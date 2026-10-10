// Host half of dsh-sys-monitor.
//
// Samples the CPU perf levels, memory, GPU and network throughput on a fixed
// cadence and serves the latest snapshot as JSON over the same-origin `/api`
// carrier the Web GUI already uses, so the browser half needs no Remote
// namespace and no Typert schema generation.
//
// The sampler is the same on every machine: a difference between two counter
// reads is a difference between two counter reads, and nothing in this file
// knows how a system publishes its memory or its GPU. That is what the platform
// driver under `lib/platform` is for — it answers the four questions this file
// asks, from whatever the running system happens to publish, and says "no" when
// the system publishes nothing.
//
// Sampling is demand-driven: the interval runs only while a browser has polled
// within `idleTimeoutMs`, so an idle profile costs nothing.

import os from 'node:os'

import { createDriver } from './platform/index.js'
import { IDLE_TIMEOUT_MS, INTERVAL_MS, NET_FULL_SCALE_BPS, clampPercent, round1 } from './platform/shared.js'

const name = 'sys-monitor'

/** Host services this half needs: `connection` owns the `/api` fetch fence. */
const inject = ['connection']

/**
 * Absolute registration path of the sample route. The browser addresses the
 * document-relative form (`api/sys-monitor.sample`) so the panel keeps working
 * when the app is served under a mount prefix.
 */
export const SAMPLE_PATH = '/api/sys-monitor.sample'

/**
 * Cumulative CPU tick counters, one entry per logical core, in the same order
 * as `os.cpus()` and therefore as the logical cpu id every driver reports its
 * tiers in.
 */
function cpuTimes() {
  return os.cpus().map((cpu) => {
    const times = cpu.times
    return {
      idle: times.idle,
      total: times.user + times.nice + times.sys + times.irq + times.idle,
    }
  })
}

/**
 * Busy percentage between two cumulative counter reads, over the given logical
 * cores or over the whole socket when no index list is given. A group is
 * reported as the share of its own capacity that was busy, so one saturated
 * core out of twelve reads as 8% rather than 100%.
 * @param previous - counters from the earlier read.
 * @param current - counters from the later read.
 * @param indices - logical core indices to sum over, or undefined for all.
 * @returns busy percentage, or undefined when the delta is unusable.
 */
function busyPercent(previous, current, indices = undefined) {
  if (previous === undefined || current === undefined) return undefined
  let idle = 0
  let total = 0
  for (const index of indices ?? current.keys()) {
    const before = previous[index]
    const now = current[index]
    // One missing core makes the whole group unreadable; a partial sum would
    // silently report a smaller denominator as a smaller percentage.
    if (before === undefined || now === undefined) return undefined
    idle += now.idle - before.idle
    total += now.total - before.total
  }
  // A counter that stood still or moved backwards means the machine rebooted
  // or the core was offline: report nothing rather than a negative rate.
  if (!(total > 0)) return undefined
  return clampPercent(((total - idle) / total) * 100)
}

/**
 * Live megahertz for one tier.
 *
 * A group that names its own logical CPUs is matched on them, which is how the
 * Linux driver's per-core readings are matched. A group that does not — the
 * IOReport channels count their cores one tier at a time and the helper reports
 * no global index — is matched by size instead, each group to at most one tier,
 * so two tiers of equal size can never both claim the same clock.
 * @param clocks - the latest clock reading, or undefined when there is none.
 * @param tiers - discovered tiers, in display order.
 * @param index - which tier to look up.
 * @returns megahertz, or undefined.
 */
function tierClock(clocks, tiers, index) {
  const groups = clocks?.groups ?? []
  const tier = tiers[index]
  const own = groups.find(
    (group) =>
      Array.isArray(group.logicalCpus) &&
      group.logicalCpus.length === tier.cores &&
      group.logicalCpus.every((core) => tier.logicalCpus.includes(core)),
  )
  if (own !== undefined) return own.mhz
  // Claim groups greedily from the first tier on, so two tiers of equal size
  // never both take the same clock.
  const claimed = new Set()
  let found
  for (let at = 0; at <= index; at++) {
    const match = groups.findIndex((group, position) => group.cores === tiers[at].cores && !claimed.has(position))
    if (match === -1) continue
    claimed.add(match)
    if (at === index) found = groups[match]
  }
  return found?.mhz
}

/**
 * Per-second rate between two cumulative counter reads. A counter that moved
 * backwards (interface reset, wrap) reports 0 rather than a negative rate.
 */
function bytesPerSecond(previous, current) {
  if (previous === undefined || current === undefined) return undefined
  const seconds = (current.at - previous.at) / 1000
  if (!(seconds > 0)) return undefined
  const rate = (now, before) => Math.max(0, (now - before) / seconds)
  return {
    down: rate(current.received, previous.received),
    up: rate(current.sent, previous.sent),
  }
}

/** The snapshot a browser sees before the first delta has been measured. */
function initialSnapshot() {
  return {
    at: Date.now(),
    platform: process.platform,
    cores: os.cpus().length,
    cpu: { overall: undefined, tiers: [], loadAverage: os.loadavg().map(round1) },
    clock: { available: false, reason: 'sampler idle' },
    mem: { available: false, percent: undefined, usedBytes: undefined, totalBytes: os.totalmem() },
    gpu: {
      percent: undefined,
      available: false,
      name: undefined,
      cores: undefined,
      memoryBytes: undefined,
      mhz: undefined,
      rendererPercent: undefined,
      tilerPercent: undefined,
    },
    net: { down: undefined, up: undefined, fullScaleBps: NET_FULL_SCALE_BPS, interfaces: 0 },
  }
}

/**
 * Create the sampler. Every tick reads all four sources concurrently, keeps
 * the previous cumulative counters, and publishes the derived snapshot.
 * @param driver - the platform driver, or none for this machine's own.
 */
function createSampler(driver = createDriver()) {
  let timer
  let previousCpu
  let previousNet
  let tiers
  let clock
  let latest = initialSnapshot()
  let lastPollAt = 0
  let collecting = false

  async function loadTiers() {
    if (tiers !== undefined) return tiers
    // A machine that publishes no split resolves to undefined forever, so the
    // probe runs once and the panel keeps drawing the whole socket.
    try {
      tiers = (await driver.tiers()) ?? []
    } catch {
      tiers = []
    }
    return tiers
  }

  /**
   * One CPU section: the split when it is known, the whole socket otherwise.
   * The clock reader is asked here rather than at the top of the tick, so it
   * only ever reads for the tiers this sample is about to draw.
   * @param current - the counter read of this tick.
   * @param previous - the counter read of the last one.
   * @param clocks - the clock reading of this tick, or undefined.
   */
  function cpuSnapshot(current, previous, clocks) {
    const discovered = tiers ?? []
    const loadAverage = os.loadavg().map(round1)
    if (discovered.length === 0) {
      return { overall: round1(busyPercent(previous, current)), tiers: [], loadAverage }
    }
    return {
      overall: round1(busyPercent(previous, current)),
      tiers: discovered.map((tier, index) => {
        const liveMhz = tierClock(clocks, discovered, index)
        return {
          label: tier.label,
          name: tier.name,
          cores: tier.cores,
          percent: round1(busyPercent(previous, current, tier.logicalCpus)),
          // The live clock when the driver reported one, and the nominal
          // frequency the runtime knows for the tier's cores when it did not.
          mhz: liveMhz ?? (os.cpus()[tier.logicalCpus[0]]?.speed || undefined),
          live: liveMhz !== undefined,
        }
      }),
      loadAverage,
    }
  }

  async function collect() {
    if (collecting) return
    collecting = true
    try {
      const [gpuResult, netResult, memory] = await Promise.all([driver.gpu(), driver.network(), driver.memory()])
      const cpu = cpuTimes()
      const rates = bytesPerSecond(previousNet, netResult)
      // A reader may answer from a sample already in hand or go and read one;
      // both shapes are awaited the same way.
      const clocks = clock === undefined ? undefined : await Promise.resolve().then(() => clock.read(tiers ?? [])).catch(() => undefined)
      latest = {
        at: Date.now(),
        platform: process.platform,
        cores: os.cpus().length,
        cpu: cpuSnapshot(cpu, previousCpu, clocks),
        clock: clock === undefined ? { available: false, reason: 'no live clock source' } : clock.status(),
        mem: memory ?? { available: false, percent: undefined, usedBytes: undefined, totalBytes: os.totalmem() },
        gpu: {
          percent: round1(gpuResult.percent),
          available: gpuResult.available,
          name: gpuResult.name,
          cores: gpuResult.cores,
          // The clock this GPU's own driver read, or the one the live-clock
          // reader is following for it.
          mhz: gpuResult.mhz ?? clocks?.gpuMhz,
          memoryBytes: gpuResult.memoryBytes,
          rendererPercent: gpuResult.rendererPercent,
          tilerPercent: gpuResult.tilerPercent,
        },
        net: {
          down: rates === undefined ? undefined : Math.round(rates.down),
          up: rates === undefined ? undefined : Math.round(rates.up),
          fullScaleBps: NET_FULL_SCALE_BPS,
          interfaces: netResult?.interfaces ?? 0,
        },
      }
      previousCpu = cpu
      previousNet = netResult
      // The core split arrives one tick late at worst; fold it into the next
      // snapshot rather than re-probing on every tick.
      if (tiers === undefined) void loadTiers()
    } finally {
      collecting = false
    }
  }

  function stop() {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
    // A resident clock source — the IOReport helper — outlives neither the
    // idle timeout nor the browser that woke the sampler.
    clock?.dispose()
    clock = undefined
  }

  /**
   * Cold start: CPU, memory and network are differences between two reads, so
   * a single collection can only establish the baseline. Take the second read
   * a moment later so the first browser poll already carries live numbers
   * instead of a panel that fills in one tick later.
   */
  async function prime() {
    await collect()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await collect()
  }

  function tick() {
    if (Date.now() - lastPollAt > IDLE_TIMEOUT_MS) {
      stop()
      return
    }
    void collect()
  }

  return {
    snapshot() {
      lastPollAt = Date.now()
      if (timer === undefined) {
        previousCpu = undefined
        previousNet = undefined
        latest = initialSnapshot()
        timer = setInterval(tick, INTERVAL_MS)
        clock = driver.createClockReader()
        void prime()
      }
      return latest
    },
    dispose() {
      stop()
    },
  }
}

/**
 * Host plugin body: serve one JSON sample per browser poll.
 * @param ctx - Host context carrying the connection service.
 */
function apply(ctx) {
  const sampler = createSampler()
  ctx.effect(() => () => sampler.dispose(), 'sys-monitor: sampler lifetime')
  ctx.connection.fetch.register({
    path: SAMPLE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () =>
      Promise.resolve(
        Response.json(sampler.snapshot(), {
          headers: { 'cache-control': 'no-store' },
        }),
      ),
  })
}

export { IDLE_TIMEOUT_MS, INTERVAL_MS, NET_FULL_SCALE_BPS, apply, createDriver, createSampler, inject, name }
