// Exercises every platform driver against a machine that is not this one.
//
// The Linux, Windows and Intel paths cannot be run on the machine this plugin
// is developed on, and writing them from a description of a kernel is how
// parsers end up quietly wrong. So each driver is handed a fixture instead: a
// fake /sys, a fake /proc, a fake command's stdout — the exact files one kind
// of machine publishes — and checked for what it makes of them. Only the
// plumbing that is common to all of them (the sampler's own arithmetic, the
// clock a tier is given) is left to the machine.
//
// Usage: node tools/driver-check.mjs

import assert from 'node:assert/strict'
import os from 'node:os'

import { createSampler } from '../lib/index.js'
import { createDarwinDriver } from '../lib/platform/darwin.js'
import { createLinuxDriver } from '../lib/platform/linux.js'
import { createPortableDriver } from '../lib/platform/portable.js'
import { createWindowsDriver } from '../lib/platform/windows.js'

let checks = 0
let section = ''

function heading(title) {
  section = title
  console.log(`\n${title}`)
}

/** Run one check, printing it as it passes and as it fails. */
async function check(name, body) {
  try {
    await body()
    checks++
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n').join('\n       ')}`)
    process.exitCode = 1
  }
}

/**
 * A machine made of strings: `files` is read by path, `directories` listed by
 * path, and `commands` answered by whatever the caller keys them under — the
 * bare name, so a test does not have to spell out which absolute path this
 * platform keeps a command at.
 */
function fixture({ platform, arch = 'x64', cpus, files = {}, directories = {}, commands = {}, totalmem, freemem }) {
  return {
    platform,
    arch,
    cpus: () => Array.from({ length: cpus }, (_unused, index) => ({ times: { user: 0, nice: 0, sys: 0, irq: 0, idle: 0 } })),
    totalmem: () => totalmem ?? 0,
    freemem: () => freemem ?? 0,
    run: async (file) => commands[file] ?? commands[file.split('/').pop()],
    readFile: async (path) => files[path],
    readdir: async (path) => directories[path],
    command: (name) => name,
  }
}

/** `/sys/devices/system/cpu/cpuN/<file>` for every core, from one value each. */
function perCore(total, file, values) {
  return Object.fromEntries(Array.from({ length: total }, (_unused, index) => [`/sys/devices/system/cpu/cpu${index}/${file}`, `${values[index]}\n`]))
}

const MEMINFO = [
  'MemTotal:       32768000 kB',
  'MemFree:         1000000 kB',
  'MemAvailable:   16000000 kB',
  'SwapTotal:       2048000 kB',
  'SwapFree:        1000000 kB',
  '',
].join('\n')

const NETDEV = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo: 1000000    1000    0    0    0     0          0         0  1000000    1000    0    0    0     0       0          0',
  '  eth0: 5000000   20000    0    0    0     0          0         0  1000000    1000    0    0    0     0       0          0',
  '  eth1: 9000000   30000    0    0    0     0          0         0  9000000    1000    0    0    0     0       0          0',
  'docker0: 7000000   40000    0    0    0     0          0         0  7000000    1000    0    0    0     0       0          0',
  '',
].join('\n')

// --- Linux: an arm64 part with two kinds of core -----------------------------

heading('linux · arm64 big.LITTLE (4 big, 4 little)')

// A Raspberry Pi 5's topology: four Cortex-A76 (`CPU_TYPE_PERFORMANCE` 4) and
// four Cortex-A55 (`CPU_TYPE_EFFICIENT` 1), the big ones numbered first.
const armFiles = {
  ...perCore(8, 'topology/core_type', [4, 4, 4, 4, 1, 1, 1, 1]),
  ...perCore(8, 'cpufreq/scaling_cur_freq', [2_994_000, 2_994_000, 1_500_000, 2_994_000, 1_800_000, 1_500_000, 1_800_000, 1_799_000]),
  '/proc/meminfo': MEMINFO,
  '/proc/net/dev': NETDEV,
  '/sys/class/drm/card0/device/gpu_busy_percent': '37\n',
  '/sys/class/drm/card0/device/mem_info_vram_used': '3221225472\n',
}
const arm = createLinuxDriver({
  platform: 'linux',
  arch: 'arm64',
  cpus: () => Array.from({ length: 8 }, () => ({})),
  command: (name) => name,
  run: async () => undefined,
  readFile: async (path) => armFiles[path],
  readdir: async (path) => (path === '/sys/class/drm' ? ['card0', 'card0-DP-1', 'renderD128'] : undefined),
  totalmem: () => 8 * 1024 ** 3,
  freemem: () => 4 * 1024 ** 3,
})

const armTiers = await arm.tiers()

await check('the two kinds of core become a Performance and an Efficiency tier', () => {
  assert.deepEqual(armTiers, [
    { label: 'P', name: 'Performance', cores: 4, logicalCpus: [0, 1, 2, 3] },
    { label: 'E', name: 'Efficiency', cores: 4, logicalCpus: [4, 5, 6, 7] },
  ])
})

await check('a tier is given the mean of its own cores, not the whole socket', async () => {
  const clocks = await arm.createClockReader().read(armTiers)
  assert.deepEqual(
    clocks.groups.map((group) => [group.cores, group.mhz]),
    [
      [4, 2621],
      [4, 1725],
    ],
  )
})

await check('memory is total minus available, with swap beside it', async () => {
  const memory = await arm.memory()
  assert.equal(memory.usedBytes, (32768000 - 16000000) * 1024)
  assert.equal(memory.totalBytes, 32768000 * 1024)
  assert.equal(memory.swapUsedBytes, (2048000 - 1000000) * 1024)
  assert.equal(memory.compressedBytes, undefined, 'Linux has no one figure for it')
})

await check('throughput counts the physical links and not the loopback or bridge', async () => {
  const net = await arm.network()
  assert.equal(net.received, 14000000, 'both eth0 and eth1')
  assert.equal(net.sent, 10000000)
  assert.equal(net.interfaces, 2, 'lo and docker0 are not links')
})

await check('an amdgpu busy percentage answers the GPU row', async () => {
  const gpu = await arm.gpu()
  assert.equal(gpu.available, true)
  assert.equal(gpu.percent, 37)
  assert.equal(gpu.memoryBytes, 3221225472)
})

// --- Linux: an Intel hybrid part ---------------------------------------------

heading('linux · Intel hybrid (8 P, 8 E)')

// Alder Lake under Linux: eight Core and eight Atom, numbered the other way
// round from an arm64 part, and with the x86 core types.
const intelTiers = await createLinuxDriver({
  platform: 'linux',
  cpus: () => Array.from({ length: 16 }, () => ({})),
  readFile: async (path) => perCore(16, 'topology/core_type', [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2])[path],
}).tiers()

await check('the Atom cores come first when the kernel numbers them first', () => {
  assert.deepEqual(intelTiers, [
    { label: 'E', name: 'Efficiency', cores: 8, logicalCpus: [0, 1, 2, 3, 4, 5, 6, 7] },
    { label: 'P', name: 'Performance', cores: 8, logicalCpus: [8, 9, 10, 11, 12, 13, 14, 15] },
  ])
})

// --- Linux: the shapes that are not a split ----------------------------------

heading('linux · a part that publishes no split')

await check('one kind of core is not a split', async () => {
  const uniform = createLinuxDriver({
    platform: 'linux',
    cpus: () => Array.from({ length: 4 }, () => ({})),
    readFile: async (path) => perCore(4, 'topology/core_type', [4, 4, 4, 4])[path],
  })
  assert.equal(await uniform.tiers(), undefined)
})

await check('no topology at all is not a split', async () => {
  const plain = createLinuxDriver({ platform: 'linux', cpus: () => Array.from({ length: 4 }, () => ({})) })
  assert.equal(await plain.tiers(), undefined)
})

await check('capacity scaling is the fallback for a kernel without core_type', async () => {
  const capacity = createLinuxDriver({
    platform: 'linux',
    cpus: () => Array.from({ length: 4 }, () => ({})),
    readFile: async (path) => perCore(4, 'topology/capacity', [1024, 1024, 255, 255])[path],
  })
  assert.deepEqual(await capacity.tiers(), [
    { label: 'P', name: 'Performance', cores: 2, logicalCpus: [0, 1] },
    { label: 'E', name: 'Efficiency', cores: 2, logicalCpus: [2, 3] },
  ])
})

await check('a core that will not answer makes the whole table unusable', async () => {
  const files = perCore(4, 'topology/core_type', [4, 4, 1, 1])
  delete files['/sys/devices/system/cpu/cpu3/topology/core_type']
  const partial = createLinuxDriver({
    platform: 'linux',
    cpus: () => Array.from({ length: 4 }, () => ({})),
    readFile: async (path) => files[path],
  })
  assert.equal(await partial.tiers(), undefined)
})

await check('no cpufreq driver means no live clock, and says so', async () => {
  const clocks = await arm.createClockReader().read([{ label: 'P', cores: 1, logicalCpus: [0] }])
  assert.equal(clocks.groups.length, 1, 'cpu0 does have a frequency in the fixture')
  const bare = createLinuxDriver({ platform: 'linux', cpus: () => Array.from({ length: 4 }, () => ({})) })
  const reader = bare.createClockReader()
  assert.deepEqual((await reader.read([{ label: 'P', cores: 1, logicalCpus: [0] }])).groups, [])
  assert.equal(reader.status().available, false)
})

// --- Linux: the GPU from a vendor tool ---------------------------------------

heading('linux · the GPU from nvidia-smi')

await check('one query answers the whole row, clock included', async () => {
  const nvidia = createLinuxDriver({
    platform: 'linux',
    cpus: () => [{}],
    command: (name) => name,
    run: async () => '37, 1024, 1980, NVIDIA GeForce RTX 4090\n',
  })
  const gpu = await nvidia.gpu()
  assert.equal(gpu.percent, 37)
  assert.equal(gpu.memoryBytes, 1024 * 1024 * 1024)
  assert.equal(gpu.mhz, 1980)
  assert.equal(gpu.name, 'NVIDIA GeForce RTX 4090')
})

await check('a machine with no answer at all says so rather than showing zero', async () => {
  const none = createLinuxDriver({ platform: 'linux', cpus: () => [{}] })
  assert.deepEqual(await none.gpu(), {
    percent: undefined,
    available: false,
    memoryBytes: undefined,
    name: undefined,
    mhz: undefined,
    rendererPercent: undefined,
    tilerPercent: undefined,
  })
})

await check('a card the tools cannot name is still named from lspci, a tick later', async () => {
  const amd = createLinuxDriver({
    platform: 'linux',
    cpus: () => [{}],
    command: (name) => name,
    run: async (file) =>
      file === 'lspci'
        ? '00:02.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [Radeon RX 7900 XT/7900 XTX] (rev 01)\n'
        : undefined,
  })
  // The name costs a subprocess, so no tick ever waits for it: the first
  // sample draws the row without one and the second carries it.
  assert.equal((await amd.gpu()).name, undefined)
  assert.equal((await amd.gpu()).name, 'Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [Radeon RX 7900 XT/7900 XTX]')
})

// --- Windows -----------------------------------------------------------------

heading('windows · memory, throughput and an NVIDIA row')

const windows = createWindowsDriver({
  platform: 'win32',
  command: (name) => name,
  totalmem: () => 16 * 1024 ** 3,
  freemem: () => 6 * 1024 ** 3,
  run: async (file) =>
    file === 'netstat'
      ? [
          'Interface Statistics',
          '',
          '                               Bytes                    Unicast  packets',
          '                    Sent     Received    Total     Transmitted   Received  Discarded',
          '-------------------------------------------------------------------------------',
          'Ethernet                  1,000,000     2,000,000     3,000,000         100          200         0',
          'vEthernet (WSL)             500,000       500,000     1,000,000          50           50         0',
          '',
        ].join('\n')
      : undefined,
})

await check('netstat -e rows are read by position, in the local language', async () => {
  const net = await windows.network()
  // Sent is the first number of a row and received the second, and the name is
  // matched so the virtual adapter that mirrors the real link is left out.
  assert.equal(net.received, 2000000)
  assert.equal(net.sent, 1000000)
  assert.equal(net.interfaces, 1)
})

await check('memory is what the runtime reports the system as using', async () => {
  const memory = await windows.memory()
  assert.equal(memory.percent, 62.5)
  assert.equal(memory.swapUsedBytes, undefined)
})

await check('nvidia-smi answers on Windows too', async () => {
  const windows = createWindowsDriver({
    platform: 'win32',
    command: (name) => name,
    run: async () => '12, 2048, 1410, NVIDIA GeForce RTX 4060 Laptop GPU\n',
  })
  const gpu = await windows.gpu()
  assert.equal(gpu.percent, 12)
  assert.equal(gpu.mhz, 1410)
  assert.equal(gpu.name, 'NVIDIA GeForce RTX 4060 Laptop GPU')
})

await check('Windows publishes no split, so the processor is one row', async () => {
  assert.equal(await createWindowsDriver({ platform: 'win32' }).tiers(), undefined)
})

// --- macOS on Intel ----------------------------------------------------------

heading('darwin · an Intel Mac, whose split only the CPU knows')

// The helper's path is checked before it is run, so the fixture points it at a
// binary that exists and lets the run answer whatever the test wants.
const intelMac = (cpus) =>
  createDarwinDriver({
    platform: 'darwin',
    arch: 'x64',
    cpus: () => Array.from({ length: cpus.length }, () => ({})),
    helpers: { cpuid: process.execPath, ioreport: process.execPath },
    command: (name) => name,
    run: async (file) => (file === process.execPath ? `{"cpus":${JSON.stringify(cpus)}}` : undefined),
  })

await check('the CPUID answer becomes a Performance and an Efficiency tier', async () => {
  assert.deepEqual(await intelMac([[0, 64], [1, 32], [2, 32], [3, 32], [4, 32], [5, 32], [6, 32], [7, 32]]).tiers(), [
    { label: 'P', name: 'Performance', cores: 1, logicalCpus: [0] },
    { label: 'E', name: 'Efficiency', cores: 7, logicalCpus: [1, 2, 3, 4, 5, 6, 7] },
  ])
})

await check('a uniform part answers with nothing to draw', async () => {
  assert.equal(await intelMac([]).tiers(), undefined)
})

await check('a core type this plugin has no name for is not half a split', async () => {
  assert.equal(await intelMac([[0, 128], [1, 32]]).tiers(), undefined)
})

await check('an Intel Mac has no IOReport, and the panel is told so', () => {
  const reader = intelMac([]).createClockReader()
  assert.equal(reader.status().available, false)
  assert.match(reader.status().reason, /Apple silicon/)
})

// --- the macOS interface table -----------------------------------------------

// `netstat -ibn` as macOS prints it: one `<Link#N>` aggregate row per interface,
// then one row per address on that interface, repeating the same counters.
const NETSTAT_IB = [
  'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
  'lo0   16384 <Link#1>                         1000     0    1000000     1000     0    1000000     0',
  'lo0   16384 127           127.0.0.1           1000     -    1000000     1000     -    1000000     -',
  'en0   1500  <Link#2>       aa:bb:cc:dd:ee:ff   2000     0    5000000     3000     0    9000000     0',
  'en0   1500  192.168.1.5   192.168.1.5         2000     -    5000000     3000     -    9000000     -',
  'utun0 1380  <Link#3>                           4000     0    7000000     5000     0    8000000     0',
  '',
].join('\n')

await check('an interface is counted once, and its addresses are not a second time', async () => {
  const mac = createDarwinDriver({
    platform: 'darwin',
    command: (name) => name,
    run: async (file) => (file === 'netstat' ? NETSTAT_IB : undefined),
  })
  const net = await mac.network()
  assert.equal(net.interfaces, 1, 'loopback and the tunnel stay out')
  assert.equal(net.received, 5000000)
  assert.equal(net.sent, 9000000)
})

await check('the interface table is read with name resolution off', async () => {
  const calls = []
  const mac = createDarwinDriver({
    platform: 'darwin',
    command: (name) => name,
    run: async (file, args) => {
      calls.push({ file, args })
      return file === 'netstat' ? NETSTAT_IB : undefined
    },
  })
  await mac.network()
  // Without -n, netstat reverse-resolves the addresses it prints, and a lookup
  // that does not answer outlasts COMMAND_TIMEOUT_MS: the row would read as
  // "this machine publishes no counters" when it publishes them promptly.
  assert.match(calls[0].args.join(' '), /-[a-z]*n/, `netstat ran as ${calls[0].args.join(' ')}: a name lookup can time the read out`)
})

// --- a platform nothing speaks for -------------------------------------------

heading('portable · a system nothing else speaks for')

await check('it still answers with what the runtime itself reports', async () => {
  const portable = createPortableDriver({ platform: 'freebsd', totalmem: () => 1000, freemem: () => 250 })
  assert.equal(await portable.tiers(), undefined)
  assert.equal((await portable.memory()).percent, 75)
  assert.equal(await portable.network(), undefined)
  assert.equal((await portable.gpu()).available, false)
  assert.equal(portable.createClockReader(), undefined)
})

// --- the sampler on top of a driver ------------------------------------------

heading('the sampler, on a driver it does not know')

await check('each tier is measured on its own cores and given its own clock', async () => {
  const sampler = createSampler({
    id: 'test',
    tiers: () =>
      Promise.resolve([
        { label: 'P', name: 'Performance', cores: 1, logicalCpus: [0] },
        { label: 'E', name: 'Efficiency', cores: 1, logicalCpus: [1] },
      ]),
    memory: () => Promise.resolve({ available: false }),
    network: () => Promise.resolve(undefined),
    gpu: () => Promise.resolve({ available: false }),
    createClockReader: () => ({
      read: () => Promise.resolve({ groups: [{ cores: 1, mhz: 4000 }, { cores: 1, mhz: 1200 }] }),
      status: () => ({ available: true }),
      dispose() {},
    }),
  })
  try {
    const first = sampler.snapshot()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const sample = sampler.snapshot()
    assert.equal(first.cpu.tiers.length, 0, 'the first sample has no tiers yet')
    assert.deepEqual(
      sample.cpu.tiers.map((tier) => [tier.label, tier.name, tier.mhz, tier.live]),
      [
        ['P', 'Performance', 4000, true],
        ['E', 'Efficiency', 1200, true],
      ],
    )
    assert.equal(sample.clock.available, true)
  } finally {
    sampler.dispose()
  }
})

await check('a tier the clock reader does not cover falls back to nominal', async () => {
  const sampler = createSampler({
    id: 'test',
    tiers: () => Promise.resolve([{ label: 'P', name: 'Performance', cores: 1, logicalCpus: [0] }]),
    memory: () => Promise.resolve({ available: false }),
    network: () => Promise.resolve(undefined),
    gpu: () => Promise.resolve({ available: false }),
    createClockReader: () => ({
      read: () => Promise.resolve({ groups: [] }),
      status: () => ({ available: false, reason: 'nothing is reading' }),
      dispose() {},
    }),
  })
  try {
    sampler.snapshot()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const [tier] = sampler.snapshot().cpu.tiers
    assert.equal(tier.live, false)
    assert.equal(tier.mhz, os.cpus()[0].speed)
  } finally {
    sampler.dispose()
  }
})

console.log(`\n${checks} checks passed${process.exitCode ? ', with failures above' : ''}`)
