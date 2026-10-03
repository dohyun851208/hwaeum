const { loadScripts } = require("../tools/runtime-scripts.cjs")
const assert = require("node:assert/strict")
const test = require("node:test")

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
  const sandbox = { MusicCore: core, devicePixelRatio: 1, performance: { now: () => 1000 } }
  sandbox.self = sandbox
  loadScripts(sandbox, { from: "drawing-renderer.js", through: "drawing.js" })
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

test("칸 경계의 작은 왕복은 110ms 프리뷰 제한에 막히지 않는다", () => {
  const DrawingCanvas = loadDrawingCanvas(), canvas = fakeCanvas(), moved = []
  const drawing = new DrawingCanvas(canvas, {
    getState: () => ({duration:30,style:C_MAJOR,mode:"melody"}),
    onPreview: (point) => moved.push(point.y),
  })
  const count = core.drawableScale(C_MAJOR).length, boundary = 1-1/count
  drawing._previewStart({x:0,y:boundary+.001})
  for(let i=0;i<10;i++)drawing._preview({x:.1,y:boundary+(i%2?.001:-.001)},false)
  assert.equal(moved.length,10,"모든 복귀 입력이 타이머를 취소할 수 있어야 한다")
  drawing._preview({x:.2,y:boundary+.002},false)
  assert.equal(moved.length,10,"같은 칸 내부의 불필요한 호출은 계속 제한한다")
})
