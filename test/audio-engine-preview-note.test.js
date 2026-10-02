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
    "sample-maps-western.js", "sample-calibration.js",
    "audio-plan.js",
    "audio-node-scope.js",
    "audio-pad-graph.js",
    "audio-engine.js",
  ]) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInContext(code, sandbox, { filename: file })
  }
  return sandbox.AudioEngine
}

function previewHarness() {
  const AudioEngine = loadEngine()
  const engine = new AudioEngine()
  const context = { currentTime: 10, state: "running" }
  const asset = { src: "sound/test-note.mp3", baseMidi: 60, waveform: "sine" }
  const plan = {
    instrument: { id: "test", group: "서양", waveform: "sine" },
    melodyAsset: asset,
  }
  const pending = deferred()
  const calls = { loadStarts: 0, samples: [], synths: [] }

  engine.ensureContext = () => context
  engine.resolvePlan = () => plan
  engine._liveUiMidi = () => 60
  engine._previewSynth = (ctx, resolvedPlan, note, start) => calls.synths.push({ ctx, resolvedPlan, note, start })
  engine._previewSample = (ctx, resolvedPlan, buffer, note, start) => calls.samples.push({ ctx, resolvedPlan, buffer, note, start })
  engine.loadBuffer = function (ctx, src) {
    if (!this.bufferCache.has(src)) {
      calls.loadStarts += 1
      const loading = pending.promise.then((buffer) => {
        this.decodedCache.set(src, buffer)
        return buffer
      })
      this.bufferCache.set(src, loading)
    }
    return this.bufferCache.get(src)
  }

  return { asset, calls, context, engine, pending, plan }
}

test("rapid note previews play one immediate fallback per click and never burst after decoding", async () => {
  const { calls, engine, pending } = previewHarness()

  await Promise.all([engine.previewNote({}, 0.5), engine.previewNote({}, 0.5), engine.previewNote({}, 0.5)])

  assert.equal(calls.loadStarts, 1)
  assert.equal(calls.synths.length, 3)
  assert.equal(calls.samples.length, 0)

  pending.resolve({ duration: 1 })
  await pending.promise
  await Promise.resolve()

  assert.equal(calls.samples.length, 0, "a completed warm-up must not replay old clicks")
})

test("a decoded note preview uses the ready sample exactly once without a synth fallback", async () => {
  const { asset, calls, engine } = previewHarness()
  const readyBuffer = { duration: 1 }
  engine.decodedCache.set(asset.src, readyBuffer)

  await engine.previewNote({}, 0.5)

  assert.equal(calls.loadStarts, 0)
  assert.equal(calls.synths.length, 0)
  assert.equal(calls.samples.length, 1)
  assert.equal(calls.samples[0].buffer, readyBuffer)
})

test("stop cancels a note preview that is still waiting for a suspended context", async () => {
  const { calls, context, engine } = previewHarness()
  const resumed = deferred()
  context.state = "suspended"
  context.resume = function () {
    return resumed.promise.then(function () {
      context.state = "running"
    })
  }

  const preview = engine.previewNote({}, 0.5)
  engine.stop()
  resumed.resolve()
  await preview

  assert.equal(calls.loadStarts, 0)
  assert.equal(calls.synths.length, 0)
  assert.equal(calls.samples.length, 0)
})

test("rapid suspended note previews remain independent until an explicit stop", async () => {
  const { calls, context, engine } = previewHarness()
  const resumed = deferred()
  context.state = "suspended"
  context.resume = function () {
    return resumed.promise.then(function () {
      context.state = "running"
    })
  }

  const previews = [engine.previewNote({}, 0.5), engine.previewNote({}, 0.5), engine.previewNote({}, 0.5)]
  resumed.resolve()
  await Promise.all(previews)

  assert.equal(calls.loadStarts, 1)
  assert.equal(calls.synths.length, 3)
  assert.equal(calls.samples.length, 0)
})

test("stop prevents a loaded effect preview from starting after its fallback was cleared", async () => {
  const AudioEngine = loadEngine()
  const engine = new AudioEngine()
  const context = { currentTime: 4, state: "running" }
  const pending = deferred()
  const calls = { fallback: 0, sample: 0 }

  engine.ensureContext = () => context
  engine._previewEffectFallback = () => {
    calls.fallback += 1
  }
  engine._playEffectBufferPreview = () => {
    calls.sample += 1
  }
  engine.loadAssetBuffer = () => pending.promise

  const preview = engine.previewEffect({ id: "rainSoft", src: "sound/test-effect.mp3" })
  assert.equal(calls.fallback, 1)

  engine.stop()
  pending.resolve({ duration: 1 })
  assert.equal(await preview, true)

  assert.equal(calls.sample, 0)
})
