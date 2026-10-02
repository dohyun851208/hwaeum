const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")
const enginePath = path.join(projectDir, "js", "audio-engine.js")

function loadSandbox() {
  const sandbox = { console, clearTimeout, setTimeout }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of [
    "music-core.js",
    "manifest.js",
    "sample-maps.js",
    "sample-maps-western.js", "sample-calibration.js",
    "audio-plan.js",
    "audio-node-scope.js",
    "audio-pad-graph.js",
    "audio-engine.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), sandbox, { filename: file })
  }
  return sandbox
}

// 게인 표는 measure:loudness 로 다시 생성되므로 값을 테스트에 박지 않고 소스에서 읽는다.
function noteGainTable(instrumentId) {
  const source = fs.readFileSync(enginePath, "utf8")
  const block = source.slice(source.indexOf("NOTE_MELODY_OUTPUT_GAINS = {"))
  const body = block.slice(0, block.indexOf("\n  }"))
  const row = body.match(new RegExp(instrumentId + ":\\s*\\{([^}]*)\\}"))
  assert.ok(row, instrumentId + " 음별 게인 표가 있어야 한다")
  const out = {}
  row[1].replace(/(\d+):\s*([\d.]+)/g, (m, midi, gain) => {
    out[Number(midi)] = Number(gain)
  })
  return out
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

function fakeContext() {
  const SR = 44100
  return {
    sampleRate: SR,
    currentTime: 0,
    destination: audioNode(),
    createGain: () => audioNode({ gain: audioParam(1) }),
    createBiquadFilter: () => audioNode({ Q: audioParam(1), frequency: audioParam(350), gain: audioParam(0) }),
    createBufferSource: () => audioNode({ buffer: null, detune: audioParam(0), playbackRate: audioParam(1) }),
    createBuffer: (channels, length, rate) => {
      const data = new Float32Array(length)
      return {
        duration: length / (rate || SR), length: length, numberOfChannels: channels,
        sampleRate: rate || SR, getChannelData: () => data,
      }
    },
  }
}

function sampleBuffer() {
  const data = new Float32Array(44100 * 2)
  return { duration: 2, length: data.length, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => data }
}

const DRAWABLE_ROWS = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]

function livePreviewFor(sandbox, instrumentId, uiMidi, versionId) {
  const ctx = fakeContext()
  const engine = new sandbox.AudioEngine()
  engine.ensureContext = () => ctx
  const plan = engine.resolvePlan(
    {
      instrument: instrumentId, style: "bright", version: versionId || "balanced", mode: "melody",
      atmosphere: "none", duration: 30, strokes: [], path: [], effectIds: [], effectStamps: [],
    },
    [],
  )
  engine._liveUiMidi = () => uiMidi
  return engine._createSampleLivePreview(ctx, plan, sampleBuffer(), 0.5)
}

// 비올라는 원본을 piano(여리게)로 골라 와 기준 게인이 가장 높다 → 천장에 닿는다.
// 예전에는 음별 보정에 같은 천장을 다시 걸어 보정이 통째로 1.0 이 됐고,
// 여리게 녹음된 음이 펜 소리에서 묻혔다.
test("기준 게인이 천장에 닿는 악기도 음별 보정을 잃지 않는다", () => {
  const sandbox = loadSandbox()
  const table = noteGainTable("viola")

  let boosted = 0
  for (const uiMidi of DRAWABLE_ROWS) {
    const live = livePreviewFor(sandbox, "viola", uiMidi)
    assert.ok(live, "midi " + uiMidi + " 미리듣기가 만들어져야 한다")
    const expected = table[uiMidi]
    assert.ok(expected, "midi " + uiMidi + " 보정값이 표에 있어야 한다")
    assert.ok(
      Math.abs(live.noteGain.gain.value - expected) < 0.01,
      "midi " + uiMidi + " 보정 " + expected + " 이 적용돼야 하는데 " + live.noteGain.gain.value,
    )
    if (expected > 1.05) boosted += 1
  }
  assert.ok(boosted >= 5, "비올라는 보정을 키워야 하는 칸이 여럿이다 (실제 " + boosted + ")")
})

test("가장 큰 음별 보정도 잘리지 않는다 — 가장 센 버전에서도", () => {
  const sandbox = loadSandbox()
  for (const instrumentId of ["viola", "frenchHorn", "cello", "flute"]) {
    const table = noteGainTable(instrumentId)
    const loudestRow = DRAWABLE_ROWS.reduce((best, m) => ((table[m] || 0) > (table[best] || 0) ? m : best), DRAWABLE_ROWS[0])
    // "그림소리 강조"가 melodyGain 이 가장 크다 — 천장에 가장 쉽게 걸리는 조건.
    const live = livePreviewFor(sandbox, instrumentId, loudestRow, "drawing")
    assert.ok(live, instrumentId + " 미리듣기가 만들어져야 한다")
    assert.ok(
      Math.abs(live.noteGain.gain.value - table[loudestRow]) < 0.01,
      instrumentId + " midi " + loudestRow + " 보정 " + table[loudestRow] + " → " + live.noteGain.gain.value,
    )
  }
})

test("그래도 상한은 남아 있다 (무한정 커지지 않음)", () => {
  const source = fs.readFileSync(enginePath, "utf8")
  const ceiling = Number((source.match(/LIVE_PREVIEW_NOTE_MAX_GAIN\s*=\s*([\d.]+)/) || [])[1])
  assert.ok(ceiling > 0, "음별 상한 상수가 있어야 한다")
  const sandbox = loadSandbox()
  for (const instrumentId of ["viola", "frenchHorn", "doubleBass"]) {
    for (const uiMidi of DRAWABLE_ROWS) {
      const live = livePreviewFor(sandbox, instrumentId, uiMidi, "drawing")
      if (!live) continue
      const finalGain = live.baseTargetGain * live.noteGain.gain.value
      assert.ok(finalGain <= ceiling + 1e-6, instrumentId + " midi " + uiMidi + " 최종 게인 " + finalGain + " 이 상한을 넘었다")
    }
  }
})
