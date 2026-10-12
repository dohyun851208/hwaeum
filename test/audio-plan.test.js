const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const AudioPlan = require("../js/audio-plan.js")
const MusicCore = require("../js/music-core.js")

const projectDir = path.resolve(__dirname, "..")

test("그린 획의 짧은 왕복은 무시하되 새 음의 체류와 명시한 음표의 리듬을 구분한다", () => {
  const events = [{ time: 0, midi: 55 }]
  for (let i = 1; i < 40; i++) events.push({ time: i * .05, midi: i % 2 ? 57 : 55 })
  assert.equal(AudioPlan.sampleVoiceRuns(events, 2, .07).length, 1)
  events.push({ time: 2, midi: 60 })
  const runs = AudioPlan.sampleVoiceRuns(events, 3, .07)
  assert.equal(runs.length, 2)
  assert.equal(runs[1].time, 2.07)
  assert.equal(runs[0].end, 2.07)
  assert.equal(AudioPlan.sampleVoiceRuns(events, 3).length, 41, "명시적으로 만든 음표는 짧아도 지우지 않는다")
})

test("해금의 빠른 재전환과 탐색 위치는 지수 미끄러짐의 값과 적분을 따른다", () => {
  const motions = AudioPlan.samplePitchMotion([{ time: 0, midi: 69 }, { time: 1, midi: 81 }, { time: 1.1, midi: 69 }], .12)
  assert.equal(motions[0].from, 440)
  assert.equal(motions[1].from, 440)
  assert.ok(Math.abs(motions[2].from - (880 - 440 * Math.exp(-.1/.12))) < 1e-9)
  assert.ok(Math.abs(AudioPlan.samplePitchTravel(motions, 0, 0, .2, 1/440, 48000, 0) - .2) < 1e-9)
  assert.ok(Math.abs(AudioPlan.pitchMotionValue(motions[2], 3) - 440) < .001)
})

test("비올라 두 원음의 기존 조율 후보값에는 검토 표시가 있고 차용 cents는 보존한다", () => {
  const data = loadData(), asset = data.melodies.viola
  for (const midi of [55,77]) {
    const segment = asset.sampleMap.find(s=>s.midi===midi)
    assert.ok(Number.isFinite(segment.tuningCents))
    assert.equal(data.sampleCalibration.viola.sources[segment.src].reviewRequired, true)
  }
  assert.ok(asset.sampleMap.some(s=>s.tuningCents!=null), "확실한 다른 원음의 조율까지 끄지 않는다")
  const borrowed = asset.sampleMap.find(s=>s.midi===65)
  assert.equal(borrowed.cents, 100)
})

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadData() {
  const sandbox = {}
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of ["manifest.js", "sample-maps.js", "sample-maps-western.js", "sample-calibration.js"]) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), sandbox, { filename: file })
  }
  return sandbox.SDStudioData
}

test("레시피 좌표는 다섯 자리로 줄여도 모든 음높이 경계의 양쪽 칸을 유지한다", () => {
  const data = loadData()
  for (const id of ["violin", "danso"]) {
    const options = {duration:300,style:data.styles.find(s => s.id === (id === "danso" ? "gugak" : "bright")),
      instrument:data.instruments.find(i => i.id === id),melodyAsset:data.melodies[id],core:MusicCore}
    const pitch = p => MusicCore.quantizePitch(p.y, options.style, options.melodyAsset)
    for (let row = 1; row < 15; row++) {
      const points = [-1,1].map((sign,i) => ({x:.123456789+i*.1,y:1-row/15+sign*1e-7}))
      const compact = AudioPlan.compactStrokePoints(points, options)
      assert.deepEqual(compact.map(pitch), points.map(pitch))
      assert.ok(compact.every((p,i) => Math.abs(p.x-points[i].x)*300 <= .0015+1e-9))
    }
  }
})

test("5분 레시피의 70ms 경계와 가까운 점 병합은 반올림으로 발음이 바뀌지 않는다", () => {
  const data=loadData(), options={duration:300,style:data.styles.find(s=>s.id==="bright"),
    instrument:data.instruments.find(i=>i.id==="violin"),melodyAsset:data.melodies.violin,core:MusicCore}
  const voices = points => AudioPlan.strokeSegmentsForPlan({strokes:[points]},300,options.style,options.instrument,options.melodyAsset,null,MusicCore)
    .map(s=>AudioPlan.sampleVoiceRuns(s.events,s.end,.07).map(r=>r.midi))
  let avoidedChanges=0
  for(const stay of [.0009,.0011,.069,.0699,.07,.0701,.071,.2]) for(const at of [10.0005,10.0015,10.003]) {
    const points=[{x:0,y:.96},{x:at/300,y:.9},{x:(at+stay)/300,y:.96},{x:1,y:.96}]
    const naive=points.map(p=>({x:Math.round(p.x*1e5)/1e5,y:p.y}))
    if(JSON.stringify(voices(naive))!==JSON.stringify(voices(points)))avoidedChanges++
    assert.deepEqual(voices(AudioPlan.compactStrokePoints(points,options)),voices(points))
  }
  assert.ok(avoidedChanges>0,"단순 5자리 반올림은 실제로 70ms 경계에서 발음을 바꾼다")
})

test("좌표 압축은 일반 획의 링크를 줄이고 레시피 코덱 왕복을 유지한다", () => {
  const data=loadData(), options={duration:300,style:data.styles.find(s=>s.id==="bright"),
    instrument:data.instruments.find(i=>i.id==="violin"),melodyAsset:data.melodies.violin,core:MusicCore}
  const points=Array.from({length:150},(_,i)=>({x:i/149,y:.51+Math.sin(i*.07)*.025}))
  const compact=AudioPlan.compactStrokePoints(points,options)
  const recipe={duration:300,strokes:[compact]}
  assert.ok(MusicCore.encodeRecipe(recipe).length < MusicCore.encodeRecipe({duration:300,strokes:[points]}).length*.75)
  assert.deepEqual(MusicCore.decodeRecipe(MusicCore.encodeRecipe(recipe)),recipe)
})

test("audio-plan supports both CommonJS and the classic browser global", () => {
  assert.equal(typeof AudioPlan.resolvePlan, "function")
  assert.equal(typeof AudioPlan.nearestSampleSegment, "function")
  assert.equal(typeof AudioPlan.normalizeSoundLayers, "function")

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
    effectStamps: [{ id: "wind1", time: 9 }, { id: "rain1", time: 2 }],
    soundLayers: [
      { id: "long", time: 2, sourceOffset: 10, duration: 6, gain: 0.6 },
      { id: "later", time: 9, sourceOffset: 3, duration: 1, gain: 0.4 },
    ],
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
  // 탐색 지점 전에 찍힌 도장도 남겨, 지나간 3초만큼 건너뛰고 이어서 낸다(소리가 끝났는지는 엔진이 버퍼로 판단).
  assert.deepEqual(plain(shifted.effectStamps), [{ id: "wind1", time: 4 }, { id: "rain1", time: 0, sourceOffset: 3 }])
  assert.deepEqual(plain(shifted.soundLayers), [
    { id: "long", time: 0, sourceOffset: 13, duration: 3, gain: 0.6 },
    { id: "later", time: 4, sourceOffset: 3, duration: 1, gain: 0.4 },
  ])
})

test("uploaded sound layers keep source trimming separate from project placement", () => {
  const file = { name: "class-song.mp3" }
  const layers = AudioPlan.normalizeSoundLayers(
    [
      {
        id: "student-1",
        name: "긴 음악",
        src: "blob:student-1",
        file,
        sourceDuration: 95,
        trimStart: 61.5,
        trimEnd: 74,
        startTime: 8,
        volume: 0.72,
      },
      { id: "outside", src: "blob:outside", sourceDuration: 20, trimStart: 0, trimEnd: 5, startTime: 30 },
    ],
    20,
  )

  assert.equal(layers.length, 1)
  assert.equal(layers[0].time, 8)
  assert.equal(layers[0].sourceOffset, 61.5)
  assert.equal(layers[0].duration, 12, "작품 끝에서만 잘리고 원본 선택 구간은 바뀌지 않는다")
  assert.equal(layers[0].gain, 0.72)
  assert.equal(layers[0].asset.file, file)
})

test("resolvePlan leaves stamps hidden past the range end silent instead of pulling them to the end", () => {
  const data = loadData()
  const recipe = {
    atmosphere: "calm",
    instrument: "violin",
    style: "bright",
    version: "balanced",
    duration: 10,
    mode: "melody",
    effectStamps: [{ id: "rain1", x: 0.5, y: 0.5 }, { id: "wind1", x: 1.6, y: 0.5 }],
    strokes: [[{ x: 0, y: 0.5 }, { x: 0.25, y: 0.4 }]],
  }
  const plan = AudioPlan.resolvePlan(recipe, [], { core: MusicCore, data })
  assert.deepEqual(plain(plan.effectStamps), [{ id: "rain1", x: 0.5, y: 0.5, time: 5 }])
})

test("sigimsae follows the instrument of each stroke, not the instrument picked last", () => {
  const data = loadData()
  const recipe = {
    atmosphere: "calm",
    instrument: "daegeum",
    strokeInstruments: ["violin", "daegeum"],
    style: "gugak",
    version: "balanced",
    duration: 10,
    mode: "melody",
    strokes: [[{ x: 0, y: 0.5 }, { x: 0.3, y: 0.4 }], [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.4 }]],
  }
  const plan = AudioPlan.resolvePlan(recipe, [], { core: MusicCore, data })
  assert.equal(plan.voiceAssets[0].gugak, false, "바이올린 줄에는 시김새를 붙이지 않는다")
  assert.equal(plan.voiceAssets[1].gugak, true)
})
