const { loadScripts } = require("../tools/runtime-scripts.cjs")
const assert = require("node:assert/strict")
const test = require("node:test")


function loadDrawing() {
  const sandbox = {
    MusicCore: {
      quantizePitch(y) { const scale = this.drawableScale(); return scale[Math.max(0, Math.min(scale.length-1, Math.floor((1-y)*scale.length)))] },
      buildScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      drawableScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      playableScale() {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      autocompleteMelodyStrokes() {
        return []
      },
      autocompleteRhythm() {
        return []
      },
    },
    performance: { now: () => 0 },
    devicePixelRatio: 1,
  }
  sandbox.self = sandbox
  loadScripts(sandbox, { from: "drawing-renderer.js", through: "drawing.js" })
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
  const handlers = {}
  return {
    width: 100,
    height: 100,
    clientWidth: 100,
    style: {},
    parentElement: null,
    closest() {
      return null
    },
    getContext() {
      return makeContext()
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 }
    },
    addEventListener(type, handler) {
      handlers[type] = handler
    },
    setPointerCapture() {},
    dispatch(type, event) {
      handlers[type](Object.assign({ pointerId: 1, clientX: 0, clientY: 0 }, event))
    },
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("undo removes the last drawn stroke with its instrument", () => {
  const DrawingCanvas = loadDrawing()
  const canvas = makeCanvas()
  let changes = 0
  const draw = new DrawingCanvas(canvas, {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    onChange: () => {
      changes += 1
    },
  })

  canvas.dispatch("pointerdown", { clientX: 10, clientY: 20 })
  canvas.dispatch("pointermove", { clientX: 40, clientY: 30 })
  canvas.dispatch("pointerup", {})

  assert.equal(draw.getStrokes().length, 1)
  assert.deepEqual(plain(draw.getStrokeInstruments()), ["violin"])
  assert.equal(draw.canUndo(), true)

  assert.equal(draw.undo(), true)
  assert.deepEqual(plain(draw.getStrokes()), [])
  assert.deepEqual(plain(draw.getStrokeInstruments()), [])
  assert.equal(draw.canUndo(), false)
  assert.equal(changes, 2)
})

test("undo restores a stroke split by the eraser", () => {
  const DrawingCanvas = loadDrawing()
  const canvas = makeCanvas()
  const draw = new DrawingCanvas(canvas, {
    activeInstrument: "flute",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const original = [
    [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.1 },
      { x: 0.3, y: 0.1 },
    ],
  ]

  draw.setStrokes(original, ["flute"])
  draw.clearUndoHistory()
  draw.setEraseMode(true)
  const labelWidth = draw.pitchLabelGutterCssPx()
  canvas.dispatch("pointerdown", { clientX: labelWidth + 0.2 * (canvas.clientWidth - labelWidth), clientY: 10 })
  canvas.dispatch("pointerup", {})

  assert.notDeepEqual(plain(draw.getStrokes()), original)
  assert.equal(draw.canUndo(), true)

  assert.equal(draw.undo(), true)
  assert.deepEqual(plain(draw.getStrokes()), original)
  assert.deepEqual(plain(draw.getStrokeInstruments()), ["flute"])
})

test("eraser leaves same-line points more than half a second away", () => {
  const DrawingCanvas = loadDrawing()
  const canvas = makeCanvas()
  const draw = new DrawingCanvas(canvas, {
    activeInstrument: "flute",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })

  draw.setStrokes(
    [
      [
        { x: 0.1, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.525, y: 0.5 },
        { x: 0.8, y: 0.5 },
      ],
    ],
    ["flute"],
  )

  assert.equal(draw._eraseAt({ x: 0.5, y: 0.5 }), true)

  const xs = plain(draw.getPath()).map((point) => point.x)
  assert.equal(xs.includes(0.5), false)
  assert.equal(xs.includes(0.525), true)
})

test("eraser preserves a one-point tap outside its radius", () => {
  const DrawingCanvas = loadDrawing()
  const draw = new DrawingCanvas(makeCanvas(), {
    activeInstrument: "flute",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const tap = [[{ x: 0.1, y: 0.1 }]]

  draw.setStrokes(tap, ["flute"])

  assert.equal(draw._eraseAt({ x: 0.9, y: 0.9 }), false)
  assert.deepEqual(plain(draw.getStrokes()), tap)
  assert.deepEqual(plain(draw.getStrokeInstruments()), ["flute"])
})

test("eraser removes a nearby one-point tap and undo restores it", () => {
  const DrawingCanvas = loadDrawing()
  const canvas = makeCanvas()
  const draw = new DrawingCanvas(canvas, {
    activeInstrument: "flute",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const tap = [[{ x: 0.25, y: 0.4 }]]

  draw.setStrokes(tap, ["flute"])
  draw.clearUndoHistory()
  draw.setEraseMode(true)
  const labelWidth = draw.pitchLabelGutterCssPx()
  canvas.dispatch("pointerdown", {
    clientX: labelWidth + 0.25 * (canvas.clientWidth - labelWidth),
    clientY: 40,
  })
  canvas.dispatch("pointerup", {})

  assert.deepEqual(plain(draw.getStrokes()), [])
  assert.equal(draw.canUndo(), true)
  assert.equal(draw.undo(), true)
  assert.deepEqual(plain(draw.getStrokes()), tap)
  assert.deepEqual(plain(draw.getStrokeInstruments()), ["flute"])
})

test("eraser keeps one-point fragments on both sides of a removed point", () => {
  const DrawingCanvas = loadDrawing()
  const draw = new DrawingCanvas(makeCanvas(), {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })

  draw.setStrokes(
    [[
      { x: 0.1, y: 0.5 },
      { x: 0.2, y: 0.5 },
      { x: 0.3, y: 0.5 },
    ]],
    ["violin"],
  )

  assert.equal(draw._eraseAt({ x: 0.2, y: 0.5 }), true)
  assert.deepEqual(plain(draw.getStrokes()), [
    [{ x: 0.1, y: 0.5 }],
    [{ x: 0.3, y: 0.5 }],
  ])
  assert.deepEqual(plain(draw.getStrokeInstruments()), ["violin", "violin"])
})
