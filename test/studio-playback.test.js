const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const createStudioTransport = require("../js/studio-transport.js")
const StudioUtils = require("../js/studio-utils.js")
const projectDir = path.resolve(__dirname, "..")
const SEGMENT_SECONDS = 2.5

function fakeClassList() {
  const names = new Set()
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    toggle(name, force) {
      if (force === undefined) force = !names.has(name)
      if (force) names.add(name)
      else names.delete(name)
      return names.has(name)
    },
    contains: (name) => names.has(name),
  }
}

function fakeElement(options) {
  options = options || {}
  const attrs = {}
  const listeners = {}
  const icon = options.icon ? { textContent: "▶" } : null
  const node = {
    classList: fakeClassList(),
    dataset: {},
    style: { setProperty(name, value) { this[name] = value } },
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    title: "",
    offsetLeft: 0,
    setAttribute(name, value) { attrs[name] = String(value) },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
    querySelector(selector) { return selector === "span" ? icon : null },
    closest(selector) { return options.closest ? options.closest(selector) : null },
    addEventListener(type, listener) { (listeners[type] || (listeners[type] = [])).push(listener) },
    dispatch(type, event) { for (const listener of listeners[type] || []) listener(event || {}) },
    setPointerCapture() {},
  }
  node.icon = icon
  return node
}

class FakeAudio {
  constructor(duration) {
    this.duration = duration == null ? 40 : duration
    this.currentTime = 0
    this.paused = true
    this.attrs = {}
    this.listeners = {}
    this.playCalls = 0
    this.pauseCalls = 0
  }

  get src() { return this.attrs.src || "" }
  set src(value) { this.attrs.src = String(value) }
  getAttribute(name) { return this.attrs[name] || null }
  removeAttribute(name) { delete this.attrs[name] }
  addEventListener(type, listener, options) {
    ;(this.listeners[type] || (this.listeners[type] = [])).push({ listener, once: !!(options && options.once) })
  }
  dispatch(type) {
    const entries = (this.listeners[type] || []).slice()
    for (const entry of entries) {
      if (entry.once) {
        const current = this.listeners[type] || []
        const index = current.indexOf(entry)
        if (index !== -1) current.splice(index, 1)
      }
      entry.listener.call(this, { type, target: this, currentTarget: this })
    }
  }
  play() {
    this.playCalls += 1
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.pauseCalls += 1
    this.paused = true
  }
}

function fakeClock() {
  let time = 100
  let nextId = 0
  const callbacks = new Map()
  return {
    now: () => time,
    requestAnimationFrame(callback) {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id) => callbacks.delete(id),
    step(milliseconds) {
      time += milliseconds
      const current = Array.from(callbacks.values())
      callbacks.clear()
      current.forEach((callback) => callback(time))
    },
    pending: () => callbacks.size,
  }
}

function fakeEngine() {
  const calls = { play: [], pause: 0, resume: 0, stop: [] }
  return {
    calls,
    isPlaying: false,
    isPaused: false,
    isStarting: false,
    ambience: null,
    lastMode: "sample",
    lastStopReason: "manual",
    onState: null,
    play(recipe, notes, options) {
      calls.play.push({ recipe, notes, options })
      this.isPlaying = true
      this.isPaused = false
      this.lastStopReason = "manual"
      if (this.onState) this.onState(true, false)
      return Promise.resolve("sample")
    },
    pause() {
      calls.pause += 1
      this.isPlaying = true
      this.isPaused = true
      if (this.onState) this.onState(true, true)
      return true
    },
    resume() {
      calls.resume += 1
      this.isPlaying = true
      this.isPaused = false
      if (this.onState) this.onState(true, false)
      return true
    },
    stop(options) {
      calls.stop.push(options || {})
      this.isPlaying = false
      this.isPaused = false
      if ((!options || options.emitState !== false) && this.onState) this.onState(false, false)
    },
    end() {
      this.lastStopReason = "ended"
      this.isPlaying = false
      this.isPaused = false
      if (this.onState) this.onState(false, false)
    },
  }
}

function createHarness(options) {
  options = options || {}
  const clock = fakeClock()
  const audio = new FakeAudio(options.audioDuration)
  const engine = fakeEngine()
  const bgRange = fakeElement()
  const bgTimeInputs = fakeElement()
  const el = {
    body: fakeElement(), statusText: fakeElement(), exportStatus: fakeElement(),
    playBtn: fakeElement({ icon: true }), stopBtn: fakeElement(), framePlayBtn: fakeElement({ icon: true }),
    frame: fakeElement(), playhead: fakeElement(), canvas: fakeElement(), bgPlayer: fakeElement(),
    bgPlayBtn: fakeElement({ icon: true }),
    bgSeek: fakeElement({ closest: (selector) => selector === ".bg-range" ? bgRange : null }),
    bgEndSeek: fakeElement(),
    bgStartInput: fakeElement({ closest: (selector) => selector === ".bg-time-inputs" ? bgTimeInputs : null }),
    bgEndInput: fakeElement(), bgTime: fakeElement(),
  }
  const wrap = { clientWidth: 320, scrollLeft: 0 }
  const state = {
    duration: options.duration == null ? 30 : options.duration,
    atmosphere: { id: options.noBackground ? "none" : "bg", src: options.noBackground ? "" : "sound/bg.mp3" },
    drawingInputMode: options.soundMode === false ? "picture" : "sound",
    bgOffset: options.bgOffset == null ? 0 : options.bgOffset,
    bgEndOffset: options.bgEndOffset == null ? 30 : options.bgEndOffset,
    playingTakeId: null,
    step: 2,
  }
  const draw = {
    flowActive: false,
    records: [],
    finishes: [],
    flowRecord(progress) { this.records.push(progress) },
    finishFlowStroke(commit) { this.finishes.push(commit); this.flowActive = false },
  }
  const counters = { refreshTimeline: 0, updateReadouts: 0, renderAtmospheres: 0, renderTakes: 0 }
  const recipe = { duration: state.duration, path: [] }
  const transport = createStudioTransport({
    root: { setTimeout, clearTimeout },
    document: { activeElement: null },
    state, el, engine, draw, clock, backgroundAudio: audio,
    DRAW_MODE_SOUND: "sound", DRAWING_STEP: 2, MIN_DURATION_SECONDS: 1, DEFAULT_DURATION_SECONDS: 30,
    SEGMENT_SECONDS,
    snapDurationToSegments: (value, maxSeconds) =>
      StudioUtils.snapDurationToSegments(value, SEGMENT_SECONDS, maxSeconds),
    canvasWrap: () => wrap,
    timelineProgressFromClientX: (x) => x / 300,
    timelineCssX: (progress) => progress * 300,
    syncCanvasScrollState() {},
    bgSrcFor: (atmosphere) => atmosphere.src || "",
    canSelectBgRange: () => !!state.atmosphere.src,
    normalizeDuration: (value) => Math.max(1, Number(value) || 30),
    clampNumber: (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0)),
    refreshTimeline() { counters.refreshTimeline += 1 },
    updateReadouts() { counters.updateReadouts += 1 },
    stopBackgroundPreview() {},
    stopExamplePreview() {},
    renderAtmospheres() { counters.renderAtmospheres += 1 },
    buildRecipe: () => recipe,
    notesFor: () => [],
    renderTakes() { counters.renderTakes += 1 },
    getStateSummary: () => ({ duration: state.duration }),
    console: { warn() {}, error() {} },
  })
  return { transport, clock, audio, engine, state, draw, el, counters, recipe }
}

function approx(actual, expected, epsilon) {
  assert.ok(Math.abs(actual - expected) <= (epsilon || 0.002), actual + " should be near " + expected)
}

test("studio transport supports CommonJS and the classic browser global", () => {
  assert.equal(typeof createStudioTransport, "function")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-transport.js"), "utf8")
  const context = { globalThis: {} }
  vm.runInNewContext(source, context)
  assert.equal(typeof context.globalThis.HwaeumStudioTransport, "function")
})

test("main playback accepts an empty melody and starts from the selected playhead", () => {
  const h = createHarness({ noBackground: true })
  h.transport.setSelectedPlayhead(0.5, false, false)
  h.transport.play()
  assert.equal(h.engine.calls.play.length, 1)
  assert.deepEqual(h.engine.calls.play[0].notes, [])
  assert.equal(h.engine.calls.play[0].recipe, h.recipe)
  approx(h.engine.calls.play[0].options.startOffset, 15)
})

test("transport toggles play, pause, and resume while keeping button state in sync", () => {
  const h = createHarness({ noBackground: true })
  h.transport.play()
  assert.equal(h.el.body.dataset.playback, "playing")
  assert.equal(h.el.playBtn.icon.textContent, "❚❚")
  assert.equal(h.el.playBtn.getAttribute("aria-label"), "전체 일시정지")
  h.transport.toggleTransport()
  assert.equal(h.engine.calls.pause, 1)
  assert.equal(h.el.body.dataset.playback, "paused")
  assert.equal(h.el.playBtn.icon.textContent, "▶")
  h.transport.toggleTransport()
  assert.equal(h.engine.calls.resume, 1)
  assert.equal(h.el.body.dataset.playback, "playing")
})

test("pausing sound-mode playback commits the active stroke at the live playhead", () => {
  const h = createHarness({ noBackground: true })
  h.draw.flowActive = true
  h.transport.play()
  h.clock.step(4500)
  h.transport.pause()

  approx(h.draw.records.at(-1), 0.15)
  assert.deepEqual(h.draw.finishes, [true])
  assert.equal(h.engine.calls.pause, 1)
})

test("pausing remembers the live playhead and stop resets it to the beginning", () => {
  const h = createHarness({ noBackground: true })
  h.transport.play()
  h.clock.step(6000)
  h.transport.pause()
  approx(h.transport.getTimeState().selectedPlayheadProgress, 0.2)
  assert.equal(h.el.playhead.getAttribute("aria-valuenow"), "6")
  h.transport.stop()
  assert.equal(h.transport.getTimeState().selectedPlayheadProgress, 0)
  assert.equal(h.el.playhead.getAttribute("aria-valuenow"), "0")
})

test("move-to-start stops playback and resets only the playhead position", () => {
  const h = createHarness({ noBackground: true })
  h.transport.setSelectedPlayhead(0.5, false, false)
  h.transport.play()
  h.clock.step(6000)

  h.transport.movePlayheadToStart(true)

  assert.equal(h.engine.calls.stop.length, 1)
  assert.equal(h.transport.getTimeState().selectedPlayheadProgress, 0)
  assert.equal(h.el.playhead.getAttribute("aria-valuenow"), "0")
  assert.equal(h.el.playhead.style.left, "0px")
  assert.equal(h.el.exportStatus.textContent, "재생 위치를 처음으로 옮겼어요.")
  assert.deepEqual(h.recipe.path, [])
})

test("an ended song leaves the visible playhead at the end", () => {
  const h = createHarness({ noBackground: true })
  h.transport.play()
  h.engine.end()
  assert.equal(h.el.playhead.hidden, false)
  assert.equal(h.el.playhead.getAttribute("aria-valuenow"), "30")
  assert.equal(h.el.playhead.style.left, "300px")
})

test("freezing before an engine stop preserves the current playhead for eraser changes", () => {
  const h = createHarness({ noBackground: true })
  h.transport.play()
  h.clock.step(7500)
  h.transport.freezePlayheadAtLivePosition()
  h.engine.stop()
  approx(h.transport.getTimeState().selectedPlayheadProgress, 0.25)
  assert.equal(h.el.playhead.getAttribute("aria-valuenow"), "8")
})

test("background range pause resumes from the exact paused audio position", () => {
  const h = createHarness({ bgOffset: 5, bgEndOffset: 20, audioDuration: 60 })
  h.transport.setupBgPlayer(true)
  h.transport.playBgPlayer()
  assert.equal(h.audio.currentTime, 5)
  assert.equal(h.audio.paused, false)
  h.audio.currentTime = 12
  h.transport.pauseBgPlayer(true)
  assert.equal(h.audio.paused, true)
  approx(h.transport.getTimeState().selectedPlayheadProgress, 7 / 15)
  h.transport.playBgPlayer()
  assert.equal(h.audio.currentTime, 12)
  assert.equal(h.audio.paused, false)
})

// 끝 지점을 아무 데나 끌어도 구간 길이는 마디(2.5초) 단위로 떨어져야 한다.
// 예전엔 15.4초 같은 길이가 그대로 남아 도화지 마지막 마디가 0.4초 토막이 되고
// "15초"와 "15.4초" 라벨이 겹쳤다. 시간 표시는 초를 버려서 둘 다 0:15 로 보였다.
test("background range end snaps to whole bars", () => {
  const h = createHarness({ bgOffset: 0, bgEndOffset: 30, audioDuration: 60 })
  const cases = [
    { drag: 15.4, expectEnd: 15 },
    { drag: 14.6, expectEnd: 15 },
    { drag: 13.2, expectEnd: 12.5 },
    { drag: 3.4, expectEnd: 2.5 },
    { drag: 0.1, expectEnd: 2.5 }, // 최소 한 마디
  ]
  for (const item of cases) {
    h.transport.seekBgEnd(item.drag)
    assert.equal(h.state.bgEndOffset, item.expectEnd, `${item.drag}초로 끌었을 때`)
    h.transport.ensureTimelineDuration(false)
    assert.equal(
      Math.round((h.state.duration % 2.5) * 1000) / 1000,
      0,
      `${item.drag}초 -> 길이 ${h.state.duration}초 가 마디 배수가 아님`,
    )
  }
})

// 12.5초를 "0:12"로 보여 주면 학생이 12초로 읽고 눈금과 다르다고 느낀다.
test("background range readout keeps the half second", () => {
  const h = createHarness({ bgOffset: 0, bgEndOffset: 30, audioDuration: 60 })
  h.transport.seekBgEnd(13.2)
  assert.equal(h.state.bgEndOffset, 12.5)
  h.transport.syncBgPlayerUI()
  assert.equal(h.el.bgEndInput.value, "0:12.5")
  assert.match(h.el.bgTime.textContent, /^0:00 ~ 0:12\.5 \//)
  // 정수 초는 그대로 정수로 보여 준다.
  h.transport.seekBgEnd(15)
  h.transport.syncBgPlayerUI()
  assert.equal(h.el.bgEndInput.value, "0:15")
})

test("background range snapping respects a start offset and the audio end", () => {
  const h = createHarness({ bgOffset: 4, bgEndOffset: 30, audioDuration: 20 })
  // 시작이 4초면 남은 길이는 16초 → 여섯 마디(15초)까지만 쓸 수 있다.
  h.transport.seekBgEnd(19.6)
  assert.equal(h.state.bgEndOffset, 19)
  h.transport.ensureTimelineDuration(false)
  assert.equal(h.state.duration, 15)
})

test("sound drawing resumes the background clock from the selected playhead", () => {
  const h = createHarness({ bgOffset: 4, bgEndOffset: 24, audioDuration: 50 })
  h.transport.setupBgPlayer(true)
  h.transport.setSelectedPlayhead(0.5, false, false)
  h.draw.flowActive = true
  h.transport.soundDrawingProgress()
  approx(h.audio.currentTime, 14)
  assert.equal(h.audio.paused, false)
  assert.equal(h.audio.playCalls, 1)
})

test("drawing during full playback uses the engine clock without replacing playback", () => {
  const h = createHarness({ bgOffset: 0, bgEndOffset: 30 })
  h.transport.setSelectedPlayhead(0.2, false, false)
  h.transport.play()
  const stopCount = h.engine.calls.stop.length
  h.clock.step(3000)
  h.draw.flowActive = true
  const progress = h.transport.soundDrawingProgress()
  approx(progress, 0.3)
  assert.equal(h.engine.calls.stop.length, stopCount)
  assert.equal(h.audio.playCalls, 0)
})

test("sound mode without background advances and finishes from the silent clock", () => {
  const h = createHarness({ noBackground: true, duration: 10 })
  h.draw.flowActive = true
  h.transport.soundDrawingProgress()
  assert.equal(h.transport.getTimeState().silentFlowActive, true)
  h.clock.step(3000)
  approx(h.draw.records.at(-1), 0.3)
  h.clock.step(7000)
  assert.equal(h.draw.records.at(-1), 1)
  assert.deepEqual(h.draw.finishes, [true])
  assert.equal(h.transport.getTimeState().silentFlowActive, false)
  assert.equal(h.clock.pending(), 0)
})

test("consecutive preserve setups only apply the newest metadata request", () => {
  const h = createHarness({ duration: 15, bgOffset: 7, bgEndOffset: 22, audioDuration: NaN })
  h.transport.setupBgPlayer(true)
  h.transport.setupBgPlayer(true)
  const updatesBeforeMetadata = h.counters.updateReadouts

  h.audio.duration = 60
  h.audio.dispatch("loadedmetadata")

  assert.equal(h.state.bgOffset, 7)
  assert.equal(h.state.bgEndOffset, 22)
  assert.equal(h.state.duration, 15)
  assert.equal(h.audio.currentTime, 7)
  assert.equal(h.counters.updateReadouts, updatesBeforeMetadata + 1)
})

test("a rapid background source change prevents the stale metadata callback from replacing the new range", () => {
  const h = createHarness({ duration: 30, bgOffset: 0, bgEndOffset: 30, audioDuration: NaN })
  h.transport.setupBgPlayer(false)

  h.state.atmosphere = { id: "new-bg", src: "sound/new-bg.mp3" }
  h.state.bgOffset = 10
  h.state.bgEndOffset = 25
  h.transport.setupBgPlayer(true)
  h.audio.duration = 60
  h.audio.dispatch("loadedmetadata")

  assert.equal(h.audio.getAttribute("src"), "sound/new-bg.mp3")
  assert.equal(h.state.bgOffset, 10)
  assert.equal(h.state.bgEndOffset, 25)
  assert.equal(h.state.duration, 15)
  assert.equal(h.audio.currentTime, 10)
})

test("metadata is ignored when the audio element source no longer matches the setup request", () => {
  const h = createHarness({ duration: 12, bgOffset: 8, bgEndOffset: 20, audioDuration: NaN })
  h.transport.setupBgPlayer(true)
  const updatesBeforeMetadata = h.counters.updateReadouts

  h.audio.src = "sound/unexpected.mp3"
  h.audio.duration = 60
  h.audio.dispatch("loadedmetadata")

  assert.equal(h.state.bgOffset, 8)
  assert.equal(h.state.bgEndOffset, 20)
  assert.equal(h.state.duration, 12)
  assert.equal(h.audio.currentTime, 0)
  assert.equal(h.counters.updateReadouts, updatesBeforeMetadata)
})

test("background range metadata updates the shared drawing duration", () => {
  const h = createHarness({ duration: 30, bgOffset: 5, bgEndOffset: 15, audioDuration: 60 })
  h.transport.setupBgPlayer(true)
  assert.equal(h.state.duration, 10)
  assert.ok(h.counters.refreshTimeline >= 1)
  assert.equal(h.el.bgTime.textContent, "0:05 ~ 0:15 / 1:00")
})
