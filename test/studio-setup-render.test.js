const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function functionBody(source, name) {
  const marker = "function " + name + "("
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, name + " should exist")
  const open = source.indexOf("{", start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1
    else if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error("Could not parse function body for " + name)
}

function createElement(tagName) {
  let text = ""
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    listeners: {},
    className: "",
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value
      },
    },
    appendChild(child) {
      this.children.push(child)
      return child
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener
    },
  }
  node.classList = {
    add(...names) {
      const current = node.className.split(/\s+/).filter(Boolean)
      for (const name of names) if (!current.includes(name)) current.push(name)
      node.className = current.join(" ")
    },
  }
  Object.defineProperty(node, "textContent", {
    get() {
      return text
    },
    set(value) {
      text = String(value == null ? "" : value)
      node.children = []
    },
  })
  return node
}

function descendants(node) {
  return [node].concat(node.children.flatMap(descendants))
}

function createSetupHarness() {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-setup-render.js"), "utf8")
  const sandbox = {
    window: {},
    document: { createElement },
    console,
    URL,
  }
  vm.runInNewContext(source, sandbox, { filename: "studio-setup-render.js" })

  const western = { id: "violin", label: "바이올린", group: "서양", family: "현악기", detail: "선명한 소리" }
  const gugak = { id: "sogeum", label: "소금", group: "국악", family: "관악기", detail: "청아한 소리" }
  const state = {
    instrument: western,
    group: western.group,
    style: { id: "bright" },
    effectStampId: null,
    bgPreviewId: null,
    examplePreviewId: null,
  }
  const el = {
    composeInstrumentList: createElement("div"),
    instrumentGroups: createElement("div"),
    instrumentGrid: createElement("div"),
    exportStatus: createElement("p"),
  }
  const calls = {
    actions: [],
    eraser: [],
    activeInstrument: [],
    engineStop: 0,
    preview: [],
    orchestra: 0,
    pitch: 0,
    readouts: 0,
    warm: 0,
  }
  const draw = {
    setActiveInstrument(id) {
      calls.activeInstrument.push(id)
    },
    compute() {},
    render() {},
  }
  const engine = {
    stop() {
      calls.engineStop += 1
    },
    previewNote(recipe, pitch) {
      calls.preview.push({ recipe, pitch })
      return Promise.resolve()
    },
  }
  const api = sandbox.window.HwaeumStudioSetupRender({
    state,
    el,
    D: { instruments: [western, gugak], atmospheres: [], backgrounds: {}, versions: [] },
    engine,
    draw,
    bgPreview: {},
    examplePreview: {},
    DEFAULT_DURATION_SECONDS: 30,
    DEFAULT_INSTRUMENT_FAMILY: "그 밖의 악기",
    INSTRUMENT_GROUPS: ["서양", "국악"],
    STUDENT_MUSIC_GROUP: "내가 찾은 음악",
    ATMOSPHERE_GROUP_ORDER: [],
    PIXABAY_MUSIC_URL: "https://example.test/music",
    CUSTOM_BG_COPYRIGHT_NOTICE: "notice",
    CUSTOM_BG_MAX_BYTES: 50,
    styleForInstrument(instrument) {
      return { id: instrument.group === "국악" ? "gugak" : "bright" }
    },
    setEraser(value) {
      calls.eraser.push(value)
    },
    renderEffects() {},
    renderEffectStamps() {},
    recordUserAction(options) {
      calls.actions.push(options)
    },
    renderOrchestraLegend() {
      calls.orchestra += 1
    },
    renderPitchAxisLabels() {
      calls.pitch += 1
    },
    updateReadouts() {
      calls.readouts += 1
    },
    warmSelectedInstrument() {
      calls.warm += 1
    },
    applyMoodTint() {},
    syncBgPlayerUI() {},
    buildRecipe() {
      return { instrument: state.instrument.id }
    },
    defaultAtmosphere() {
      return { id: "none" }
    },
    applyInstrumentTone() {},
    getNextCustomBgId() {
      return "custom-1"
    },
  })

  return { api, calls, el, gugak, state }
}

test("setup renderer owns compose rendering without a callback back into studio", () => {
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const setupRender = fs.readFileSync(path.join(projectDir, "js", "studio-setup-render.js"), "utf8")
  const setupCallStart = studio.indexOf("window.HwaeumStudioSetupRender({")
  const setupCallEnd = studio.indexOf("})", setupCallStart)
  const setupCall = studio.slice(setupCallStart, setupCallEnd)

  assert.doesNotMatch(setupCall, /\brenderComposeInstruments\s*,/)
  assert.match(setupCall, /\brecordUserAction\s*,/)
  assert.match(functionBody(studio, "renderComposeInstruments"), /return renderComposeInstrumentsFromSetup\(\)/)
  assert.match(functionBody(setupRender, "selectInstrument"), /renderComposeInstruments\(\)/)
})

test("compose instrument click records the action, changes the instrument, and previews it", () => {
  const { api, calls, el, gugak, state } = createSetupHarness()

  assert.deepEqual(Object.keys(api).sort(), [
    "addCustomBackground",
    "backgroundFor",
    "bgSrcFor",
    "renderAtmospheres",
    "renderComposeInstruments",
    "renderInstrumentGroups",
    "renderInstruments",
    "stopBackgroundPreview",
    "stopExamplePreview",
  ])

  api.renderComposeInstruments()
  const groupSections = el.composeInstrumentList.children
  assert.deepEqual(groupSections.map((node) => node.dataset.group), ["서양", "국악"])
  assert.match(groupSections[0].className, /\bactive\b/)

  const gugakButton = descendants(el.composeInstrumentList).find(
    (node) => node.tagName === "BUTTON" && node.title === "국악 · 관악기 · 청아한 소리",
  )
  assert.ok(gugakButton)
  gugakButton.listeners.click()

  assert.equal(calls.actions.length, 1)
  assert.equal(calls.actions[0].update, false)
  assert.equal(state.instrument, gugak)
  assert.equal(state.group, "국악")
  assert.equal(state.style.id, "gugak")
  assert.deepEqual(calls.eraser, [false])
  assert.deepEqual(calls.activeInstrument, ["sogeum"])
  assert.equal(calls.engineStop, 1)
  assert.equal(calls.orchestra, 1)
  assert.equal(calls.pitch, 1)
  assert.equal(calls.readouts, 1)
  assert.equal(calls.warm, 1)
  assert.equal(calls.preview.length, 1)
  assert.equal(calls.preview[0].recipe.instrument, "sogeum")
  assert.equal(calls.preview[0].pitch, 0.5)
  assert.match(el.exportStatus.textContent, /소금.*연주됩니다/)
})
