// Executes lib/client.js the way the page does — through
// `window.__ModuleLoader__.load` — against a stub React and a stub Cordis
// context, then renders the registered overlay entry and checks the six rows.
//
// Usage: node tools/render-check.mjs

import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

// Shaped like a real sample from an Apple M5 Pro: a 12-core `Performance` level
// and a 6-core `Super` level, which is what the Host discovers from the
// perf-level table and the per-core device-tree nodes.
const SPLIT = {
  at: Date.now(),
  platform: 'darwin',
  cores: 18,
  cpu: {
    overall: 14.3,
    tiers: [
      { label: 'P', name: 'Performance', cores: 12, percent: 10.9, mhz: 3692, live: true },
      { label: 'S', name: 'Super', cores: 6, percent: 26, mhz: 4395, live: true },
    ],
    loadAverage: [3.8, 6.5, 6.3],
  },
  mem: {
    available: true,
    percent: 58.1,
    usedBytes: 39_899_422_720,
    totalBytes: 68_719_476_736,
    compressedBytes: 4_881_264_640,
    swapUsedBytes: 2_026_168_704,
    swapTotalBytes: 3_221_225_472,
  },
  gpu: {
    percent: 47,
    mhz: 338,
    available: true,
    name: 'Apple M5 Pro',
    cores: 20,
    memoryBytes: 2_088_534_016,
    rendererPercent: 47,
    tilerPercent: 42,
  },
  clock: { available: true },
  net: { down: 1_572_864, up: 34_816, fullScaleBps: 104_857_600, interfaces: 8 },
}

// A machine that publishes no perf-level split: one CPU row, no clock.
const NO_SPLIT = { ...SPLIT, cpu: { overall: 14.3, tiers: [], loadAverage: [3.8, 6.5, 6.3] } }

let served = null
let currentSample = SPLIT
const fetchCalls = []
const timers = []

const documentStub = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {} }),
  querySelector: () => null,
  hidden: false,
  // The window the panel may be parked in: a drag is clamped against it, and a
  // position saved on a larger screen has to survive a smaller one.
  documentElement: { clientWidth: 1200, clientHeight: 800 },
}

// --- minimal React -----------------------------------------------------------
let hookIndex = 0
const hookSlots = []
const pendingEffects = []
const reactStub = {
  createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const index = hookIndex++
    if (!(index in hookSlots)) hookSlots[index] = typeof initial === 'function' ? initial() : initial
    return [
      hookSlots[index],
      (next) => {
        hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next
      },
    ]
  },
  useEffect(effect) {
    pendingEffects.push(effect)
  },
  useMemo: (factory) => factory(),
  useRef(initial) {
    // React keeps one ref object per hook for the life of the component, and
    // the panel's drag state lives in one, so the stub has to as well.
    const index = hookIndex++
    if (!(index in hookSlots)) hookSlots[index] = { current: initial }
    return hookSlots[index]
  },
}

const moduleLoader = { load: (entry) => { served = entry } }
const windowStub = { __ModuleLoader__: moduleLoader }

// The panel's appearance survives a reload in page storage. The seed is
// deliberately hostile — an opacity past its end, a colour that is not a
// colour, a blur past the slider's end, a font that is a whole stylesheet
// rather than one of the panel's own keys, a text size the panel does not
// draw at — because that is what a stale record from an older build, or a
// hand-edited one, looks like.
const store = new Map([
  [
    'dsh-sys-monitor.appearance',
    JSON.stringify({
      bg: '#112233',
      bgAlpha: 150,
      text: 'chartreuse',
      bar: '#00ff00',
      barAlpha: 40,
      blur: 99,
      font: 'Comic Sans MS; } body { display:none',
      size: 40,
    }),
  ],
])
windowStub.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
}

// A drag is heard on the window, not on the panel, because a pointer that
// leaves the panel mid-drag still owns it. The same rule a browser applies —
// one registration per function — keeps a re-run effect from stacking copies.
const windowListeners = new Map()
const listen = (type, listener) => {
  const list = windowListeners.get(type) ?? []
  if (!list.includes(listener)) list.push(listener)
  windowListeners.set(type, list)
}
windowStub.addEventListener = (type, listener) => listen(type, listener)
windowStub.removeEventListener = (type, listener) => {
  windowListeners.set(type, (windowListeners.get(type) ?? []).filter((each) => each !== listener))
}
const fireWindow = (type, event) => {
  for (const listener of [...(windowListeners.get(type) ?? [])]) listener(event)
}
const fetchStub = (input) => {
  fetchCalls.push(input)
  return Promise.resolve({ ok: true, status: 200, json: async () => currentSample })
}
const abortStub = class {
  constructor() {
    this.signal = { aborted: false, addEventListener() {} }
  }
  abort() {
    this.signal.aborted = true
  }
}

// --- run the bundle ----------------------------------------------------------
const run = new Function(
  'window',
  'document',
  'fetch',
  'setInterval',
  'clearInterval',
  'AbortController',
  source,
)
run(windowStub, documentStub, fetchStub, (fn, ms) => timers.push({ fn, ms }) && timers.length, () => {}, abortStub)

assert.ok(served, 'the bundle never called window.__ModuleLoader__.load')
assert.equal(served.id, '@liangjieweb/dsh-sys-monitor')

const exportsObject = served.factory((specifier) => {
  if (specifier === 'react') return reactStub
  throw new Error(`unexpected client import: ${specifier}`)
})
assert.equal(typeof exportsObject.apply, 'function', 'apply must be exported')
assert.deepEqual(exportsObject.inject, ['slots', 'locale'])

// The panel is parked in the corner the window's own title strip occupies, and
// Electron resolves drag regions by geometry rather than by hit test: a press
// inside a `drag` region moves the window whatever is drawn over it. The panel
// therefore has to subtract itself, or its header drags the window instead.
const stylesheet = /var css = "([\s\S]*?)";\n/.exec(source)[1].replace(/\\"/g, '"')
assert.match(
  stylesheet,
  /\.dshsm\{[^}]*-webkit-app-region:no-drag/,
  'the panel must opt out of the window drag region',
)
assert.match(stylesheet, /\.dshsm--placed\{right:auto\}/, 'a placed panel is anchored by its own coordinates')
// The panel has one width in both of its shapes, so its edges never move when
// it collapses; what the collapsed shape gives up is the room inside.
assert.match(stylesheet, /\.dshsm\{[^}]*width:calc\(272px \* var\(--dshsm-scale,1\)\)/,
  'the positioned element is 272px wide at 11px and as wide as the panel is drawn at any other size, so the corner and the clamp measure the panel the window can see')
assert.match(stylesheet, /\.dshsm__box\{[^}]*width:272px/, 'and the panel inside it is drawn at 272px of its own')
assert.doesNotMatch(stylesheet, /\.dshsm--mini\{[^}]*width/, 'and collapsing does not hand it another')
assert.match(stylesheet, /\.dshsm--mini \.dshsm__head\{border-bottom:0/, 'a collapsed panel is one line, so its header draws no rule under itself')
assert.match(stylesheet, /\.dshsm__mini\{[^}]*flex:1 1 auto;min-width:0/, 'the two figures take the room between the title and the buttons')
assert.match(stylesheet, /\.dshsm__row--mini\{flex:1 1 0/, 'and split that room between them')
assert.doesNotMatch(stylesheet, /\.dshsm--mini \.dshsm__rows/, 'a collapsed panel has no body left to lay out')
// The edge is one pixel of the border token, and a stale sample says so on the
// edge itself. Both are the token-usage panel's wording too: the two overlays
// are meant to read as a pair, so the numbers here are the numbers over there.
assert.match(stylesheet, /\.dshsm__box\{[^}]*border:1px solid var\(--dshsm-line,var\(--dsw-alias-border-l1\)\)/, 'the panel is edged in one pixel of the border token')
assert.match(stylesheet, /\.dshsm__head\{[^}]*border-bottom:1px solid var\(--dshsm-line/, 'and its header is separated by the same line')
assert.match(stylesheet, /\.dshsm--error \.dshsm__box\{border-color:var\(--dsw-alias-state-warn-primary\)\}/, 'a stale sample is said on the border, not only in the note')

// --- stub client context -----------------------------------------------------
const dictionaries = {}
const registrations = []
const disposeEffects = []
const ctx = {
  effect(effect) {
    disposeEffects.push(effect())
  },
  locale: {
    register(ns, dicts) {
      dictionaries[ns] = dicts
      return () => {}
    },
    bind(ns) {
      const dict = dictionaries[ns]
      return (key) => dict.zh[key] ?? dict.en[key] ?? key
    },
  },
  slots: {
    inject(name, mount) {
      assert.equal(name, 'shell.overlay')
      mount()
    },
    register(registration, component) {
      registrations.push({ registration, component })
      return () => {}
    },
  },
}

exportsObject.apply(ctx)

assert.deepEqual(Object.keys(dictionaries), ['sys-monitor'])
assert.deepEqual(Object.keys(dictionaries['sys-monitor'].zh), Object.keys(dictionaries['sys-monitor'].en))
assert.equal(registrations.length, 1)
assert.equal(registrations[0].registration.id, 'sys-monitor.panel')
assert.equal(registrations[0].registration.name, 'shell.overlay')

// --- render the panel, before any sample has arrived -------------------------
hookIndex = 0
hookSlots.length = 0

const flat = []
const walk = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach(walk)
  if (typeof node.type === 'function') return walk(node.type({ ...node.props }))
  flat.push(node)
  return walk(node.props?.children)
}
// One metric row, read out of the element: the caption, the accessible name
// behind the bar, the fill width, the figure beside it and the hover text.
const readRow = (row) => ({
  label: row.props.children[0].props.children,
  aria: row.props.children[1].props['aria-label'],
  width: row.props.children[1].props.children.props.style.width,
  value: row.props.children[2].props.children,
  hint: row.props.title,
})
// The expanded rows are the ones that carry no modifier class; the collapsed
// panel's own pair is read by `miniOf`, which picks those out instead.
const rowsOf = (nodes) => nodes.filter((node) => node.props.className === 'dshsm__row').map(readRow)

// React rewinds the hook cursor at the top of every render; so does this stub.
const renderPanel = () => {
  hookIndex = 0
  flat.length = 0
  walk(registrations[0].component({}))
  return flat
}

renderPanel()
assert.ok(pendingEffects.length > 0, 'the panel registered no polling effect')

const panel = flat.find((node) => node.props.className?.startsWith('dshsm'))
assert.ok(panel, 'the panel element was not rendered')

const firstRows = rowsOf(flat)
assert.equal(firstRows.length, 5, `expected five rows before any split is known, got ${firstRows.length}`)
assert.deepEqual(
  firstRows.map((row) => row.label),
  ['CPU', '内存', 'GPU', '↓', '↑'],
  'without a sample the CPU is one row and the captions are the short ones',
)
assert.deepEqual(
  firstRows.map((row) => row.value),
  ['—', '—', '—', '—', '—'],
  'the first paint must show placeholders, never a fabricated zero',
)

// --- run one poll and render again -------------------------------------------
const effects = pendingEffects.splice(0)
const cleanup = effects.map((effect) => effect()).filter((value) => typeof value === 'function')
assert.equal(timers.length, 1, 'expected exactly one interval')
assert.equal(timers[0].ms, 1000, 'expected a one-second cadence')
assert.deepEqual(fetchCalls, ['api/sys-monitor.sample'], 'the panel must address the document-relative route')

await new Promise((resolve) => setImmediate(resolve))
const rowSummary = rowsOf(renderPanel())
pendingEffects.splice(0)
console.log('rendered rows:')
for (const row of rowSummary) console.log(`  ${row.label.padEnd(5)} ${String(row.width).padStart(7)}  ${row.value}`)

assert.equal(rowSummary.length, 6, 'the split CPU plus memory, GPU and both directions make six rows')

// Captions stay terse; the full name lives in the tooltip and the aria-label.
assert.deepEqual(
  rowSummary.map((row) => row.label),
  ['P', 'S', '内存', 'GPU', '↓', '↑'],
  'captions must be one letter or one arrow',
)
assert.match(rowSummary[0].hint, /^Performance · /, 'the perf level spells its own name on hover')
assert.match(rowSummary[1].hint, /^Super · /)
assert.match(rowSummary[4].hint, /^下行 · /, 'the down arrow spells its direction on hover')
assert.match(rowSummary[5].hint, /^上行 · /)
assert.equal(rowSummary[0].aria, 'Performance')

// Percent plus a second figure, from the same source as the bar.
assert.equal(rowSummary[0].value, '11% · 3692 MHz')
assert.equal(rowSummary[0].width, '10.9%')
assert.equal(rowSummary[1].value, '26% · 4395 MHz')
assert.equal(rowSummary[2].value, '58% · 37/64 GB')
assert.equal(rowSummary[2].width, '58.1%')
assert.equal(rowSummary[3].value, '47% · 338 MHz')
assert.equal(rowSummary[3].hint, 'Apple M5 Pro · 核: 20 · 已用显存: 1.9 GB · 渲染器: 47% · 分块器: 42% · 频率: 338 MHz')
assert.equal(rowSummary[2].hint, '内存 · 已用: 37/64 GB · 压缩内存: 4.5 GB · 交换空间: 1.9/3.0 GB')
assert.match(rowSummary[0].hint, /频率: 3692 MHz/)
assert.match(rowSummary[0].hint, /平均负载: 3\.8 6\.5 6\.3/)

// Without the IOReport helper the host reports the nominal frequency instead,
// and the tooltip says so rather than passing it off as a live reading.
currentSample = { ...SPLIT, cpu: { ...SPLIT.cpu, tiers: SPLIT.cpu.tiers.map((tier) => ({ ...tier, mhz: 2400, live: false })) } }
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
const nominal = rowsOf(renderPanel())
pendingEffects.splice(0)
assert.equal(nominal[0].value, '11% · 2400 MHz')
assert.match(nominal[0].hint, /标称频率: 2400 MHz/)

// A panel that fell back to nominal clocks says so, and says why.
const NOMINAL = {
  ...SPLIT,
  cpu: { ...SPLIT.cpu, tiers: SPLIT.cpu.tiers.map((tier) => ({ ...tier, mhz: 2400, live: false })) },
}
currentSample = { ...NOMINAL, clock: { available: false, reason: 'helper exited (code 1)' } }
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
renderPanel()
pendingEffects.splice(0)
const note = flat.find((node) => node.props.className === 'dshsm__note')
assert.ok(note, 'a panel without live clocks must explain itself')
assert.equal(note.props.children, '频率为标称值 · helper exited (code 1)')

// A GPU with no counter renders as a dash rather than a fabricated zero.
currentSample = { ...SPLIT, gpu: { percent: undefined, available: false, name: 'Intel HD Graphics 630' } }
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
const offlineGpu = rowsOf(renderPanel())
pendingEffects.splice(0)
assert.equal(offlineGpu[3].value, '—', 'a GPU without a counter must read as a dash')
assert.match(offlineGpu[3].hint, /该 GPU 未提供利用率计数器/)

// A machine with no published split falls back to one CPU row that says why.
currentSample = { ...NO_SPLIT, clock: { available: false, reason: 'no live clock source' } }
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
const unsplit = rowsOf(renderPanel())
pendingEffects.splice(0)
assert.equal(unsplit.length, 5, 'without a split there is one CPU row again')
assert.equal(unsplit[0].label, 'CPU')
assert.equal(unsplit[0].value, '14%', 'the unsplit row still shows its percentage')
assert.match(unsplit[0].hint, /该 CPU 未提供分核档位/)
assert.equal(flat.filter((node) => node.props.className === 'dshsm__note').length, 0, 'a row that shows no clock has none to explain')

// The bar uses a 0.35 power curve: a trickle stays low, a busy link still
// fills, and neither end of the range pins at zero or 100.
const downWidth = Number.parseFloat(rowSummary[4].width)
const upWidth = Number.parseFloat(rowSummary[5].width)
assert.equal(rowSummary[4].width, '23%', `1.5 MB/s of 100 MB/s reads ~23%, got ${rowSummary[4].width}`)
assert.equal(rowSummary[5].width, '6.1%', `34 KB/s of 100 MB/s reads ~6%, got ${rowSummary[5].width}`)
assert.ok(downWidth > upWidth && upWidth < 20, 'a smaller rate must draw a smaller bar')

// --- polling lifecycle -------------------------------------------------------
// The mount poll plus the four ticks driven above.
assert.equal(fetchCalls.length, 5, 'mount issues exactly one immediate poll')
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(fetchCalls.length, 6, 'the interval must issue exactly one poll per tick')

// --- the appearance settings -------------------------------------------------
// This block re-renders the panel and re-runs its effects after every control
// is used, which is what commits a record to storage. Re-running the polling
// effect is harmless — a second interval that is never ticked — but it moves
// the poll counts, so this runs after them.
const classesOf = (node) => (node.props.className ?? '').split(' ')
const panelOf = () => flat.find((node) => classesOf(node)[0] === 'dshsm')
const styleOf = () => panelOf().props.style
const byClass = (className) => flat.filter((node) => classesOf(node).includes(className))
const byType = (type) => flat.filter((node) => node.props.type === type)
const commit = () => {
  renderPanel()
  for (const effect of pendingEffects.splice(0)) effect()
}

// A hostile record is opened, not obeyed: what it does get through is used.
assert.equal(styleOf()['--dshsm-bg'], 'rgba(17,34,51,1)', 'the panel opens with the background it was given')
assert.equal(styleOf()['--dshsm-bar'], 'rgba(0,255,0,0.4)', 'a chosen bar colour carries its own opacity')
assert.equal(styleOf()['--dshsm-blur'], '24px', 'a blur past the slider end clamps to the end')
assert.equal(styleOf()['--dshsm-fg'], undefined, 'a colour that is not a colour falls back to the theme')
assert.equal(styleOf()['--dshsm-track'], 'rgba(12,24,37,1)', 'the trough is shaded from the background the user chose')
assert.equal(styleOf()['--dshsm-line'], 'rgba(112,122,133,1)', 'and so is the border, which no theme token describes')
assert.ok(
  !classesOf(panelOf()).includes('dshsm--tinted'),
  'a colour that is already a colour needs no mix to become translucent',
)

assert.equal(byClass('dshsm__settings').length, 0, 'the settings stay closed until the gear is used')
const gear = () => byClass('dshsm__gear')[0]
assert.ok(gear(), 'the header carries a settings button')
assert.equal(gear().props['aria-label'], '设置')
gear().props.onClick()
commit()
assert.equal(gear().props['aria-expanded'], true, 'and says so while they are open')
assert.equal(byClass('dshsm__settings').length, 1, 'the gear opens the settings')
assert.equal(byType('color').length, 4, 'background, text, border and bars each get a colour input')
assert.deepEqual(
  byType('color').map((input) => input.props['aria-label']),
  ['背景颜色', '文字颜色', '边框颜色', '进度条颜色'],
  'the border is one of them: the one line that has to be seen gets a field of its own',
)
assert.equal(byType('range').length, 3, 'background opacity, bar opacity and blur each get a slider')
// The border moves *away* from the background, not along with the other
// derived surfaces. Shading a black panel towards black is what made the
// border the panel's own colour, and it is the one value in the record where
// being invisible is the whole bug.
{
  const luminanceOf = (channels) => (0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]) / 255
  for (const background of ['#000000', '#ffffff', '#0c1428']) {
    byType('color')[0].props.onChange({ target: { value: background } })
    commit()
    const border = styleOf()['--dshsm-line']
    const shown = border.match(/[\d.]+/g).slice(0, 3).map(Number)
    const base = [1, 3, 5].map((at) => parseInt(background.slice(at, at + 2), 16))
    assert.ok(
      Math.abs(luminanceOf(shown) - luminanceOf(base)) > 0.2,
      `a ${background} panel gets a border it can be seen against, not its own colour (got ${border})`,
    )
  }
  byType('color')[0].props.onChange({ target: { value: '#112233' } })
  commit()
}

assert.deepEqual(
  byType('color').map((input) => input.props.value),
  ['#112233', '#e8e8ec', '#3a3a42', '#00ff00'],
  'a field that still follows the theme shows a swatch of its own',
)
assert.ok(
  classesOf(byType('color')[1]).includes('dshsm__set-color--theme'),
  'the swatch of a field on loan from the theme is dimmed',
)
assert.ok(
  !classesOf(byType('color')[0]).includes('dshsm__set-color--theme'),
  'a colour the user chose is not dimmed',
)
assert.deepEqual(
  byType('range').map((input) => input.props.value),
  [100, 40, 24],
  'each slider opens on the value in the record',
)
assert.deepEqual(
  byClass('dshsm__set-theme').map((button) => button.props.disabled),
  [false, true, true, false],
  'only a field that still follows the theme can be handed back to it',
)

// Choosing a text colour carries the whole text ramp and the border with it,
// instead of leaving the quiet labels on a theme colour no longer in use.
byType('color')[1].props.onChange({ target: { value: '#ffdd00' } })
commit()
assert.equal(styleOf()['--dshsm-fg'], '#ffdd00')
assert.equal(styleOf()['--dshsm-fg-2'], 'rgba(255,221,0,0.75)', 'the quiet labels are the same colour, quieter')
assert.equal(styleOf()['--dshsm-fg-3'], 'rgba(255,221,0,0.55)')
assert.equal(styleOf()['--dshsm-line'], 'rgba(255,221,0,0.24)')
assert.equal(byClass('dshsm__set-theme')[1].props.disabled, false, 'and the field is now the user’s to give back')

// A border the user picked beats both fallbacks.
byType('color')[2].props.onChange({ target: { value: '#ff2d55' } })
commit()
assert.equal(styleOf()['--dshsm-line'], '#ff2d55', 'a chosen border is used as it is')
byType('color')[2].props.onChange({ target: { value: '' } })
commit()
assert.equal(styleOf()['--dshsm-line'], 'rgba(255,221,0,0.24)', 'and handing it back falls through to the text it was derived from')

// One bar colour on the panel overrides all six rows, each of which keeps its
// own theme colour as the fallback it falls back to.
const fills = byClass('dshsm__fill')
assert.equal(fills.length, rowsOf(flat).length, 'every row has a bar')
assert.equal(fills[0].props.style['--dshsm-row'], 'var(--dsw-alias-brand-primary)', 'a row keeps the theme colour it was given')
assert.equal(fills[1].props.style['--dshsm-row'], 'var(--dsw-alias-state-warn-primary)', 'memory keeps its warning colour')
assert.equal(fills[2].props.style['--dshsm-row'], 'var(--dsw-alias-state-success-primary)', 'and the GPU keeps its success colour')
assert.equal(styleOf()['--dshsm-bar'], 'rgba(0,255,0,0.4)', 'and one property on the panel beats all six')
assert.equal(fills[0].props.style.background, undefined, 'the bar takes its colour from the stylesheet, not an inline background')

// The sliders: half a background, and a blur to go with it.
byType('range')[0].props.onChange({ target: { value: '60' } })
byType('range')[2].props.onChange({ target: { value: '8' } })
commit()
assert.equal(styleOf()['--dshsm-bg'], 'rgba(17,34,51,0.6)', 'a chosen background fades as its slider moves')
assert.equal(styleOf()['--dshsm-track'], 'rgba(12,24,37,0.6)', 'and the trough fades with the background it was shaded from')
assert.equal(styleOf()['--dshsm-blur'], '8px')
assert.deepEqual(
  byClass('dshsm__set-num').map((node) => node.props.children),
  ['60%', '40%', '8px'],
  'each slider reads out its own value and unit',
)

// A theme colour cannot be faded in JavaScript — the panel only has its name —
// so that one case asks the stylesheet to mix it, and only then.
// The rows are background, text, border, bar — so the bar's ⟲ is the fourth.
byClass('dshsm__set-theme')[0].props.onClick()
byClass('dshsm__set-theme')[3].props.onClick()
commit()
assert.equal(styleOf()['--dshsm-bg-alpha'], '60%', 'a theme background is handed its opacity as a percentage')
assert.equal(styleOf()['--dshsm-bar-alpha'], '40%', 'and so is a theme bar')
assert.ok(classesOf(panelOf()).includes('dshsm--tinted'), 'which is a class of its own, not a property every panel carries')
assert.ok(classesOf(panelOf()).includes('dshsm--tinted-bars'))

// Handing one field back to the theme touches that field alone: the background
// above already went back, so the text colour is what is left to check.
assert.equal(styleOf()['--dshsm-fg'], '#ffdd00', 'handing the background back leaves the text colour beside it alone')
assert.equal(byType('color')[0].props.value, '#1c1c20', 'and the background shows the theme swatch once more')

// A font is a menu of the panel's own keys, and the record holds a key — never
// a stack of its own. The stored value above is a whole stylesheet, and the
// case that has to be refused rather than trimmed.
assert.equal(styleOf()['--dshsm-font'], undefined, 'a hand-edited font is not carried into the panel')
{
  const font = byClass('dshsm__set-menu')[0]
  assert.equal(font.props.value, '', 'and the menu is left on the face the page already uses')
  assert.deepEqual(
    font.props.children.map((option) => option.props.value),
    ['', 'mono', 'sans', 'serif'],
    'the menu is the page’s own face first, then one entry per stack the panel knows',
  )
  assert.deepEqual(
    font.props.children.map((option) => option.props.children),
    ['跟随主题', '等宽', '无衬线', '衬线'],
    'and each entry says what it is in the page’s own language',
  )
  font.props.onChange({ target: { value: 'mono' } })
  commit()
  assert.equal(
    styleOf()['--dshsm-font'],
    'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'a chosen face reaches the panel as the stack the table holds for that key',
  )
  assert.equal(
    JSON.parse(store.get('dsh-sys-monitor.appearance')).font,
    'mono',
    'and the key is what is kept, so the next load cannot inherit a stranger’s CSS',
  )
  // The other end of the same menu is the page's own face again, and it means
  // the property goes away rather than becoming an empty declaration.
  font.props.onChange({ target: { value: '' } })
  commit()
  assert.equal(styleOf()['--dshsm-font'], undefined, 'following the theme takes the property away again')
  assert.match(
    source,
    /\.dshsm__box\{[^}]*font-family:var\(--dshsm-font,inherit\)/,
    'so the stylesheet is what hands the panel the page’s own face when the record says nothing',
  )

  // The size menu is the other half of the same row: whole pixels, the base
  // size included, and no entry the panel cannot draw at. A menu and not a
  // slider, because every value lays the panel out again.
  const size = byClass('dshsm__set-menu')[1]
  assert.deepEqual(
    size.props.children.map((option) => option.props.value),
    [9, 10, 11, 12, 13, 14, 15],
    'the sizes on offer, as numbers, from the smallest readable to the largest the panel is drawn at',
  )
  assert.deepEqual(
    size.props.children.map((option) => option.props.children),
    ['9px', '10px', '11px', '12px', '13px', '14px', '15px'],
    'and each entry says its own size in pixels',
  )
  assert.equal(size.props.value, 11, 'a size the record did not name leaves the panel at the size it draws at by default')
  assert.equal(byType('range').length, 3, 'so there is still one slider fewer than there are fields')
  size.props.onChange({ target: { value: '15' } })
  commit()
  assert.equal(styleOf()['--dshsm-scale'], String(15 / 11), 'a chosen size reaches the panel as the zoom that draws it')
  assert.equal(
    JSON.parse(store.get('dsh-sys-monitor.appearance')).size,
    15,
    'and the record keeps the pixels, not the menu’s string or the ratio the stylesheet needs',
  )
  assert.match(source, /\.dshsm__box\{[^}]*zoom:var\(--dshsm-scale,1\)/, 'which the stylesheet applies as a zoom')
  size.props.onChange({ target: { value: '11' } })
  commit()
  assert.equal(styleOf()['--dshsm-scale'], undefined, 'and the size the panel draws at by default sets no zoom at all')
}

// Reset puts every field back, and only then goes quiet.
assert.equal(byClass('dshsm__set-reset')[0].props.disabled, false, 'a panel that differs from the theme can always be put back')
byClass('dshsm__set-reset')[0].props.onClick()
commit()
assert.deepEqual(styleOf(), {}, 'reset leaves the panel inheriting every theme token again')
assert.equal(byClass('dshsm__set-reset')[0].props.disabled, true, 'and the button goes quiet when there is nothing left to reset')
assert.deepEqual(
  JSON.parse(store.get('dsh-sys-monitor.appearance')),
  { bg: '', bgAlpha: 100, text: '', border: '', bar: '', barAlpha: 100, blur: 0, font: '', size: 11 },
  'the record is persisted, and nothing but the record',
)

// A fresh panel reads that record back: this is what a reload does.
hookSlots.length = 0
commit()
assert.deepEqual(styleOf(), {}, 'a panel mounted on the next page load still follows the theme')
assert.equal(byClass('dshsm__settings').length, 0, 'and opens with the settings closed')

gear().props.onClick()
commit()
assert.equal(byClass('dshsm__settings').length, 1, 'the gear opens them again')
gear().props.onClick()
commit()
assert.equal(byClass('dshsm__settings').length, 0, 'and closes them again')

// --- moving the panel --------------------------------------------------------
const title = () => byClass('dshsm__title')[0]
const storedPosition = () => (store.has('dsh-sys-monitor.position') ? JSON.parse(store.get('dsh-sys-monitor.position')) : null)
const reload = () => {
  hookSlots.length = 0
  commit()
}
const drag = (from, to) => {
  title().props.onPointerDown({ button: 0, pointerId: 1, clientX: from.x, clientY: from.y })
  if (to !== undefined) fireWindow('pointermove', { pointerId: 1, clientX: to.x, clientY: to.y })
  fireWindow('pointerup', { pointerId: 1 })
  commit()
}

// The blank space beside the title is the handle; the two buttons beside it are
// not, and a drag that starts on one of them would fight the click.
assert.ok(title().props.onPointerDown, 'the title takes the pointer down')
assert.deepEqual(
  flat.filter((node) => node.props.onPointerDown !== undefined).map((node) => node.props.className),
  ['dshsm__title'],
  'nothing else in the panel starts a drag',
)
assert.equal(storedPosition(), null, 'a panel nobody has moved carries no position')
assert.equal(styleOf().left, undefined, 'and no inline position to contradict the corner')
assert.ok(!classesOf(panelOf()).includes('dshsm--placed'))

// The grip is the *header's*, not the box's, and the difference is the whole
// body: an upward-opening panel is pinned by its bottom edge, so the box it is
// drawn in starts at the far end of the panel, a long way from the header the
// hand is on. Measuring the box would put the panel back on its own height the
// moment the pointer moved.
{
  const head = { getBoundingClientRect: () => ({ left: 100, top: 300, height: 28 }) }
  const bottomPinned = {
    style: {},
    firstElementChild: { firstElementChild: head },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 100, top: -200 }),
  }
  panelOf().props.ref.current = bottomPinned
  title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 120, clientY: 310 })
  fireWindow('pointermove', { pointerId: 1, clientX: 220, clientY: 360 })
  fireWindow('pointerup', { pointerId: 1 })
  commit()
  assert.deepEqual(storedPosition(), { x: 200, y: 350 }, 'so the header is left exactly where the pointer left it')
  // The next check is about a panel with nothing to measure, so the stub goes
  // back to the state it is in before any of this.
  panelOf().props.ref.current = null
}

// With no measured box the panel follows the cursor outright, which makes the
// committed position the pointer itself — clamped to the window.
drag({ x: 400, y: 200 }, { x: 430, y: 260 })
assert.equal(styleOf().left, '430px')
assert.equal(styleOf().top, '260px')
assert.ok(classesOf(panelOf()).includes('dshsm--placed'), 'a moved panel is placed, not anchored to the corner')
assert.deepEqual(storedPosition(), { x: 430, y: 260 }, 'and the position is kept')

reload()
assert.equal(styleOf().left, '430px', 'the next panel opens where it was left')
assert.equal(styleOf().top, '260px')

// A position kept on a larger screen must not park this one off screen.
store.set('dsh-sys-monitor.position', JSON.stringify({ x: 5000, y: -40 }))
reload()
assert.deepEqual(storedPosition(), { x: 1176, y: 24 }, 'a stored position is put back inside the window it opens in')
assert.equal(styleOf().left, '1176px')

// The same clamp holds while the pointer is still down.
drag({ x: 100, y: 100 }, { x: 5000, y: 5000 })
assert.deepEqual(storedPosition(), { x: 1176, y: 776 }, 'a drag cannot leave the panel where it can no longer be found')

// And it measures the panel as it is drawn: a panel at a larger text size is
// wider on screen, so the edge it may not cross moves with it. Otherwise a
// zoomed panel dragged to the left edge hangs a third of itself off screen,
// and the corner the clamp exists to keep is gone.
store.set('dsh-sys-monitor.appearance', JSON.stringify({ size: 15 }))
store.set('dsh-sys-monitor.position', JSON.stringify({ x: -5000, y: 200 }))
reload()
assert.equal(styleOf()['--dshsm-scale'], String(15 / 11), 'a stored text size is applied on the next load')
assert.deepEqual(
  storedPosition(),
  { x: 24 - Math.round(272 * (15 / 11)), y: 200 },
  'a stored position is measured against the width the panel now draws at',
)
drag({ x: 100, y: 100 }, { x: -5000, y: 200 })
assert.equal(storedPosition().x, 24 - Math.round(272 * (15 / 11)), 'and so is a live drag')

// The clamp works in screen pixels and a zoomed box's *offsets* are scaled by
// the zoom as well, so what gets written is not what the drag measured. Read it
// back the way the browser will — the offset times the zoom — and it has to be
// the pixel the pointer asked for. Without the conversion the panel is not
// dragged slowly, it is dragged to the wrong place, and the stored position
// comes back somewhere else again. The stub's own box is wired up first, since
// a drag that cannot measure a header has no gap to pin itself by.
{
  // What the panel is given is the pointer's own pixel, with no factor of the
  // zoom anywhere: the element carrying left/top/bottom is not the one `zoom` is
  // on, and Chromium scales a scaled element's offsets a second time.
  const given = (property) => parseFloat(styleOf()[property])
  const box = {
    style: {},
    firstElementChild: { firstElementChild: { getBoundingClientRect: () => ({ left: 100, top: 50, height: 28 }) } },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
  }
  const landZoomed = (x, y) => {
    panelOf().props.ref.current = box
    title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300 })
    fireWindow('pointermove', { pointerId: 1, clientX: 300 + (x - 100), clientY: 300 + (y - 50) })
    fireWindow('pointerup', { pointerId: 1 })
    commit()
  }
  landZoomed(500, 620)
  assert.equal(given('left'), 500, 'a zoomed drag is given the pixel the pointer is on')
  assert.deepEqual(storedPosition(), { x: 500, y: 620 }, 'and the position kept is the one the pointer asked for, in screen pixels')
  assert.equal(given('bottom'), 800 - 620 - 28, 'and the gap under the header, which is what an upward-opening panel is pinned by')
  landZoomed(500, 200)
  assert.equal(given('top'), 200, 'and the top edge is the row the header is on, for a panel that opens downward')
  assert.equal(storedPosition().y, 200, 'so a text size cannot leave the panel where the drag put it')
}
store.set('dsh-sys-monitor.appearance', JSON.stringify({ size: 11 }))
store.set('dsh-sys-monitor.position', JSON.stringify({ x: 1176, y: 776 }))
reload()

// A click is not a drag: nothing moved, so nothing is kept and the panel stays
// exactly where the user last put it. The handle is handed back all the same —
// a stale one would make the next gesture drag from a grip that is long gone.
const parked = storedPosition()
title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 500, clientY: 500 })
fireWindow('pointerup', { pointerId: 1 })
commit()
assert.deepEqual(storedPosition(), parked, 'a press and release in one spot leaves the panel where it was')
drag({ x: 500, y: 500 }, { x: 300, y: 300 })
assert.deepEqual(storedPosition(), { x: 300, y: 300 }, 'and the next drag is the panel’s own, not the click’s')

// Neither is a right-click, which belongs to the browser, not to the panel.
title().props.onPointerDown({ button: 2, pointerId: 1, clientX: 500, clientY: 500 })
fireWindow('pointermove', { pointerId: 1, clientX: 700, clientY: 700 })
fireWindow('pointerup', { pointerId: 1 })
commit()
assert.deepEqual(storedPosition(), { x: 300, y: 300 }, 'a right-button press does not drag the panel')

// A release the window never saw — over the menu bar, say — must not leave the
// panel stuck to a grip nobody is holding: the next press takes hold of its own.
title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 500, clientY: 500 })
fireWindow('pointermove', { pointerId: 1, clientX: 900, clientY: 900 })
drag({ x: 200, y: 200 }, { x: 220, y: 240 })
assert.deepEqual(storedPosition(), { x: 220, y: 240 }, 'a new press takes hold, not the last one')

// Two clicks in one spot is a deliberate act, and sends the panel home.
title().props.onDoubleClick()
commit()
assert.equal(styleOf().left, undefined, 'a double click gives the corner back')
assert.ok(!classesOf(panelOf()).includes('dshsm--placed'))
assert.equal(storedPosition(), null, 'and forgets the position rather than keeping a stale one')

// A position that is not a position is ignored, the same as a colour that is
// not a colour: the panel opens in its corner.
store.set('dsh-sys-monitor.position', JSON.stringify({ x: 'left', y: 2 }))
reload()
assert.equal(styleOf().left, undefined)
assert.equal(storedPosition(), null)
store.set('dsh-sys-monitor.position', '{not json')
reload()
assert.equal(styleOf().top, undefined, 'and so is one that will not parse')
pendingEffects.splice(0)

// --- which way the panel opens ---------------------------------------------
// The header is what the user put where they wanted it, so it is the part that
// must not move. A panel whose header is under the middle of the window opens
// upward into the room above it; one over the middle opens downward. The
// midpoint of the stub's 800px window is 400.
//
// The stub's header box sits at top:50 and does not move, so a pointer that
// travels dy pixels lands the header dy pixels lower than where it started.
const fakeHead = { getBoundingClientRect: () => ({ left: 100, top: 50, height: 28 }) }
const fakePanel = {
  style: {},
  // The stub of the root the ref is handed: its first child is the drawn box,
  // and the box's first child is the header `headerHeight` measures.
  firstElementChild: { firstElementChild: fakeHead },
  classList: { add() {}, remove() {} },
  getBoundingClientRect: () => ({ left: 100, top: 50 }),
}
const landed = (y) => {
  panelOf().props.ref.current = fakePanel
  title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300 })
  fireWindow('pointermove', { pointerId: 1, clientX: 300, clientY: 300 + (y - 50) })
  fireWindow('pointerup', { pointerId: 1 })
  commit()
  return { style: styleOf(), className: classesOf(panelOf()) }
}

const upper = landed(300)
assert.ok(!upper.className.includes('dshsm--up'), 'a header in the upper half opens downward, into the room under it')
assert.equal(upper.style.top, '300px', 'and is pinned by its top edge')
assert.equal(upper.style.bottom, undefined, 'which is the edge the body grows from')

const lower = landed(500)
assert.ok(lower.className.includes('dshsm--up'), 'a header in the lower half opens upward, into the room above it')
assert.equal(lower.style.bottom, `${800 - 500 - 28}px`, 'pinned by its bottom edge, where the header is rather than the body')
assert.equal(lower.style.top, 'auto', 'with the top edge given up, so the box is not stretched between two of them')

// Crossing the middle mid-drag changes both the order and the pinned edge at
// once, so the header held at the pointer does not jump by its own height.
panelOf().props.ref.current = fakePanel
title().props.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 300 })
fireWindow('pointermove', { pointerId: 1, clientX: 300, clientY: 300 + (500 - 50) })
assert.equal(fakePanel.style.bottom, '272px', 'low in the window means pinned at the bottom')
assert.equal(fakePanel.style.top, 'auto', 'with the top edge given up')
fireWindow('pointermove', { pointerId: 1, clientX: 300, clientY: 300 + (100 - 50) })
assert.equal(fakePanel.style.top, '100px', 'and high in the window means pinned at the top')
assert.equal(fakePanel.style.bottom, 'auto', 'with the bottom edge given up')
fireWindow('pointerup', { pointerId: 1 })
pendingEffects.splice(0)

// The corner a panel nobody has moved keeps already says which way it opens:
// this one is parked at the top edge of the window, so it opens downward.
assert.match(stylesheet, /\.dshsm\{[^}]*top:10px;right:10px/, 'the panel is parked at the top edge')
// The text size is a zoom, and the zoom is on the panel that is *drawn* rather
// than on the element the panel is positioned with: Chromium scales a zoomed
// box's own left/top/bottom by the same factor as its size, so a zoom on the
// positioned element is a drag that follows the pointer at the wrong rate and a
// stored position that opens in the wrong place. Two elements is what keeps the
// offsets plain pixels at every size.
assert.doesNotMatch(stylesheet, /\.dshsm\{[^}]*zoom:/, 'the positioned element is never scaled')
assert.match(stylesheet, /\.dshsm__box\{[^}]*zoom:var\(--dshsm-scale,1\)/, 'the drawn panel carries the zoom instead')
assert.doesNotMatch(stylesheet, /\.dshsm\{[^}]*(background|border|box-shadow):/, 'so the box that has them is the one the zoom is on')
assert.equal(/var DEFAULT_GROW_UP = (\w+);/.exec(source)[1], 'false', 'so an untouched panel opens downward')
assert.match(source, /if \(anchor === null\) return DEFAULT_GROW_UP;/, 'the corner answer is the fallback')
assert.match(source, /return anchor\.y \+ headerHeight\(root, cache\) \/ 2 > size\.height \/ 2;/, 'and a moved panel is judged by where its header was put')
assert.match(stylesheet, /\.dshsm__box\{[^}]*display:flex;flex-direction:column;/, 'the drawn panel is a column, so the order can be reversed')
assert.match(stylesheet, /\.dshsm--up \.dshsm__box\{flex-direction:column-reverse\}/, 'and `--up` is what reverses it, on the drawn panel')
// The header's rule has to move with the header, or a reversed panel grows a
// stray line along its outer bottom edge.
assert.match(
  stylesheet,
  /\.dshsm--up \.dshsm__head\{border-bottom:0;border-top:1px solid var\(--dshsm-line/,
  'the rule between header and body follows the header',
)
assert.match(
  stylesheet,
  /\.dshsm--up\.dshsm--mini \.dshsm__head\{border-top:0\}/,
  'and a collapsed panel, which has no body to divide from, has no rule at all',
)

// These moves are here to move the panel, not to leave it moved: the section
// below opens a collapsed panel in its corner, as a first run of this does.
title().props.onDoubleClick()
commit()
assert.equal(storedPosition(), null, 'and the panel goes back to its corner for the next section')
// The stand-in element stays off the ref, so the drags below again measure
// against no box at all and land on the pointer, which is what they expect.
panelOf().props.ref.current = null
pendingEffects.splice(0)

// --- the arrow ---------------------------------------------------------------
// The arrow is drawn by the stylesheet, not written into the button, and what
// turns is the glyph and not the button: a button whose own box rotates takes
// its hover background and its hit area round with it, and the arrow stops
// sitting still under the pointer while the panel is opening.
assert.match(
  stylesheet,
  /\.dshsm__fold::before\{content:'▸';/,
  'the arrow is the stylesheet one element, so it has something to turn',
)
assert.doesNotMatch(
  stylesheet,
  /\.dshsm__fold(?:--open)?\{[^}]*transform/,
  'and the button itself carries no transform, or the button is what turns',
)
assert.match(
  stylesheet,
  /\.dshsm__fold--open::before\{transform:rotate\(90deg\)\}/,
  'an expanded panel that opens downward turns the arrow at the body',
)
assert.match(
  stylesheet,
  /\.dshsm--up \.dshsm__fold--open::before\{transform:rotate\(-90deg\)\}/,
  'and one that opens upward turns it the other way, at its own body',
)
assert.match(
  stylesheet,
  /\.dshsm__fold::before\{[^}]*transition:transform/,
  'the turn is animated, which a swap of two characters is not',
)
assert.match(
  stylesheet,
  /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*dshsm__fold::before\{transition:none\}\}/,
  'and a reader who has asked for stillness gets none of it',
)
assert.ok(
  byClass("dshsm__fold")[0].props.children === undefined,
  'the button has no text child, or the arrow would be drawn twice',
)

// --- the collapsed panel ------------------------------------------------------
// Collapsed, the panel keeps the two figures worth a glance and drops the rest,
// and the box is one line high: the figures ride in the header, between the
// title and the buttons, rather than on a row of their own under it. A panel
// that fell back to nominal clocks says so while it is showing them;
// collapsed, it shows none, so it says nothing.
const collapseArrow = () => byClass('dshsm__toggle').find((node) => node.props['aria-label'] !== '设置')
const miniOf = () => flat.filter((node) => classesOf(node).includes('dshsm__row--mini')).map(readRow)
currentSample = { ...NOMINAL, clock: { available: false, reason: 'helper exited (code 1)' } }
await timers[0].fn()
await new Promise((resolve) => setImmediate(resolve))
commit()
assert.equal(rowsOf(flat).length, 6, 'an expanded panel draws every row')
assert.equal(byClass('dshsm__note').length, 1, 'and explains its nominal clocks')

assert.equal(collapseArrow().props['aria-label'], '收起', 'the header carries a collapse arrow')
collapseArrow().props.onClick()
commit()
assert.equal(collapseArrow().props['aria-label'], '展开', 'which says it opens the panel again')
assert.ok(classesOf(panelOf()).includes('dshsm--mini'), 'a collapsed panel is the narrower one')
assert.equal(byClass('dshsm__note').length, 0, 'and it has no clocks left to explain')
assert.equal(rowsOf(flat).length, 0, 'the six rows are gone, not merely hidden')
assert.equal(byClass('dshsm__settings').length, 0, 'and the settings stay out of a body too narrow for them')
assert.equal(byClass('dshsm__rows').length, 0, 'a collapsed panel has no body at all: the header is the whole panel')

// One line: title, then the figures, then the gear and the collapse arrow.
// The panel is two elements — the root that is positioned with, and the drawn
// box inside it — and the stub collapses a lone child rather than wrapping it in
// an array, so this is the one place that steps through both.
const firstChild = (node) => (Array.isArray(node.props.children) ? node.props.children[0] : node.props.children)
const headOf = () => firstChild(firstChild(panelOf()))
assert.deepEqual(
  headOf().props.children.map((node) => classesOf(node)[0]),
  ['dshsm__title', 'dshsm__mini', 'dshsm__toggle', 'dshsm__toggle'],
  'the collapsed panel is one row: title, figures, gear, collapse',
)
assert.equal(byClass('dshsm__mini').length, 1, 'the two figures share the one region between the title and the buttons')

const mini = miniOf()
assert.equal(mini.length, 2, 'two figures are left: the CPU and memory in use')
assert.deepEqual(mini.map((row) => row.label), ['CPU', '内存'], 'both keep the caption the wide panel gives them')
assert.equal(mini[0].aria, 'CPU', 'and the accessible name that goes with it')
assert.equal(mini[0].width, '14.3%', "the collapsed CPU is the whole socket's busy share, not one perf level")
assert.equal(mini[0].value, '14%', 'and it shows nothing but the percentage, as the bar does')
assert.equal(
  mini[0].hint,
  'CPU · 核: 18 · 分档: P 11% · S 26% · 平均负载: 3.8 6.5 6.3',
  'the split that share is made of is one hover away',
)
assert.equal(mini[1].width, '58.1%')
assert.equal(mini[1].value, '58%', 'a short track keeps the percentage and drops the size beside it')
assert.equal(
  mini[1].hint,
  '内存 · 已用: 37/64 GB · 压缩内存: 4.5 GB · 交换空间: 1.9/3.0 GB',
  'the memory tooltip is the one the wide row carries',
)

// The gear is in the header, and the settings are in the body: opening them
// from a collapsed panel has to open the panel too.
gear().props.onClick()
commit()
assert.ok(!classesOf(panelOf()).includes('dshsm--mini'), 'the settings need a body, so the gear opens the panel')
assert.equal(rowsOf(flat).length, 6, 'and every row comes back with it')
assert.equal(byClass('dshsm__settings').length, 1, 'with the settings the user asked for')
gear().props.onClick()
commit()
assert.equal(byClass('dshsm__settings').length, 0, 'and close again on a second turn of the gear')

// The box is the same box either way: a drag from a collapsed panel is
// clamped by the one width, and lands where the same drag would have.
collapseArrow().props.onClick()
commit()
drag({ x: 200, y: 200 }, { x: -300, y: 100 })
assert.deepEqual(storedPosition(), { x: -248, y: 100 }, 'a collapsed panel is dragged like any other')
collapseArrow().props.onClick()
commit()
assert.equal(rowsOf(flat).length, 6, 'expanding it does not disturb the position it was left at')
assert.deepEqual(storedPosition(), { x: -248, y: 100 })
title().props.onDoubleClick()
commit()
assert.equal(storedPosition(), null, 'the panel goes back to its corner, as any other double click does')
assert.ok(!classesOf(panelOf()).includes('dshsm--mini'), 'and the last state it was left in is an expanded one')

for (const dispose of [...cleanup, ...disposeEffects]) dispose()
console.log('\nOK: bundle registers, renders six rows or two when collapsed, polls once per second, and keeps its colours, its face, its size and its place.')
