const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const core = require("../js/music-core.js")

const projectDir = path.resolve(__dirname, "..")

function loadEngine() {
  const sandbox = { MusicCore: core }
  sandbox.self = sandbox
  for (const file of ["manifest.js", "sample-maps.js", "audio-engine.js"]) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return sandbox
}

function noop() {}

function makeParam() {
  return {
    events: [],
    setValueAtTime(value, time) {
      this.events.push(["set", value, time])
    },
    linearRampToValueAtTime(value, time) {
      this.events.push(["linear", value, time])
    },
    exponentialRampToValueAtTime(value, time) {
      this.events.push(["exponential", value, time])
    },
    setTargetAtTime(value, time, constant) {
      this.events.push(["target", value, time, constant])
    },
    cancelScheduledValues(time) {
      this.events.push(["cancel", time])
    },
  }
}

function makeNode(extra) {
  return Object.assign(
    {
      connect: noop,
      disconnect: noop,
      start: noop,
      stop: noop,
    },
    extra,
  )
}

function makeAudioContext() {
  const created = { oscillators: [], buffers: [], gains: [], filters: [] }
  return {
    created,
    currentTime: 0,
    createOscillator() {
      const node = makeNode({ type: "sine", frequency: makeParam(), detune: makeParam() })
      created.oscillators.push(node)
      return node
    },
    createBufferSource() {
      const node = makeNode({
        buffer: null,
        playbackRate: makeParam(),
        detune: makeParam(),
        loop: false,
        loopStart: 0,
        loopEnd: 0,
      })
      created.buffers.push(node)
      return node
    },
    createGain() {
      const node = makeNode({ gain: makeParam() })
      created.gains.push(node)
      return node
    },
    createBiquadFilter() {
      const node = makeNode({ type: "lowpass", frequency: makeParam(), Q: makeParam() })
      created.filters.push(node)
      return node
    },
  }
}

test("resolvePlan keeps the selected scale independent from instrument sample ranges", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const base = { duration: 30, atmosphere: "calm", style: "bright", version: "balanced", mode: "melody" }

  const violin = engine.resolvePlan(Object.assign({}, base, { instrument: "violin" }), [])
  const bass = engine.resolvePlan(Object.assign({}, base, { instrument: "doubleBass" }), [])

  assert.deepEqual(violin.pitchStyle, violin.style)
  assert.deepEqual(bass.pitchStyle, bass.style)
  assert.deepEqual(core.buildScale(violin.pitchStyle), core.buildScale(bass.pitchStyle))
})

test("scheduleSynthMelody sustains contiguous notes as one connected phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "synth", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )

  engine.scheduleSynthMelody(ctx, dest, plan, 0, noop)

  assert.equal(ctx.created.oscillators.length, 1)
  assert.ok(ctx.created.oscillators[0].frequency.events.length >= 3)
})

test("scheduleSampleMelody sustains contiguous notes as one connected sample phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  const buffer = { duration: 2.4 }

  engine.scheduleSampleMelody(ctx, dest, plan, buffer, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.ok(ctx.created.buffers[0].playbackRate.events.length >= 3)
})

test("preload decodes uploaded background files for the merged playback graph", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const uploadedBytes = new Uint8Array([1, 2, 3, 4]).buffer
  sandbox.SDStudioData.backgrounds.customTest = {
    label: "내 배경",
    src: "blob:custom-test",
    custom: true,
    file: { arrayBuffer: async () => uploadedBytes },
  }
  sandbox.SDStudioData.atmospheres.push({
    id: "customTest",
    label: "내 배경",
    padType: "ambient",
    backgroundId: "customTest",
    effectIds: [],
  })
  const ctx = {
    decodeAudioData: async (bytes) => ({ duration: bytes.byteLength }),
  }
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "customTest", instrument: "synth", style: "bright", version: "balanced", mode: "melody" },
    [],
  )

  const buffers = await engine.preload(ctx, plan)

  assert.deepEqual(buffers.pad, { duration: 4 })
})
