const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadDrawing(buildScale, coreOverrides) {
  const sandbox = {
    MusicCore: Object.assign({
      buildScale: buildScale || function () {
        return [60, 62, 64, 65, 67, 69, 71, 72]
      },
      autocompleteMelodyStrokes() {
        return []
      },
      autocompleteRhythm() {
        return []
      },
    }, coreOverrides || {}),
    performance: { now: () => 0 },
    devicePixelRatio: 1,
  }
  sandbox.self = sandbox
  const code = fs.readFileSync(path.join(projectDir, "js", "drawing.js"), "utf8")
  vm.runInNewContext(code, sandbox, { filename: "drawing.js" })
  return sandbox.DrawingCanvas
}

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
    fillRect(x, y, w, h) {
      this.calls.push(["fillRect", x, y, w, h, this.fillStyle])
    },
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

test("renderNotes keeps stroke instrument colors and uses the same line treatment for every instrument", () => {
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
  const fluteStrokes = ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#4f9bb8")
  const violinWidths = violinStrokes.map((call) => call[2])
  const fluteWidths = fluteStrokes.map((call) => call[2])

  assert.equal(violinStrokes.length, 2, "each violin note should render as a stroked line")
  assert.equal(fluteStrokes.length, 2, "each flute note should render as a stroked line")
  assert.deepEqual(fluteWidths, violinWidths, "line widths should not vary by instrument")
})

test("pitch rendering places edge pitches at row centers on the G3..G5 axis", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const scale = [55, 57, 60, 79]
  const rowH = draw.canvas.height / scale.length

  assert.equal(draw._pitchToY(55, scale), draw.canvas.height - rowH / 2)
  assert.equal(draw._pitchToY(79, scale), rowH / 2)

  const y = draw._pitchToY(56, [56, 58, 60])
  assert.equal(y, draw.canvas.height - draw.canvas.height / 6, "lowest playable non-label pitch should use its row center")
})

test("renderGrid draws pitch-row cells with timeline vertical lines", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const rowCount = DrawingCanvas.pitchRowsForStyle({}).length

  ctx.calls.length = 0
  draw.renderGrid()

  const fills = ctx.calls.filter((call) => call[0] === "fillRect")
  assert.equal(fills.length, 2, "grid should only fill the paper and pitch-label gutter without row shading")

  const verticals = []
  for (let i = 0; i < ctx.calls.length - 1; i++) {
    const a = ctx.calls[i]
    const b = ctx.calls[i + 1]
    if (a[0] === "moveTo" && b[0] === "lineTo" && a[1] === b[1] && a[2] === 0 && b[2] === draw.canvas.height) {
      verticals.push(a[1])
    }
  }
  const horizontals = []
  for (let i = 0; i < ctx.calls.length - 1; i++) {
    const a = ctx.calls[i]
    const b = ctx.calls[i + 1]
    if (a[0] === "moveTo" && b[0] === "lineTo" && a[2] === b[2] && b[1] === draw.canvas.width) {
      horizontals.push(a[2])
    }
  }
  assert.equal(verticals.length, 13, "30 second drawing grid should show one vertical line every 2.5 seconds")
  assert.ok(verticals.every((x) => x >= 0 && x <= draw.canvas.width), "vertical lines should stay inside the canvas")
  assert.ok(verticals[0] > 0, "0초 세로선은 음높이 라벨 뒤에서 시작해야 한다")
  assert.ok(Math.abs(verticals[0] - draw._timelineLeft()) <= 1, "0초 세로선은 라벨 폭만큼 이동해야 한다")
  assert.ok(
    Math.abs(verticals[1] - verticals[0] - (draw._timelineWidth() * 2.5) / 30) <= 1,
    "첫 번째 시간 칸은 2.5초 폭이어야 한다",
  )
  assert.equal(horizontals.length, rowCount + 1, "pitch rows should draw one boundary line around each row")
})

test("pointer x positions use the timeline area after the pitch labels", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
  })
  const labelWidth = draw.pitchLabelGutterCssPx()

  assert.equal(draw._point({ clientX: 0, clientY: 180 }).x, 0)
  assert.equal(draw._point({ clientX: labelWidth, clientY: 180 }).x, 0)
  assert.equal(draw._point({ clientX: 900, clientY: 180 }).x, 1)
})

test("sticky pitch axis exposes Korean note names without octave numbers", () => {
  const DrawingCanvas = loadDrawing()

  const pitchLabels = DrawingCanvas.pitchLabelsForStyle({})
  const labels = JSON.parse(JSON.stringify(pitchLabels.map((label) => label.label)))

  // 악기마다 음역대가 달라 옥타브 숫자가 실제 소리와 어긋날 수 있어, 계이름만 표시한다.
  assert.deepEqual(labels, ["도", "레", "미", "파", "솔", "라", "시", "도"])
  assert.equal(pitchLabels[0].top, 93.75)
  assert.equal(pitchLabels[pitchLabels.length - 1].top, 6.25)
})

test("pitch axis labels use requested Korean order for western and gugak palettes", () => {
  const westernMidis = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
  const gugakMidis = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]
  const westernLabels = loadDrawing(() => westernMidis).pitchLabelsForStyle({}).map((label) => label.label)
  const gugakRows = loadDrawing(null, {
    drawableScale() {
      return westernMidis
    },
    isPitchPlayable(midi) {
      return gugakMidis.indexOf(midi) !== -1
    },
  }).pitchRowsForStyle({}, {})
  const gugakLabels = gugakRows.map((label) => label.label)
  const gugakDisabled = gugakRows.filter((row) => !row.selected).map((row) => row.midi)

  assert.deepEqual(westernLabels, ["솔", "라", "시", "도", "레", "미", "파", "솔", "라", "시", "도", "레", "미", "파", "솔"])
  assert.deepEqual(gugakLabels, westernLabels)
  assert.deepEqual(gugakDisabled, [59, 65, 71, 77, 79])
})

test("inactive pitch rows do not start a new drawing stroke", () => {
  const westernMidis = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
  const gugakMidis = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]
  const DrawingCanvas = loadDrawing(null, {
    drawableScale() {
      return westernMidis
    },
    isPitchPlayable(midi) {
      return gugakMidis.indexOf(midi) !== -1
    },
    quantizePitch(y) {
      const idx = Math.max(0, Math.min(westernMidis.length - 1, Math.floor((1 - y) * westernMidis.length)))
      const midi = westernMidis[idx]
      return gugakMidis.indexOf(midi) !== -1 ? midi : null
    },
  })
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    getState: () => ({ duration: 30, style: {}, mode: "melody", melodyAsset: { playableMidi: gugakMidis } }),
  })

  draw.isDrawing = true
  draw.drawingGestureHasUndo = false
  assert.equal(draw._startStrokeSegment({ x: 0.2, y: 1 - (2 + 0.5) / westernMidis.length }), false)
  assert.equal(draw.getStrokes().length, 0)

  assert.equal(draw._startStrokeSegment({ x: 0.2, y: 1 - (4 + 0.5) / westernMidis.length }), true)
  assert.equal(draw.getStrokes().length, 1)
})

test("sticky pitch axis snaps label rows to whole CSS pixels", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const body = functionBody(source, "renderPitchAxisLabels")

  assert.match(body, /const axisHeight = Math\.round/)
  assert.match(body, /Math\.round\(\(\(Number\(percent\) \|\| 0\) \/ 100\) \* axisHeight\)/)
  assert.match(body, /d\.style\.top = rowTop \+ "px"/)
  assert.match(body, /d\.style\.height = Math\.max\(1, rowBottom - rowTop\) \+ "px"/)
  assert.match(body, /d\.style\.top = labelTop != null \? labelTop \+ "px" : label\.top \+ "%"/)
})
