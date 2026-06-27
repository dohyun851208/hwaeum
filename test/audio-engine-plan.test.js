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
  for (const file of ["manifest.js", "sample-maps.js", "sample-maps-western.js", "audio-engine.js"]) {
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
  const created = { oscillators: [], buffers: [], gains: [], filters: [] }
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

test("scheduleSampleMelody sustains contiguous notes as one connected sample phrase", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const ctx = makeAudioContext()
  const dest = makeNode()
  const plan = engine.resolvePlan(
    { duration: 30, atmosphere: "calm", instrument: "daegeum", style: "gugak", version: "balanced", mode: "melody" },
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

test("multi-sample melody schedules each note with its own instrument sample buffer", () => {
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

test("서양 악기 선율만 1.5배로 키우고 국악기 선율은 기존 크기를 유지한다", () => {
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

  const westernValues = gainSetValuesFor("violin")
  const gugakValues = gainSetValuesFor("sogeum")

  assert.ok(westernValues.includes(1.68 * 1.5), "서양 악기 선율 gain 이 1.5배여야 한다")
  assert.ok(gugakValues.includes(1.68), "국악기 선율 gain 은 기존 값을 써야 한다")
  assert.equal(gugakValues.includes(1.68 * 1.5), false, "국악기 선율에는 1.5배 증폭을 적용하지 않는다")
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


