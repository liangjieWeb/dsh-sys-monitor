// The one open-source tool the Linux and Windows drivers both borrow.
//
// NVIDIA ships `nvidia-smi` with the driver on every system it supports, and
// it is the only vendor tool that answers "how busy is the GPU right now" to an
// ordinary user: NVIDIA publishes no utilization counter under /sys, and the
// DRM client's per-process statistics need permission this plugin does not ask
// for. One query, no resident process, and the clock and the model come back on
// the way past.

import { clampPercent, number } from './shared.js'

/** The figures the panel shows, in the order `nvidia-smi` will answer them. */
const FIELDS = ['utilization.gpu', 'memory.used', 'clocks.current.graphics', 'name']

const ARGS = [`--query-gpu=${FIELDS.join(',')}`, '--format=csv,noheader,nounits']

/**
 * What one `nvidia-smi` query answered, or undefined when the tool is not
 * installed, the driver is not loaded, or the answer is not a GPU's worth of
 * CSV. Every field is optional: a laptop whose dGPU is asleep reports `[N/A]`
 * for the clock and a zero for the rest, which is a sample, not a failure.
 * @param env - the environment to run the tool through.
 * @returns the sample, or undefined.
 */
export async function readNvidia(env) {
  const raw = await env.run(env.command('nvidia_smi'), ARGS)
  if (raw === undefined) return undefined
  const line = raw.split('\n').find((entry) => entry.trim() !== '')
  if (line === undefined) return undefined
  const columns = line.split(',')
  if (columns.length < FIELDS.length) return undefined
  const [utilization, memory, clock, name] = columns
  // `nounits` still reports memory in MiB, the one unit `nvidia-smi` has never
  // let go of; the rest are already in percent, megahertz and text.
  return {
    percent: clampPercent(number(utilization)),
    available: true,
    memoryBytes: memory === undefined ? undefined : (number(memory) ?? 0) * 1024 * 1024,
    mhz: number(clock),
    name: name?.trim() === '' ? undefined : name?.trim(),
  }
}
