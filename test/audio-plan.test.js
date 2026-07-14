const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const AudioPlan = require("../js/audio-plan.js")
const MusicCore = require("../js/music-core.js")

const projectDir = path.resolve(__dirname, "..")

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadData() {
  const sandbox = {}
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of ["manifest.js", "sample-maps.js", "sample-maps-western.js"]) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), sandbox, { filename: file })
  }
  return sandbox.SDStudioData
}

test("audio-plan supports both CommonJS and the classic browser global", () => {
  assert.equal(typeof AudioPlan.resolvePlan, "function")
  assert.equal(typeof AudioPlan.nearestSampleSegment, "function")

  const sandbox = {}
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "audio-plan.js"), "utf8"), sandbox, {
    filename: "audio-plan.js",
  })

  assert.equal(typeof sandbox.SDAudioPlan.resolvePlan, "function")
  assert.equal(typeof sandbox.SDAudioPlan.seekPlan, "function")
})

test("sample selection is deterministic and corrects detected pitch cents", () => {
  const asset = {
    baseMidi: 60,
    sampleMap: [
      { midi: 60, src: "c.mp3" },
      { midi: 64, src: "e.mp3" },
    ],
  }

  assert.equal(AudioPlan.nearestSampleSegment(asset, 62).src, "c.mp3", "equal-distance ties keep the earlier segment")
  assert.equal(AudioPlan.nearestSampleSegment(asset, 63).src, "e.mp3")

  const rate = AudioPlan.segmentPlaybackRate(asset, 62, { midi: 60, cents: 50 })
  assert.ok(Math.abs(rate - Math.pow(2, 1.5 / 12)) < 1e-12)
  assert.equal(AudioPlan.playbackMidiForInstrument(60, null, { playbackTranspose: 12, playableMidi: [60] }), 72)
  assert.equal(AudioPlan.playbackMidiForInstrument(61, null, { playbackTranspose: 12, playableMidi: [60] }), null)
})

test("sample and background ranges clamp invalid metadata without Web Audio", () => {
  const buffer = { duration: 10, length: 480000, sampleRate: 48000 }

  assert.deepEqual(AudioPlan.sampleSegmentBounds(buffer, { offset: 20, duration: 3 }, 2), { offset: 2, duration: 3 })
  assert.deepEqual(AudioPlan.sampleSegmentBounds(buffer, { offset: 8, duration: 5 }, 0), { offset: 8, duration: 2 })
  const range = AudioPlan.backgroundRange({ bgOffset: 12, bgEndOffset: 3, totalDuration: 30 }, buffer)
  assert.equal(range.start, 9.95)
  assert.equal(range.end, 10)
  assert.ok(Math.abs(range.length - 0.05) < 1e-12)
})

test("resolvePlan applies per-voice instruments and keeps effect stamps deterministic", () => {
  const data = loadData()
  const recipe = {
    atmosphere: "calm",
    instrument: "violin",
    strokeInstruments: ["cello"],
    style: "bright",
    version: "balanced",
    duration: 20,
    mode: "melody",
    effectIds: ["wind1", "wind1"],
    effectStamps: [{ id: "rain1", x: 0.25, y: 0.8 }],
    strokes: [[{ x: 0, y: 0.5 }, { x: 0.25, y: 0.4 }]],
  }
  const notes = [
    { time: 1, duration: 2, midi: 60, velocity: 0.7, voice: 0 },
    { time: 4, duration: 1, midi: 64, velocity: 0.6, voice: 1 },
  ]

  const plan = AudioPlan.resolvePlan(recipe, notes, { core: MusicCore, data })

  assert.equal(plan.voiceAssets[0].instrument.id, "cello")
  assert.equal(plan.notes[0].uiMidi, 60)
  assert.equal(plan.notes[0].midi, 48)
  assert.equal(plan.notes[1].midi, 64)
  assert.deepEqual(plain(plan.effects.map((effect) => effect.id)), ["wind1", "rain1"])
  assert.deepEqual(plain(plan.effectStamps), [{ id: "rain1", x: 0.25, y: 0.8, time: 5 }])
  assert.equal(plan.strokeSegments.length, 1)
  assert.equal(plan.strokeSegments[0].voice, 0)
})

test("seekPlan trims crossing notes and shifts timed plan entries", () => {
  const plan = {
    duration: 10,
    totalDuration: 10,
    notes: [
      { time: 3, duration: 4, midi: 60 },
      { time: 8, duration: 1, midi: 62 },
    ],
    uiNotes: [{ time: 3, duration: 4, midi: 60 }],
    strokeSegments: [
      {
        start: 3,
        end: 7,
        duration: 4,
        events: [
          { time: 3, midi: 60 },
          { time: 6, midi: 62 },
        ],
      },
    ],
    rhythmHits: [{ time: 6, velocity: 0.5 }],
    effectStamps: [{ id: "wind1", time: 9 }],
  }

  const shifted = AudioPlan.seekPlan(plan, 5)

  assert.equal(shifted.duration, 5)
  assert.equal(shifted.playbackOffset, 5)
  assert.deepEqual(plain(shifted.notes), [
    { time: 0, duration: 2, midi: 60 },
    { time: 3, duration: 1, midi: 62 },
  ])
  assert.deepEqual(plain(shifted.strokeSegments[0].events), [
    { time: 0, midi: 60 },
    { time: 1, midi: 62 },
  ])
  assert.deepEqual(plain(shifted.rhythmHits), [{ time: 1, velocity: 0.5 }])
  assert.deepEqual(plain(shifted.effectStamps), [{ id: "wind1", time: 4 }])
})
