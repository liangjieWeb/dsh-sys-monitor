// The driver layer: the sampler asks a driver what the machine is doing, and
// the driver is the only code that knows how this particular system answers.
//
// A driver is an object with these members, and with nothing else the sampler
// may call on it:
//
//   id                 the platform this one speaks for
//   tiers()            which logical cores belong to which tier, or undefined
//   memory()           bytes in use, out of total, with swap where there is any
//   network()          cumulative byte counters and the interface count
//   gpu()              a utilization percentage, or an honest "not published"
//   createClockReader()  a live-frequency reader, or undefined for none
//
// A tier is `{label, name, cores, logicalCpus}`: the one-letter caption the row
// draws, the full name its tooltip spells out, how many logical processors it
// holds, and which of them, counted from zero in the runtime's own order. A
// driver that finds no split returns undefined rather than a single "tier":
// the sampler then draws the whole processor as one row, which is what a
// uniform part deserves.
//
// Every member resolves and never rejects. A system that answers none of this
// is a normal thing to meet, and a monitor that threw on it would be worse than
// one that draws a dash.

import { createDarwinDriver } from './darwin.js'
import { createLinuxDriver } from './linux.js'
import { createPortableDriver } from './portable.js'
import { createWindowsDriver } from './windows.js'

const FACTORIES = {
  darwin: createDarwinDriver,
  linux: createLinuxDriver,
  win32: createWindowsDriver,
}

/**
 * The driver for whichever system this is, and for the system nothing else
 * speaks for: a runtime that reports nothing but its own core count and its own
 * memory still gets both rows.
 * @param options - platform overrides and the injected environment, for tests.
 * @returns the driver.
 */
export function createDriver(options = {}) {
  const platform = options.platform ?? process.platform
  const factory = FACTORIES[platform] ?? createPortableDriver
  return factory(options)
}
