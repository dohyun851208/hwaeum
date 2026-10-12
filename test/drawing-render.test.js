const { loadScripts } = require("../tools/runtime-scripts.cjs")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

function loadDrawing(buildScale, coreOverrides) {
  const scaleForTest = buildScale || function () {
    return [60, 62, 64, 65, 67, 69, 71, 72]
  }
  const sandbox = {
    MusicCore: Object.assign({
      buildScale: scaleForTest,
      drawableScale: scaleForTest,
      playableScale: scaleForTest,
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
  loadScripts(sandbox, { from: "drawing-renderer.js", through: "drawing.js" })
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
    arc(x, y, r) {
      this.calls.push(["arc", x, y, r, this.fillStyle])
    },
    ellipse(x, y, rx, ry) {
      this.calls.push(["ellipse", x, y, rx, ry, this.fillStyle])
    },
    quadraticCurveTo(cx, cy, x, y) {
      this.calls.push(["quadraticCurveTo", cx, cy, x, y])
    },
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

test("melody rendering keeps the notes for playback without drawing correction bars", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    instrumentColor: (id) => ({ violin: "#c85f4d", flute: "#2f9c95" })[id],
  })

  ctx.calls.length = 0
  draw.strokeInstruments = ["violin", "flute"]
  draw.notes = [
    { time: 0, duration: 2, midi: 60, velocity: 0.7, voice: 0 },
    { time: 3, duration: 2, midi: 64, velocity: 0.7, voice: 1 },
  ]

  draw.render()

  const violinStrokes = ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#c85f4d")
  const fluteStrokes = ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#2f9c95")
  assert.equal(violinStrokes.length, 0, "quantized violin notes should not cover the drawing")
  assert.equal(fluteStrokes.length, 0, "quantized flute notes should not cover the drawing")
  assert.equal(draw.notes.length, 2, "hiding correction bars must preserve computed notes")
  assert.equal(ctx.calls.some((call) => call[1] === "#c96f66" || call[1] === "#b89d45"), false)
})

test("renderStroke uses instrument colors instead of pitch colors", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode: "melody" }),
    instrumentColor: (id) => ({ violin: "#c85f4d", flute: "#2f9c95" })[id],
  })

  ctx.calls.length = 0
  draw.strokes = [
    [
      { x: 0, y: 0.5 },
      { x: 0.05, y: 0.4 },
      { x: 0.1, y: 0.3 },
      { x: 0.2, y: 0.5 },
    ],
    [{ x: 0.4, y: 0.36 }],
  ]
  draw.strokeInstruments = ["violin", "flute"]

  draw.renderStroke()

  const violinStrokes = ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#c85f4d")
  const fluteDots = ctx.calls.filter((call) => call[0] === "fill" && call[1] === "#2f9c95")
  // 마법의 선율: 한 경로를 빛무리·빛·선 세 겹으로 칠한다. 점 사이마다 끊어 그리지 않아 round cap이 겹치지 않는다.
  assert.equal(violinStrokes.length, 3, "a many-point stroke is one continuous path painted as aura, glow and core")
  assert.deepEqual(violinStrokes.map((call) => call[3]), [0.07, 0.16, 0.92])
  assert.ok(ctx.calls.some((call) => call[0] === "stroke" && call[1] === "#ffffff"), "a thin sheen lights the top of the line")
  assert.ok(fluteDots.length >= 1, "a one-point tap is one note, shown as a pearl")
  assert.equal(ctx.calls.some((call) => call[1] === "#c96f66" || call[1] === "#b89d45"), false)
})

test("magic melody keeps the line clean and floats a note above the melody", () => {
  const DrawingCanvas = loadDrawing()
  const ctx = makeContext()
  let mode = "melody"
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    activeInstrument: "violin",
    getState: () => ({ duration: 30, style: {}, mode }),
    instrumentColor: (id) => ({ violin: "#c85f4d", flute: "#2f9c95" })[id],
  })
  draw.strokes = [
    [
      { x: 0, y: 0.5 },
      { x: 0.25, y: 0.375 },
      { x: 0.5, y: 0.25 },
    ],
  ]
  draw.strokeInstruments = ["violin"]
  draw.notes = [
    { time: 0, duration: 7.5, midi: 60, velocity: 0.7, voice: 0 },
    { time: 7.5, duration: 7.5, midi: 64, velocity: 0.7, voice: 0 },
  ]
  const noteHeads = () => ctx.calls.filter((call) => call[0] === "ellipse" && call[5] === "#c85f4d")

  ctx.calls.length = 0
  draw.renderStroke()
  // 선 위에 동그란 구슬을 달지 않는다 — 원은 점 하나짜리 획(탭)에만 쓴다.
  assert.equal(ctx.calls.filter((call) => call[0] === "arc").length, 0)
  // 점 사이는 곡선으로 이어 흐르게 그린다.
  assert.ok(ctx.calls.some((call) => call[0] === "quadraticCurveTo"))
  // 첫 음 위로 음표가 떠오른다: 첫 음(0초) 자리의 선 높이(0.5)보다 16px 위.
  const heads = noteHeads()
  assert.ok(heads.length >= 1)
  assert.equal(heads[0][1], draw._timeToX(0) + 3)
  assert.ok(Math.abs(heads[0][2] - (0.5 * draw.canvas.height - 16)) < 1e-9)

  // 다시 그려도 반짝임·음표 자리가 같다(무작위 없음).
  const first = JSON.stringify(ctx.calls)
  ctx.calls.length = 0
  draw.renderStroke()
  assert.equal(JSON.stringify(ctx.calls), first)

  // 지우개로 긋는 중에는 음 목록의 획 번호가 낡았으므로 음표를 잠시 그리지 않는다.
  draw.isDrawing = true
  draw.eraseMode = true
  ctx.calls.length = 0
  draw.renderStroke()
  assert.equal(noteHeads().length, 0)
  draw.isDrawing = false
  draw.eraseMode = false

  // 리듬형에는 떠오르는 음표가 없다.
  mode = "rhythm"
  ctx.calls.length = 0
  draw.renderStroke()
  assert.equal(noteHeads().length, 0)
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
  assert.equal(fills.length, rowCount + 2, "grid should fill the paper, pitch-label gutter, and subtle pitch row tints")
  assert.ok(fills.slice(2).every((call) => call[1] === draw._timelineLeft()), "pitch row tints should start after the pitch labels")

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
    playableScale() {
      return gugakMidis
    },
  }).pitchRowsForStyle({}, { playableMidi: gugakMidis })
  const gugakLabels = gugakRows.map((row) => row.label)

  assert.deepEqual(westernLabels, ["솔", "라", "시", "도", "레", "미", "파", "솔", "라", "시", "도", "레", "미", "파", "솔"])
  // 국악 축은 발음 가능한 10칸만 보인다 — 파·시 줄은 축에서 아예 빠지고, 남은 칸이 화면을 채운다.
  assert.deepEqual(gugakLabels, ["솔", "라", "도", "레", "미", "솔", "라", "도", "레", "미"])
  assert.ok(gugakRows.every((row) => row.selected))
  assert.ok(gugakRows.every((row) => Math.abs(row.rowHeight - 10) < 1e-9))
  assert.equal(gugakRows.find((row) => row.label === "도").color, "#c96f66")
})

test("gugak axis hides western strokes but keeps them for the western axis", () => {
  const westernMidis = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
  const gugakMidis = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]
  const gugakAsset = { playableMidi: gugakMidis }
  const westernAsset = {}
  const DrawingCanvas = loadDrawing(null, {
    drawableScale() {
      return westernMidis
    },
    playableScale(style, asset) {
      return asset && asset.playableMidi ? asset.playableMidi : westernMidis
    },
    // 변환이 실제로 렌더에 쓰이는지 확인할 수 있게 단순 축소 변환을 흉내 낸다.
    displayYFromStored(y) {
      return y * 0.5
    },
    storedYFromDisplay(y) {
      return y
    },
  })
  const ctx = makeContext()
  let activeAsset = gugakAsset
  const draw = new DrawingCanvas(makeCanvas(ctx), {
    activeInstrument: "gayageum",
    melodyAssetForInstrument: (id) => (id === "violin" ? westernAsset : gugakAsset),
    getState: () => ({ duration: 30, style: {}, mode: "melody", melodyAsset: activeAsset }),
    instrumentColor: (id) => ({ violin: "#c85f4d", gayageum: "#9a7138" })[id],
  })

  ctx.calls.length = 0
  draw.strokes = [
    [
      { x: 0, y: 0.4 },
      { x: 0.2, y: 0.4 },
    ],
    [
      { x: 0.3, y: 0.4 },
      { x: 0.5, y: 0.4 },
    ],
  ]
  draw.strokeInstruments = ["gayageum", "violin"]

  draw.renderStroke()
  assert.equal(ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#c85f4d").length, 0, "국악 축에서 서양 획은 숨긴다")
  assert.ok(ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#9a7138").length > 0, "국악 획은 보인다")
  // 보이는 국악 획은 화면 좌표 변환(displayYFromStored)을 거친다.
  assert.ok(ctx.calls.some((call) => call[0] === "moveTo" && call[2] === 0.4 * 0.5 * draw.canvas.height))

  // 숨겨졌을 뿐 지워지지 않는다 — 지우개도 숨은 획은 건드리지 못한다.
  assert.equal(draw._eraseAt({ x: 0.4, y: 0.4 }), false)
  assert.equal(draw.strokes.length, 2)

  // 서양 축으로 돌아오면 두 획이 모두 다시 보인다.
  activeAsset = westernAsset
  ctx.calls.length = 0
  draw.renderStroke()
  assert.ok(ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#c85f4d").length > 0)
  assert.ok(ctx.calls.filter((call) => call[0] === "stroke" && call[1] === "#9a7138").length > 0)
})

test("inactive pitch rows do not start a new drawing stroke", () => {
  const westernMidis = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
  const gugakMidis = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]
  const DrawingCanvas = loadDrawing(null, {
    drawableScale() {
      return westernMidis
    },
    playableScale() {
      return gugakMidis
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
