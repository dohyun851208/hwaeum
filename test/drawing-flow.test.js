const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadDrawing() {
  const sandbox = {
    MusicCore: {
      buildScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      drawableScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      playableScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      autocompleteMelodyStrokes(strokes) {
        return strokes.flatMap((stroke, voice) =>
          stroke.map((point) => ({
            time: point.x * 30,
            duration: 0.25,
            midi: 60,
            velocity: 0.7,
            voice,
          })),
        )
      },
      autocompleteRhythm() {
        return []
      },
    },
    performance: { now: () => 0 },
    devicePixelRatio: 1,
  }
  sandbox.self = sandbox
  const code = fs.readFileSync(path.join(projectDir, "js", "drawing.js"), "utf8")
  vm.runInNewContext(code, sandbox, { filename: "drawing.js" })
  return sandbox.DrawingCanvas
}

function makeContext() {
  const noop = () => {}
  return new Proxy(
    {},
    {
      get(target, key) {
        if (!(key in target)) target[key] = noop
        return target[key]
      },
      set(target, key, value) {
        target[key] = value
        return true
      },
    },
  )
}

function makeCanvas() {
  const ctx = makeContext()
  const parent = {
    clientWidth: 720,
    scrollWidth: 1440,
    scrollLeft: 0,
    getBoundingClientRect() {
      return { left: 0, right: 720, top: 0, bottom: 540, width: 720, height: 540 }
    },
  }
  return {
    width: 1440,
    height: 540,
    clientWidth: 1440,
    style: {},
    parentElement: parent,
    closest() {
      return parent
    },
    getContext() {
      return ctx
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1440, height: 540 }
    },
    addEventListener() {},
    setPointerCapture() {},
  }
}

test("flow mode records time from progress while pointer controls only pitch", () => {
  const DrawingCanvas = loadDrawing()
  const events = []
  const draw = new DrawingCanvas(makeCanvas(), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    onPreviewStart: () => events.push("preview:start"),
    onPreviewEnd: () => events.push("preview:end"),
    onFlowStart: () => events.push("flow:start"),
    onFlowEnd: () => events.push("flow:end"),
  })

  draw.setFlowMode(true)
  draw._startFlowStroke({ x: 0.8, y: 0.4 })
  draw.flowY = 0.25
  draw.flowRecord(0.1)
  draw.flowY = 0.75
  draw.flowRecord(0.2)
  draw.flowY = 0.5
  draw.flowRecord(0.2)

  assert.deepEqual(
    Array.from(draw.strokes[0], (point) => point.x),
    [0, 0.1, 0.2],
  )
  assert.equal(draw.strokes[0][2].y, 0.5)
  assert.equal(draw.flowActive, true)

  assert.equal(draw.finishFlowStroke(true), true)
  assert.equal(draw.flowActive, false)
  assert.deepEqual(events, ["preview:start", "flow:start", "preview:end", "flow:end"])
  assert.ok(draw.notes.length > 0)
})

test("flow mode starts the stroke at the supplied playback progress", () => {
  const DrawingCanvas = loadDrawing()
  const draw = new DrawingCanvas(makeCanvas(), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    getFlowProgress: () => 0.4,
  })

  draw.setFlowMode(true)
  draw._startFlowStroke({ x: 0.8, y: 0.3 })
  draw.flowY = 0.6
  draw.flowRecord(0.5)

  assert.deepEqual(
    Array.from(draw.strokes[0], (point) => point.x),
    [0.4, 0.5],
  )
  assert.equal(draw.strokes[0][0].y, 0.3)
  assert.equal(draw.strokes[0][1].y, 0.6)
})

test("turning flow mode off closes the active preview without notifying flow end twice", () => {
  const DrawingCanvas = loadDrawing()
  const events = []
  const draw = new DrawingCanvas(makeCanvas(), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    onPreviewStart: () => events.push("preview:start"),
    onPreviewEnd: () => events.push("preview:end"),
    onFlowStart: () => events.push("flow:start"),
    onFlowEnd: () => events.push("flow:end"),
  })

  draw.setFlowMode(true)
  draw._startFlowStroke({ x: 0.5, y: 0.3 })
  draw.flowRecord(0.3)
  draw.setFlowMode(false)

  assert.equal(draw.flowMode, false)
  assert.equal(draw.flowActive, false)
  assert.deepEqual(events, ["preview:start", "flow:start", "preview:end"])
})
