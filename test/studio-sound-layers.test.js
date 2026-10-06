const assert = require("node:assert/strict")
const test = require("node:test")

const createStudioSoundLayers = require("../js/studio-sound-layers.js")

function classList() {
  const values = new Set()
  return {
    add(value) { values.add(value) },
    remove(value) { values.delete(value) },
    toggle(value, force) {
      if (force === undefined ? !values.has(value) : force) values.add(value)
      else values.delete(value)
    },
    contains(value) { return values.has(value) },
  }
}

function element() {
  const listeners = {}
  const node = {
    children: [],
    className: "",
    classList: classList(),
    dataset: {},
    disabled: false,
    files: [],
    value: "",
    textContent: "",
    appendChild(child) { this.children.push(child); return child },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    dispatch(type, event = {}) { (listeners[type] || []).forEach((fn) => fn(event)) },
    setAttribute(name, value) { this[name] = String(value) },
    click() { this.dispatch("click") },
  }
  Object.defineProperty(node, "innerHTML", {
    get() { return "" },
    set() { node.children = [] },
  })
  return node
}

function audio() {
  const listeners = {}
  return {
    currentTime: 0,
    volume: 1,
    src: "",
    preload: "",
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    pause() {},
    play() { return Promise.resolve() },
  }
}

function harness(options = {}) {
  let duration = options.duration || 30
  let urlId = 0
  const state = { soundLayers: [] }
  const el = {
    soundLayerInput: element(),
    soundLayerAddBtn: element(),
    soundLayerList: element(),
    soundLayerCount: element(),
    soundLayerStatus: element(),
  }
  const changes = []
  const api = createStudioSoundLayers({
    root: {
      Audio: audio,
      URL: {},
      setTimeout,
      clearTimeout,
      addEventListener() {},
    },
    document: { createElement: element },
    state,
    el,
    engine: {
      warmSoundLayer(layer) {
        return Promise.resolve({ duration: layer.file.testDuration })
      },
    },
    maxLayers: 3,
    maxBytes: 1000,
    getProjectDuration: () => duration,
    createAudio: audio,
    createObjectURL: () => "blob:test-" + ++urlId,
    revokeObjectURL() {},
    onChange: () => changes.push("change"),
  })
  return { api, state, el, changes, setDuration(value) { duration = value } }
}

function soundFile(name, duration, size = 100) {
  return { name, type: "audio/mpeg", size, testDuration: duration }
}

test("sound layer upload accepts at most three files and defaults each trim to the project length", async () => {
  const h = harness({ duration: 30 })
  h.api.addFiles([
    soundFile("첫 곡.mp3", 75),
    soundFile("둘째 곡.mp3", 12),
    soundFile("셋째 곡.mp3", 45),
    soundFile("넷째 곡.mp3", 20),
  ])
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(h.state.soundLayers.length, 3)
  assert.deepEqual(h.state.soundLayers.map((layer) => layer.trimEnd), [30, 12, 30])
  assert.equal(h.el.soundLayerCount.textContent, "3/3개")
  assert.equal(h.el.soundLayerAddBtn.disabled, true)
  assert.equal(h.api.recipeLayers().length, 3)
  assert.equal(h.changes.length, 3)
})

test("project duration changes do not rewrite uploaded source trims or absolute placement", async () => {
  const h = harness({ duration: 30 })
  h.api.addFiles([soundFile("긴 음악.mp3", 90)])
  await Promise.resolve()
  await Promise.resolve()
  const layer = h.state.soundLayers[0]
  layer.trimStart = 50
  layer.trimEnd = 72
  layer.startTime = 24

  h.setDuration(15)
  h.api.handleDurationChange()
  assert.equal(layer.trimStart, 50)
  assert.equal(layer.trimEnd, 72)
  assert.equal(layer.startTime, 24)
  assert.match(h.el.soundLayerStatus.textContent, /길이를 다시 늘리면 같은 초/)

  h.setDuration(30)
  h.api.handleDurationChange()
  const recipe = h.api.recipeLayers()[0]
  assert.equal(recipe.trimStart, 50)
  assert.equal(recipe.trimEnd, 72)
  assert.equal(recipe.startTime, 24)
})

test("saved takes restore only sound files that are still registered in the current page", async () => {
  const h = harness()
  h.api.addFiles([soundFile("수업 녹음.mp3", 40)])
  await Promise.resolve()
  await Promise.resolve()
  const saved = h.api.recipeLayers()

  h.api.clear({ silent: true })
  assert.equal(h.state.soundLayers.length, 0)
  h.api.restoreRecipe(saved)
  assert.equal(h.state.soundLayers.length, 1)
  assert.equal(h.state.soundLayers[0].name, "수업 녹음.mp3")

  h.api.restoreRecipe([{ id: "missing", src: "blob:old", trimStart: 0, trimEnd: 10 }])
  assert.equal(h.state.soundLayers.length, 0)
  assert.match(h.el.soundLayerStatus.textContent, /원본 파일을 다시 올려야/)
})

test("a saved sound whose file is gone keeps its settings and re-uploading the same file brings them back", async () => {
  const h = harness()
  h.api.restoreRecipe([{ id: "layer-old", name: "빗소리.mp3", sourceDuration: 40, trimStart: 4, trimEnd: 14, startTime: 6, volume: 0.4 }])
  assert.equal(h.state.soundLayers.length, 0)
  const kept = h.api.recipeLayers()
  assert.equal(kept.length, 1, "다시 저장해도 설정이 남는다")
  assert.equal(kept[0].missing, true)
  assert.equal(kept[0].src, undefined)
  assert.equal(kept[0].startTime, 6)
  assert.equal(h.el.soundLayerCount.textContent, "1/3개")

  h.api.addFiles([soundFile("빗소리.mp3", 40)])
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(h.state.soundLayers.length, 1)
  const layer = h.state.soundLayers[0]
  assert.equal(layer.trimStart, 4)
  assert.equal(layer.trimEnd, 14)
  assert.equal(layer.startTime, 6)
  assert.equal(layer.volume, 0.4)
  assert.equal(h.api.recipeLayers().filter((item) => item.missing).length, 0)
  assert.match(h.el.soundLayerStatus.textContent, /다시 이어 붙였어요/)
})

test("a sound file longer than ten minutes is refused", async () => {
  const h = harness()
  h.api.addFiles([soundFile("한 시간 녹음.mp3", 3600)])
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(h.state.soundLayers.length, 0)
  assert.match(h.el.soundLayerStatus.textContent, /10분보다 짧은/)
})

test("a fourth file is refused with a message that is not hidden by the first file's progress", async () => {
  const h = harness()
  h.api.addFiles([soundFile("하나.mp3", 5), soundFile("둘.mp3", 5), soundFile("셋.mp3", 5), soundFile("넷.mp3", 5)])
  assert.match(h.el.soundLayerStatus.textContent, /최대 3개까지.*앞의 3개만/)
})
