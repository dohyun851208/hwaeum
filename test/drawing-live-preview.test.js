const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const core = require("../js/music-core.js")

const C_MAJOR = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11] }

function noop() {}

function fakeContext() {
  return {
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    arc: noop,
    arcTo: noop,
    closePath: noop,
    setLineDash: noop,
  }
}

function fakeCanvas() {
  const handlers = {}
  return {
    handlers,
    width: 100,
    height: 100,
    getContext: () => fakeContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    addEventListener: (type, handler) => {
      handlers[type] = handler
    },
    setPointerCapture: noop,
  }
}

function loadDrawingCanvas() {
  const code = fs.readFileSync(path.resolve(__dirname, "..", "js", "drawing.js"), "utf8")
  const sandbox = { MusicCore: core, devicePixelRatio: 1, performance: { now: () => 1000 } }
  sandbox.self = sandbox
  vm.runInNewContext(code, sandbox, { filename: "drawing.js" })
  return sandbox.DrawingCanvas
}

test("DrawingCanvas emits sustained preview lifecycle while pointer is held", () => {
  const DrawingCanvas = loadDrawingCanvas()
  const canvas = fakeCanvas()
  const events = []

  new DrawingCanvas(canvas, {
    getState: () => ({ duration: 30, style: C_MAJOR, mode: "melody" }),
    onPreviewStart: (point) => events.push(["start", point]),
    onPreview: (point) => events.push(["move", point]),
    onPreviewEnd: () => events.push(["end"]),
  })

  canvas.handlers.pointerdown({ clientX: 10, clientY: 30, pointerId: 1 })
  canvas.handlers.pointermove({ clientX: 30, clientY: 20, pointerId: 1 })
  canvas.handlers.pointerup({ pointerId: 1 })

  assert.equal(events[0][0], "start")
  assert.equal(events.at(-1)[0], "end")
  assert.ok(events.some((event) => event[0] === "move"))
})
