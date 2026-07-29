const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function loadEngine() {
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
  return sandbox.AudioEngine
}

// 펜을 내리고 그대로 움직이는 상황. 샘플은 아직 디코드 전이라 loadBuffer가 늦게 끝난다.
function drawingHarness() {
  const AudioEngine = loadEngine()
  const engine = new AudioEngine()
  const context = { currentTime: 10, state: "running" }
  const asset = { src: "sound/viola_D4.mp3", baseMidi: 62, waveform: "sine" }
  const plan = { instrument: { id: "viola", group: "서양", waveform: "sine" }, melodyAsset: asset }
  const pending = deferred()
  const created = []

  engine.ensureContext = () => context
  engine.resolvePlan = () => plan
  engine._liveUiMidi = () => 62
  engine._liveMidi = () => 62
  engine._liveSignature = () => "viola|서양"
  engine._createLivePreview = (ctx, resolvedPlan, normY) => {
    const live = { kind: "sample", signature: "viola|서양", normY: normY, noteGain: null, env: { gain: {} } }
    created.push(live)
    return live
  }
  engine.loadBuffer = function (ctx, src) {
    if (!this.bufferCache.has(src)) this.bufferCache.set(src, pending.promise)
    return this.bufferCache.get(src)
  }

  return { engine, plan, pending, created }
}

test("로딩 중 펜이 움직여도 첫 음이 취소되지 않는다", async () => {
  const { engine, pending, created } = drawingHarness()

  engine.liveDrawingStart({}, 0.5)
  assert.equal(engine.livePreview, null, "아직 로딩 중이라 미리듣기는 없다")
  assert.ok(engine.livePending, "진행 중인 로딩이 기록돼야 한다")

  // pointermove 가 연달아 들어온다 — 예전에는 매번 liveDrawingStart 를 다시 불러
  // 토큰을 올렸고, 그 바람에 진행 중이던 로딩이 폐기돼 소리가 영영 안 났다.
  const tokenBefore = engine.livePreviewToken
  for (let i = 0; i < 12; i++) engine.liveDrawingMove({}, 0.5)
  assert.equal(engine.livePreviewToken, tokenBefore, "이동만으로 진행 중인 로딩을 무효화하면 안 된다")

  pending.resolve({ duration: 1.5 })
  await pending.promise
  await Promise.resolve()

  assert.equal(created.length, 1, "로딩이 끝나면 미리듣기가 정확히 한 번 만들어진다")
  assert.ok(engine.livePreview, "펜을 움직이는 중에도 소리가 나야 한다")
  assert.equal(engine.livePending, null, "착지한 뒤엔 진행 기록이 지워진다")
})

test("불러오는 사이 펜이 옮겨간 음높이로 시작한다", async () => {
  const { engine, pending, created } = drawingHarness()

  engine.liveDrawingStart({}, 0.5)
  engine.liveDrawingMove({}, 0.42)
  engine.liveDrawingMove({}, 0.31) // 펜이 계속 올라갔다

  pending.resolve({ duration: 1.5 })
  await pending.promise
  await Promise.resolve()

  assert.equal(created.length, 1)
  assert.equal(created[0].normY, 0.31, "펜을 내린 위치가 아니라 착지 시점의 위치로 시작해야 한다")
})

test("정지하면 진행 중인 로딩 기록도 지운다", () => {
  const { engine } = drawingHarness()

  engine.liveDrawingStart({}, 0.5)
  assert.ok(engine.livePending)

  engine.liveDrawingEnd()
  assert.equal(engine.livePending, null, "획이 끝나면 진행 기록이 남아 있으면 안 된다")
})
