const { scriptFiles } = require("../tools/runtime-scripts.cjs")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

// 그림과 소리를 맞추려고 플레이헤드를 늦추는 보정의 안전 속성을 지킨다.
// 핵심 규칙: 보정이 실제 지연보다 커지면 플레이헤드가 소리보다 뒤처져
// "소리가 그린 선보다 먼저" 나게 된다 — 절대 허용하지 않는 방향이다.

const SCHEDULE_LEAD_MS = 50 // PLAYBACK_SCHEDULE_LEAD_SECONDS 와 짝
const MAX_TRUSTED_LATENCY_MS = 300 // MAX_TRUSTED_OUTPUT_LATENCY_SECONDS 와 짝

function loadEngine() {
  const sandbox = { console, clearTimeout, setTimeout }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of scriptFiles({ from: "music-core.js", through: "audio-engine.js" })) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInContext(code, sandbox, { filename: file })
  }
  return sandbox.AudioEngine
}

function engineWithContext(context) {
  const AudioEngine = loadEngine()
  const engine = new AudioEngine()
  engine.ctx = context
  return engine
}

test("보정값은 결코 실제 지연보다 크지 않다 (소리가 선보다 먼저 나면 안 됨)", () => {
  const cases = [
    { outputLatency: 0, baseLatency: 0 },
    { outputLatency: 0.01, baseLatency: 0.005 },
    { outputLatency: 0.12, baseLatency: 0.01 },
    { outputLatency: 0.25, baseLatency: 0.02 },
  ]
  for (const ctx of cases) {
    const engine = engineWithContext(ctx)
    const trueLeadMs = SCHEDULE_LEAD_MS + ctx.outputLatency * 1000
    const lead = engine.audioLeadMs(true)
    assert.ok(lead <= trueLeadMs + 1e-6, `과보정 금지: ${lead}ms > 실제 ${trueLeadMs}ms`)
    assert.ok(lead >= 0, "보정값은 음수가 될 수 없다")
  }
})

test("출력 지연을 못 읽어도 확실히 아는 예약 리드는 회수한다", () => {
  const engine = engineWithContext({ outputLatency: 0, baseLatency: 0 })
  const lead = engine.audioLeadMs(true)
  assert.ok(lead > 0, "50ms 예약 리드는 오차가 없으므로 반드시 보정해야 한다")
  assert.ok(lead <= SCHEDULE_LEAD_MS + 1e-6, "지연 정보가 없으면 예약 리드를 넘을 수 없다")
})

test("이어재생은 예약 리드 없이 하드웨어 지연만 보정한다", () => {
  const ctx = { outputLatency: 0.1, baseLatency: 0.01 }
  const engine = engineWithContext(ctx)
  const resumeLead = engine.audioLeadMs(false)
  const playLead = engine.audioLeadMs(true)
  assert.ok(resumeLead < playLead, "이어재생 리드는 새 재생보다 작아야 한다")
  assert.ok(resumeLead <= ctx.outputLatency * 1000 + 1e-6, "이어재생은 하드웨어 지연을 넘을 수 없다")
})

test("터무니없이 큰 출력 지연 보고는 잘라 쓴다", () => {
  const engine = engineWithContext({ outputLatency: 5, baseLatency: 0.01 })
  assert.equal(engine.outputLatencySeconds(), MAX_TRUSTED_LATENCY_MS / 1000)
  assert.ok(engine.audioLeadMs(true) <= SCHEDULE_LEAD_MS + MAX_TRUSTED_LATENCY_MS + 1e-6)
})

test("outputLatency 가 없으면 더 작은 baseLatency 로 대체한다 (과소 보정 쪽)", () => {
  const engine = engineWithContext({ baseLatency: 0.02 })
  assert.equal(engine.outputLatencySeconds(), 0.02)
})

test("AudioContext 가 아직 없으면 지연은 0", () => {
  const AudioEngine = loadEngine()
  const engine = new AudioEngine()
  assert.equal(engine.outputLatencySeconds(), 0)
  assert.equal(engine.audioLeadMs(true) >= 0, true)
})

test("플레이헤드는 엔진이 알려준 리드만큼 출발을 늦춘다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-transport.js"), "utf8")
  assert.match(source, /playheadStartedAt = nowMs\(\) - playheadElapsedMs \+ audioLeadMs\(\)/)
})

test("정지하면 리드 값이 남지 않는다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")
  const stopAt = source.indexOf("AudioEngine.prototype.stop = function")
  assert.notEqual(stopAt, -1)
  const stopBody = source.slice(stopAt, stopAt + 1200)
  assert.match(stopBody, /this\.playbackLeadMs = 0/)
})
