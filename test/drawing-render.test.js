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
  const code = fs.readFileSync(path.join(projectDir, "js", "drawing.js"), "utf8")
  vm.runInNewContext(code, sandbox, { filename: "drawing.js" })
  return sandbox.DrawingCanvas
}

function makeContext() {
  return {
    calls: [],
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo(x, y) {
      this.calls.push(["moveTo", x, y])
    },
    lineTo(x, y) {
      this.calls.push(["lineTo", x, y])
    },
    stroke() {
      this.calls.push(["stroke", this.strokeStyle, this.lineWidth, this.globalAlpha])
    },
    fill() {
      this.calls.push(["fill", this.fillStyle, this.globalAlpha])
    },
    arc() {},
    arcTo() {},
    closePath() {},
    setLineDash() {},
  }
}

function makeCanvas(ctx) {
  return {
    width: 900,
    height: 360,
    style: {},
    parentElement: null,
    closest() {
      return null
    },
    getContext() {
      return ctx
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 900, height: 360 }
    },
    addEventListener() {},
    setPointerCapture() {},
  }
}

test("renderNotes keeps stroke instrument colors and renders strings as lines", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    instrumentColor: (id) => ({ violin: "#c0504d", flute: "#4f9bb8" })[id],
  })

  ctx.calls.length = 0
  draw.strokeInstruments = ["violin", "flute"]
  draw.notes = [
    { time: 0, duration: 2, midi: 60, velocity: 0.7, voice: 0 },
    { time: 3, duration: 2, midi: 64, velocity: 0.7, voice: 1 },
  ]

  draw.renderNotes()

  const violinStrokes = ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#c0504d")
  const fluteFills = ctx.calls.filter((call) => call[0] === "fill" && call[1] === "#4f9bb8")
  const violinWidths = violinStrokes.map((call) => call[2])

  assert.ok(violinStrokes.length >= 2, "string instruments should render as stroked lines")
  assert.ok(Math.min(...violinWidths) < Math.max(...violinWidths), "string line should include a thinner foreground stroke")
  assert.ok(fluteFills.length >= 1, "wind instruments should keep the filled bar treatment")
})

test("pitch rendering keeps non-label pitches inside the audible palette rows", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })

  const y = draw._pitchToY(56, [56, 58, 60])

  assert.ok(y < draw.canvas.height, "lowest audible pitch should stay above the bottom silent row")
  assert.ok(y > 0, "audible pitch should stay below the top silent row")
})

test("renderGrid adds one-second vertical palette cells", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })

  ctx.calls.length = 0
  draw.renderGrid()

  const verticals = []
  for (let i = 0; i < ctx.calls.length - 1; i++) {
    const a = ctx.calls[i]
    const b = ctx.calls[i + 1]
    if (a[0] === "moveTo" && b[0] === "lineTo" && a[1] === b[1] && a[2] === 0 && b[2] === draw.canvas.height) {
      verticals.push(a[1])
    }
  }
  assert.ok(verticals.length >= 29, "30초 팔레트는 최소 29개의 세로 모눈선을 가져야 한다")
})
