// Shared plumbing for the platform drivers.
//
// A driver answers four questions for the sampler — which cores belong to which
// tier, what memory and the GPU are doing, and how many bytes crossed the
// network — each from whatever the running system publishes. Nothing in here
// knows which system it is on: the drivers do. What every driver does share is
// how a system command is run, how a file is read, and where a command lives on
// disk, so that lives here once.
//
// The environment is a plain object rather than a module-level import so a
// driver can be pointed at a fixture — a sysfs tree copied into /tmp, a canned
// stdout — and checked without the machine it was written for.

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'

/** Upper bound on one command, so a wedged toolchain cannot stall a tick. */
export const COMMAND_TIMEOUT_MS = 2_500

/** Sample cadence in milliseconds. */
export const INTERVAL_MS = 1000

/** The sampler stops this long after the last browser poll. */
export const IDLE_TIMEOUT_MS = 15_000

/**
 * Full-scale throughput of the network bars (bytes per second). Traffic is
 * mapped onto 0..100% logarithmically against this value, because network
 * speed has no natural 0..100% and a linear bar would sit at zero forever.
 */
export const NET_FULL_SCALE_BPS = 100 * 1024 * 1024

/**
 * Where the helper commands live. A plugin host may run with a PATH of its own
 * — the desktop app prepends its bundled runtime directories — so a command
 * that is merely on the default PATH is not a command this plugin can count on.
 * Anything missing falls back to the bare name and fails loudly at run time.
 */
const SYSTEM_COMMANDS = {
  darwin: {
    ioreg: '/usr/sbin/ioreg',
    netstat: '/usr/sbin/netstat',
    sysctl: '/usr/sbin/sysctl',
    system_profiler: '/usr/sbin/system_profiler',
    vm_stat: '/usr/bin/vm_stat',
  },
  linux: {
    lspci: '/usr/bin/lspci',
    nvidia_smi: '/usr/bin/nvidia-smi',
  },
  win32: {
    netstat: 'netstat.exe',
    nvidia_smi: 'nvidia-smi.exe',
    powershell: 'powershell.exe',
  },
}

/**
 * Physical interfaces counted toward throughput. Loopback, bridges, tunnels
 * and Apple AWDL links are excluded: a VPN tunnel mirrors the same bytes its
 * physical link carries, and counting both would double every number.
 */
const INTERFACE_PATTERNS = {
  darwin: /^en\d+$/,
  linux: /^(eth|enp|wlan|wl)\d+$/,
  win32: /^(Ethernet|Wi-Fi|Wireless|Local Area Connection|以太网|无线网络).*/,
}

/** The interface pattern for a platform, falling back to "count nothing". */
export function interfacePattern(platform) {
  return INTERFACE_PATTERNS[platform] ?? /^$/
}

/** Absolute path of a helper command, or its plain name when unknown here. */
function defaultCommand(platform) {
  const table = SYSTEM_COMMANDS[platform] ?? {}
  return (name) => {
    const path = table[name]
    return path !== undefined && existsSync(path) ? path : name
  }
}

/** Run one command and resolve its stdout, or undefined when it fails. */
export function runCommand(file, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) =>
      resolve(error ? undefined : stdout),
    )
  })
}

/**
 * Everything a driver is allowed to touch, with the real machine as the
 * default. `options` is what makes a driver testable: hand it a fixture and it
 * reads the fixture.
 *
 * Every member resolves rather than rejects. A system that answers none of
 * these is a normal thing to meet, and a monitor that threw on it would be
 * worse than one that draws a dash.
 * @param options - overrides for the members a test cares about.
 * @returns the environment.
 */
export function createEnvironment(options = {}) {
  const platform = options.platform ?? process.platform
  return {
    platform,
    arch: options.arch ?? process.arch,
    /** Logical processors, in the order the kernel numbers them. */
    cpus: options.cpus ?? (() => os.cpus()),
    /** Total and free physical memory, as the runtime reports it. */
    totalmem: options.totalmem ?? (() => os.totalmem()),
    freemem: options.freemem ?? (() => os.freemem()),
    /** Run a command; resolves its stdout, or undefined when it fails. */
    run: options.run ?? runCommand,
    /** Start a resident process; the returned handle is a child process. */
    spawn: options.spawn ?? spawn,
    /** Read a whole file, or undefined when it cannot be read. */
    readFile: options.readFile ?? ((path) => readFile(path, 'utf8').catch(() => undefined)),
    /** Names in a directory, or undefined when it cannot be listed. */
    readdir: options.readdir ?? ((path) => readdir(path).catch(() => undefined)),
    /** Absolute path of a system command, or its plain name. */
    command: options.command ?? defaultCommand(platform),
  }
}

/** A number from trimmed text, or undefined for anything else. */
export function number(text) {
  if (typeof text !== 'string') return undefined
  const value = Number(text.trim())
  return Number.isFinite(value) ? value : undefined
}

export const clampPercent = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined)
export const round1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined)

/**
 * Group logical CPU indices by a key, each group sorted. A driver that has one
 * hole in its answer drops the entry before it gets here: a group with a gap in
 * it would divide a smaller sum by a smaller denominator, and report a core that
 * was never measured as a core that was never busy.
 * @param entries - `[logicalCpu, key]` pairs, in any order.
 * @returns groups of sorted logical CPU indices, keyed by the key.
 */
export function groupCores(entries) {
  const groups = new Map()
  for (const [logicalCpu, key] of entries) {
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [logicalCpu])
    else bucket.push(logicalCpu)
  }
  return new Map([...groups].map(([key, list]) => [key, list.sort((a, b) => a - b)]))
}

/**
 * Do these logical CPU indices account for exactly the whole machine, once
 * each? A tier map that leaves a core to nobody, or counts one twice, would
 * make every percentage it produces a lie.
 * @param groups - the grouped indices, as `groupCores` returns them.
 * @param total - how many logical processors the runtime reports.
 * @returns true when the groups tile the machine exactly.
 */
export function coversEveryCore(groups, total) {
  const seen = new Set()
  for (const list of groups.values()) {
    for (const index of list) {
      if (!Number.isInteger(index) || index < 0 || index >= total) return false
      if (seen.has(index)) return false
      seen.add(index)
    }
  }
  return seen.size === total
}

/**
 * Rows in the order the kernel numbers the cores they hold. On every part this
 * plugin has seen that puts the faster tier first, and it stays true if a
 * system ever renumbers within a tier. A `Map` keeps its insertion order, so
 * the sorted groups are still groups and not loose lists.
 * @param groups - the grouped indices, as `groupCores` returns them.
 * @returns the same groups, fastest-reading order, by their lowest logical CPU.
 */
export function inCpuOrder(groups) {
  return new Map([...groups].sort((a, b) => a[1][0] - b[1][0]))
}
