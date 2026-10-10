// Standalone harness: run the host half against a fake Cordis context and
// print a few consecutive samples, so the numbers can be checked on a machine
// before the plugin is installed in a profile — and so a machine that is not
// the one this was written on can say what it does publish.
//
// Usage: node tools/probe.mjs [MB of dd load between samples]
//
// The helper binaries are optional; build them with tools/build-helper.sh to
// see live clocks rather than the nominal ones.

import { apply, SAMPLE_PATH } from '../lib/index.js'

const registered = []
const effects = []
const ctx = {
  effect: (fn) => {
    effects.push(fn)
    return () => {}
  },
  connection: {
    fetch: {
      register: (route) => {
        registered.push(route)
        return () => {}
      },
    },
  },
}

apply(ctx)
console.log('route:', SAMPLE_PATH, '| methods:', registered[0].methods.join(','))

const gib = (bytes) => (Number.isFinite(bytes) ? (bytes / 1024 ** 3).toFixed(1) : '—')
const pct = (value) => (Number.isFinite(value) ? value.toFixed(1) : '—')
const read = () => registered[0].fetch(new Request('http://x' + SAMPLE_PATH)).then((r) => r.json())

for (const round of [1, 2, 3, 4]) {
  const snapshot = await read()
  const tiers =
    snapshot.cpu.tiers.length > 0
      ? snapshot.cpu.tiers.map((tier) => `${tier.label}=${tier.name} ${tier.cores}c ${pct(tier.percent)}% @${tier.mhz ?? '—'}MHz${tier.live ? '' : ' (nominal)'}`).join('  ')
      : '(no split published)'
  console.log(`#${round}  platform=${snapshot.platform} cores=${snapshot.cores}`)
  console.log(`  cpu   ${tiers}${snapshot.cpu.tiers.length > 0 ? '' : `  overall=${pct(snapshot.cpu.overall)}%`}  load=${snapshot.cpu.loadAverage.join(' ')}`)
  console.log(`  mem   ${pct(snapshot.mem.percent)}%  ${gib(snapshot.mem.usedBytes)}/${gib(snapshot.mem.totalBytes)} GiB  compressed=${gib(snapshot.mem.compressedBytes)}  swap=${gib(snapshot.mem.swapUsedBytes)}/${gib(snapshot.mem.swapTotalBytes)}`)
  const gpuClock = Number.isFinite(snapshot.gpu.mhz) ? ` @${snapshot.gpu.mhz}MHz` : ''
  console.log(`  gpu   ${snapshot.gpu.available === true ? `${snapshot.gpu.percent}%${gpuClock}  ${gib(snapshot.gpu.memoryBytes)} GiB mapped  ${snapshot.gpu.name ?? '—'} ${snapshot.gpu.cores ?? '—'}c` : `unavailable${snapshot.gpu.name === undefined ? '' : ` (${snapshot.gpu.name})`}`}`)
  console.log(`  net   down=${snapshot.net.down ?? '—'}  up=${snapshot.net.up ?? '—'}  interfaces=${snapshot.net.interfaces}`)
  if (snapshot.clock.available !== true && snapshot.clock.reason !== 'sampler idle') {
    console.log(`  clock ${snapshot.clock.reason}`)
  }
  if (round < 4) {
    // keep some network traffic and CPU load in flight during the delta
    const busy = Number(process.argv[2] ?? 0)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (busy > 0) {
      const { execFileSync } = await import('node:child_process')
      execFileSync('dd', [`if=/dev/zero`, `of=/dev/null`, `bs=1m`, `count=${busy}`])
    }
  }
}
for (const dispose of effects) dispose()
