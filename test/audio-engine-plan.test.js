const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const core = require("../js/music-core.js")

const projectDir = path.resolve(__dirname, "..")

function loadEngine() {
  const sandbox = { MusicCore: core, setTimeout, clearTimeout }
  sandbox.self = sandbox
  for (const file of [
    "manifest.js",
    "sample-maps.js",
    "sample-maps-western.js",
    "audio-plan.js",
    "audio-node-scope.js",
    "audio-pad-graph.js",
    "audio-engine.js",
  ]) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return sandbox
}

function noop() {}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

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
      startCalls: [],
      stopCalls: [],
      connect: noop,
      disconnect: noop,
      start(...args) {
        this.startCalls.push(args)
      },
      stop(...args) {
        this.stopCalls.push(args)
      },
    },
    extra,
  )
}

function makeAudioContext() {
  const created = { oscillators: [], buffers: [], gains: [], filters: [], audioBuffers: [] }
  return {
    created,
    currentTime: 0,
    state: "running",
    destination: makeNode(),
    resume() {
      this.state = "running"
      return Promise.resolve()
    },
    suspend() {
      this.state = "suspended"
      return Promise.resolve()
    },
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
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
      const buffer = {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData(ch) {
          return channels[ch]
        },
      }
      created.audioBuffers.push(buffer)
      return buffer
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

function expectedStableLoop(duration, offset = 0) {
  const dur = Number(duration) || 0
  const minLoop = Math.min(0.22, dur * 0.35)
  const relStart = Math.max(Math.min(dur * 0.28, Math.max(0, dur - minLoop - 0.06)), Math.min(0.18, Math.max(0, dur - minLoop)))
  const relEnd = Math.max(Math.min(Math.max(relStart + minLoop, dur * 0.78), Math.max(relStart + 0.08, dur - 0.06)), relStart + 0.08)
  return { start: offset + relStart, end: offset + relEnd }
}

function assertStableLoop(source, duration, offset = 0) {
  const expected = expectedStableLoop(duration, offset)
  assert.equal(source.loop, true)
  assert.ok(Math.abs(source.loopStart - expected.start) < 1e-9)
  assert.ok(Math.abs(source.loopEnd - expected.end) < 1e-9)
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

test("AudioEngine keeps resolvePlan and seekPlan compatibility wrappers", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const recipe = {
    duration: 12,
    atmosphere: "calm",
    instrument: "cello",
    style: "bright",
    version: "balanced",
    mode: "melody",
    strokes: [[{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.3 }]],
  }
  const notes = [{ time: 1, duration: 3, midi: 60, velocity: 0.7, voice: 0 }]

  const enginePlan = engine.resolvePlan(recipe, notes)
  const directPlan = sandbox.SDAudioPlan.resolvePlan(recipe, notes, {
    core: sandbox.MusicCore,
    data: sandbox.SDStudioData,
  })

  assert.deepEqual(plain(enginePlan), plain(directPlan))
  assert.deepEqual(plain(engine.seekPlan(enginePlan, 2)), plain(sandbox.SDAudioPlan.seekPlan(directPlan, 2)))
})

test("배경음악 없음(silent) 분위기는 합성 패드 폴백도 깔지 않는다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const emptyBuffers = { pad: null, melody: null, melodySamples: null, effects: [], byInstrument: {} }
  const base = { duration: 30, instrument: "violin", style: "bright", version: "balanced", mode: "melody" }

  const silentPlan = engine.resolvePlan(Object.assign({}, base, { atmosphere: "none" }), [])
  assert.equal(silentPlan.silent, true)
  const silentCtx = makeAudioContext()
  engine.schedule(silentCtx, makeNode(), silentPlan, emptyBuffers, 0, noop)
  assert.equal(silentCtx.created.oscillators.length, 0, "배경 없음이면 합성 패드 오실레이터가 없어야 한다")
  assert.equal(silentCtx.created.buffers.length, 0, "배경 없음이면 배경 버퍼 소스도 없어야 한다")

  // 대조군: 일반 분위기는 배경 버퍼가 없으면 합성 패드로 폴백한다.
  const calmPlan = engine.resolvePlan(Object.assign({}, base, { atmosphere: "calm" }), [])
  assert.equal(calmPlan.silent, false)
  const calmCtx = makeAudioContext()
  engine.schedule(calmCtx, makeNode(), calmPlan, emptyBuffers, 0, noop)
  assert.ok(calmCtx.created.oscillators.length > 0, "일반 분위기는 합성 패드가 깔려야 한다")
})

test("scheduleSynthMelody sustains contiguous notes as one connected phrase", () => {
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

  engine.scheduleSynthMelody(ctx, dest, plan, plan.notes, 0, noop)

  assert.equal(ctx.created.oscillators.length, 1)
  assert.ok(ctx.created.oscillators[0].frequency.events.length >= 3)
})

test("gayageum synth fallback decays like a plucked string instead of holding a sustained tone", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 5, midi: 60, velocity: 0.7 }],
  )

  engine.scheduleSynthMelody(ctx, dest, plan, plan.notes, 0, noop)

  const gainEvents = ctx.created.gains[0].gain.events
  assert.ok(gainEvents.some((event) => event[0] === "exponential" && event[1] === 0.001))
  assert.equal(gainEvents.some((event) => event[0] === "set" && event[1] > 0.1 && event[2] > 1), false)
})

test("scheduleSampleMelody sustains contiguous notes as one connected sample phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  const buffer = { duration: 2.4 }

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: buffer, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.ok(ctx.created.buffers[0].playbackRate.events.length >= 3)
})

test("scheduleSampleMelody bridges tiny drawing gaps as one connected sample phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.55, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 1.1, duration: 0.5, midi: 60, velocity: 0.7 },
    ],
  )

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls.length, 1)
  assert.ok(ctx.created.buffers[0].stopCalls[0][0] >= 1.6)
})

test("sample playback mirrors live drawing by not adding synthetic ornament ramps", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "haegeum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  const rateEvents = ctx.created.buffers[0].playbackRate.events
  assert.equal(rateEvents.filter((event) => event[0] === "set").length, 1)
  assert.equal(rateEvents.some((event) => event[0] === "linear"), false)
  assert.ok(rateEvents.some((event) => event[0] === "target"))
})

test("full playback uses stored drawing strokes as one continuous sample source", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const recipe = {
    duration: 30,
    atmosphere: "calm",
    instrument: "sogeum",
    style: "gugak",
    version: "balanced",
    mode: "melody",
    strokes: [[{ x: 0, y: 0.5 }, { x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }]],
    strokeInstruments: ["sogeum"],
  }
  const fragmentedNotes = [
    { time: 0, duration: 0.2, midi: 60, velocity: 0.7, voice: 0 },
    { time: 2, duration: 0.2, midi: 60, velocity: 0.7, voice: 0 },
    { time: 4, duration: 0.2, midi: 60, velocity: 0.7, voice: 0 },
  ]
  const plan = engine.resolvePlan(recipe, fragmentedNotes)

  engine.schedule(
    ctx,
    dest,
    plan,
    {
      pad: null,
      melody: { duration: 2.4 },
      melodySamples: null,
      effects: [],
      byInstrument: { sogeum: { melody: { duration: 2.4 }, melodySamples: null } },
    },
    0,
    noop,
  )

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls.length, 1)
  assert.ok(ctx.created.buffers[0].stopCalls[0][0] >= 15)
})

test("stroke sample playback uses live drawing glide timing", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const style = sandbox.SDStudioData.styles.find((s) => s.id === "gugak")
  const asset = sandbox.SDStudioData.melodies.haegeum
  const rows = core.drawableScale(style, asset)
  const yFor = (midi) => 1 - (rows.indexOf(midi) + 0.5) / rows.length
  const recipe = {
    duration: 30,
    atmosphere: "calm",
    instrument: "haegeum",
    style: "gugak",
    version: "balanced",
    mode: "melody",
    strokes: [[{ x: 0, y: yFor(67) }, { x: 0.25, y: yFor(69) }]],
    strokeInstruments: ["haegeum"],
  }
  const plan = engine.resolvePlan(recipe, [{ time: 0, duration: 7.5, midi: 60, velocity: 0.7, voice: 0 }])

  engine.schedule(
    ctx,
    dest,
    plan,
    {
      pad: null,
      melody: { duration: 2.4 },
      melodySamples: null,
      effects: [],
      byInstrument: { haegeum: { melody: { duration: 2.4 }, melodySamples: null } },
    },
    0,
    noop,
  )

  const target = ctx.created.buffers[0].playbackRate.events.find((event) => event[0] === "target")
  assert.ok(target)
  assert.equal(target[3], 0.09)
})

test("stroke sample playback ignores mapped offsets outside the loaded buffer", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [{ midi: 60, offset: 170.988, duration: 2.4, cents: 0 }],
  })

  engine.scheduleSampleStrokes(
    ctx,
    dest,
    plan,
    [{ start: 0, end: 0.2, duration: 0.2, events: [{ time: 0, midi: 60, uiMidi: 60 }] }],
    { melody: { duration: 2.4 }, melodySamples: null },
    0,
    noop,
  )

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
})

test("scheduleSampleMelody loops a long single phrase sample from its stable region until the drawn note ends", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 5, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assertStableLoop(ctx.created.buffers[0], 2.4)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
  assert.ok(ctx.created.buffers[0].stopCalls[0][0] >= 5)
})

test("sample melody playback ignores mapped offsets outside the loaded buffer", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 0.2, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [{ midi: 60, offset: 170.988, duration: 2.4, cents: 0 }],
  })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
})

test("scheduleSampleMelody snaps sustained sample loops to nearby zero crossings", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 5, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })
  const data = new Float32Array(2400).fill(-0.5)
  data[690] = 0.1
  data[1880] = 0.1
  const buffer = { duration: 2.4, sampleRate: 1000, getChannelData: () => data }

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: buffer, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].loop, true)
  assert.equal(ctx.created.buffers[0].loopStart, 0.69)
  assert.equal(ctx.created.buffers[0].loopEnd, 1.88)
})

test("sustained sample playback bakes a crossfaded loop buffer when PCM data is available", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 5, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })
  const data = new Float32Array(2400)
  for (let i = 0; i < data.length; i++) data[i] = i / data.length
  const buffer = {
    duration: 2.4,
    length: data.length,
    sampleRate: 1000,
    numberOfChannels: 1,
    getChannelData: () => data,
  }

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: buffer, melodySamples: null }, 0, noop)

  const source = ctx.created.buffers[0]
  assert.equal(ctx.created.audioBuffers.length, 1)
  assert.notEqual(source.buffer, buffer)
  assert.equal(source.loop, true)
  assert.equal(source.startCalls[0][1], 0)
  const tailFrame = Math.round(source.loopEnd * source.buffer.sampleRate) - 1
  assert.notEqual(source.buffer.getChannelData(0)[tailFrame], data[tailFrame])
})

test("gayageum sample playback does not apply a sustained sample loop", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 5, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  const source = ctx.created.buffers[0]
  assert.equal(source.loop, false)
  assert.equal(source.startCalls[0][1], 0)
  assert.ok(source.startCalls[0][2] <= 2.4)
  assert.equal(ctx.created.filters.length, 0, "가야금 샘플은 원음 보존을 위해 국악 공통 톤 필터를 거치지 않는다")
  assert.equal(
    ctx.created.gains[0].gain.events.some((event) => event[0] === "exponential" && event[1] === 0.001),
    false,
    "가야금 샘플은 원음 감쇠를 살리기 위해 추가 빠른 감쇠 엔벨로프를 걸지 않는다",
  )
})

test("gayageum connected sample notes retrigger each plucked pitch", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [
      { midi: 60, offset: 0.1, duration: 0.5, cents: 0 },
      { midi: 62, offset: 0.6, duration: 0.5, cents: 0 },
      { midi: 64, offset: 1.1, duration: 0.5, cents: 0 },
    ],
  })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  assert.equal(ctx.created.buffers.length, 3)
  assert.deepEqual(ctx.created.buffers.map((source) => source.startCalls[0][0]), [0, 0.5, 1])
  assert.deepEqual(ctx.created.buffers.map((source) => source.startCalls[0][1]), [0.1, 0.6, 1.1])
  ctx.created.buffers.forEach((source) => {
    assert.equal(source.loop, false)
    assert.equal(source.playbackRate.events.some((event) => event[0] === "target"), false)
  })
})

test("gugak multi-sample long horizontal notes loop the stable region of the sample", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 8, midi: 60, velocity: 0.7 }],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "multi", sampleMap: [{ midi: 72, src: "sogeum_C5.mp3" }] })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: null, melodySamples: { 72: { duration: 2.4 } } }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assertStableLoop(ctx.created.buffers[0], 2.4)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
  assert.ok(ctx.created.buffers[0].stopCalls[0][0] >= 8)
})

test("violin bottom G uses a shorter front sustain loop", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 8, midi: 55, velocity: 0.7 }],
  )
  const duration = 2.194

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: null, melodySamples: { 55: { duration } } }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].loop, true)
  assert.ok(Math.abs(ctx.created.buffers[0].loopStart - duration * 0.28) < 1e-9)
  assert.ok(Math.abs(ctx.created.buffers[0].loopEnd - duration * 0.58) < 1e-9)
})

test("double bass long notes loop the measured stable region instead of the fixed ratio window", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "doubleBass", style: "bright", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 8, midi: 55, velocity: 0.7 }],
  )
  const midi = plan.notes[0].midi
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "multi", sampleMap: [{ midi, src: "bass.mp3" }] })
  // 실측 doubleBass_As2 형태: 어택(0~0.15s) → 지속(~1.2s) → 급감쇠. 진폭 = RMS가 되게 ±교대 신호.
  const sampleRate = 1000
  const data = new Float32Array(2400)
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    const amp = t < 0.15 ? 0.9 : t < 1.2 ? 0.4 : 0.02
    data[i] = (i % 2 ? 1 : -1) * amp
  }
  const buffer = { duration: 2.4, length: data.length, sampleRate, numberOfChannels: 1, getChannelData: () => data }

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: null, melodySamples: { [midi]: buffer } }, 0, noop)

  const source = ctx.created.buffers[0]
  assert.equal(source.loop, true)
  assert.ok(source.loopStart >= 0.1, "어택은 루프에서 제외한다: " + source.loopStart)
  assert.ok(source.loopEnd <= 1.3, "고정 비율(78% ≈ 1.87s)이면 감쇠 꼬리를 물고 돈다: " + source.loopEnd)
  assert.ok(source.loopEnd - source.loopStart >= 0.3, "루프가 너무 짧으면 안 된다")
})

test("double bass without PCM data still falls back to the fixed ratio loop", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "doubleBass", style: "bright", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 8, midi: 55, velocity: 0.7 }],
  )
  const midi = plan.notes[0].midi
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "multi", sampleMap: [{ midi, src: "bass.mp3" }] })

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: null, melodySamples: { [midi]: { duration: 2.4 } } }, 0, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assertStableLoop(ctx.created.buffers[0], 2.4)
})

test("multi-sample melody sustains contiguous notes as one connected phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "viola", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  const c4 = { duration: 1.2, id: "viola_C4" }
  const d4 = { duration: 1.2, id: "viola_D4" }
  const e4 = { duration: 1.2, id: "viola_E4" }

  engine.scheduleSampleMelody(
    ctx,
    dest,
    plan,
    plan.notes,
    { melody: { duration: 1.2, id: "fallback" }, melodySamples: { 60: c4, 62: d4, 64: e4 } },
    0,
    noop,
  )

  assert.equal(ctx.created.buffers.length, 1)
  assert.deepEqual(ctx.created.buffers[0].buffer, c4)
  assert.ok(ctx.created.buffers[0].playbackRate.events.some((event) => event[0] === "target"))
})

test("haegeum connected notes glide smoothly without re-triggering the grace bend", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "haegeum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  const c4 = { duration: 2.4, id: "haegeum_C4" }

  engine.scheduleSampleMelody(
    ctx,
    dest,
    plan,
    plan.notes,
    { melody: { duration: 2.4, id: "fallback" }, melodySamples: { 60: c4 } },
    0,
    noop,
  )

  const rateEvents = ctx.created.buffers[0].playbackRate.events
  const targets = rateEvents.filter((event) => event[0] === "target")
  assert.equal(ctx.created.buffers.length, 1)
  assert.ok(targets.length >= 2, "connected haegeum notes should glide on the same sample source")
  assert.ok(targets.every((event) => event[3] === 0.12), "haegeum uses a slower full-playback glide")
  assert.equal(
    rateEvents.some((event) => event[0] === "set" && Math.abs(event[2] - 0.5) < 1e-6),
    false,
    "connected haegeum note changes should not re-trigger the starting grace bend",
  )
})

test("multi-sample melody keeps separate strokes as separate sample starts", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "viola", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 1.2, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 2.4, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )
  const c4 = { duration: 1.2, id: "viola_C4" }
  const d4 = { duration: 1.2, id: "viola_D4" }
  const e4 = { duration: 1.2, id: "viola_E4" }

  engine.scheduleSampleMelody(
    ctx,
    dest,
    plan,
    plan.notes,
    { melody: { duration: 1.2, id: "fallback" }, melodySamples: { 60: c4, 62: d4, 64: e4 } },
    0,
    noop,
  )

  assert.deepEqual(
    ctx.created.buffers.map((source) => source.buffer),
    [c4, d4, e4],
  )
})

test("멀티샘플 악기는 드로잉 중 비동기 재시작 없이 피치만 글라이드해야 한다(실시간 미리듣기 무음 방지)", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const mockCtx = { currentTime: 1, state: "running" }
  engine.ensureContext = () => mockCtx

  const recipe = { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" }
  const plan = engine.resolvePlan(recipe, [])
  assert.equal(plan.melodyAsset.sampleMode, "multi", "전제: violin 은 멀티샘플")

  const rateParam = makeParam()
  engine.livePreview = { kind: "sample", signature: engine._liveSignature(plan), sampleMidi: plan.melodyAsset.baseMidi, rateParam: rateParam }

  let restarted = false
  engine.stopLivePreview = () => { restarted = true }
  engine.liveDrawingStart = () => { restarted = true; return Promise.resolve() }

  // 음높이를 여기저기 옮겨도(샘플 경계를 여러 번 넘어도) 재시작이 일어나면 안 된다.
  engine.liveDrawingMove(recipe, 0.1)
  engine.liveDrawingMove(recipe, 0.9)
  engine.liveDrawingMove(recipe, 0.4)

  assert.equal(restarted, false, "멀티샘플 미리듣기는 음 경계마다 재시작하면 안 됨")
  assert.ok(rateParam.events.some((e) => e[0] === "target"), "playbackRate 를 글라이드해야 함")
})

test("haegeum live drawing preview uses a slower pitch glide", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const recipe = { duration: 30, atmosphere: "calm", instrument: "haegeum", style: "gugak", version: "balanced", mode: "melody" }
  const plan = engine.resolvePlan(recipe, [])
  const rateParam = makeParam()
  engine.ensureContext = () => ctx
  engine.livePreview = {
    kind: "sample",
    signature: engine._liveSignature(plan),
    sampleMidi: 67,
    rateParam: rateParam,
  }

  const rows = core.drawableScale(plan.style, plan.melodyAsset)
  const y = 1 - (rows.indexOf(67) + 0.5) / rows.length
  engine.liveDrawingMove(recipe, y)

  const target = rateParam.events.find((event) => event[0] === "target")
  assert.ok(target, "haegeum live preview should glide instead of restarting")
  assert.equal(target[3], 0.09)
})

test("live drawing preview uses the full-playback melody gain target", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [],
  )

  engine._createSampleLivePreview(ctx, plan, { duration: 2.4 }, 0.5)

  const target = ctx.created.gains[0].gain.events.find((event) => event[0] === "linear")[1]
  const expected = plan.version.melodyGain * 1.5 * 0.81 * (0.7 * 0.85) * 0.56
  const noteGain = ctx.created.gains[1].gain.events.find((event) => event[0] === "set")[1]
  assert.ok(Math.abs(noteGain - Math.min(0.95, expected * 1.329) / expected) < 1e-9)
  assert.ok(Math.abs(target - expected) < 1e-9, "드로잉 중 미리듣기 음량은 전체 재생 선율 기준을 따라야 한다")
  assert.ok(target <= 0.95, "마스터 리미터 없는 프리뷰는 클리핑 방지 상한을 지켜야 한다")
})

test("국악 샘플은 드로잉 기준 음량을 30% 올리고 전체 재생도 같은 출력 목표를 쓴다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const previewCtx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 1.2, midi: 60, velocity: 0.7 }],
  )

  engine._createSampleLivePreview(previewCtx, plan, { duration: 2.4 }, 0.5)

  const previewTarget = previewCtx.created.gains[0].gain.events.find((event) => event[0] === "linear")[1]
  const previousDrawingTarget = plan.version.melodyGain * 0.52 * (0.7 * 0.85) * 0.56
  assert.ok(Math.abs(previewTarget - previousDrawingTarget * 1.3) < 1e-9)

  const ctx = makeAudioContext()
  const dest = makeNode()
  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  const phrasePeak = ctx.created.gains[0].gain.events.find((event) => event[0] === "linear")[1]
  const playbackOutputTarget = phrasePeak * plan.version.melodyGain * 0.52 * 0.56
  assert.ok(Math.abs(playbackOutputTarget - previewTarget) < 1e-9)

  const toneFilter = ctx.created.filters.find((filter) => filter.frequency.events.some((event) => event[1] === 2300))
  assert.ok(toneFilter, "전체 재생도 드로잉 미리듣기와 같은 국악 샘플 필터를 써야 한다")
  assert.ok(toneFilter.Q.events.some((event) => event[1] === 0.9))
})

test("live drawing preview loops long sample tones from the stable region for sustained instruments", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })

  engine._createSampleLivePreview(ctx, plan, { duration: 2.4 }, 0.5)

  assert.equal(ctx.created.buffers.length, 1)
  assertStableLoop(ctx.created.buffers[0], 2.35, 0.05)
})

test("gayageum live drawing preview does not loop the held sample", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })

  engine._createSampleLivePreview(ctx, plan, { duration: 2.4 }, 0.5)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].loop, false)
  assert.equal(ctx.created.filters.length, 0, "가야금 라이브 미리듣기도 원음 보존을 위해 필터를 거치지 않는다")
  assert.equal(
    ctx.created.gains[0].gain.events.some((event) => event[0] === "exponential" && event[1] === 0.001),
    false,
    "가야금 라이브 미리듣기는 샘플 자체의 자연 감쇠를 사용한다",
  )
})

test("live drawing preview ignores mapped offsets outside the loaded buffer", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [{ midi: 60, offset: 170.988, duration: 2.4, cents: 0 }],
  })

  engine._createSampleLivePreview(ctx, plan, { duration: 2.4 }, 0.5)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
})

test("note preview ignores mapped offsets outside the loaded buffer", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [{ midi: 60, offset: 170.988, duration: 2.4, cents: 0 }],
  })

  engine._previewSample(ctx, plan, { duration: 2.4 }, { time: 0, duration: 0.2, midi: 60, velocity: 0.7 }, 0)

  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls[0][1], 0)
})

test("note preview plays at twice the previous instrument-button gain", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const plan = {
    instrument: { id: "previewTest", group: "테스트" },
    melodyAsset: { sampleMode: "multi", baseMidi: 60, minRate: 0.5, maxRate: 2 },
  }
  const note = { time: 0, duration: 0.2, midi: 60, uiMidi: 60, velocity: 0.7 }

  engine._previewSynth(ctx, plan, note, 0)
  engine._previewSample(ctx, plan, { duration: 2.4 }, note, 1)

  const linearTargets = ctx.created.gains.map((gain) => gain.gain.events.find((event) => event[0] === "linear")[1])
  assert.ok(Math.abs(linearTargets[0] - 0.7 * 0.24 * 2) < 1e-9)
  assert.ok(Math.abs(linearTargets[1] - 0.7 * 0.34 * 2) < 1e-9)
})

test("resolvePlan applies instrument playback transposition per drawn voice", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const recipe = {
    duration: 30,
    atmosphere: "calm",
    instrument: "violin",
    style: "bright",
    version: "balanced",
    mode: "melody",
    strokeInstruments: ["flute", "cello", "doubleBass", "violin"],
  }

  const plan = engine.resolvePlan(recipe, [
    { time: 0, duration: 0.5, midi: 55, velocity: 0.7, voice: 0 },
    { time: 1, duration: 0.5, midi: 55, velocity: 0.7, voice: 1 },
    { time: 2, duration: 0.5, midi: 55, velocity: 0.7, voice: 2 },
    { time: 3, duration: 0.5, midi: 55, velocity: 0.7, voice: 3 },
  ])

  assert.deepEqual(
    plain(
    plan.notes.map((note) => note.midi),
    ),
    [67, 43, 31, 55],
  )
  assert.deepEqual(
    plain(
    plan.notes.map((note) => note.uiMidi),
    ),
    [55, 55, 55, 55],
  )
})

test("resolvePlan filters Korean instrument notes outside the allowed playable rows", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const recipe = { duration: 30, atmosphere: "calm", instrument: "sogeum", style: "gugak", version: "balanced", mode: "melody" }

  const plan = engine.resolvePlan(recipe, [
    { time: 0, duration: 0.5, midi: 65, velocity: 0.7 },
    { time: 1, duration: 0.5, midi: 67, velocity: 0.7 },
    { time: 2, duration: 0.5, midi: 76, velocity: 0.7 },
  ])

  assert.deepEqual(
    plain(
    plan.notes.map((note) => note.midi),
    ),
    [79, 88],
  )
  assert.deepEqual(
    plain(
    plan.notes.map((note) => note.uiMidi),
    ),
    [67, 76],
  )
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
  sandbox.SDStudioData.instruments.push({
    id: "silentTest",
    label: "테스트 악기",
    group: "테스트",
    waveform: "sine",
  })
  const ctx = {
    decodeAudioData: async (bytes) => ({ duration: bytes.byteLength }),
  }
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "customTest", instrument: "silentTest", style: "bright", version: "balanced", mode: "melody" },
    [],
  )

  const buffers = await engine.preload(ctx, plan)

  assert.deepEqual(buffers.pad, { duration: 4 })
})

test("resolvePlan includes user-selected natural effect ids", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()

  const plan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      effectIds: ["wind1", "rain2", "missing-effect"],
    },
    [],
  )

  assert.deepEqual(
    Array.from(plan.effects, (effect) => effect.label),
    ["산들바람", "소나기"],
  )
})

test("resolvePlan maps stamped natural effects to exact playback times", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()

  const plan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      effectStamps: [{ id: "wind1", x: 0.5, y: 0.25 }],
    },
    [],
  )

  assert.deepEqual(
    plan.effectStamps.map((stamp) => ({ id: stamp.id, time: stamp.time, x: stamp.x, y: stamp.y })),
    [{ id: "wind1", time: 15, x: 0.5, y: 0.25 }],
  )
  assert.deepEqual(
    Array.from(plan.effects, (effect) => effect.id),
    ["wind1"],
  )
})

test("schedule plays stamped natural effects only at stamped positions", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      effectStamps: [{ id: "wind1", x: 0.5, y: 0.25 }],
    },
    [],
  )
  const wind = plan.effects[0]

  engine.schedule(ctx, dest, plan, { pad: null, melody: null, effects: [{ asset: wind, buffer: { duration: 4 } }] }, 2, noop)

  assert.equal(ctx.created.buffers.length, 1)
  assert.deepEqual(ctx.created.buffers[0].startCalls[0], [17, 0, 4])
  assert.ok(
    ctx.created.gains.some((gain) => gain.gain.events.some((event) => event[0] === "set" && event[1] === 0.15 && event[2] === 17)),
    "효과음 도장 gain은 0.15여야 한다",
  )
})

test("previewEffect plays the stamped sound immediately", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  engine.ctx = ctx
  engine.decodedCache.set("sound/effects/wind1.mp3", { duration: 2.5 })

  const played = await engine.previewEffect({ id: "wind1", src: "sound/effects/wind1.mp3" })

  assert.equal(played, true)
  assert.equal(ctx.created.buffers.length, 1)
  assert.deepEqual(ctx.created.buffers[0].startCalls[0], [0.01, 0, 1.2])
  assert.deepEqual(ctx.created.buffers[0].stopCalls[0], [1.25])
  assert.ok(
    ctx.created.gains.some((gain) => gain.gain.events.some((event) => event[0] === "linear" && event[1] === 0.24)),
    "효과음 도장 미리듣기 gain은 0.24여야 한다",
  )
})

test("previewEffect makes an immediate fallback sound while the effect sample loads", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  let resolveLoad
  engine.ctx = ctx
  engine.loadAssetBuffer = async () =>
    new Promise((resolve) => {
      resolveLoad = resolve
    })

  const pending = engine.previewEffect({ id: "wind1", src: "sound/effects/wind1.mp3" })

  assert.equal(ctx.created.oscillators.length, 1, "첫 스탬프도 즉시 들리는 폴백음을 내야 한다")
  resolveLoad({ duration: 0.4 })
  assert.equal(await pending, true)
  assert.equal(ctx.created.buffers.length, 1, "효과음 버퍼가 준비되면 실제 효과음도 재생한다")
})

test("warmEffect starts decoding the selected stamp sound before stamping", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  let seenEffect = null
  engine.ctx = ctx
  engine.loadAssetBuffer = async (actualCtx, effect) => {
    assert.equal(actualCtx, ctx)
    seenEffect = effect
    return { duration: 0.3 }
  }

  const buffer = await engine.warmEffect({ id: "wind1", src: "sound/effects/wind1.mp3" })

  assert.equal(buffer.duration, 0.3)
  assert.equal(seenEffect.id, "wind1")
})

test("all natural effect categories play at gain 0.15", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      effectStamps: [
        { id: "wind1", x: 0.2, y: 0.25 },
        { id: "rain2", x: 0.35, y: 0.25 },
        { id: "forest1", x: 0.5, y: 0.25 },
        { id: "thunder2", x: 0.65, y: 0.25 },
      ],
    },
    [],
  )

  engine.schedule(
    ctx,
    dest,
    plan,
    {
      pad: null,
      melody: null,
      effects: plan.effects.map((effect) => ({ asset: effect, buffer: { duration: 4 } })),
    },
    2,
    noop,
  )

  const effectGainEvents = ctx.created.gains.flatMap((gain) =>
    gain.gain.events.filter((event) => event[0] === "set" && event[1] === 0.15),
  )
  assert.equal(effectGainEvents.length, 4)
})

test("full playback background starts with the first beat and is cut at the recipe duration", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [],
  )
  const start = 2

  engine.schedule(ctx, dest, plan, { pad: { duration: 120 }, melody: null, effects: [] }, start, noop)

  const padSource = ctx.created.buffers[0]
  const padGain = ctx.created.gains[0]
  assert.equal(padSource.loop, false)
  assert.deepEqual(padSource.startCalls[0], [start, 0])
  assert.equal(padSource.stopCalls[0][0], start + plan.duration + 0.05)
  assert.equal(padGain.gain.events[1][1], plan.version.padGain * 1.5, "배경음악은 기존 padGain 기준 1.5배로 재생")
  assert.ok(padGain.gain.events[0][1] > 0, "배경 gain 이 0에서 시작하면 초반에 선율만 들린다")
  assert.ok(padGain.gain.events[1][2] <= start + 0.5, "배경 fade-in 이 길면 선율 뒤에야 배경이 들린다")
})

test("선율 gain은 서양 기준과 악기별 음량 보정을 함께 적용한다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const note = { time: 0, duration: 0.5, midi: 60, velocity: 0.7 }
  const gainSetValuesFor = function (instrumentId) {
    const ctx = makeAudioContext()
    const dest = makeNode()
    const plan = engine.resolvePlan(
      { duration: 30, atmosphere: "calm", instrument: instrumentId, style: "bright", version: "balanced", mode: "melody" },
      [note],
    )
    engine.schedule(ctx, dest, plan, { pad: null, melody: null, effects: [], byInstrument: {} }, 0, noop)
    return ctx.created.gains.flatMap((gain) => gain.gain.events.filter((event) => event[0] === "set").map((event) => event[1]))
  }

  const fluteValues = gainSetValuesFor("flute")
  const oboeValues = gainSetValuesFor("oboe")
  const clarinetValues = gainSetValuesFor("clarinet")
  const frenchHornValues = gainSetValuesFor("frenchHorn")
  const violinValues = gainSetValuesFor("violin")
  const violaValues = gainSetValuesFor("viola")
  const celloValues = gainSetValuesFor("cello")
  const doubleBassValues = gainSetValuesFor("doubleBass")
  const sogeumValues = gainSetValuesFor("sogeum")
  const daegeumValues = gainSetValuesFor("daegeum")
  const dansoValues = gainSetValuesFor("danso")
  const gayageumValues = gainSetValuesFor("gayageum")
  const haegeumValues = gainSetValuesFor("haegeum")

  const hasGain = (values, expected) => values.some((value) => Math.abs(value - expected) < 1e-9)

  assert.ok(hasGain(fluteValues, 1.68 * 1.5 * 1.08), "flute gain follows measured instrument loudness calibration")
  assert.ok(hasGain(oboeValues, 1.68 * 1.5 * 1.03), "oboe gain follows measured instrument loudness calibration")
  assert.ok(hasGain(clarinetValues, 1.68 * 1.5 * 0.91), "clarinet gain follows measured instrument loudness calibration")
  assert.ok(hasGain(frenchHornValues, 1.68 * 1.5 * 1.3332), "french horn gain follows measured instrument loudness calibration")
  assert.ok(hasGain(violinValues, 1.68 * 1.5 * 0.81), "violin is the reference calibrated instrument gain")
  assert.ok(hasGain(violaValues, 1.68 * 1.5 * 1.15), "viola gain follows measured instrument loudness calibration")
  assert.ok(hasGain(celloValues, 1.68 * 1.5 * 0.73), "cello gain follows measured instrument loudness calibration")
  assert.ok(hasGain(doubleBassValues, 1.68 * 1.5 * 0.296), "double bass gain follows measured instrument loudness calibration")
  assert.ok(hasGain(sogeumValues, 1.68 * 0.52), "sogeum gain follows measured instrument loudness calibration")
  assert.ok(hasGain(daegeumValues, 1.68 * 0.97), "daegeum gain follows measured instrument loudness calibration")
  assert.ok(hasGain(dansoValues, 1.68 * 0.23), "danso gain follows measured instrument loudness calibration")
  assert.ok(hasGain(gayageumValues, 1.68 * 0.522), "gayageum output is trimmed because plucked attack peaks read louder than sustain RMS")
  assert.ok(hasGain(haegeumValues, 1.68 * 0.36), "haegeum gain follows measured instrument loudness calibration")
  assert.equal(sogeumValues.includes(1.68 * 1.5), false, "국악기 선율에는 서양 1.5배 증폭을 적용하지 않는다")
})

test("gayageum note-level gain does not boost plucked sample rows", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 62, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 64, velocity: 0.7 },
    ],
  )

  engine.scheduleSampleMelody(ctx, dest, plan, plan.notes, { melody: { duration: 2.4 }, melodySamples: null }, 0, noop)

  const gainEvents = ctx.created.gains.flatMap((gain) => gain.gain.events)
  assert.equal(ctx.created.buffers.length, 2, "gayageum retriggers each plucked note as a separate sample source")
  assert.equal(ctx.created.gains.length, ctx.created.buffers.length, "gayageum does not add extra note-level gain nodes")
  assert.equal(
    gainEvents.some((event) => event[0] === "set" && Math.abs(event[1] - 1.413) < 1e-9),
    false,
    "가야금 D/E 줄은 원음 보존을 위해 +3dB 줄별 보정을 적용하지 않는다",
  )
})

test("viola F4 uses the measured replacement-sample gain and pitch correction", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "viola", style: "bright", version: "balanced", mode: "melody" },
    [{ time: 0, duration: 0.5, midi: 65, velocity: 0.7 }],
  )

  engine.scheduleSampleMelody(
    ctx,
    dest,
    plan,
    plan.notes,
    { melody: { duration: 2.4 }, melodySamples: null },
    0,
    noop,
  )

  const expectedRate = Math.pow(2, -1 / 12)
  const rateEvents = ctx.created.buffers[0].playbackRate.events
  const gainEvents = ctx.created.gains.flatMap((gain) => gain.gain.events)
  assert.ok(rateEvents.some((event) => event[0] === "set" && Math.abs(event[1] - expectedRate) < 1e-12))
  assert.ok(gainEvents.some((event) => (event[0] === "set" || event[0] === "target") && Math.abs(event[1] - 1.345) < 1e-9))
})

test("audited isolated quiet rows use replacement pitch and measured gain", () => {
  const cases = [
    { id: "flute", midi: 71, cents: -200, gain: 1.306 },
    { id: "violin", midi: 76, cents: -100, gain: 1.323 },
    { id: "viola", midi: 69, cents: -100, gain: 1.295 },
    { id: "viola", midi: 71, cents: -100, gain: 0.747 },
    { id: "viola", midi: 74, cents: -200, gain: 1.236 },
    { id: "cello", midi: 69, cents: -100, gain: 0.765 },
    { id: "sogeum", midi: 69, cents: 191, gain: 1.047 },
    { id: "haegeum", midi: 76, cents: 100, gain: Math.pow(10, 3 / 20) },
  ]

  for (const item of cases) {
    const sandbox = loadEngine()
    const engine = new sandbox.AudioEngine()
    const ctx = makeAudioContext()
    const dest = makeNode()
    const plan = engine.resolvePlan(
      {
        duration: 30,
        atmosphere: "calm",
        instrument: item.id,
        style: ["sogeum", "haegeum"].includes(item.id) ? "gugak" : "bright",
        version: "balanced",
        mode: "melody",
      },
      [{ time: 0, duration: 0.5, midi: item.midi, velocity: 0.7 }],
    )

    engine.scheduleSampleMelody(
      ctx,
      dest,
      plan,
      plan.notes,
      { melody: { duration: 2.4 }, melodySamples: null },
      0,
      noop,
    )

    const expectedRate = Math.pow(2, -item.cents / 1200)
    const rateEvents = ctx.created.buffers[0].playbackRate.events
    const gainEvents = ctx.created.gains.flatMap((gain) => gain.gain.events)
    assert.ok(
      rateEvents.some((event) => event[0] === "set" && Math.abs(event[1] - expectedRate) < 1e-12),
      `${item.id} ${item.midi} replacement pitch`,
    )
    assert.ok(
      gainEvents.some(
        (event) => (event[0] === "set" || event[0] === "target") && Math.abs(event[1] - item.gain) < 1e-9,
      ),
      `${item.id} ${item.midi} replacement gain`,
    )
  }
})

test("note-level melody gain is clamped to roughly +/-3 dB inside each instrument", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 55, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 74, velocity: 0.7 },
    ],
  )

  engine.schedule(ctx, dest, plan, { pad: null, melody: { duration: 2.4 }, effects: [], byInstrument: {} }, 0, noop)

  const noteGainEvents = ctx.created.gains.flatMap((gain) => gain.gain.events)
  const minGain = Math.pow(10, -3 / 20)
  const maxGain = Math.pow(10, 3 / 20)
  assert.ok(noteGainEvents.some((event) => event[0] === "set" && Math.abs(event[1] - 0.708) < 1e-9))
  assert.ok(noteGainEvents.some((event) => event[0] === "target" && Math.abs(event[1] - maxGain) < 1e-9))
  assert.ok(0.708 >= minGain - 0.001)
  assert.ok(maxGain <= Math.pow(10, 3 / 20) + 0.001)
})

test("auto-loop pilot instrument allows wider per-note gain to even out quiet samples", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  // 시(uiMidi 71) = doubleBass_B2 — 남들보다 15dB가량 작게 녹음된 샘플. ±3dB 한도(1.413)로는
  // 크게 조용하게 남으므로 자동 루프 파일럿 악기는 ±12dB까지 측정 보정을 허용한다.
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "doubleBass", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 71, velocity: 0.7 },
    ],
  )

  engine.schedule(ctx, dest, plan, { pad: null, melody: { duration: 2.4 }, effects: [], byInstrument: {} }, 0, noop)

  const noteGainEvents = ctx.created.gains.flatMap((gain) => gain.gain.events)
  const oldCap = Math.pow(10, 3 / 20)
  const wideCap = Math.pow(10, 12 / 20)
  assert.ok(
    noteGainEvents.some((event) => (event[0] === "set" || event[0] === "target") && event[1] > oldCap + 0.01),
    "작게 녹음된 음(시=B2)은 +3dB 한도를 넘어 보정돼야 한다",
  )
  assert.ok(
    noteGainEvents.every((event) => !(event[0] === "set" || event[0] === "target") || event[1] <= wideCap + 0.01 || event[1] < oldCap),
    "그래도 ±12dB 한도는 넘지 않는다",
  )
})

test("seekPlan starts playback from the selected timeline time", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [
      { time: 4, duration: 2, midi: 60, velocity: 0.7 },
      { time: 10, duration: 5, midi: 62, velocity: 0.7 },
      { time: 16, duration: 2, midi: 64, velocity: 0.7 },
    ],
  )

  const seeked = engine.seekPlan(plan, 12)

  assert.equal(seeked.duration, 18)
  assert.equal(seeked.totalDuration, 30)
  assert.equal(seeked.playbackOffset, 12)
  assert.deepEqual(
    plain(seeked.notes.map((note) => ({ time: note.time, duration: note.duration, midi: note.midi }))),
    [
      { time: 0, duration: 3, midi: 62 },
      { time: 4, duration: 2, midi: 64 },
    ],
  )
})

test("seeked background starts at the matching point inside the selected loop range", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const basePlan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      bgOffset: 5,
      bgEndOffset: 9,
    },
    [],
  )
  const plan = engine.seekPlan(basePlan, 10)

  engine.schedule(ctx, dest, plan, { pad: { duration: 60 }, melody: null, effects: [], byInstrument: {} }, 0, noop)

  const padSource = ctx.created.buffers[0]
  assert.equal(padSource.loopStart, 5)
  assert.equal(padSource.loopEnd, 9)
  assert.equal(padSource.startCalls[0][1], 7)
  assert.equal(padSource.stopCalls[0][0], 20.05)
})

test("play accepts a selected start offset and schedules only the remaining duration", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  let scheduledPlan = null

  engine.ensureContext = function () {
    return ctx
  }
  engine.preload = async function () {
    return { pad: null, melody: null, effects: [], byInstrument: {} }
  }
  engine.schedule = function (ctx, dest, plan) {
    scheduledPlan = plan
    return false
  }

  await engine.play(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [],
    { startOffset: 12 },
  )

  assert.equal(scheduledPlan.duration, 18)
  assert.equal(scheduledPlan.playbackOffset, 12)
  engine.stop()
})

test("playback auto-stop records an ended reason for the UI", async () => {
  const sandbox = loadEngine()
  let autoStop = null
  sandbox.setTimeout = function (fn) {
    autoStop = fn
    return 1
  }
  sandbox.clearTimeout = noop
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const states = []

  engine.ensureContext = function () {
    return ctx
  }
  engine.preload = async function () {
    return { pad: null, melody: null, effects: [], byInstrument: {} }
  }
  engine.schedule = function () {
    return false
  }
  engine.onState = function (playing, paused) {
    states.push([playing, paused])
  }

  await engine.play(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody" },
    [],
  )

  assert.equal(typeof autoStop, "function")
  assert.equal(engine.lastStopReason, "stopped")
  autoStop()
  assert.equal(engine.lastStopReason, "ended")
  assert.deepEqual(states.at(-1), [false, false])

  engine.stop()
  assert.equal(engine.lastStopReason, "stopped")
})

test("pause and resume emit transport state so the UI can freeze and continue", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const states = []

  engine.ctx = ctx
  engine.isPlaying = true
  engine.playEndsAtMs = Date.now() + 5000
  engine.stopTimer = setTimeout(noop, 5000)
  engine.onState = function (playing, paused) {
    states.push([playing, paused])
  }

  assert.equal(engine.pause(), true)
  assert.equal(ctx.state, "suspended")
  assert.equal(engine.isPaused, true)
  assert.deepEqual(states.at(-1), [true, true])

  assert.equal(engine.resume(), true)
  assert.equal(ctx.state, "running")
  assert.equal(engine.isPaused, false)
  assert.deepEqual(states.at(-1), [true, false])

  engine.stop()
})

test("stop also silences the drawing ambience loop", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const ambienceSource = makeNode()
  const ambienceGain = makeNode({ gain: makeParam() })

  engine.ctx = ctx
  engine.ambience = {
    signature: "calm|balanced",
    gain: ambienceGain,
    nodes: [ambienceSource],
  }

  engine.stop()

  assert.equal(engine.ambience, null)
  assert.equal(ambienceSource.stopCalls.length, 1, "정지 버튼은 드로잉 배경음 루프도 멈춰야 한다")
  assert.equal(ambienceSource.disconnectCalls?.length || 0, 0)
})

test("pause suspends the context when only drawing ambience is playing", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const states = []

  engine.ctx = ctx
  engine.ambience = {
    signature: "calm|balanced",
    gain: makeNode({ gain: makeParam() }),
    nodes: [makeNode()],
  }
  engine.onState = function (playing, paused) {
    states.push([playing, paused])
  }

  assert.equal(engine.pause(), true)
  assert.equal(ctx.state, "suspended")
  assert.equal(engine.isPaused, true)
  assert.deepEqual(states.at(-1), [false, true])

  assert.equal(engine.resume(), true)
  assert.equal(ctx.state, "running")
  assert.equal(engine.isPaused, false)
  assert.deepEqual(states.at(-1), [false, false])
})

test("stop cancels a play request that is still waiting for preload", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  let resolvePreload
  let scheduled = false

  engine.ctx = ctx
  engine.ensureContext = function () {
    return ctx
  }
  engine.resolvePlan = function () {
    return { duration: 1 }
  }
  engine.preload = function () {
    return new Promise((resolve) => {
      resolvePreload = function () {
        resolve({ pad: null, melody: null, effects: [] })
      }
    })
  }
  engine.schedule = function () {
    scheduled = true
    return false
  }

  const pending = engine.play({ duration: 1 }, [])
  await Promise.resolve()
  engine.stop()
  resolvePreload()
  await pending

  assert.equal(scheduled, false)
  assert.equal(engine.isPlaying, false)
})

test("starting playback does not emit a stopped state before the new playing state", async () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const states = []

  engine.ctx = ctx
  engine.ensureContext = function () {
    return ctx
  }
  engine.resolvePlan = function () {
    return { duration: 1 }
  }
  engine.preload = async function () {
    return { pad: null, melody: null, effects: [] }
  }
  engine.schedule = function () {
    return false
  }
  engine.onState = function (playing, paused) {
    states.push([playing, paused])
  }

  await engine.play({ duration: 1 }, [])

  assert.deepEqual(states, [[true, false]])
  engine.stop()
})

test("오케스트라: strokeInstruments 가 voice별 악기/asset 으로 매핑된다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody", strokeInstruments: ["violin", "cello"] },
    [],
  )
  assert.equal(plan.voiceAssets[0].instrument.id, "violin")
  assert.equal(plan.voiceAssets[1].instrument.id, "cello")
  assert.ok(plan.voiceAssets[1].melodyAsset && plan.voiceAssets[1].melodyAsset.src, "cello asset 존재")
})

test("오케스트라: 두 성부(voice)가 각자 악기로 동시에 스케줄된다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody", strokeInstruments: ["violin", "cello"] },
    [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7, voice: 0 },
      { time: 1, duration: 0.5, midi: 64, velocity: 0.7, voice: 1 },
    ],
  )
  const buffers = {
    pad: null,
    melody: { duration: 2.4 },
    melodySamples: null,
    effects: [],
    byInstrument: {
      violin: { melody: { duration: 2.4 }, melodySamples: null },
      cello: { melody: { duration: 2.4 }, melodySamples: null },
    },
  }
  engine.schedule(ctx, dest, plan, buffers, 0, noop)
  assert.ok(ctx.created.buffers.length >= 2, "성부 2개가 각각 샘플 소스로 스케줄: " + ctx.created.buffers.length)
})

test("배경음악 bgOffset: 패드를 고른 지점부터 시작한다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody", bgOffset: 12 },
    [],
  )
  assert.equal(plan.bgOffset, 12)
  const buffers = { pad: { duration: 60 }, melody: null, melodySamples: null, effects: [], byInstrument: {} }
  engine.schedule(ctx, dest, plan, buffers, 0, noop)
  const padSource = ctx.created.buffers[0]
  assert.ok(padSource, "패드 버퍼 소스 생성됨")
  assert.equal(padSource.startCalls[0][1], 12, "패드가 bgOffset(12초)부터 시작")
})

test("배경음악 bgEndOffset: 선택한 구간만 루프로 사용한다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    {
      duration: 30,
      atmosphere: "calm",
      instrument: "violin",
      style: "bright",
      version: "balanced",
      mode: "melody",
      bgOffset: 5,
      bgEndOffset: 9,
    },
    [],
  )
  assert.equal(plan.bgEndOffset, 9)
  const buffers = { pad: { duration: 60 }, melody: null, melodySamples: null, effects: [], byInstrument: {} }
  engine.schedule(ctx, dest, plan, buffers, 0, noop)
  const padSource = ctx.created.buffers[0]
  assert.equal(padSource.startCalls[0][1], 5)
  assert.equal(padSource.loopStart, 5)
  assert.equal(padSource.loopEnd, 9)
  assert.equal(padSource.loop, true)
})

test("배경음악 bgOffset: 버퍼 길이를 넘으면 클램프된다", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "violin", style: "bright", version: "balanced", mode: "melody", bgOffset: 999 },
    [],
  )
  const buffers = { pad: { duration: 40 }, melody: null, melodySamples: null, effects: [], byInstrument: {} }
  engine.schedule(ctx, dest, plan, buffers, 0, noop)
  const padSource = ctx.created.buffers[0]
  assert.ok(padSource.startCalls[0][1] <= 40, "bgOffset이 버퍼 길이로 클램프됨: " + padSource.startCalls[0][1])
})

test("짧게 그린 획도 라이브처럼 지속음(loop)으로 이어진다 — 한 source + 피치 글라이드", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "haegeum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  // 샘플(2.4s)보다 훨씬 짧은 0.5s 획: 과거 게이트(phrase>sample)에서는 loop 를 걸지 않아
  // 드로잉 중(라이브)과 달리 재생에서 음이 뚝 끊겼다. 이제 라이브와 같은 기준으로 항상 loop 한다.
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, { sampleMode: "phrase", sampleMap: [] })

  engine.scheduleSampleStrokes(
    ctx,
    dest,
    plan,
    [
      {
        start: 0,
        end: 0.5,
        duration: 0.5,
        events: [
          { time: 0, midi: 60, uiMidi: 60 },
          { time: 0.25, midi: 62, uiMidi: 62 },
          { time: 0.5, midi: 64, uiMidi: 64 },
        ],
      },
    ],
    { melody: { duration: 2.4 }, melodySamples: null },
    0,
    noop,
  )

  // 획 하나당 단 하나의 sample source (음마다 재타격하지 않음)
  assert.equal(ctx.created.buffers.length, 1)
  assert.equal(ctx.created.buffers[0].startCalls.length, 1)
  // 핵심: 짧은 획도 이제 loop 로 지속됨 (게이트 통일의 직접 검증)
  assert.equal(ctx.created.buffers[0].loop, true)
  // 음 변화는 새 source 가 아니라 playbackRate 글라이드로 표현됨
  const rateEvents = ctx.created.buffers[0].playbackRate.events
  assert.equal(rateEvents.filter((event) => event[0] === "set").length, 1)
  assert.ok(rateEvents.some((event) => event[0] === "target"), "음 변화는 playbackRate 글라이드여야 한다")
})

test("gayageum stroke playback retriggers pitch changes instead of gliding one decayed pluck", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "gayageum", style: "gugak", version: "balanced", mode: "melody" },
    [],
  )
  plan.melodyAsset = Object.assign({}, plan.melodyAsset, {
    sampleMode: "phrase",
    sampleMap: [
      { midi: 60, offset: 0.1, duration: 0.5, cents: 0 },
      { midi: 62, offset: 0.6, duration: 0.5, cents: 0 },
      { midi: 64, offset: 1.1, duration: 0.5, cents: 0 },
    ],
  })

  engine.scheduleSampleStrokes(
    ctx,
    dest,
    plan,
    [
      {
        start: 0,
        end: 1.2,
        duration: 1.2,
        events: [
          { time: 0, midi: 60, uiMidi: 60 },
          { time: 0.25, midi: 60, uiMidi: 60 },
          { time: 0.5, midi: 62, uiMidi: 62 },
          { time: 1, midi: 64, uiMidi: 64 },
        ],
      },
    ],
    { melody: { duration: 2.4 }, melodySamples: null },
    0,
    noop,
  )

  assert.equal(ctx.created.buffers.length, 3)
  assert.deepEqual(ctx.created.buffers.map((source) => source.startCalls[0][0]), [0, 0.5, 1])
  assert.deepEqual(ctx.created.buffers.map((source) => source.startCalls[0][1]), [0.1, 0.6, 1.1])
  ctx.created.buffers.forEach((source) => {
    assert.equal(source.loop, false)
    assert.equal(source.playbackRate.events.some((event) => event[0] === "target"), false)
  })
})

test("드로잉 미리듣기와 전체 재생이 같은 지속음 헬퍼(continuousSustainPlan)를 쓴다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")
  // 네 군데(획/멀티/단일 phrase 재생 + 라이브 미리듣기)가 모두 공통 헬퍼를 거쳐야 한다.
  const calls = source.match(/continuousSustainPlan\(/g) || []
  assert.ok(calls.length >= 5, "정의 1 + 호출 4 이상이어야 한다 (실제: " + calls.length + ")")
  // 과거의 분기 기준(악구 길이 > 샘플 길이)이 스케줄러에 남아 있으면 안 된다.
  assert.doesNotMatch(source, /needSustain = phraseDuration \* baseRate > usableSourceDur \* 0\.85/)
})

test("preparePlaybackSustain 은 continuousSustainPlan 안에서만 호출된다 (실제 source 이중 buffer 설정 방지)", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")
  // preparePlaybackSustain 은 넘겨받은 객체의 .buffer 를 재할당한다. 실제 source(이미 buffer 설정됨)에
  // 직접 부르면 buffer 이중 설정 → 브라우저 InvalidStateError → 선율/미리듣기 무음.
  // 실제 노드(스케줄러의 src)에 직접 부르면 안 되고, 가짜 probe 객체에만 적용해야 한다.
  // (정의는 (ctx, source) 시그니처이므로 호출형 src 만 검사한다.)
  assert.doesNotMatch(source, /preparePlaybackSustain\(\s*ctx\s*,\s*src\b/, "preparePlaybackSustain 을 실제 src 에 직접 부르면 buffer 이중 설정")
  assert.match(source, /preparePlaybackSustain\(ctx, probe,/, "sustain 계산은 probe 객체로 해야 한다")
  // 스케줄러/미리듣기는 계산된 결과 buffer 를 한 번만 설정한다.
  assert.match(source, /\.buffer = sustain\.buffer\b/, "source.buffer 는 sustain 계획 결과로 한 번만 설정해야 한다")
})
