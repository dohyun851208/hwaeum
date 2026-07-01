const test = require("node:test")
const assert = require("node:assert")
const core = require("../js/music-core.js")

const C_MAJOR = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11] }
const C_MAJOR_LIMITED = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], lowMidi: 60, highMidi: 72 }
const G3_G5 = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], lowMidi: 55, highMidi: 79 }
const GUGAK_COMMON = { root: 55, intervals: [0, 2, 5, 7, 9], lowMidi: 55, highMidi: 76 }
const GUGAK_FIXED_GRID = {
  root: 55,
  intervals: [0, 2, 5, 7, 9],
  lowMidi: 55,
  highMidi: 76,
  drawRoot: 60,
  drawIntervals: [0, 2, 4, 5, 7, 9, 11],
  drawLowMidi: 55,
  drawHighMidi: 79,
}
const GUGAK_ASSET = { playableMidi: [55, 57, 60, 62, 64, 67, 69, 72, 74, 76] }

function rowCenterY(rows, midi) {
  const idx = rows.indexOf(midi)
  assert.notStrictEqual(idx, -1)
  return 1 - (idx + 0.5) / rows.length
}

// --- Task 1: scale / pitch / time resampling ---

test("buildScale: 범위 내 오름차순 음만 생성", () => {
  const scale = core.buildScale(C_MAJOR)
  assert.ok(scale.length > 0)
  assert.deepStrictEqual(scale, [...scale].sort((a, b) => a - b))
  assert.ok(scale.every((m) => m >= 48 && m <= 84))
})

test("quantizePitch: 정규화 y를 음계음으로 스냅(위=높은음)", () => {
  const top = core.quantizePitch(0, C_MAJOR)
  const bottom = core.quantizePitch(1, C_MAJOR)
  assert.ok(top > bottom)
  assert.ok(core.buildScale(C_MAJOR).includes(top))
})

test("buildScale: 악기별 권장 음역을 적용", () => {
  const scale = core.buildScale(C_MAJOR_LIMITED)
  assert.ok(scale.every((m) => m >= 60 && m <= 72))
  assert.strictEqual(core.quantizePitch(0, C_MAJOR_LIMITED), 72)
  assert.strictEqual(core.quantizePitch(1, C_MAJOR_LIMITED), 60)
})

test("quantizePitch: G3..G5 축의 맨 위와 맨 아래도 음을 만든다", () => {
  assert.strictEqual(core.quantizePitch(0, G3_G5), 79)
  assert.strictEqual(core.quantizePitch(1, G3_G5), 55)
  assert.strictEqual(core.quantizePitch(0.01, G3_G5), 79)
  assert.strictEqual(core.quantizePitch(0.99, G3_G5), 55)
})

test("buildScale: 국악 공통 팔레트는 G-A-C-D-E-G-A-C-D-E 10칸이다", () => {
  assert.deepStrictEqual(core.buildScale(GUGAK_COMMON), [55, 57, 60, 62, 64, 67, 69, 72, 74, 76])
})

test("drawableScale: 국악기는 서양 기본 축 15칸을 유지한다", () => {
  const rows = core.drawableScale(GUGAK_FIXED_GRID, GUGAK_ASSET)
  assert.deepStrictEqual(rows, [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])
})

test("quantizePitch: 국악 비활성 칸은 음을 만들지 않는다", () => {
  const rows = core.drawableScale(GUGAK_FIXED_GRID, GUGAK_ASSET)
  assert.strictEqual(core.quantizePitch(rowCenterY(rows, 59), GUGAK_FIXED_GRID, GUGAK_ASSET), null)
  assert.strictEqual(core.quantizePitch(rowCenterY(rows, 65), GUGAK_FIXED_GRID, GUGAK_ASSET), null)
  assert.strictEqual(core.quantizePitch(rowCenterY(rows, 67), GUGAK_FIXED_GRID, GUGAK_ASSET), 67)
})

test("resampleByTime: 그리는 속도와 무관 — 점 밀도가 달라도 같은 결과", () => {
  const sparse = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  const dense = [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }, { x: 1, y: 1 }]
  const a = core.resampleByTime(sparse, 8)
  const b = core.resampleByTime(dense, 8)
  assert.strictEqual(a.length, b.length)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i].y - b[i].y) < 1e-6)
})

// --- Task 2: rhythm autocomplete / sigimsae ---

test("autocompleteMelody: 박자 격자에 음 생성, 모든 음은 음계 내", () => {
  const path = [{ x: 0, y: 0.6 }, { x: 0.5, y: 0.3 }, { x: 1, y: 0.5 }]
  const notes = core.autocompleteMelody(path, { durationSec: 30, style: C_MAJOR })
  assert.ok(notes.length > 0)
  const scale = core.buildScale(C_MAJOR)
  assert.ok(notes.every((n) => scale.includes(n.midi)))
  assert.ok(notes.every((n) => n.time >= 0 && n.time < 30))
})

test("autocompleteMelody: 제한 음역 밖으로 음을 만들지 않음", () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  const notes = core.autocompleteMelody(path, { durationSec: 12, style: C_MAJOR_LIMITED })
  assert.ok(notes.length > 0)
  assert.ok(notes.every((n) => n.midi >= 60 && n.midi <= 72))
})

test("autocompleteMelody: 위아래 가장자리도 선율 음으로 만든다", () => {
  const path = [{ x: 0, y: 0.01 }, { x: 1, y: 0.01 }]
  const notes = core.autocompleteMelody(path, { durationSec: 12, style: G3_G5 })

  assert.ok(notes.length > 0)
  assert.ok(notes.every((n) => n.midi === 79))
})

test("autocompleteMelody: 가로로 길게 그은 선은 끊기지 않는 긴 한 음이다", () => {
  const path = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]
  const notes = core.autocompleteMelody(path, { durationSec: 30, style: C_MAJOR })

  assert.strictEqual(notes.length, 1)
  assert.strictEqual(notes[0].time, 0)
  assert.ok(Math.abs(notes[0].duration - 30) < 1e-6)
})

test("autocompleteMelody keeps un-drawn timeline sections empty", () => {
  const path = [{ x: 0, y: 0.6 }, { x: 0.25, y: 0.3 }]
  const notes = core.autocompleteMelody(path, { durationSec: 20, style: C_MAJOR })
  assert.ok(notes.length > 0)
  assert.ok(notes.every((n) => n.time >= 0 && n.time + n.duration <= 5.5))
})

test("autocompleteMelodyStrokes keeps gaps between separate strokes as rests", () => {
  const strokes = [
    [{ x: 0, y: 0.6 }, { x: 0.25, y: 0.6 }],
    [{ x: 0.75, y: 0.3 }, { x: 1, y: 0.3 }],
  ]
  const notes = core.autocompleteMelodyStrokes(strokes, { durationSec: 20, style: C_MAJOR })
  assert.ok(notes.some((n) => n.time < 6), "첫 획 음이 없다")
  assert.ok(notes.some((n) => n.time >= 14), "두 번째 획 음이 없다")
  assert.ok(notes.every((n) => n.time + n.duration <= 6 || n.time >= 14), "획 사이 빈 구간에 음이 생겼다")
})

test("autocompleteMelodyStrokes can play two drawn lines at the same time", () => {
  const strokes = [
    [{ x: 0, y: 0.2 }, { x: 0.4, y: 0.2 }],
    [{ x: 0, y: 0.8 }, { x: 0.4, y: 0.8 }],
  ]
  const notes = core.autocompleteMelodyStrokes(strokes, { durationSec: 10, style: C_MAJOR })
  const simultaneous = notes.filter((n) => Math.abs(n.time) < 1e-6)
  assert.ok(simultaneous.length >= 2, "같은 시간에 시작하는 두 음이 만들어지지 않았다")
  assert.ok(new Set(simultaneous.map((n) => n.midi)).size >= 2, "두 선이 서로 다른 음높이로 연주되지 않는다")
})

test("autocompleteMelody preserves the drawn x position as time", () => {
  const path = [{ x: 1 / 3, y: 0.6 }, { x: 2 / 3, y: 0.3 }]
  const notes = core.autocompleteMelody(path, { durationSec: 30, style: C_MAJOR })
  assert.ok(notes.length > 0)
  assert.ok(notes.every((n) => n.time >= 9.5 && n.time < 21))
})

test("autocompleteRhythm: 온셋이 4/4 8분음표 격자에 정렬", () => {
  const path = [{ x: 0, y: 0.2 }, { x: 0.5, y: 0.9 }, { x: 1, y: 0.3 }]
  const hits = core.autocompleteRhythm(path, { durationSec: 8, bpm: 100 })
  const step = 60 / 100 / 2
  assert.ok(hits.length > 0)
  assert.ok(hits.every((h) => Math.abs(Math.round(h.time / step) * step - h.time) < 1e-6))
  assert.ok(hits.every((h) => h.time >= 0 && h.time < 8))
})

test("sigimsaeFor: 국악풍은 장식, 그 외는 빈 배열", () => {
  const orn = core.sigimsaeFor({ gugak: true, durationBeats: 1 })
  assert.ok(orn.length > 0)
  assert.deepStrictEqual(core.sigimsaeFor({ gugak: false, durationBeats: 1 }), [])
})

test("sigimsaeFor: 긴 국악 지속음은 더 짙은 농현을 쓴다", () => {
  const shortVibrato = core.sigimsaeFor({ gugak: true, durationBeats: 1 }).find((seg) => seg.type === "vibrato")
  const longVibrato = core.sigimsaeFor({ gugak: true, durationBeats: 2.5 }).find((seg) => seg.type === "vibrato")

  assert.ok(longVibrato.cents > shortVibrato.cents)
  assert.ok(longVibrato.rateHz > shortVibrato.rateHz)
})

// --- Task 3: recipe codec / wav encoder ---

test("encodeRecipe/decodeRecipe 왕복", () => {
  const r = {
    duration: 30,
    atmosphere: "calm",
    instrument: "daegeum",
    style: "gugak",
    mode: "melody",
    path: [{ x: 0, y: 0.5 }, { x: 1, y: 0.2 }],
  }
  const s = core.encodeRecipe(r)
  assert.strictEqual(typeof s, "string")
  assert.deepStrictEqual(core.decodeRecipe(s), r)
})

test("encodeWav: 유효한 RIFF/WAVE 헤더", () => {
  const fake = {
    numberOfChannels: 1,
    sampleRate: 44100,
    length: 100,
    getChannelData: () => new Float32Array(100),
  }
  const buf = Buffer.from(core.encodeWav(fake))
  assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF")
  assert.strictEqual(buf.toString("ascii", 8, 12), "WAVE")
  assert.strictEqual(buf.readUInt32LE(24), 44100)
})
