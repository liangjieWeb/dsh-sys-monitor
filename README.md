# @liangjieweb/dsh-sys-monitor

A DeepSeek Harness plugin that shows the host machine's live CPU perf levels,
memory, GPU and network throughput in the Web GUI, as six progress bars with
the current value on the right, refreshed once per second.

## What it shows

| Row | Caption | Reads | Right-hand text |
| --- | --- | --- | --- |
| CPU | `P`, `S`, `E` or `CPU` | the perf levels, from the platform driver | busy percent · **clock** |
| Memory | `内存` / `Memory` | the driver's memory reader | busy percent · used/total |
| GPU | `GPU` | the driver's GPU reader | busy percent · **clock** |
| ↓ Down | `↓` | byte deltas over the physical interfaces | throughput |
| ↑ Up | `↑` | same counters, outbound direction | throughput |

Captions stay one letter or one arrow; hovering a row explains the sample with
the full name: which tier the cores belong to, how many of them, the load
average, how much memory the compressor holds, what the GPU is mapped, how many
interfaces feed the throughput. Anything the machine does not publish renders as
`—` with the reason on hover instead of a fabricated zero. Collapsed, the panel
keeps two of these rows — see [Collapsing the panel](#collapsing-the-panel).

### The drivers

`lib/platform/` is the only code that knows which system it is on. A driver
answers the same six questions everywhere — which cores belong to which tier,
what the memory is doing, what the GPU is doing, how many bytes crossed the
network, what a live clock costs — and the sampler in `lib/index.js` never asks
how. Where a system publishes nothing, the driver says so rather than guessing.

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| CPU split | `hw.perflevelN` sysctls matched against the IORegistry `cluster-type`; on Intel, CPUID leaf 0x1A | `cpuN/topology/core_type`, falling back to `topology/capacity` | nothing published |
| CPU clock | IOReport residency histograms, or the nominal frequency | `cpuN/cpufreq/scaling_cur_freq`, or the nominal frequency | the nominal frequency |
| Memory | `vm_stat` and `vm.swapusage` | `/proc/meminfo` | what the runtime's `GlobalMemoryStatusEx` reports |
| GPU busy | `ioreg` `Device Utilization %` | `nvidia-smi`, else `cardN/device/gpu_busy_percent` | `nvidia-smi` |
| GPU name | `system_profiler SPDisplaysDataType` | `nvidia-smi`, else `lspci -nn` | `nvidia-smi`, else `Win32_VideoController` |
| Network | `netstat -ibn` | `/proc/net/dev` | `netstat -e` |

A driver never throws and never invents: a machine with none of this — an
unsupported platform, a virtual CPU, a container without `/sys` — falls back to
the portable driver, which is what the runtime itself reports and nothing more.

Where a machine does publish more, an installed open-source tool is used in
preference to parsing a kernel file: `nvidia-smi` is the one vendor tool that
answers "how busy is this GPU right now" to an ordinary user, and it reports the
clock and the model on the way past. It is what the Linux and Windows drivers
reach for first, and it is the whole GPU row when it is installed.

### The CPU split

**Apple silicon** runs two kinds of core, and macOS publishes the division
without elevation in two places: the `hw.perflevelN.name` / `.logicalcpu`
sysctls name the levels and count their cores, while each `cpuN` node in the
IORegistry carries a `cluster-type` — the device-tree marker that tells the two
core implementations apart (`apple,sawtooth` vs `apple,everest` on an M5 Pro).
The Host groups the cores by that marker, matches the groups onto levels by
core count, and reports each group's busy share of its own capacity. On an M5 Pro
that is `P` = 12 Performance cores and `S` = 6 Super cores.

**Intel Macs** split their cores too, in the hardware, and publish nothing about
it: no perf-level sysctl, no cluster type, no command that will say which of an
Alder Lake's cores are the big ones. The CPU itself publishes it, through CPUID
leaf 0x1A — executed on a core, it answers "what kind of core am I running on",
with no elevation and no driver. So the whole of the job is to execute it once
per core, which means being on each core in turn, which is what
`helper/dsh-cpuid.c` does: one JSON line of `[[logicalCpu, coreType], …]`, and
the naming of the two types stays in JavaScript.

**Linux** says so itself. `cpuN/topology/core_type` is the number the scheduler
draws its own decisions from — `CPU_TYPE_EFFICIENT` against
`CPU_TYPE_PERFORMANCE` on arm64, `CPU_CORE_TYPE_INTEL_ATOM` against
`CPU_CORE_TYPE_INTEL_CORE` on x86 — and the higher one is the performance tier on
both, because only the low value is the same on both. Kernels too old for that
still publish `topology/capacity`, whose normalised maximum is the fast core.

**A machine that publishes no split** — every desktop part, every virtual
machine, every Windows machine — draws the whole processor as one `CPU` row
rather than a division the machine never reported. That is the "performance
core" the row stands for: on a uniform part every core is one, and the hover
says so.

### The clocks

A live clock is in different places on different systems, and in none of them is
it free.

On **Apple silicon** it is in **IOReport**, a private IOKit interface whose only
command-line front end is `powermetrics`, and `powermetrics` refuses to run as
anything but root. `macmon` calls itself "sudoless" because it links the private
IOReport symbols directly and reads them as an ordinary user; so does
`helper/dsh-ioreport.c` here. The helper subscribes to the frequency channels —
`PCPU*` for the top tier, `ECPU*`/`MCPU*` for the tier below, `GPUPH` for the
GPU — and prints one JSON line of residency histograms per second. It stops
there on purpose: each channel is one counter per DVFS state, and pairing those
with the `voltage-states*` state tables the Host reads from the `pmgr` node
yields the average clock a cluster actually ran at. That arithmetic stays in
JavaScript, where it is testable.

On **Linux** it is a file: `cpuN/cpufreq/scaling_cur_freq`, in kilohertz, per
logical CPU. A tier's clock is the mean of its own cores — the same share of its
own capacity the busy percentage beside it reports — and no process is involved.

On **NVIDIA cards** anywhere, `nvidia-smi` reports the graphics clock along with
the utilisation, so the GPU row has a live clock on Linux and Windows too.

| Layer | Reads | Needs |
| --- | --- | --- |
| `helper/dsh-ioreport.c` | IOReport residency histograms | the compiled helper, no root |
| `helper/dsh-cpuid.c` | CPUID leaf 0x1A, once per core | the compiled helper, no root |
| `lib/platform/*.js` | everything else | nothing |

Without a helper the panel keeps working and shows the nominal frequency the
runtime reports for that tier's cores, labelled 标称频率 / `nominal clock` in the
tooltip so the two are never confused. A helper runs only while a browser is
polling, and is killed with the sampler. Where no live clock exists at all —
Windows, an Intel Mac, a Linux box with no cpufreq driver — the panel says why
under the rows instead of drawing a number that never changes.

### Collapsing the panel

Collapsing leaves the same box one line high: the title, then the CPU's busy
share of the whole socket and memory in use, then the gear and the arrow. The
two rows sit *in* the header, between the title and the buttons, rather than on a
row of their own under it — the header is the whole panel, and there is no body
left to stack anything in. It draws no rule under itself for the same reason.
The panel does not change width — an overlay parked in a corner stays exactly
where it was put, and its edges do not move out from under a muscle memory — so
what it gives up is the room inside: 272×185 becomes one line about 28px high,
two of the six rows on tracks a third as long. Nothing is fetched less often
either way: it is the same one-second sample, drawn with less of itself.

Each half of the line keeps the caption, the colour and the hover text the wide
panel gives it, so the sample is still explained in full — which perf levels the
CPU share is made of, how much memory the compressor holds, what the swap is
doing. The figures that do not fit beside a short bar are the ones that were in
the tooltip already: the clock beside a percentage, the used-over-total beside
memory's. The six-row panel comes back on one more click, and the gear on the
way there opens the panel as well, since the settings have no room in a header
that short.

Because the width never changes there is one `PANEL_WIDTH` and one clamp: a drag
from a collapsed panel lands where the same drag of the expanded one would have.
The stylesheet agrees — `.dshsm--mini` carries no `width` of its own, only the
row direction and the split between the two halves.

### Which way it opens

A panel opens into the room it has. The header is the part the user put where
they wanted it, so it is the part that stays put: a panel whose header sits below
the middle of the window opens **upward**, with the body above the header, and one
above the middle opens **downward**. The body moves; the header does not.

The two are different in the stylesheet — `--up` reverses the panel's flex
column, and takes the rule under the header with it so a reversed panel does not
grow a stray line along its outer edge. They are also different in what they are
anchored by: an upward-opening panel is pinned by its bottom edge rather than its
top, so the edge the header is on stays where it was put while the body grows
away from the middle of the window.

The arrow on the collapse button says which way the panel will go, and it is
the *icon* that turns to say so: down for a panel that opens downward, up for
one that opens upward. The button itself never turns — a rotated button takes
its own hover background and hit area round with it, and the arrow stops
sitting still under the pointer while the panel is opening.

The glyph is drawn by the stylesheet (`::before`) rather than written into the
button, precisely so there is one element to animate. The turn is 180ms, and a
reader who has asked for less motion gets none of it.

The direction is judged from the *header*, not the panel, and it can change
mid-drag — crossing the middle swaps both the order and the pinned edge at once,
so a header held at the pointer does not jump by its own body's height. A panel
nobody has moved is not judged at all: its corner already says which way it
opens, and the corner is the fallback.

### Moving the panel

The blank space beside the title is a handle: hold it and the panel follows the
pointer, keeping the grip you took hold of rather than jumping its header up to
the cursor. Release and the panel stays where you left it — one JSON object in
`localStorage` under `dsh-sys-monitor.position`, read once at mount, and a
double-click on the title sends it back to the corner and forgets the position.

The panel is parked in the top-right corner, which is where the window's own
title strip is, and Electron decides its drag regions *geometrically*: any press
whose coordinates land in a `drag` region moves the window, whatever is drawn
there. So the panel declares `-webkit-app-region: no-drag`, which subtracts its
whole box from that region — without it the header would move the window, and
the panel would sit there while the window ran.

A drag is clamped to the window: the panel may hang off an edge, but never so
far that a corner of it is gone, and the header — the only part you can grab it
by — always stays on screen. The stored position is put through the same clamp
when it is read, so a panel parked on a large display slides back into view
rather than vanishing on a small one. A press and release in one spot is a
click, not a drag: the panel does not move, and the grip is handed back so the
next gesture starts its own — including after a release the window never saw,
over the menu bar or anywhere else, which arrives as a blur rather than as an
event.

The move is painted through the panel's own style for the duration of the drag
and committed once at the end, rather than through a state update per
`pointermove` — six rows are not worth rebuilding to shift a box.

### Settings

The header carries a gear next to the collapse arrow. It opens the appearance
controls, which repaint the panel behind them, so a colour is judged where it
will be used:

| Control | Effect |
| --- | --- |
| Background | The panel's own colour. The trough behind the bars is shaded from it, since no theme token describes a colour the user picked. |
| Background opacity | How much of the page shows through the panel. Applies to the theme colour too, not only to a chosen one. |
| Text | One colour for the panel, with the titles, captions and notes derived from it at 75% and 55% rather than left on a theme colour that is no longer in use. |
| Border | The panel's edge. Left on the theme token it is the one line the panel is read by, so it gets a field of its own: an edge has to move *away* from the background, and the trough's shading cannot do that — shaded, a black panel's border came out black too. |
| Bar colour | One colour for all six bars. Each row keeps its own theme colour as the fallback it drops back to. |
| Bar opacity | The strength of the fill, kept apart from its colour so a pale hue stays readable. |
| Background blur | How far the page behind a translucent panel is blurred, 0–24px. |
| Font | The face the panel is drawn in: follow the theme, monospace, sans or serif. Covers the titles, the row captions and every value. |
| Text size | 9–15px, the size the panel's own text is written at. The whole panel is drawn proportionally larger or smaller, so the text costs the panel width and height, not just the row it sits on. |
| Reset | Puts every field back, and goes quiet once there is nothing left to reset. |

Every colour field is a *default-or-chosen* pair: the input shows the theme
token's own colour at half strength, and the `⟲` beside it hands the field back
to the theme. A panel nobody has touched therefore carries no inline style at
all and follows the theme exactly as before, including a theme switch at
runtime.

A face is a menu rather than a `⟲` row, because a menu can say "none of these"
by itself: the first entry is the page's own face, and picking it takes the
custom property away instead of setting it to nothing. The panel reads it as
`font-family: var(--dshsm-font, inherit)`, so an untouched panel inherits the
page's face rather than declaring one — the same "no inline style at all" rule
the colour fields follow, and the reason a theme switch at runtime still shows.
`dsh-token-usage` offers the same four entries in the same order, so a face
chosen in one panel is the same face in the other.

What the record holds is the *key* (`"mono"`, not `ui-monospace,…`); the stack
itself is looked up in the table in `lib/client.js`. A font is a field the user
can type into, and the table is the only place a `font-family` value can come
from — the same reason a colour is checked with `parseHex()` before it reaches a
stylesheet. The entries are stacks ending in a generic family: a name this
machine does not have falls through to the next, where a single missing name
would leave the browser with the panel's inherited face and no sign of why.

The text size is a **zoom**, `zoom: var(--dshsm-scale, 1)`, and not a
`font-size` on the panel root, so that every size in the panel moves together:
the row captions, the values, the bar heights and the collapsed panel's total
are all written against one base size, and a `font-size` would move the text
and leave the boxes it has to sit in exactly where they were. It is a menu
rather than a slider because every value in it lays the panel out again, and a
slider doing that under the pointer that is dragging it moves the box that
pointer is measured against. The record holds the pixels (11, 15), the
stylesheet gets the ratio, and a stored number that is not on the menu is not
clamped into one — it falls back to the size the panel was drawn at, the same
way an unknown font key falls back to the page's face.

One measurement follows from the zoom: the panel is *wider* on screen than its
272px, so the drag clamp that keeps a corner on screen measures the width it is
drawn at — otherwise a 15px panel dragged to the left edge hangs a third of
itself off screen. That width is rounded before the clamp compares, so a stored
position stays a whole number of pixels at any size. A stored position is put
through that same clamp on load, so a panel left at the edge at one size keeps
its corner at another.

Which element the zoom is on is the load-bearing part, and it is why the panel is
two elements. **Chromium scales a zoomed box's `left`, `top` and `bottom` by the
same factor it scales the box's size.** A `zoom` on the element the panel is
positioned with therefore turns every offset into a number in the wrong space: a
drag that measured `left: 500px` against the pointer and wrote it back would put
the panel at 682 — it follows the hand at the wrong speed, and the position it
stores is wrong by the same factor. Dividing before writing fixes the two ends
and leaves the middle, a conversion whose rounding is the fraction a whole-pixel
offset costs, which is the kind of half-pixel a user sees as a drag that does not
track.

So `.dshsm` is the element the panel is positioned with — plain `position:fixed`,
plain `top`/`right`, **never scaled** — and `.dshsm__box` is the panel that is
drawn, carrying the border, the background, the face, the 11px base size and the
zoom. Nothing is converted anywhere: the offsets a drag writes are the pixels the
pointer is in, at every size, and the parked corner is a plain
`top: 10px; right: 10px` because the gap is measured on an unscaled element too.

That only works because the root is exactly as big as the panel drawn inside it.
Its *height* already is — a zoomed child brings its height back to the
parent — but its *width* is its own, so it is
`calc(272px * var(--dshsm-scale, 1))`: a root
pinned at 272px under a panel drawn 371px wide hangs 99px of itself off the
right-hand edge of the window at 15px, and its 10px gap is a gap in a panel nobody
can see the end of.
A position in the record is in screen pixels, which is what a drag measures, so a
panel left at 500,300 opens at 500,300 at any size — measured, not argued.

The header is the one thing the box does not answer for, and it is read through
it: `headerOf()` walks root → box → header, because an upward-opening panel is
pinned by its bottom edge, so its box *begins* at the far end of the panel and
the gap between the two is the whole body. Measuring the box instead would let
the grab point slide by the panel's height the moment a drag began.

A colour the user chose is applied as the `rgba()` it was mixed into in
JavaScript, opacity included. A theme token is only a *name* in the panel, so
the one case that has to be mixed in CSS — a token asked to be translucent —
is a class of its own (`dshsm--tinted`, `dshsm--tinted-bars`) rather than a
rule every panel carries: a `color-mix()` that cannot resolve takes the whole
declaration with it, and an untouched panel must not depend on one. Where it
cannot resolve at all, the panel simply stays opaque instead of turning
transparent.

The record is one JSON object in `localStorage` under `dsh-sys-monitor.appearance`,
written whenever it changes and read once at mount. It is sanitized on the way
in and on the way out: an opacity past its end clamps, a colour that is not a
colour falls back to the theme, a font that is not one of the panel's own keys
falls back to the page's face, a text size that is not one the panel draws at
falls back to the one it does, and a record that will not parse is ignored —
a stale key from an older build costs one field, never the panel.

### About the other numbers

CPU busy percentages come from the kernel's own per-core tick counters: each
tier is reported as the share of *its own* capacity that was busy, so one
saturated core out of twelve reads as 8%. Memory in use is counted the way the
platform counts it — Activity Monitor's application, wired and compressor pages
on macOS, `MemTotal` minus `MemAvailable` on Linux, what `GlobalMemoryStatusEx`
calls available on Windows — leaving out reclaimable file cache in every case.
GPU percentage is the IOKit `Device Utilization %` on macOS, which counts
activity on the whole device rather than GPU active time, and `nvidia-smi`'s
utilization on a machine that has one.

Throughput is a difference between two cumulative counter reads, so a counter
that stands still or moves backwards reports zero rather than a negative rate.
Loopback, bridges, tunnels, Apple AWDL links and Windows' virtual adapters are
excluded by default: a tunnel mirrors the bytes its physical link already
carries, and counting both would double every number. The macOS read passes
`-n`: without it `netstat` reverse-resolves every address it prints, and one
lookup that does not answer takes longer than the per-command timeout, which
would leave the row empty on a machine whose counters are perfectly readable.

## How it is wired

- **Host half** (`lib/index.js`) registers one route,
  `/api/sys-monitor.sample`, inside the connection's `/api` fetch fence, and
  answers it with the latest JSON snapshot. Sampling runs on a one-second
  interval that only stays alive while a browser polled within the last 15
  seconds, so an idle profile costs nothing. Every helper command is bounded by
  a 2.5 s timeout so a wedged toolchain cannot stall a tick.
- **Driver layer** (`lib/platform/`) picks itself by `process.platform` and
  answers for it. Every member resolves and never rejects: a system that
  publishes nothing is a normal thing to meet. Each driver reads through an
  injected environment — commands, files, the core list — so it can be exercised
  against a fixture instead of the machine it was written for.
- **Client half** (`lib/client.js`) is a prebuilt browser bundle that mounts one
  `shell.overlay` entry in the top-right corner. It polls the same-origin route
  every second, keeps at most one request in flight, skips polling while the page
  is hidden, and keeps the last good sample visible if a poll fails. Its
  appearance — colours, opacities, blur — and its place on screen are the panel's
  own settings, persisted in the page's storage; the half holds no tuning of its
  own. It draws whatever tiers it is given, which is why a new platform needs no
  change to the browser half.
- **Bundle** (`cordis.patch.yml`) declares a single Loader row. The client half
  is discovered from the same entry through the package's `dsh.client`
  declaration, so one row mounts both halves.

The perf-level discovery, the DVFS tables and the GPU model are read once and
cached; the one-second path only re-reads the counters.

The client bundle is authored in the platform's `window.__ModuleLoader__.load`
form and needs no build step. Editing `lib/client.js` is picked up on the next
page refresh; editing `lib/index.js` or anything under `lib/platform/` needs the
plugin reloaded, because the Host half is evaluated at startup.

## Build the helpers (optional)

```bash
tools/build-helper.sh      # or: npm run build:helper
```

One `clang` invocation, nothing to install; it needs the Xcode command line
tools. Which helper it builds depends on the machine, because each one is for
an architecture the other does not have:

| Machine | Builds | Check it with |
| --- | --- | --- |
| Apple silicon | `bin/dsh-ioreport` — live clocks | `./bin/dsh-ioreport -i 1000` |
| Intel Mac | `bin/dsh-cpuid` — the P/E split | `./bin/dsh-cpuid` |

`ARCH=x86_64 tools/build-helper.sh` builds for the other architecture, which is
the only way to check on an Apple silicon machine the helper it cannot run there.
The binaries are build artifacts and are not checked in. The plugin finds them
relative to itself, so a `link:` install keeps working wherever the directory
lives.

## Install

From npm:

```bash
dsh plugin --profile demo add @liangjieweb/dsh-sys-monitor
```

Or straight from this repository:

```bash
dsh plugin --profile demo add github:liangjieWeb/dsh-sys-monitor
```

Once installed, the Plugins page in the sidebar lists it and toggles its row.
To develop against a local checkout instead, link that directory:

```bash
dsh plugin --profile demo add /path/to/dsh-sys-monitor
```

A linked install records a `link:` dependency, so the installed copy is that
directory: edit the source there, reload the plugin, and refresh the page.

## Tune

Everything tunable, and where it lives:

| Constant | File | Meaning |
| --- | --- | --- |
| `INTERVAL_MS` | `lib/platform/shared.js` | sample cadence, default 1000 |
| `IDLE_TIMEOUT_MS` | `lib/platform/shared.js` | how long the sampler lives after the last poll |
| `COMMAND_TIMEOUT_MS` | `lib/platform/shared.js` | per-command ceiling |
| `NET_FULL_SCALE_BPS` | `lib/platform/shared.js` | throughput that fills a network bar |
| `INTERFACE_PATTERNS` | `lib/platform/shared.js` | which interfaces count toward throughput |
| `SYSTEM_COMMANDS` | `lib/platform/shared.js` | where each system keeps the commands it uses |
| `CLOCK_RETRY_MS` | `lib/platform/darwin.js` | how long to wait before restarting a helper that exited |
| `GPU_CLASSES` | `lib/platform/darwin.js` | which ioreg classes hold GPU counters |
| `MAX_CLOCK_SAMPLES` | `lib/platform/linux.js` | how many of a tier's cores a clock reading samples |

## Verify without installing

```bash
node tools/probe.mjs        # runs the Host half and prints four real samples
node tools/driver-check.mjs # runs every driver against a fixture, not a machine
node tools/render-check.mjs # executes the browser bundle and checks the six rows
```

`probe.mjs` runs the Host half against a stub Cordis context, so the numbers can
be checked on a machine before the plugin is mounted in a profile — and, run on
a machine that is not this one, it says what that machine publishes. `node
tools/probe.mjs 64` adds 64 MB of `dd` load between samples, which is a quick
way to see the two CPU tiers diverge.

`driver-check.mjs` is how the platforms that cannot be run here are checked. It
hands each driver a fixture instead of a machine: a fake `/sys` for an arm64
big.LITTLE part and for an Intel hybrid one, a fake `/proc`, a canned
`nvidia-smi`, `lspci` and `netstat -e`, the CPUID helper's JSON and an
interface table for a Mac, and a Windows adapter table. It checks what each one
makes of them — the tiers, the clock a tier is given, memory, throughput, the
GPU row — and then checks the sampler on a driver it has never heard of.
Writing a kernel parser from a description of a kernel is how parsers end up
quietly wrong: the fixture for `/proc/net/dev` caught one on the first run.

`render-check.mjs` executes `lib/client.js` the way the page does — through
`window.__ModuleLoader__.load` — against a stub React, then renders the
registered overlay entry and asserts the rows, the formatted values, the bar
widths, the terse captions, the hover text, and the one-second poll cadence.
It seeds page storage with a hostile appearance record and then checks that the
panel opens on the parts of it that survived, that each control writes the
custom properties the stylesheet reads, and that a reset puts every field back.
It then drags the panel by its title — including a drag that runs off the edge
of the window, a press and release that moved nothing, a right-button press, and
a double-click — and checks the position it keeps, the one it puts back on
reload, and the ones it refuses. Last it collapses the panel and checks the two
figures that are left sharing one line, their hover text, the gear that has to
open the panel on its way to the settings, and that a drag of the collapsed
panel lands where the same drag of the expanded one does.
