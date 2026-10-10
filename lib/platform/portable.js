// The driver for a system nothing else speaks for.
//
// What the runtime itself reports is worth exactly two rows: the processor's
// busy share, and the memory in use. Both come from counters the runtime keeps
// anyway, so the panel works on an unrecognised platform with nothing installed
// and no command run on its behalf — which is a better answer than no panel at
// all, and an honest one, since every figure it draws is one the platform
// agreed to publish.

import { clampPercent, createEnvironment } from './shared.js'

/** The portable driver. */
export function createPortableDriver(options = {}) {
  const env = createEnvironment(options)
  return {
    id: 'portable',
    // No split: nothing outside the driver can say which of the cores are
    // which, and inventing a division is worse than drawing the whole thing.
    tiers: () => Promise.resolve(undefined),
    memory: () =>
      Promise.resolve(
        (() => {
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
        })(),
      ),
    network: () => Promise.resolve(undefined),
    gpu: () =>
      Promise.resolve({
        percent: undefined,
        available: false,
        memoryBytes: undefined,
        name: undefined,
        cores: undefined,
        mhz: undefined,
        rendererPercent: undefined,
        tilerPercent: undefined,
      }),
    createClockReader: () => undefined,
  }
}
