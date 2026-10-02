const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const MusicCore = require("../js/music-core.js")

const projectDir = path.resolve(__dirname, "..")

function makeParam() {
  return {
    events: [],
    setValueAtTime(value, time) {
      this.events.push(["set", value, time])
    },
    linearRampToValueAtTime(value, time) {
      this.events.push(["linear", value, time])
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
      connections: [],
      disconnectCalls: 0,
      startCalls: [],
      stopCalls: [],
      onended: null,
      connect(target) {
        this.connections.push(target)
      },
      disconnect() {
        this.disconnectCalls += 1
      },
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

function makeContext() {
  return {
    currentTime: 1,
    state: "running",
    destination: makeNode(),
    createGain() {
      return makeNode({ gain: makeParam() })
    },
    createOscillator() {
      return makeNode({ type: "sine", frequency: makeParam(), detune: makeParam() })
    },
    createBiquadFilter() {
      return makeNode({ type: "lowpass", frequency: makeParam(), Q: makeParam() })
    },
    resume() {
      this.state = "running"
      return Promise.resolve()
    },
  }
}

function loadEngine(padGraphOverride) {
  const sandbox = { MusicCore, console, clearTimeout, setTimeout }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const file of [
    "manifest.js",
    "sample-maps.js",
    "sample-maps-western.js", "sample-calibration.js",
    "audio-plan.js",
    "audio-node-scope.js",
    "audio-pad-graph.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(projectDir, "js", file), "utf8"), sandbox, { filename: file })
  }
  if (padGraphOverride) sandbox.SDAudioPadGraph = padGraphOverride
  vm.runInContext(fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8"), sandbox, {
    filename: "audio-engine.js",
  })
  return sandbox
}

function padPlan() {
  return {
    duration: 8,
    style: { root: 60, intervals: [0, 2, 4, 5, 7] },
    atmosphere: { id: "calm" },
    padAsset: { fallbackWave: "sine" },
    version: { padGain: 0.3 },
  }
}

test("full playback and ambience share the pad graph while keeping different lifecycle policies", () => {
  const calls = []
  const padGraph = {
    createSynthPadGraph(ctx, destination, plan, when) {
      const gain = makeNode({ gain: makeParam() })
      gain.connect(destination)
      const sources = [makeNode(), makeNode(), makeNode()]
      const cleanupNodes = [makeNode(), makeNode(), makeNode()]
      const graph = { gain, sources, cleanupNodes }
      calls.push({ ctx, destination, plan, when, graph })
      return graph
    },
  }
  const sandbox = loadEngine(padGraph)
  const engine = new sandbox.AudioEngine()
  const ctx = makeContext()
  const destination = makeNode()
  const registered = []
  const plan = padPlan()

  engine.scheduleSynthPad(ctx, destination, plan, 2, (source, cleanupNodes) => {
    registered.push({ source, cleanupNodes })
  })
  engine._startAmbienceSynth(ctx, plan, "calm|balanced")

  assert.equal(calls.length, 2)
  const scheduled = calls[0].graph
  const ambience = calls[1].graph
  assert.deepEqual(scheduled.sources.map((source) => source.startCalls), [[[2]], [[2]], [[2]]])
  assert.deepEqual(scheduled.sources.map((source) => source.stopCalls), [[[10.2]], [[10.2]], [[10.2]]])
  assert.equal(registered.length, 3)
  registered.forEach((item, index) => {
    assert.equal(item.cleanupNodes.length, 1)
    assert.equal(item.cleanupNodes[0], scheduled.cleanupNodes[index])
  })
  assert.ok(scheduled.gain.gain.events.length > 0, "full playback owns its finite envelope")

  assert.deepEqual(ambience.sources.map((source) => source.startCalls), [[[1.02]], [[1.02]], [[1.02]]])
  assert.deepEqual(ambience.sources.map((source) => source.stopCalls), [[], [], []])
  assert.ok(ambience.gain.gain.events.length > 0, "ambience owns its open-ended fade-in")
  assert.equal(engine.ambience.gain, ambience.gain)
})

test("ambience immediate and graceful stops keep their existing timing and cleanup policies", () => {
  const calls = []
  const padGraph = {
    createSynthPadGraph(ctx, destination) {
      const gain = makeNode({ gain: makeParam() })
      gain.connect(destination)
      const graph = {
        gain,
        sources: [makeNode(), makeNode(), makeNode()],
        cleanupNodes: [makeNode(), makeNode(), makeNode()],
      }
      calls.push(graph)
      return graph
    },
  }
  const sandbox = loadEngine(padGraph)
  const engine = new sandbox.AudioEngine()
  const ctx = makeContext()
  engine.ctx = ctx

  engine._startAmbienceSynth(ctx, padPlan(), "calm|balanced")
  const immediate = calls[0]
  engine.stopAmbience(true)

  assert.deepEqual(immediate.sources.map((source) => source.stopCalls), [[[1]], [[1]], [[1]]])
  assert.deepEqual(immediate.sources.map((source) => source.disconnectCalls), [1, 1, 1])
  assert.deepEqual(immediate.cleanupNodes.map((node) => node.disconnectCalls), [1, 1, 1])
  assert.equal(immediate.gain.disconnectCalls, 1)
  assert.deepEqual(immediate.gain.gain.events.slice(-2), [
    ["cancel", 1],
    ["target", 0.0001, 1, 0.01],
  ])

  ctx.currentTime = 4
  engine._startAmbienceSynth(ctx, padPlan(), "calm|balanced")
  const graceful = calls[1]
  engine.stopAmbience(false)

  assert.deepEqual(graceful.sources.map((source) => source.stopCalls), [[[4.5]], [[4.5]], [[4.5]]])
  assert.deepEqual(graceful.sources.map((source) => source.disconnectCalls), [0, 0, 0])
  assert.deepEqual(graceful.cleanupNodes.map((node) => node.disconnectCalls), [0, 0, 0])
  assert.equal(graceful.gain.disconnectCalls, 0)
  assert.deepEqual(graceful.gain.gain.events.slice(-2), [
    ["cancel", 4],
    ["target", 0.0001, 4, 0.2],
  ])
})

test("AudioEngine keeps transport and preview node scopes separate and stop clears both once", () => {
  const sandbox = loadEngine()
  const engine = new sandbox.AudioEngine()
  const transportSource = makeNode()
  const transportGain = makeNode()
  const previewSource = makeNode()
  const previewGain = makeNode()
  engine.ctx = makeContext()

  assert.notEqual(engine.transportScope, engine.previewScope)
  engine.transportScope.track(transportSource, transportGain)
  engine._registerPreviewNode(previewSource, previewGain)
  assert.equal(engine.transportScope.size, 1)
  assert.equal(engine.previewScope.size, 1)

  engine.stop()
  engine.stop()

  assert.equal(engine.transportScope.size, 0)
  assert.equal(engine.previewScope.size, 0)
  assert.deepEqual(transportSource.stopCalls, [[0]])
  assert.deepEqual(previewSource.stopCalls, [[0]])
  assert.equal(transportSource.disconnectCalls, 1)
  assert.equal(transportGain.disconnectCalls, 1)
  assert.equal(previewSource.disconnectCalls, 1)
  assert.equal(previewGain.disconnectCalls, 1)
})
