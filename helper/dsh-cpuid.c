// dsh-cpuid — ask an Intel hybrid CPU which of its cores is which.
//
// macOS does not publish the split. There is no `hw.perflevel` on an Intel Mac,
// no cluster type in the IORegistry, no sysctl, and no command that will say
// which of an Alder Lake's cores are the big ones — the scheduler knows, and
// keeps it to itself. The hardware does publish it, through CPUID leaf 0x1A:
// executed on a core, it answers "what kind of core am I running on", in five
// bits, with no elevation and no driver. So the whole of the job is to execute
// it once per core, which means being on each core in turn.
//
// Two ways to get there, and the helper tries the first and falls back to the
// second. `THREAD_AFFINITY_POLICY` pins a thread to one processor, and if macOS
// honours it the answer is immediate and exact. If it does not, the leaf is
// still the truth: reading it for every logical processor in turn, over and
// over, walks the scheduler's rotations until it has been executed on each core
// — the leaf reports which processor it answered for, so the caller can tell a
// real answer from a repeat. The fallback is slower and no less certain.
//
// The answer is one JSON line, the raw core types rather than names:
//
//   {"cpus":[[0,64],[1,64],[2,32]]}     0x40 Core, 0x20 Atom
//   {"cpus":[],"reason":"not a hybrid part"}
//
// Naming the types is the host's job, so that a core type nobody has seen yet is
// a table entry in JavaScript rather than a guess in C.
//
// Build: clang -O2 -o bin/dsh-cpuid helper/dsh-cpuid.c

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#if !defined(__x86_64__) && !defined(__i386__)

// Built for the wrong architecture: the instruction this helper exists for does
// not exist here. Saying so beats printing a line of nonsense.
int main(void) {
  fputs("dsh-cpuid: CPUID is an x86 instruction and this is not an x86 build\n", stderr);
  return 1;
}

#else

#include <mach/mach.h>
#include <pthread.h>

/** The leaf that answers the question. */
#define LEAF_HYBRID 0x1a

/** Core type: the five bits the leaf gives for the processor it answers for. */
#define CORE_TYPE_MASK 0x1f

/** Logical processor number: which of the processor's threads it answered for. */
#define LOGICAL_PROCESSOR_SHIFT 16
#define LOGICAL_PROCESSOR_MASK 0x3f

/** `CPUID.1:ECX[22]`, set by every part that has two kinds of core. */
#define CPUID_HYBRID 0x400000

/** How long the unpinned sweep waits for the scheduler to cover every core. */
#define SWEEP_SECONDS 1.0

/** How many times a pinned thread re-asks before it counts the answer lost. */
#define PIN_ATTEMPTS 1000

/** The four register values, as one `cpuid` leaves them. */
typedef struct Leaf {
  uint32_t eax, ebx, ecx, edx;
} Leaf;

/** One `cpuid` with a sub-leaf, which the hybrid leaf cannot be asked without. */
static void cpuid(uint32_t leaf, uint32_t subleaf, Leaf *out) {
  __asm__ __volatile__("cpuid" : "=a"(out->eax), "=b"(out->ebx), "=c"(out->ecx), "=d"(out->edx) : "a"(leaf), "c"(subleaf));
}

/** Seconds since an arbitrary point, for the sweep's deadline. */
static double now_seconds(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
}

/**
 * Ask the leaf about one processor, and record the answer when it is about that
 * processor. A part with no hybrid leaf returns zeros, and a sample taken on
 * some other core answers for that core instead: both are answers about
 * somebody else, and neither is recorded.
 * @return true when this processor's type was recorded.
 */
static bool ask_about(int processor, int *types) {
  Leaf leaf;
  cpuid(LEAF_HYBRID, (uint32_t)processor, &leaf);
  if (leaf.eax == 0) return false;
  int answered_for = (int)((leaf.eax >> LOGICAL_PROCESSOR_SHIFT) & LOGICAL_PROCESSOR_MASK);
  if (answered_for != processor) return false;
  types[processor] = (int)(leaf.eax & CORE_TYPE_MASK);
  return true;
}

/** Pin this thread to one processor, through the affinity tag macOS keeps. */
static bool pin_to(int processor) {
  pthread_t self = pthread_self();
  if (self == NULL) return false;
  mach_port_t thread = pthread_mach_thread_np(self);
  if (thread == MACH_PORT_NULL) return false;
  // The tag is a bit per processor, and it is a hint the scheduler is free to
  // ignore: whatever answers is checked against the processor it named anyway.
  struct thread_affinity_policy policy;
  policy.affinity_tag = (integer_t)(1u << processor);
  return thread_policy_set(thread, THREAD_AFFINITY_POLICY, (thread_policy_t)&policy, THREAD_AFFINITY_POLICY_COUNT) == KERN_SUCCESS;
}

/**
 * One pass with the thread pinned to each processor in turn.
 * @return true when every processor answered.
 */
static bool probe_pinned(int processors, int *types) {
  // The tag is one bit per processor, so this only reaches a machine small
  // enough to fit in it; anything larger is the sweep's business.
  if (processors > 31) return false;
  for (int processor = 0; processor < processors; processor++) {
    if (!pin_to(processor)) return false;
    bool answered = false;
    for (int attempt = 0; attempt < PIN_ATTEMPTS && !answered; attempt++) {
      answered = ask_about(processor, types);
    }
    if (!answered) return false;
  }
  return true;
}

/**
 * One pass without pinning: read the leaf for every processor in turn, over
 * and over, until the scheduler has run this thread on each of them. A sample
 * taken on the wrong core is discarded rather than filed against the wrong
 * entry, so the sweep costs nothing but a few milliseconds.
 * @return true when every processor answered before the deadline.
 */
static bool probe_sweeping(int processors, int *types) {
  char *answered = calloc((size_t)processors, sizeof(char));
  if (answered == NULL) return false;
  int seen = 0;
  double deadline = now_seconds() + SWEEP_SECONDS;
  while (seen < processors) {
    for (int processor = 0; processor < processors && seen < processors; processor++) {
      if (answered[processor]) continue;
      if (ask_about(processor, types)) {
        answered[processor] = 1;
        seen++;
      }
    }
    if (now_seconds() > deadline) break;
  }
  free(answered);
  return seen == processors;
}

int main(void) {
  Leaf top;
  cpuid(0, 0, &top);
  if (top.eax < LEAF_HYBRID) {
    // Too old to have the leaf: a uniform part, which answers to the same
    // "no split" as one that has the leaf and does not use it.
    fputs("{\"cpus\":[],\"reason\":\"this processor has no hybrid leaf\"}\n", stdout);
    return 0;
  }
  Leaf features;
  cpuid(1, 0, &features);
  if ((features.ecx & CPUID_HYBRID) == 0) {
    fputs("{\"cpus\":[],\"reason\":\"not a hybrid part\"}\n", stdout);
    return 0;
  }

  int processors = (int)sysconf(_SC_NPROCESSORS_ONLN);
  if (processors <= 0) {
    fputs("dsh-cpuid: cannot count the logical processors\n", stderr);
    return 1;
  }
  int *types = calloc((size_t)processors, sizeof(int));
  if (types == NULL) {
    fputs("dsh-cpuid: out of memory\n", stderr);
    return 1;
  }

  // Pinned first because it is instant when it works, swept when it does not.
  if (!probe_pinned(processors, types) && !probe_sweeping(processors, types)) {
    fputs("dsh-cpuid: could not run the leaf on every logical processor\n", stderr);
    free(types);
    return 1;
  }

  fputs("{\"cpus\":[", stdout);
  for (int processor = 0; processor < processors; processor++) {
    if (processor > 0) putchar(',');
    printf("[%d,%d]", processor, types[processor]);
  }
  fputs("]}\n", stdout);
  free(types);
  return 0;
}

#endif
