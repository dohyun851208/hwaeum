const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadSandbox() {
  const sandbox = { console, clearTimeout, setTimeout }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of [
    "music-core.js",
    "manifest.js",
    "sample-maps.js",
    "sample-maps-western.js",
    "audio-plan.js",
    "audio-node-scope.js",
    "audio-pad-graph.js",
    "audio-engine.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), sandbox, { filename: file })
  }
  return sandbox
}

function audioParam(value) {
  return {
    value: value,
    cancelScheduledValues() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    setValueAtTime(next) {
      this.value = next
    },
  }
}

function audioNode(extra) {
  return Object.assign(
    { connect() { return this }, disconnect() {}, addEventListener() {}, removeEventListener() {}, start() {}, stop() {} },
    extra || {},
  )
}

// source.start(when, offset) 호출을 기록하는 컨텍스트
function recordingContext(starts) {
  const SR = 44100
  return {
    sampleRate: SR,
    currentTime: 0,
    destination: audioNode(),
    createGain: () => audioNode({ gain: audioParam(1) }),
    createBiquadFilter: () => audioNode({ Q: audioParam(1), frequency: audioParam(350), gain: audioParam(0) }),
    createBufferSource: () => {
      const src = audioNode({ buffer: null, detune: audioParam(0), playbackRate: audioParam(1) })
      src.start = (when, offset) => starts.push({ when: when, offset: offset, source: src })
      return src
    },
    createBuffer: (channels, length, rate) => {
      const data = new Float32Array(length)
      return {
        duration: length / (rate || SR), length: length, numberOfChannels: channels,
        sampleRate: rate || SR, getChannelData: () => data,
      }
    },
  }
}

function sineBuffer(seconds) {
  const SR = 44100
  const length = Math.round(seconds * SR)
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.4
  return { duration: seconds, length: length, numberOfChannels: 1, sampleRate: SR, getChannelData: () => data }
}

function previewStarts(sandbox, instrumentId, buffer) {
  const starts = []
  const ctx = recordingContext(starts)
  const engine = new sandbox.AudioEngine()
  engine.ensureContext = () => ctx
  const plan = engine.resolvePlan(
    {
      instrument: instrumentId, style: "bright", version: "balanced", mode: "melody",
      atmosphere: "none", duration: 30, strokes: [], path: [], effectIds: [], effectStamps: [],
    },
    [],
  )
  engine._liveUiMidi = () => 62
  const live = engine._createSampleLivePreview(ctx, plan, buffer, 0.5)
  return { live: live, starts: starts }
}

// 필하모니아 원본은 세기 프로필에 따라 음정이 뜨는 시점이 10~360ms 로 제각각이다
// (비올라는 piano 로 골라 와 기본 칸에서 70~230ms). 펜 소리가 파일 어택부터 틀면
// 악기마다 반응 속도가 달라지므로, 지속음 루프가 있으면 안정 구간에서 시작해야 한다.
test("멀티샘플 펜 소리는 어택을 건너뛰고 안정 구간(loopStart)에서 시작한다", () => {
  const sandbox = loadSandbox()
  const { live, starts } = previewStarts(sandbox, "viola", sineBuffer(2))
  assert.ok(live, "미리듣기가 만들어져야 한다")
  assert.equal(starts.length, 1, "소스는 한 번만 시작한다")
  const src = starts[0].source
  assert.ok(src.loop, "지속음 루프가 걸려 있어야 한다")
  assert.ok(
    Math.abs(starts[0].offset - src.loopStart) < 1e-6,
    "시작 지점이 loopStart(" + src.loopStart + ")여야 하는데 " + starts[0].offset,
  )
  assert.ok(starts[0].offset > 0.2, "안정 구간은 파일 앞이 아니라 안쪽이다 (실제 " + starts[0].offset + ")")
})

// 국악 음원은 소금 20ms · 대금 10ms 로 이미 즉각 발음되고 시김새·발음이 학습 내용이다.
// 소금/대금/해금도 sampleMode 가 "multi" 라 멀티샘플 조건만으로는 같이 걸린다 — 걸리면 안 된다.
test("국악기 펜 소리는 원음 그대로 앞에서 시작한다", () => {
  const sandbox = loadSandbox()
  for (const instrumentId of ["sogeum", "daegeum", "haegeum"]) {
    const { live, starts } = previewStarts(sandbox, instrumentId, sineBuffer(2))
    assert.ok(live, instrumentId + " 미리듣기가 만들어져야 한다")
    assert.equal(starts.length, 1)
    assert.equal(starts[0].offset, 0, instrumentId + " 는 어택을 건너뛰면 안 된다 (실제 " + starts[0].offset + ")")
  }
})

test("루프가 없는 짧은 샘플은 그대로 앞에서 시작한다", () => {
  const sandbox = loadSandbox()
  // 0.3초 < 0.45초 → continuousSustainPlan 이 loop: false 로 떨어진다
  const { live, starts } = previewStarts(sandbox, "viola", sineBuffer(0.3))
  assert.ok(live, "미리듣기가 만들어져야 한다")
  assert.equal(starts.length, 1)
  assert.equal(starts[0].offset, 0, "루프가 없으면 기존처럼 파일 앞에서 시작한다")
})
