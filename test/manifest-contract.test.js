const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")
const GUGAK_PLAYABLE_MIDI = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueIds(items, label) {
  const ids = items.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length, label + " ids must be unique")
  return ids
}

function loadManifest() {
  const sandbox = {}
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of ["manifest.js", "sample-maps.js", "sample-maps-western.js", "sample-calibration.js"]) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInContext(code, sandbox, { filename: file })
  }
  return sandbox.SDStudioData
}

test("manifest instruments and melody assets share one stable identity contract", () => {
  const data = loadManifest()
  const instrumentIds = uniqueIds(Array.from(data.instruments), "instrument")
  const melodyIds = Object.keys(data.melodies)

  assert.deepEqual(instrumentIds.slice().sort(), melodyIds.slice().sort())
  for (const instrument of data.instruments) {
    const melody = data.melodies[instrument.id]
    assert.ok(melody, instrument.id + " melody asset")
    assert.equal(melody.label, instrument.label, instrument.id + " label")
    assert.equal(melody.group, instrument.group, instrument.id + " group")
    assert.equal(melody.waveform, instrument.waveform, instrument.id + " waveform")
    assert.ok(Number.isFinite(melody.baseMidi), instrument.id + " baseMidi")
    assert.ok(Number.isFinite(melody.lowMidi), instrument.id + " lowMidi")
    assert.ok(Number.isFinite(melody.highMidi), instrument.id + " highMidi")
    assert.ok(melody.lowMidi <= melody.baseMidi && melody.baseMidi <= melody.highMidi, instrument.id + " pitch range")
    assert.ok(["multi", "phrase"].includes(melody.sampleMode), instrument.id + " sampleMode")
  }
})

test("manifest atmospheres reference valid background, pad, and effect metadata", () => {
  const data = loadManifest()
  uniqueIds(Array.from(data.atmospheres), "atmosphere")

  for (const atmosphere of data.atmospheres) {
    if (atmosphere.silent) {
      assert.equal(atmosphere.id, "none")
      assert.equal(atmosphere.backgroundId, null)
      assert.equal(atmosphere.padType, null)
      continue
    }

    assert.equal(atmosphere.backgroundId, atmosphere.id, atmosphere.id + " background identity")
    assert.ok(data.backgrounds[atmosphere.backgroundId], atmosphere.id + " background")
    assert.equal(data.backgrounds[atmosphere.backgroundId].label, atmosphere.label, atmosphere.id + " background label")
    assert.ok(data.pads[atmosphere.padType], atmosphere.id + " fallback pad")
    for (const effectId of atmosphere.effectIds || []) {
      assert.ok(data.effects[effectId], atmosphere.id + " effect " + effectId)
    }
  }

  assert.equal(data.backgrounds.none, undefined)
})

test("manifest scale, mix, and gugak pitch metadata stay internally valid", () => {
  const data = loadManifest()
  uniqueIds(Array.from(data.styles), "style")
  uniqueIds(Array.from(data.versions), "version")

  for (const style of data.styles) {
    assert.ok(Number.isFinite(style.root), style.id + " root")
    assert.ok(Number.isFinite(style.lowMidi), style.id + " lowMidi")
    assert.ok(Number.isFinite(style.highMidi), style.id + " highMidi")
    assert.ok(style.lowMidi <= style.highMidi, style.id + " pitch range")
    assert.ok(Array.isArray(style.intervals) && style.intervals.length > 0, style.id + " intervals")
  }
  for (const version of data.versions) {
    assert.ok(Number.isFinite(version.melodyGain) && version.melodyGain >= 0, version.id + " melodyGain")
    assert.ok(Number.isFinite(version.padGain) && version.padGain >= 0, version.id + " padGain")
  }

  for (const instrument of data.instruments.filter((item) => item.group === "국악")) {
    assert.deepEqual(plain(data.melodies[instrument.id].playableMidi), GUGAK_PLAYABLE_MIDI, instrument.id)
  }
})

test("post-processed sample maps remain sorted and usable by the audio planner", () => {
  const data = loadManifest()

  for (const [id, asset] of Object.entries(data.melodies)) {
    assert.ok(Array.isArray(asset.sampleMap) && asset.sampleMap.length > 0, id + " sampleMap")
    let previousMidi = -Infinity
    for (const segment of asset.sampleMap) {
      assert.ok(Number.isFinite(segment.midi), id + " segment midi")
      assert.ok(segment.midi >= previousMidi, id + " sorted sampleMap")
      previousMidi = segment.midi
      if (segment.src != null) assert.equal(typeof segment.src, "string", id + " segment src")
      if (segment.offset != null) assert.ok(Number.isFinite(segment.offset) && segment.offset >= 0, id + " segment offset")
      if (segment.duration != null) assert.ok(Number.isFinite(segment.duration) && segment.duration > 0, id + " segment duration")
      if (segment.cents != null) assert.ok(Number.isFinite(segment.cents), id + " segment cents")
    }
  }
})

test("every effect stamp carries a measured loudness gain, with the bird as the reference", () => {
  const data = loadManifest()
  // 값은 tools/measure-effect-loudness.cjs 가 새소리 크기에 맞춰 추천한다(2026-10-05).
  assert.equal(data.effects.animalBird.gain, 1, "새소리가 크기 기준이다")
  for (const [id, effect] of Object.entries(data.effects)) {
    assert.ok(Number.isFinite(effect.gain) && effect.gain > 0 && effect.gain <= 16, id + " gain")
  }
})

test("every effect stamp knows how long it sounds, for the length band on the canvas", () => {
  const data = loadManifest()
  // 값은 tools/measure-effect-loudness.cjs --check 가 실제 파일 길이와 맞는지 본다(2026-10-06).
  for (const [id, effect] of Object.entries(data.effects)) {
    assert.ok(Number.isFinite(effect.duration) && effect.duration > 0 && effect.duration <= 30, id + " duration")
  }
})
