// The macOS driver.
//
// Apple silicon publishes a lot without elevation, and most of it in two
// places: the `hw.perflevelN` sysctls name the tiers and count their cores, and
// the device tree in the IORegistry marks every core with the cluster it
// belongs to. That is enough to draw the split, and the cores' own tick
// counters are enough to measure it.
//
// Intel Macs split their cores too, in the hardware, and publish nothing about
// it: there is no perf-level sysctl, no cluster type, and no command that will
// say which of Alder Lake's cores are the big ones. The only source is the CPU
// itself — CPUID leaf 0x1A, which answers "what kind of core am I running on"
// and has to be asked while running on each core in turn. `helper/dsh-cpuid.c`
// does that, one line of JSON, and this file maps its answer onto tiers.
//
// A machine that publishes no split — every Intel part that is not a hybrid
// one, every Mac Pro, every virtual machine — draws the whole processor as a
// single row instead.

import { accessSync, constants, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  clampPercent,
  COMMAND_TIMEOUT_MS,
  coversEveryCore,
  createEnvironment,
  groupCores,
  inCpuOrder,
  interfacePattern,
  INTERVAL_MS,
  number,
} from './shared.js'

/** Built helper for live clocks, when the plugin was compiled with `tools/build-helper.sh`. */
const IOREPORT_PATH = fileURLToPath(new URL('../../bin/dsh-ioreport', import.meta.url))

/** Built helper for the Intel core types, same build, same directory. */
const CPUID_PATH = fileURLToPath(new URL('../../bin/dsh-cpuid', import.meta.url))

/** How long to wait before restarting a helper that exited. */
const CLOCK_RETRY_MS = 10_000

/**
 * IOReport names a channel after its tier, not after its cluster: `PCPU*` is
 * the top tier, `ECPU*` and `MCPU*` the one below it. Apple renamed that tier
 * on the M5 generation without renaming the channels.
 */
const TOP_TIER_CHANNELS = 'PCPU'
const OTHER_TIER_CHANNELS = ['ECPU', 'MCPU']

/** The GPU publishes exactly one frequency channel on every part. */
const GPU_CHANNEL = 'GPUPH'

/** The GPU's DVFS table. The CPU tiers are addressed through `acc-clusters`. */
const GPU_DVFS_KEY = 'voltage-states9'

/** Histogram states that mean "this core was not running at any DVFS step". */
const IDLE_STATES = new Set(['IDLE', 'DOWN', 'OFF'])

/**
 * The core types CPUID leaf 0x1A names: `0x20` for the Atom cores, `0x40` for
 * the Core ones. The helper reports the raw numbers rather than deciding, so
 * that a part with a core type nobody has seen yet is a table entry here
 * instead of a guess in C.
 */
const INTEL_CORE_TYPES = {
  0x20: { label: 'E', name: 'Efficiency' },
  0x40: { label: 'P', name: 'Performance' },
}

/**
 * One `sysctl` call answered as a plain object, e.g. `{'hw.nperflevels': '2'}`.
 * Unknown OIDs make sysctl exit non-zero, so callers read the keys that did
 * come back instead of failing the whole call.
 */
async function readSysctl(env, keys) {
  const raw = await env.run(env.command('sysctl'), keys)
  const values = {}
  if (raw === undefined) return values
  for (const line of raw.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return values
}

/**
 * Per-core IORegistry facts Apple silicon publishes without elevation: the
 * logical cpu id (which lines up with `os.cpus()`) and the cluster type, which
 * is the only unprivileged marker that separates the two kinds of core. The
 * names come from the device tree, not from Apple product names, so they stay
 * meaningful on any Mac.
 * @returns core descriptors, or undefined when the nodes are unreadable.
 */
async function readCpuNodes(env) {
  const raw = await env.run(env.command('ioreg'), ['-r', '-d', '1', '-w', '0', '-c', 'IOPlatformDevice'], 5_000)
  if (raw === undefined) return undefined
  const nodes = []
  const lines = raw.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!/\+-o cpu\d+@\S+/.test(lines[index])) continue
    const node = {}
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next].trim()
      if (line.startsWith('}') || line.includes('+-o')) break
      const match = /^"(logical-cpu-id|cluster-type)"\s*=\s*(.*)$/.exec(line)
      if (match !== null) node[match[1]] = match[2].trim().replace(/^<|>$/g, '').replace(/^"|"$/g, '')
    }
    const logicalCpuId = number(node['logical-cpu-id'])
    const clusterType = node['cluster-type']
    if (!Number.isInteger(logicalCpuId) || typeof clusterType !== 'string' || clusterType === '') return undefined
    nodes.push({ logicalCpuId, clusterType })
  }
  return nodes
}

/**
 * Match discovered clusters onto perf levels by core count. The counts are hard
 * evidence: on a part with two kinds of core the cluster sizes have to add up
 * to the two level sizes.
 */
function matchByCoreCount(clusters, levels) {
  if (clusters.length !== levels.length) return undefined
  const unclaimed = [...levels]
  const pairs = []
  for (const cluster of clusters) {
    const index = unclaimed.findIndex((level) => level.cores === cluster.logicalCpus.length)
    if (index === -1) return undefined
    pairs.push([unclaimed[index], cluster])
    unclaimed.splice(index, 1)
  }
  return pairs
}

/**
 * Fall back to declaration order for parts whose two levels hold the same
 * number of cores, where the counts cannot tell the clusters apart: macOS
 * numbers the cores of level 0 first.
 */
function matchByOrder(clusters, levels) {
  if (clusters.length !== levels.length) return undefined
  return levels.map((level, index) => [level, clusters[index]])
}

/**
 * Short row label for a perf level: the first letter of the name macOS gives
 * it, so `Super` reads as `S` and `Performance` as `P`.
 */
function tierLabel(levelName) {
  const match = /[A-Za-z]/.exec(levelName)
  return match === null ? 'CPU' : match[0].toUpperCase()
}

/**
 * The Apple silicon split, or undefined when this is not one of those parts or
 * the two answers disagree.
 */
async function discoverAppleTiers(env) {
  const levelCount = number((await readSysctl(env, ['hw.nperflevels']))['hw.nperflevels'])
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > 8) return undefined
  const keys = []
  for (let level = 0; level < levelCount; level++) {
    keys.push(`hw.perflevel${level}.name`, `hw.perflevel${level}.logicalcpu`)
  }
  const values = await readSysctl(env, keys)
  const levels = []
  for (let level = 0; level < levelCount; level++) {
    const levelName = values[`hw.perflevel${level}.name`]
    const cores = number(values[`hw.perflevel${level}.logicalcpu`])
    if (levelName === undefined || levelName === '' || !Number.isInteger(cores) || cores < 1) return undefined
    levels.push({ name: levelName, cores })
  }
  if (levels.length < 2) return undefined

  const nodes = await readCpuNodes(env)
  // The split is only usable when every logical core is accounted for exactly
  // once; a partial map would attribute the missing cores to nobody.
  if (nodes === undefined || nodes.length !== env.cpus().length) return undefined
  const logicalCpus = nodes.map((node) => node.logicalCpuId)
  if (new Set(logicalCpus).size !== logicalCpus.length) return undefined
  if (Math.max(...logicalCpus) !== env.cpus().length - 1 || Math.min(...logicalCpus) !== 0) return undefined

  const byType = new Map()
  for (const node of nodes) {
    const bucket = byType.get(node.clusterType)
    if (bucket === undefined) byType.set(node.clusterType, { logicalCpus: [node.logicalCpuId] })
    else bucket.logicalCpus.push(node.logicalCpuId)
  }
  const clusters = [...byType.values()]
    .map((cluster) => ({ ...cluster, logicalCpus: cluster.logicalCpus.sort((a, b) => a - b) }))
    .sort((a, b) => a.logicalCpus[0] - b.logicalCpus[0])
  if (clusters.length !== levels.length) return undefined

  const pairs = matchByCoreCount(clusters, levels) ?? matchByOrder(clusters, levels)
  if (pairs === undefined) return undefined
  return pairs.map(([level, cluster]) => ({
    label: tierLabel(level.name),
    name: level.name,
    cores: cluster.logicalCpus.length,
    logicalCpus: cluster.logicalCpus,
  }))
}

/**
 * The Intel split, from the CPUID helper: one core type per logical CPU, which
 * is the whole answer with no matching to be done. A helper that is not built,
 * or that reports no hybrid part, is not a failure — it is the answer for every
 * Mac that is not one of these.
 * @returns the tiers, or undefined.
 */
async function discoverIntelTiers(env, cpuidPath) {
  if (!existsSync(cpuidPath)) return undefined
  const raw = await env.run(cpuidPath, [], COMMAND_TIMEOUT_MS)
  if (raw === undefined) return undefined
  let cpus
  try {
    cpus = JSON.parse(raw).cpus
  } catch {
    return undefined
  }
  if (!Array.isArray(cpus) || cpus.length !== env.cpus().length) return undefined
  // An unknown core type is a part this table does not cover: drawing the
  // split from half of it would be a division the machine never reported.
  if (cpus.some((entry) => !Array.isArray(entry) || INTEL_CORE_TYPES[entry[1]] === undefined)) return undefined
  // The helper names the logical cpu in every entry, so the split is usable
  // exactly when those names account for the whole machine once each — the
  // same rule the device-tree path is held to.
  const groups = inCpuOrder(
    groupCores(
      cpus.map((entry) => [entry[0], entry[1]]),
    ),
  )
  if (groups.size !== 2 || !coversEveryCore(groups, env.cpus().length)) return undefined
  return [...groups].map(([kind, logicalCpus]) => ({ ...INTEL_CORE_TYPES[kind], cores: logicalCpus.length, logicalCpus }))
}

/** Which cores belong to which tier, or undefined when this Mac has no split. */
export async function discoverTiers(env, cpuids = CPUID_PATH) {
  const apple = await discoverAppleTiers(env)
  if (apple !== undefined) return apple
  // The helper only exists on an Intel build, and only answers there.
  if (env.arch !== 'x64') return undefined
  return discoverIntelTiers(env, cpuids)
}

/**
 * A hex data property of the `pmgr` node as bytes, or undefined when absent. */
function hexProperty(text, key) {
  const match = new RegExp(`"${key}" = <([0-9a-f]+)>`, 'i').exec(text)
  return match === null ? undefined : Buffer.from(match[1], 'hex')
}

/**
 * A DVFS state table in megahertz. Apple has stored these in kilohertz since
 * the M4 generation and in hertz before it; the unit is read off the magnitude
 * rather than the chip name, so a new part needs no table of its own.
 * @param values - raw frequency words from the blob.
 * @returns states in megahertz, or undefined when the blob is unusable.
 */
function megahertzTable(values) {
  const max = Math.max(...values)
  if (!Number.isFinite(max) || max === 0) return undefined
  const scale = max >= 5e8 ? 1e6 : max >= 5e5 ? 1e3 : 1
  // A zero entry is the "off" state, not a clock the cluster ever ran at.
  return values.filter((value) => value > 0).map((value) => Math.round(value / scale))
}

/**
 * The DVFS state tables, read once from IORegistry: one per CPU tier and one
 * for the GPU.
 *
 * `acc-clusters` lists the groups in 8-byte records — the index of that group's
 * `voltage-states` table, then the cluster type. A higher type means a faster
 * tier, which is how the top cluster is told apart from the one below it
 * without knowing what this chip calls its cores.
 */
async function readDvfsTables(env) {
  const raw = await env.run(env.command('ioreg'), ['-r', '-d', '1', '-w', '0', '-c', 'AppleARMIODevice', '-n', 'pmgr'], 5_000)
  if (raw === undefined) return undefined
  const acc = hexProperty(raw, 'acc-clusters')
  if (acc === undefined || acc.length < 16) return undefined
  const clusters = []
  for (let at = 0; at + 8 <= acc.length; at += 8) {
    clusters.push({ table: `voltage-states${acc[at]}-sram`, type: acc[at + 1] })
  }
  clusters.sort((a, b) => a.type - b.type)
  const table = (entry) => {
    const blob = entry === undefined ? undefined : hexProperty(raw, entry.table)
    if (blob === undefined) return undefined
    const values = []
    for (let at = 0; at + 4 <= blob.length; at += 8) values.push(blob.readUInt32LE(at))
    return megahertzTable(values)
  }
  const tables = {
    top: table(clusters.at(-1)),
    other: table(clusters.at(-2)),
    gpu: table({ table: GPU_DVFS_KEY }),
  }
  return tables.top === undefined && tables.gpu === undefined ? undefined : tables
}

/**
 * Average clock over the sampled window, from one residency histogram. The
 * first state that is neither idle nor down is the lowest DVFS step, and the
 * steps after it line up with the state table position by position.
 *
 * A cluster with no active time in the window did not run at every DVFS step at
 * once: it sat at the lowest one, which is what this reports. Anything else
 * would either invent a frequency or drop back to the nominal value that says
 * nothing about what the cores are doing now.
 * @param states - `[label, residency]` pairs as the helper printed them.
 * @param table - that cluster's DVFS states, in megahertz.
 * @returns average megahertz, or undefined when the histogram is unusable.
 */
function averageClock(states, table) {
  if (!Array.isArray(states) || table === undefined) return undefined
  const offset = states.findIndex(([label]) => !IDLE_STATES.has(label))
  if (offset === -1 || offset + table.length > states.length) return undefined
  const active = states.slice(offset, offset + table.length)
  const busy = active.reduce((sum, [, residency]) => sum + residency, 0)
  if (busy <= 0) return table[0]
  return Math.round(active.reduce((sum, [, residency], at) => sum + (residency / busy) * table[at], 0))
}

/**
 * Live clocks for the CPU tiers and the GPU.
 *
 * The helper gives every core its own channel, so counting the channels that
 * answered reports a tier's core count. That is the same evidence the perf-level
 * discovery matches on, so a tier is given its clock by core count rather than
 * by assuming which tier comes first.
 */
function createClockReader(env, helper) {
  let child
  let retry
  let tables
  let latest = { groups: [], gpuMhz: undefined }
  let state = { available: false, reason: 'starting' }
  let stopped = false

  function ingest(line) {
    let channels
    try {
      channels = JSON.parse(line).ch
    } catch {
      return
    }
    if (channels === null || typeof channels !== 'object') return
    const groups = new Map()
    let gpuMhz
    for (const [name, states] of Object.entries(channels)) {
      const kind = name.startsWith(TOP_TIER_CHANNELS)
        ? 'top'
        : OTHER_TIER_CHANNELS.some((prefix) => name.startsWith(prefix))
          ? 'other'
          : name.startsWith(GPU_CHANNEL)
            ? 'gpu'
            : undefined
      if (kind === undefined) continue
      const mhz = averageClock(states, tables?.[kind])
      if (mhz === undefined) continue
      if (kind === 'gpu') {
        gpuMhz = mhz
        continue
      }
      const bucket = groups.get(kind) ?? { cores: 0, total: 0 }
      bucket.cores++
      bucket.total += mhz
      groups.set(kind, bucket)
    }
    latest = {
      groups: [...groups].map(([kind, bucket]) => ({ kind, cores: bucket.cores, mhz: Math.round(bucket.total / bucket.cores) })),
      gpuMhz,
    }
    state = { available: true, reason: undefined }
  }

  function start() {
    if (stopped || child !== undefined) return
    state = { available: false, reason: 'starting' }
    child = env.spawn(helper, ['-i', String(INTERVAL_MS)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let buffered = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() !== '') ingest(line)
      }
    })
    // The helper explains itself on stderr, and a silent failure would leave
    // the panel showing nominal clocks with nobody able to say why.
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).trim()
    })
    const fail = (reason) => {
      child = undefined
      state = { available: false, reason }
      if (!stopped) retry = setTimeout(start, CLOCK_RETRY_MS)
    }
    child.on('error', (error) => fail(`spawn failed: ${error.code ?? error.message}`))
    child.on('exit', (code, signal) => fail(stderr === '' ? `helper exited (${signal ?? `code ${code}`})` : stderr))
  }

  void readDvfsTables(env)
    .then((value) => {
      tables = value
      if (value === undefined) {
        state = { available: false, reason: 'no DVFS tables in IORegistry' }
        return
      }
      start()
    })
    .catch((error) => {
      state = { available: false, reason: `ioreg failed: ${error.message}` }
    })

  return {
    read() {
      return latest
    },
    /** Whether live clocks are arriving, and why not when they are not. */
    status() {
      return state
    },
    dispose() {
      stopped = true
      if (retry !== undefined) clearTimeout(retry)
      child?.kill()
      child = undefined
    },
  }
}

/**
 * Is the IOReport helper built and executable? The reason travels all the way
 * to the panel, because a clock that quietly stays nominal is worse than one
 * that says what stopped it.
 * @returns `{available: true}` or `{available: false, reason}`.
 */
function helperStatus(helper) {
  try {
    accessSync(helper, constants.X_OK)
    return { available: true, reason: undefined }
  } catch (error) {
    const reason =
      error.code === 'ENOENT'
        ? 'bin/dsh-ioreport is missing, run tools/build-helper.sh'
        : error.code === 'EACCES'
          ? 'bin/dsh-ioreport is not executable'
          : `bin/dsh-ioreport unusable: ${error.code ?? error.message}`
    return { available: false, reason }
  }
}

/**
 * The clock reader this Mac can actually have. IOReport is an Apple silicon
 * interface: an Intel Mac has no such channels, so the panel is told that once
 * instead of spawning a helper that can only exit with an error.
 * @returns a reader, or undefined when the helper is not built.
 */
function createDarwinClockReader(env, helper) {
  if (env.arch !== 'arm64') {
    const reason = 'live clocks are an Apple silicon IOReport interface'
    return { read: () => ({ groups: [], gpuMhz: undefined }), status: () => ({ available: false, reason }), dispose() {} }
  }
  const status = helperStatus(helper)
  if (!status.available) return { read: () => ({ groups: [], gpuMhz: undefined }), status: () => status, dispose() {} }
  return createClockReader(env, helper)
}

/** Page counts reported by `vm_stat`, keyed by their label. */
function parseVmStat(raw) {
  const pages = new Map()
  for (const line of raw.split('\n')) {
    const match = /^"?([A-Za-z][^:"]*)"?:\s+(\d+)\.?\s*$/.exec(line.trim())
    if (match !== null) pages.set(match[1], Number(match[2]))
  }
  return pages
}

/** `vm_stat` swap line: `total = 3072.00M  used = 1933.00M  free = ...`. */
function parseSwapUsage(raw) {
  const amount = (key) => {
    const match = new RegExp(`${key} = ([\\d.]+)([MG])`).exec(raw)
    if (match === null) return undefined
    return Number(match[1]) * (match[2] === 'G' ? 1024 * 1024 * 1024 : 1024 * 1024)
  }
  const totalBytes = amount('total')
  const usedBytes = amount('used')
  return totalBytes === undefined || usedBytes === undefined ? undefined : { totalBytes, usedBytes }
}

/**
 * Memory in use, counted the way Activity Monitor counts it: application
 * pages, wired pages nothing may page out, and the pages the compressor still
 * occupies. Reclaimable file cache is left out, because counting it would show
 * a machine with a warm disk cache as full.
 */
async function readMemory(env) {
  const [statRaw, swapRaw] = await Promise.all([
    env.run(env.command('vm_stat')),
    readSysctl(env, ['vm.swapusage']).then((values) => values['vm.swapusage']),
  ])
  if (statRaw === undefined) return undefined
  const pages = parseVmStat(statRaw)
  const pageSize = number(/page size of (\d+) bytes/.exec(statRaw)?.[1]) ?? 4096
  const active = pages.get('Pages active')
  const wired = pages.get('Pages wired down')
  if (active === undefined || wired === undefined) return undefined
  const totalBytes = env.totalmem()
  const usedBytes = (active + wired + (pages.get('Pages occupied by compressor') ?? 0)) * pageSize
  const swap = swapRaw === undefined ? undefined : parseSwapUsage(swapRaw)
  return {
    available: true,
    percent: clampPercent((usedBytes / totalBytes) * 100),
    usedBytes,
    totalBytes,
    compressedBytes: (pages.get('Pages occupied by compressor') ?? 0) * pageSize,
    swapUsedBytes: swap?.usedBytes,
    swapTotalBytes: swap?.totalBytes,
  }
}

/** Cumulative byte counters over the counted interfaces, or undefined. */
async function readNetwork(env) {
  // `-n` is not a nicety: without it netstat reverse-resolves every address it
  // prints, and a resolver that does not answer (a link-local address with no
  // PTR, a network that cannot be reached) takes far longer than
  // COMMAND_TIMEOUT_MS — so the row would silently read as "nothing published"
  // rather than as slow. Numeric output is identical in the counters and the
  // `<Link#N>` aggregate rows this parser reads.
  const raw = await env.run(env.command('netstat'), ['-ibn'])
  if (raw === undefined) return undefined
  const counted = interfacePattern('darwin')
  let received = 0
  let sent = 0
  let interfaces = 0
  for (const line of raw.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 10) continue
    const [interfaceName, , network] = columns
    // One aggregate row per interface; the per-address rows repeat the same
    // counters and would multiply every byte count.
    if (network === undefined || !network.startsWith('<Link#')) continue
    if (!counted.test(interfaceName)) continue
    const inbound = number(columns[6])
    const outbound = number(columns[9])
    if (inbound === undefined || outbound === undefined) continue
    received += inbound
    sent += outbound
    interfaces++
  }
  return interfaces > 0 ? { at: Date.now(), received, sent, interfaces } : undefined
}

/** ioreg registry classes that expose GPU performance counters, newest first. */
const GPU_CLASSES = ['AGXAccelerator', 'IOAccelerator']

/**
 * GPU busy percentage from the IOKit performance counters Apple silicon and
 * most Intel parts publish without elevation. The same dictionary carries the
 * memory the GPU has mapped, which is the second figure the row shows because
 * no GPU publishes a clock here.
 */
async function readGpuUtilization(env) {
  for (const registryClass of GPU_CLASSES) {
    const raw = await env.run(env.command('ioreg'), ['-r', '-d', '-1', '-w', '0', '-c', registryClass])
    if (raw === undefined) continue
    const match = /"Device Utilization %"\s*=\s*(\d+)/.exec(raw)
    if (match === null) continue
    const value = (pattern) => {
      const found = pattern.exec(raw)
      return found === null ? undefined : Number(found[1])
    }
    return {
      percent: clampPercent(Number(match[1])),
      available: true,
      // The "(driver)" sibling key must not match: the anchor requires the
      // quoted name to end right after the space.
      memoryBytes: value(/"In use system memory"\s*=\s*(\d+)/),
      rendererPercent: value(/"Renderer Utilization %"\s*=\s*(\d+)/),
      tilerPercent: value(/"Tiler Utilization %"\s*=\s*(\d+)/),
    }
  }
  return { percent: undefined, available: false, memoryBytes: undefined, rendererPercent: undefined, tilerPercent: undefined }
}

/** GPU model and core count. Static hardware facts, so read once and keep. */
async function readGpuDescription(env) {
  const raw = await env.run(env.command('system_profiler'), ['SPDisplaysDataType'], 5_000)
  if (raw === undefined) return undefined
  const model = /Chipset Model:\s*(.+)/.exec(raw)?.[1]?.trim()
  const cores = /Total Number of Cores:\s*(\d+)/.exec(raw)?.[1]
  if (model === undefined && cores === undefined) return undefined
  return { name: model, cores: cores === undefined ? undefined : Number(cores) }
}

/** The macOS driver. */
export function createDarwinDriver(options = {}) {
  const env = createEnvironment(options)
  // The two built helpers, which a caller may point elsewhere so the driver can
  // be exercised without building them.
  const ioreport = options.helpers?.ioreport ?? IOREPORT_PATH
  const cpuid = options.helpers?.cpuid ?? CPUID_PATH
  // The model and the core count cost a `system_profiler`, which takes seconds
  // to answer: it is asked for once, in the background, and every sample after
  // that carries whatever it found.
  let description
  let descriptionPending
  function loadDescription() {
    if (description !== undefined) return
    descriptionPending ??= readGpuDescription(env)
      .then((value) => {
        if (value !== undefined) description = value
        descriptionPending = undefined
        return description
      })
      .catch(() => undefined)
  }

  return {
    id: 'darwin',
    tiers: () => discoverTiers(env, cpuid),
    async memory() {
      return (await readMemory(env)) ?? portableMemory(env)
    },
    network: () => readNetwork(env),
    async gpu() {
      loadDescription()
      const sample = await readGpuUtilization(env)
      return { ...sample, name: description?.name, cores: description?.cores, mhz: undefined }
    },
    createClockReader: () => createDarwinClockReader(env, ioreport),
  }
}

/** The last resort, so the row still works on a machine whose `vm_stat` failed. */
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
