const assert = require("node:assert/strict")
const test = require("node:test")

const Core = require("../js/music-core.js")

// 서양 기본 축: 솔(55)~솔(79) 자연음 15칸
const style = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], lowMidi: 55, highMidi: 79 }
// 국악 팔레트: 솔라도레미 2옥타브 10음 (manifest GUGAK_PALETTE_MIDI와 동일)
const gugakAsset = { playableMidi: [55, 57, 60, 62, 64, 67, 69, 72, 74, 76] }

test("전체 축은 15칸, 국악 악기의 보이는 축은 10칸", () => {
  assert.equal(Core.drawableScale(style).length, 15)
  assert.deepEqual(Core.playableScale(style, gugakAsset), gugakAsset.playableMidi)
  assert.equal(Core.playableScale(style, null).length, 15)
})

test("서양 악기(전체 축)는 화면↔저장 변환이 항등", () => {
  for (const y of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(Core.displayYFromStored(y, style, null), y)
    assert.equal(Core.storedYFromDisplay(y, style, null), y)
  }
})

test("국악 축: 화면 칸 가운데를 그리면 그 칸의 음으로 저장·보정된다", () => {
  const visible = gugakAsset.playableMidi
  for (let j = 0; j < visible.length; j++) {
    const displayY = 1 - (j + 0.5) / visible.length
    const stored = Core.storedYFromDisplay(displayY, style, gugakAsset)
    assert.equal(Core.quantizePitch(stored, style, gugakAsset), visible[j], "row " + j)
  }
})

test("국악 축: 캔버스 맨 위·맨 아래 픽셀도 발음 가능한 음으로 저장된다", () => {
  const topStored = Core.storedYFromDisplay(0, style, gugakAsset)
  const bottomStored = Core.storedYFromDisplay(1, style, gugakAsset)
  assert.equal(Core.quantizePitch(topStored, style, gugakAsset), 76)
  assert.equal(Core.quantizePitch(bottomStored, style, gugakAsset), 55)
})

test("국악 축: 화면→저장→화면 왕복이 원위치로 돌아온다 (획 모양 유지)", () => {
  for (let i = 0; i <= 40; i++) {
    const displayY = i / 40
    const stored = Core.storedYFromDisplay(displayY, style, gugakAsset)
    const roundTrip = Core.displayYFromStored(stored, style, gugakAsset)
    assert.ok(Math.abs(roundTrip - displayY) < 1e-4, displayY + " -> " + roundTrip)
  }
})

test("숨은 칸(파·시)에 있던 옛 저장 점도 화면 범위 안의 이웃 칸에 붙는다", () => {
  const full = Core.drawableScale(style)
  for (const midi of [59, 65, 71, 77, 79]) {
    const idx = full.indexOf(midi)
    const stored = 1 - (idx + 0.5) / full.length
    const display = Core.displayYFromStored(stored, style, gugakAsset)
    assert.ok(display >= 0 && display <= 1, midi + " -> " + display)
  }
})
