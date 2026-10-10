// The Linux driver: everything the kernel publishes under /sys and /proc.
//
// Linux is the platform that publishes the most and the cheapest: the topology
// a hybrid CPU splits itself into, the frequency each core is running at, the
// counters behind `free` and the network devices, all readable by anyone. The
// only thing it will not hand over unprivileged is a busy percentage for a GPU
// that is not NVIDIA's, so that row comes from a vendor tool when one is
// installed and says so when none is.

import { readNvidia } from './nvidia.js'
import { clampPercent, coversEveryCore, createEnvironment, groupCores, inCpuOrder, interfacePattern, number } from './shared.js'

/** Where the kernel describes the processors. */
const CPU_ROOT = '/sys/devices/system/cpu'

/** Where the DRM drivers describe the graphics cards. */
const DRM_ROOT = '/sys/class/drm'

/** How many cores of one tier a single clock sample reads, at most. */
const MAX_CLOCK_SAMPLES = 12

/**
 * The two kinds of core a hybrid Linux CPU comes in, named here because the
 * kernel does not: `core_type` is a number whose magnitude orders the kinds —
 * `CPU_TYPE_EFFICIENT` 1 against `CPU_TYPE_PERFORMANCE` 4 on arm64,
 * `CPU_CORE_TYPE_INTEL_ATOM` 1 against `CPU_CORE_TYPE_INTEL_CORE` 2 on x86 —
 * and only the low value is the same on both. So the higher kind is the
 * performance tier, the lower one is the efficiency tier, and the names are
 * this plugin's to give. A part with one kind reports a single value, or no
 * file at all, and neither is a split.
 */
const TIERS = {
  performance: { label: 'P', name: 'Performance' },
  efficiency: { label: 'E', name: 'Efficiency' },
}

/** One entry per logical CPU, or undefined when the file is not there. */
async function readPerCore(env, file) {
  const total = env.cpus().length
  if (total === 0) return undefined
  const values = await Promise.all(
    Array.from({ length: total }, async (_unused, index) => number(await env.readFile(`${CPU_ROOT}/cpu${index}/${file}`))),
  )
  // One core that will not answer makes the whole table unusable: a partial
  // read would silently invent a tier boundary nobody drew.
  return values.some((value) => value === undefined) ? undefined : values
}

/**
 * The split by `core_type`, which is the kernel's own answer and the one to
 * believe: the drivers derive scheduling decisions from it, so it is the same
 * division the CPU is actually run under.
 */
async function readCoreTypes(env) {
  return readPerCore(env, 'topology/core_type')
}

/**
 * The split by capacity, for the arm64 kernels that predate `core_type`.
 * Capacity scaling normalises the fastest core to 1024, so the ordering means
 * the same thing and the higher value is still the performance tier.
 */
async function readCapacities(env) {
  return readPerCore(env, 'topology/capacity')
}

/**
 * Two values into two tiers, or undefined when there is no split to draw.
 * @param values - one number per logical CPU.
 * @returns the tiers in the kernel's own core order, or undefined.
 */
function tiersFromValues(values) {
  const kinds = [...new Set(values)].sort((a, b) => a - b)
  // Zero or one kind is a uniform part, and one row for the whole processor is
  // the honest answer for it. More than two is a part this plugin has no names
  // for, and two rows drawn across three kinds would be a division nobody drew.
  if (kinds.length !== 2) return undefined
  const [higher] = kinds.slice(1)
  const groups = inCpuOrder(
    groupCores(
      values.map((value, index) => [index, value === higher ? 'performance' : 'efficiency']),
    ),
  )
  if (!coversEveryCore(groups, values.length)) return undefined
  return [...groups].map(([kind, logicalCpus]) => ({ ...TIERS[kind], cores: logicalCpus.length, logicalCpus }))
}

/**
 * Which cores belong to which tier, or undefined when the machine publishes no
 * split — which is every desktop part, every virtual CPU, and every kernel too
 * old to know about the question.
 * @param env - the environment to read through.
 * @returns the tiers, or undefined.
 */
export async function discoverTiers(env) {
  const coreTypes = await readCoreTypes(env)
  if (coreTypes !== undefined) return tiersFromValues(coreTypes)
  const capacities = await readCapacities(env)
  return capacities === undefined ? undefined : tiersFromValues(capacities)
}

/** The cores to read a tier's clock from: all of them, up to a sane number. */
function sampleCores(logicalCpus) {
  if (logicalCpus.length <= MAX_CLOCK_SAMPLES) return logicalCpus
  const step = logicalCpus.length / MAX_CLOCK_SAMPLES
  return Array.from({ length: MAX_CLOCK_SAMPLES }, (_unused, at) => logicalCpus[Math.floor(at * step)])
}

/**
 * Live frequencies straight from the cpufreq driver, which needs no resident
 * process: `scaling_cur_freq` is a per-logical-CPU number in kilohertz, so a
 * tier's clock is the mean of its own cores — the same "share of its own
 * capacity" the busy percentage next to it reports.
 *
 * A tier whose cores have no such file — a machine with no cpufreq driver, a
 * virtual CPU, anything under a cgroup that pins frequency — is left out, and
 * the panel falls back to the nominal figure for that tier alone.
 */
function createClockReader(env) {
  let state = { available: false, reason: 'not read yet' }

  async function read(tiers = []) {
    const groups = []
    let answered = 0
    for (const tier of tiers) {
      const readings = await Promise.all(
        sampleCores(tier.logicalCpus).map(async (index) => number(await env.readFile(`${CPU_ROOT}/cpu${index}/cpufreq/scaling_cur_freq`))),
      )
      const measured = readings.filter((value) => value !== undefined)
      if (measured.length === 0) continue
      answered++
      groups.push({
        logicalCpus: tier.logicalCpus,
        cores: tier.cores,
        mhz: Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length / 1000),
      })
    }
    // One tier answering is a real sample; none of them answering is a machine
    // that publishes no frequency, and the panel should say so rather than draw
    // a nominal clock as if it were live.
    state = answered > 0 ? { available: true, reason: undefined } : { available: false, reason: 'no cpufreq driver' }
    return { groups, gpuMhz: undefined }
  }

  return {
    read,
    status: () => state,
    dispose() {},
  }
}

/** Linux memory in use: everything the kernel can hand out on demand is free. */
async function readMemory(env) {
  const raw = await env.readFile('/proc/meminfo')
  if (raw === undefined) return portableMemory(env)
  const kib = new Map()
  for (const line of raw.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line)
    if (match !== null) kib.set(match[1], Number(match[2]) * 1024)
  }
  const totalBytes = kib.get('MemTotal')
  const availableBytes = kib.get('MemAvailable')
  if (totalBytes === undefined || availableBytes === undefined) return portableMemory(env)
  const usedBytes = totalBytes - availableBytes
  const swapTotalBytes = kib.get('SwapTotal')
  const swapFreeBytes = kib.get('SwapFree')
  return {
    available: true,
    percent: clampPercent((usedBytes / totalBytes) * 100),
    usedBytes,
    totalBytes,
    compressedBytes: undefined,
    swapUsedBytes: swapTotalBytes === undefined || swapFreeBytes === undefined ? undefined : swapTotalBytes - swapFreeBytes,
    swapTotalBytes,
  }
}

/** The last resort, for a machine whose /proc is not mounted. */
function portableMemory(env) {
  const totalBytes = env.totalmem()
  const usedBytes = totalBytes - env.freemem()
  return {
    available: true,
    percent: clampPercent((usedBytes / totalBytes) * 100),
    usedBytes,
    totalBytes,
    compressedBytes: undefined,
    swapUsedBytes: undefined,
    swapTotalBytes: undefined,
  }
}

/** Cumulative byte counters over the counted interfaces, or undefined. */
async function readNetwork(env) {
  const raw = await env.readFile('/proc/net/dev')
  if (raw === undefined) return undefined
  const counted = interfacePattern('linux')
  let received = 0
  let sent = 0
  let interfaces = 0
  for (const line of raw.split('\n').slice(2)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (!counted.test(line.slice(0, colon).trim())) continue
    const columns = line.slice(colon + 1).trim().split(/\s+/).map(Number)
    // Eight columns per direction: [rxBytes, rxPackets, rxErrs, rxDrop, rxFifo,
    // rxFrame, rxCompressed, rxMulticast, txBytes, ...]. The transmit bytes are
    // the ninth, not the eighth — the last receive column is multicast, which
    // is a packet count and would have read as a plausible-looking number.
    if (!Number.isFinite(columns[0]) || !Number.isFinite(columns[8])) continue
    received += columns[0]
    sent += columns[8]
    interfaces++
  }
  return interfaces > 0 ? { at: Date.now(), received, sent, interfaces } : undefined
}

/** The DRM card directories, `card0` and upwards, render nodes left aside. */
async function readCards(env) {
  const names = await env.readdir(DRM_ROOT)
  if (names === undefined) return []
  return names.filter((name) => /^card\d+$/.test(name)).map((name) => `${DRM_ROOT}/${name}`)
}

/**
 * A busy percentage from a driver that publishes one. amdgpu does; i915 and
 * Xe do not, and no other source under /sys stands in for them.
 */
async function readSysfsGpu(env) {
  for (const card of await readCards(env)) {
    const busy = number(await env.readFile(`${card}/device/gpu_busy_percent`))
    if (busy === undefined) continue
    // The frame buffer is spelled differently by every driver that has one.
    const used = await firstNumber(
      env,
      ['mem_info_vram_used', 'lmem_used_bytes', 'vram_used_bytes'].map((file) => `${card}/device/${file}`),
    )
    return { percent: clampPercent(busy), available: true, memoryBytes: used }
  }
  return undefined
}

/** The first of these files that holds a number. */
async function firstNumber(env, paths) {
  for (const path of paths) {
    const value = number(await env.readFile(path))
    if (value !== undefined) return value
  }
  return undefined
}

/** The three device classes a display adapter registers itself under. */
const GPU_CLASSES = 'VGA compatible controller|3D controller|Display controller'

/** The model behind a card, for the drivers that publish no name of their own. */
async function readLspciName(env) {
  const raw = await env.run(env.command('lspci'), ['-nn'])
  if (raw === undefined) return undefined
  for (const line of raw.split('\n')) {
    if (!new RegExp(GPU_CLASSES).test(line)) continue
    // The bus address carries a colon of its own, so the class name is what
    // says where the description begins; the PCI id and the revision are the
    // two things a model name is not.
    const name = line
      .replace(new RegExp(`^.*?(?:${GPU_CLASSES}):\\s*`), '')
      .replace(/\s*\[[0-9a-f]{4}:[0-9a-f]{4}\]\s*$/i, '')
      .replace(/\s*\(rev [^)]*\)\s*$/i, '')
      .trim()
    if (name !== '') return name
  }
  return undefined
}

/**
 * The GPU row. `nvidia-smi` first, because it is the only one of these that
 * answers for a card that is busy right now; the sysfs counters second; and a
 * card whose only fact is its name still gets a name.
 * @param env - the environment to read through.
 * @param name - the model name found so far, if any.
 * @returns the sample, with `available` false when nothing could be measured.
 */
async function readGpu(env, name) {
  const sample = (await readNvidia(env)) ?? (await readSysfsGpu(env))
  if (sample !== undefined) return { ...sample, name: sample.name ?? name }
  return {
    percent: undefined,
    available: false,
    memoryBytes: undefined,
    name,
    mhz: undefined,
    rendererPercent: undefined,
    tilerPercent: undefined,
  }
}

/** The Linux driver. */
export function createLinuxDriver(options = {}) {
  const env = createEnvironment(options)
  // The model name costs a subprocess, so it is asked for once, in the
  // background: a tick that waited for it would be a tick late for the name
  // alone, and the name never changes.
  let name
  let namePending
  function loadName() {
    if (name !== undefined) return
    namePending ??= readLspciName(env)
      .then((value) => {
        if (value !== undefined) name = value
        namePending = undefined
        return name
      })
      .catch(() => undefined)
  }

  return {
    id: 'linux',
    tiers: () => discoverTiers(env),
    memory: () => readMemory(env),
    network: () => readNetwork(env),
    async gpu() {
      loadName()
      return readGpu(env, name)
    },
    createClockReader: () => createClockReader(env),
  }
}
