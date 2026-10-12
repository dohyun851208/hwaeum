const assert = require("node:assert/strict")
const test = require("node:test")
const { loadScripts } = require("../tools/runtime-scripts.cjs")
const Core = require("../js/music-core.js")
const Utils = require("../js/studio-utils.js")
const AudioPlan = require("../js/audio-plan.js")
const createRecipe = require("../js/studio-recipe.js")
const createReflection = require("../js/studio-reflection.js")

const sandbox = {}
sandbox.self = sandbox
loadScripts(sandbox, { from: "manifest.js", through: "sample-calibration.js" })
const data = sandbox.SDStudioData
const model = createRecipe({ core: Core, data, audioPlan: AudioPlan, utils: Utils })
const stroke = [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }]

function makeState() {
  return {
    duration: 30, atmosphere: data.atmospheres.find((a) => a.id === "none"),
    instrument: data.instruments.find((i) => i.id === "violin"),
    style: data.styles.find((s) => s.id === "bright"), version: data.versions[0],
    title: "  봄 노래  ", composerName: "화음", pic: "data:image/webp;base64,AA==", picName: "봄",
    actionCount: 8, bgOffset: 5, bgEndOffset: 35, pictureThought: "따뜻해요",
    backgroundReason: "잔잔해요", melodyIntent: "높은 산", hashtags: "#봄, 봄, 푸른 하늘",
    effectIds: [], effectStamps: [], backgroundNotes: {}, instrumentNotes: {}, reflectionEdited: {},
  }
}

test("recipe serialization preserves metadata and stroke/instrument alignment without changing input", () => {
  const state = makeState()
  const drawing = { strokes: [stroke, [], stroke], strokeInstruments: ["violin", "flute", "daegeum"], path: stroke }
  const before = JSON.stringify({ state, drawing })
  const recipe = model.buildRecipe(state, drawing)
  assert.equal(recipe.title, "봄 노래")
  assert.equal(recipe.pictureThought, state.pictureThought)
  assert.equal(recipe.picture, state.pic)
  assert.deepEqual(recipe.hashtags, ["봄", "푸른 하늘"])
  assert.deepEqual(recipe.strokeInstruments, ["violin", "daegeum"])
  assert.equal(recipe.strokes.length, 2)
  assert.equal(JSON.stringify({ state, drawing }), before)
  assert.deepEqual(Core.decodeRecipe(Core.encodeRecipe(recipe)), recipe)
})

test("recipe background offsets are included only when a playable background range is enabled", () => {
  const state = makeState()
  for (const enabled of [true, false]) {
    const recipe = model.buildRecipe(state, { bgRangeEnabled: enabled })
    assert.equal(recipe.bgOffset, enabled ? 5 : 0)
    assert.equal(recipe.bgEndOffset, enabled ? 35 : 0)
  }
})

test("preview recipe never reads drawing, picture or reflection data", () => {
  const state = makeState()
  for (const name of ["pic", "recipePicture", "effectStamps", "backgroundReason", "melodyIntent"]) {
    Object.defineProperty(state, name, { get() { throw new Error("expensive state read: " + name) } })
  }
  assert.deepEqual(Object.keys(model.buildPreviewRecipe(state)), ["duration", "atmosphere", "instrument", "style", "version", "mode"])
})

test("saved path notes use the recipe instrument and keep the legacy path format", () => {
  const recipe = { instrument: "daegeum", style: "bright", duration: 30, path: [{ x: 0.1, y: 0 }, { x: 0.5, y: 0 }] }
  const expected = Core.autocompleteMelody(recipe.path, {
    durationSec: 30, style: data.styles.find((s) => s.id === "bright"), melodyAsset: data.melodies.daegeum,
  })
  assert.equal(expected.length, 0, "국악기에서 낼 수 없는 높은 솔 칸")
  assert.ok(Core.autocompleteMelody(recipe.path, {
    durationSec: 30, style: data.styles.find((s) => s.id === "bright"), melodyAsset: data.melodies.violin,
  }).length, "같은 저장 좌표라도 서양 악기에는 발음 가능한 칸")
  assert.deepEqual(model.notesFor(recipe), expected)
  assert.deepEqual(model.notesFor({ ...recipe, mode: "rhythm" }), [])
})

test("mixed instrument notes retain their voice and use the recipe fallback for missing instrument ids", () => {
  const recipe = { instrument: "daegeum", style: "gugak", duration: 30, strokes: [stroke, stroke], strokeInstruments: ["violin", "missing"] }
  const notes = model.notesFor(recipe)
  const expected = Core.autocompleteMelodyStrokes(recipe.strokes, {
    durationSec: 30, style: data.styles.find((s) => s.id === "gugak"), melodyAsset: data.melodies.daegeum,
    melodyAssets: [data.melodies.violin, data.melodies.daegeum],
  })
  assert.deepEqual(notes, expected)
  assert.deepEqual([...new Set(notes.map((note) => note.voice))], [0, 1])
})

test("used instrument labels ignore empty strokes, deduplicate, and fall back to the recipe selection", () => {
  assert.deepEqual(model.usedInstrumentIdsForRecipe({ instrument: "flute", strokes: [stroke, [], stroke, stroke], strokeInstruments: ["violin", "cello", "violin"] }, "haegeum"), ["violin", "flute"])
  assert.deepEqual(model.usedInstrumentIdsForRecipe({ instrument: "flute" }, "haegeum"), ["flute"])
})

function reflectionHarness() {
  const state = makeState()
  const field = () => ({ value: "" })
  const el = { pictureThoughtInput: field(), pictureThoughtCompletionInput: field(), bgReasonInput: field(), melodyIntentInput: field() }
  const ui = createReflection({ state, el, utils: Utils, composerNameMax: 24, updateReadouts() {} })
  return { state, el, ui }
}

test("reflection carries only selected listening notes and respects student edits", () => {
  const { state, el, ui } = reflectionHarness()
  state.backgroundNotes = { none: "조용해요", calm: "선택하지 않은 메모" }
  state.instrumentNotes = { violin: "부드러워요", flute: "선택하지 않은 악기" }
  ui.syncReflectionFromNotes()
  assert.equal(el.bgReasonInput.value, "조용해요")
  assert.equal(el.melodyIntentInput.value, "부드러워요")
  state.reflectionEdited.melodyIntent = true
  state.melodyIntent = "직접 고친 표현"
  state.instrumentNotes.violin = "다시 쓴 메모"
  ui.syncReflectionFromNotes()
  assert.equal(el.melodyIntentInput.value, "직접 고친 표현")
  assert.equal(el.pictureThoughtInput.value, el.pictureThoughtCompletionInput.value)
})

test("loading a saved work protects its reflection from notes left by the previous work", () => {
  const { state, el, ui } = reflectionHarness()
  state.backgroundNotes.none = "이전 작품의 감상"
  state.instrumentNotes.violin = "이전 작품의 악기 메모"
  ui.restore({ pictureThought: "구름", backgroundReason: "저장된 이유", melodyIntent: "", hashtags: ["구름"] })
  ui.syncReflectionFromNotes()
  assert.equal(el.bgReasonInput.value, "저장된 이유")
  assert.equal(el.melodyIntentInput.value, "")
  assert.equal(el.pictureThoughtCompletionInput.value, "구름")
  assert.deepEqual(ui.hashtagList(), ["구름"])
})
