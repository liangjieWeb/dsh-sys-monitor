// The Windows driver.
//
// Windows publishes the least of the three systems, and least of it in a form
// that answers fast. The memory figures come from the runtime's own view of the
// physical memory, the byte counters from `netstat -e` — the one command that
// reports adapter totals without a PowerShell startup — and the GPU from
// `nvidia-smi` when the machine has one. There is no perf-level split to find:
// the kernel-equivalent publishes nothing about which of the cores are the
// big ones, so the panel draws the whole processor as one row and says so.

import { readNvidia } from './nvidia.js'
import { clampPercent, createEnvironment, interfacePattern, number } from './shared.js'

/** Byte counters with the thousands separator this system writes. */
function byteCount(text) {
  if (typeof text !== 'string') return undefined
  return number(text.replace(/[,\s]/g, ''))
}

/**
 * Memory in use. The runtime reads `GlobalMemoryStatusEx`, so this is the same
 * "in use" the task manager draws: what is free is what the system can hand out
 * on demand, and the standby list is not in use. The page file is not counted:
 * Windows does not report a swap-in-use figure any command will hand over.
 */
function readMemory(env) {
  const totalBytes = env.totalmem()
  const usedBytes = totalBytes - env.freemem()
  return Promise.resolve({
    available: true,
    percent: clampPercent((usedBytes / totalBytes) * 100),
    usedBytes,
    totalBytes,
    compressedBytes: undefined,
    swapUsedBytes: undefined,
    swapTotalBytes: undefined,
  })
}

/**
 * Cumulative byte counters over the counted interfaces.
 *
 * `netstat -e` is the only byte counter Windows ships that answers in
 * milliseconds. Its rows carry the adapter name and six numbers, of which the
 * first is bytes sent and the second bytes received; the name is in the user's
 * language, so the numbers are read by position and the name is never parsed.
 *
 * The totals cover every adapter the table lists, because the command offers no
 * way to ask for a subset. A Hyper-V or WSL bridge usually mirrors bytes its
 * physical link already carried, so the arrows can read high on a machine that
 * has one — the alternative, a PowerShell start-up per tick, costs more than
 * the overcount. The interface *count* the hover reports does skip those
 * bridges, because a name is all that tells them apart.
 */
async function readNetwork(env) {
  const raw = await env.run(env.command('netstat'), ['-e'])
  if (raw === undefined) return undefined
  const counted = interfacePattern('win32')
  let received = 0
  let sent = 0
  let interfaces = 0
  let named = 0
  for (const line of raw.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 3) continue
    const inbound = byteCount(columns[2])
    const outbound = byteCount(columns[1])
    if (inbound === undefined || outbound === undefined) continue
    received += inbound
    sent += outbound
    interfaces++
    if (counted.test(columns[0])) named++
  }
  if (interfaces === 0) return undefined
  return { at: Date.now(), received, sent, interfaces: named > 0 ? named : interfaces }
}

/**
 * The adapter behind a card that no vendor tool will name for us. It costs a
 * PowerShell start-up — over a second of it — so it runs once, in the
 * background, and the row that wants it repaints when it lands.
 */
function readAdapterName(env) {
  return env
    .run(
      env.command('powershell'),
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name'],
      8_000,
    )
    .then((raw) => {
      const name = raw?.split('\n').find((line) => line.trim() !== '')?.trim()
      return name === '' ? undefined : name
    })
    .catch(() => undefined)
}

/** The Windows driver. */
export function createWindowsDriver(options = {}) {
  const env = createEnvironment(options)
  let name
  let namePending
  function loadName() {
    if (name !== undefined) return
    namePending ??= readAdapterName(env)
      .then((value) => {
        if (value !== undefined) name = value
        namePending = undefined
        return name
      })
      .catch(() => undefined)
  }

  return {
    id: 'windows',
    // No split published: the two kinds of core an Intel or a Snapdragon part
    // runs are not described by anything an unprivileged process can read.
    tiers: () => Promise.resolve(undefined),
    memory: () => readMemory(env),
    network: () => readNetwork(env),
    async gpu() {
      loadName()
      const sample = await readNvidia(env)
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
    },
    // No live clock: Windows has no per-core frequency to read without a driver.
    createClockReader: () => undefined,
  }
}
