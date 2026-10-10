// dsh-ioreport — stream the live frequency-state residency histograms that
// Apple silicon publishes through IOReport.
//
// The clock a CPU or GPU cluster is running at right now lives in IOReport, a
// private IOKit interface with no command-line front end: the only Apple tool
// that reads it is powermetrics, and powermetrics refuses to run as anything
// but root. macmon gets around that by linking the private symbols directly,
// and so does this helper — as an unprivileged user, no sudo, no kext.
//
// What comes out of IOReport is not a frequency. Each channel is a residency
// histogram: one counter per DVFS state, labelled either `IDLE`/`DOWN`/`OFF` or
// with a frequency number in whatever unit the machine uses. The helper
// deliberately stops there and prints the raw histograms; pairing them with the
// `voltage-states*` tables the plugin reads from IORegistry is the host's job,
// so the scaling and the tier mapping stay in testable JavaScript.
//
// One JSON line per interval on stdout, for example:
//
//   {"ch":{"MCPU0":[["DOWN",0],["IDLE",900],["2640",80]],
//           ["PCPU0",[["IDLE",980]]],
//           ["GPUPH",[["OFF",600],["338",40]]]]}
//
// Build: clang -O2 -o bin/dsh-ioreport helper/dsh-ioreport.c \
//            -framework IOKit -framework CoreFoundation \
//            -Wl,-undefined,dynamic_lookup

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Private IOReport interface, resolved at load time from the dyld shared cache.
// The `-Wl,-undefined,dynamic_lookup` link flag is what lets the binary build
// against a header the SDK does not ship.
extern CFDictionaryRef IOReportCopyAllChannels(uint32_t, uint32_t);
extern void *IOReportCreateSubscription(void *allocator, CFMutableDictionaryRef channels,
                                        void **subscription, uint64_t flags, CFTypeRef options);
extern CFDictionaryRef IOReportCreateSamples(void *subscription, CFMutableDictionaryRef options,
                                             CFTypeRef out);
extern CFDictionaryRef IOReportCreateSamplesDelta(CFDictionaryRef previous, CFDictionaryRef current,
                                                   CFTypeRef out);
extern CFStringRef IOReportChannelGetGroup(CFDictionaryRef item);
extern CFStringRef IOReportChannelGetSubGroup(CFDictionaryRef item);
extern CFStringRef IOReportChannelGetChannelName(CFDictionaryRef item);
extern int64_t IOReportStateGetCount(CFDictionaryRef item);
extern CFStringRef IOReportStateGetNameForIndex(CFDictionaryRef item, int64_t index);
extern int64_t IOReportStateGetResidency(CFDictionaryRef item, int64_t index);

/** One channel we keep, by the name the host will look it up under. */
typedef struct {
  char name[96];
  CFDictionaryRef item;
} Channel;

/** Channel name as a C string, empty when the key is missing or not a string. */
static void copy_string(CFStringRef value, char *into, size_t size) {
  into[0] = '\0';
  if (value == NULL || CFGetTypeID(value) != CFStringGetTypeID()) return;
  CFStringGetCString(value, into, (CFIndex)size, kCFStringEncodingUTF8);
}

static bool name_is(const char *name, const char *value) {
  return strcmp(name, value) == 0;
}

/**
 * Does this channel carry a cluster's frequency residency?
 *
 * The CPU layout names the top tier `PCPU*` and the other tier `ECPU*` or
 * `MCPU*` — M5 Pro splits what M1-M4 called Performance and Efficiency into
 * Super and Performance, but the channel names kept both spellings. Ultra parts
 * prefix every channel with its die and separate cluster from core. Only the
 * frequency subgroup is sampled: the rest of `CPU Stats` is power and IP counters
 * this plugin has no use for.
 */
static bool wants_cpu_channel(const char *channel) {
  return strstr(channel, "PCPU") != NULL || strstr(channel, "ECPU") != NULL ||
         strstr(channel, "MCPU") != NULL;
}

/** The GPU publishes one frequency channel, `GPUPH`, on every part. */
static bool wants_gpu_channel(const char *channel) { return strstr(channel, "GPUPH") != NULL; }

/** Copy every wanted channel out of the full catalogue, in catalogue order. */
static CFIndex select_channels(CFDictionaryRef all, Channel **out) {
  CFArrayRef items = (CFArrayRef)CFDictionaryGetValue(all, CFSTR("IOReportChannels"));
  if (items == NULL || CFGetTypeID(items) != CFArrayGetTypeID()) return -1;
  CFIndex count = CFArrayGetCount(items);

  Channel *channels = calloc((size_t)count, sizeof(Channel));
  if (channels == NULL) return -1;

  CFIndex kept = 0;
  for (CFIndex index = 0; index < count; index++) {
    CFDictionaryRef item = (CFDictionaryRef)CFArrayGetValueAtIndex(items, index);
    if (item == NULL || CFGetTypeID(item) != CFDictionaryGetTypeID()) continue;
    char group[64];
    char subgroup[96];
    char channel[96];
    copy_string(IOReportChannelGetGroup(item), group, sizeof(group));
    copy_string(IOReportChannelGetSubGroup(item), subgroup, sizeof(subgroup));
    copy_string(IOReportChannelGetChannelName(item), channel, sizeof(channel));

    bool cpu = name_is(group, "CPU Stats") && name_is(subgroup, "CPU Core Performance States") &&
               wants_cpu_channel(channel);
    bool gpu = name_is(group, "GPU Stats") && name_is(subgroup, "GPU Performance States") &&
               wants_gpu_channel(channel);
    bool wanted = cpu || gpu;
    if (!wanted) continue;
    memcpy(channels[kept].name, channel, sizeof(channel));
    channels[kept].item = item;
    kept++;
  }

  // The caller turns these into the subscription dictionary; the catalogue
  // entries themselves stay owned by `all`.
  *out = channels;
  return kept;
}

/**
 * A mutable copy of the catalogue carrying only the wanted channels, which is
 * what the subscription is created from.
 */
static CFMutableDictionaryRef subscription_channels_for(CFDictionaryRef all, const Channel *channels,
                                                        CFIndex kept) {
  CFMutableDictionaryRef subscription = CFDictionaryCreateMutableCopy(kCFAllocatorDefault, kept, all);
  if (subscription == NULL) return NULL;
  CFMutableArrayRef selection = CFArrayCreateMutable(kCFAllocatorDefault, kept, &kCFTypeArrayCallBacks);
  for (CFIndex index = 0; index < kept; index++) CFArrayAppendValue(selection, channels[index].item);
  CFDictionarySetValue(subscription, CFSTR("IOReportChannels"), selection);
  CFRelease(selection);
  return subscription;
}

/** Write one JSON string, escaping the two characters that would break it. */
static void put_json_string(const char *value) {
  putchar('"');
  for (const char *at = value; *at != '\0'; at++) {
    if (*at == '"' || *at == '\\') putchar('\\');
    putchar(*at);
  }
  putchar('"');
}

/** Print one delta sample: every channel with its per-state residency. */
static void print_sample(const Channel *channels, CFIndex kept, CFDictionaryRef delta) {
  CFArrayRef items = (CFArrayRef)CFDictionaryGetValue(delta, CFSTR("IOReportChannels"));
  if (items == NULL || CFGetTypeID(items) != CFArrayGetTypeID()) {
    fputs("{\"ch\":{}}\n", stdout);
    return;
  }
  fputs("{\"ch\":{", stdout);
  bool first = true;
  for (CFIndex index = 0; index < kept; index++) {
    // The sample keeps the channel order the subscription was built from.
    if (index >= CFArrayGetCount(items)) break;
    CFDictionaryRef item = (CFDictionaryRef)CFArrayGetValueAtIndex(items, index);
    if (item == NULL || CFGetTypeID(item) != CFDictionaryGetTypeID()) continue;
    if (!first) putchar(',');
    first = false;
    put_json_string(channels[index].name);
    fputs(":[", stdout);
    int64_t states = IOReportStateGetCount(item);
    for (int64_t state = 0; state < states; state++) {
      if (state > 0) putchar(',');
      CFStringRef name = IOReportStateGetNameForIndex(item, state);
      char label[64];
      copy_string(name, label, sizeof(label));
      if (label[0] == '\0') snprintf(label, sizeof(label), "S%d", (int)state);
      putchar('[');
      put_json_string(label);
      printf(",%lld", (long long)IOReportStateGetResidency(item, state));
      putchar(']');
    }
    putchar(']');
  }
  fputs("}}\n", stdout);
  fflush(stdout);
}

int main(int argc, char **argv) {
  unsigned interval_ms = 1000;
  for (int index = 1; index < argc - 1; index++) {
    if (strcmp(argv[index], "-i") == 0) interval_ms = (unsigned)atoi(argv[index + 1]);
  }

  CFDictionaryRef all = IOReportCopyAllChannels(0, 0);
  if (all == NULL) {
    fprintf(stderr, "dsh-ioreport: IOReportCopyAllChannels failed\n");
    return 1;
  }
  Channel *channels = NULL;
  CFIndex kept = select_channels(all, &channels);
  if (kept < 0) {
    fprintf(stderr, "dsh-ioreport: no IOReport channel catalogue\n");
    return 1;
  }
  if (kept == 0) {
    fprintf(stderr, "dsh-ioreport: this machine publishes no frequency channels\n");
    return 1;
  }

  CFMutableDictionaryRef subscription_channels =
      subscription_channels_for(all, channels, kept);
  CFRelease(all);
  if (subscription_channels == NULL) {
    fprintf(stderr, "dsh-ioreport: cannot narrow the channel catalogue\n");
    return 1;
  }

  // The subscription is the return value; the out parameter is a companion
  // client reference this helper never needs to touch again.
  void *client = NULL;
  void *subscription = IOReportCreateSubscription(NULL, subscription_channels, &client, 0, NULL);
  if (subscription == NULL) {
    fprintf(stderr, "dsh-ioreport: IOReportCreateSubscription failed\n");
    return 1;
  }
  fprintf(stderr, "dsh-ioreport: %lld frequency channels\n", (long long)kept);

  while (1) {
    // The channel dictionary doubles as the per-sample options; the second
    // argument is not optional even though nothing in it has to change.
    CFDictionaryRef before = IOReportCreateSamples(subscription, subscription_channels, NULL);
    if (before == NULL) {
      fprintf(stderr, "dsh-ioreport: IOReportCreateSamples failed\n");
      return 1;
    }
    usleep(interval_ms * 1000);
    CFDictionaryRef after = IOReportCreateSamples(subscription, subscription_channels, NULL);
    if (after == NULL) break;
    // Residency counters are cumulative, so one interval is a delta of two.
    CFDictionaryRef delta = IOReportCreateSamplesDelta(before, after, NULL);
    CFRelease(before);
    CFRelease(after);
    if (delta != NULL) {
      print_sample(channels, kept, delta);
      CFRelease(delta);
    }
  }
  return 0;
}
