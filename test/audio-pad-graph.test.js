const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const AudioPadGraph = require("../js/audio-pad-graph.js")

const projectDir = path.resolve(__dirname, "..")

function makeParam() {
  return {
    events: [],
    setValueAtTime(value, time) {
      this.events.push(["set", value, time])
    },
  }
}

function makeNode(extra) {
  return Object.assign(
    {
      connections: [],
      startCalls: [],
      stopCalls: [],
      connect(target) {
        this.connections.push(target)
      },
      disconnect() {},
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
  const created = { gains: [], oscillators: [], filters: [] }
  return {
    created,
    createGain() {
      const node = makeNode({ gain: makeParam() })
      created.gains.push(node)
      return node
    },
    createOscillator() {
      const node = makeNode({ type: "sine", frequency: makeParam(), detune: makeParam() })
      created.oscillators.push(node)
      return node
    },
    createBiquadFilter() {
      const node = makeNode({ type: "lowpass", frequency: makeParam() })
      created.filters.push(node)
      return node
    },
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

test("audio-pad-graph supports both CommonJS and the classic browser global", () => {
  assert.equal(typeof AudioPadGraph.createSynthPadGraph, "function")

  const sandbox = {}
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "audio-pad-graph.js"), "utf8"), sandbox, {
    filename: "audio-pad-graph.js",
  })

  assert.equal(typeof sandbox.SDAudioPadGraph.createSynthPadGraph, "function")
})

test("createSynthPadGraph builds timbre nodes without owning envelope or source lifecycle", () => {
  const ctx = makeContext()
  const destination = makeNode()
  const plan = {
    style: { root: 60, intervals: [0, 2, 4, 5, 7] },
    atmosphere: { id: "rain" },
    padAsset: { fallbackWave: "sawtooth" },
  }

  const graph = AudioPadGraph.createSynthPadGraph(ctx, destination, plan, 3.5)

  assert.equal(graph.gain, ctx.created.gains[0])
  assert.deepEqual(graph.sources, ctx.created.oscillators)
  assert.deepEqual(graph.cleanupNodes, ctx.created.filters)
  assert.deepEqual(ctx.created.oscillators.map((osc) => osc.type), ["triangle", "sawtooth", "sawtooth"])
  assert.deepEqual(
    ctx.created.oscillators.map((osc) => osc.frequency.events[0]),
    [
      ["set", midiToFreq(48), 3.5],
      ["set", midiToFreq(52), 3.5],
      ["set", midiToFreq(55), 3.5],
    ],
  )
  assert.deepEqual(ctx.created.oscillators.map((osc) => osc.detune.events[0]), [
    ["set", -7, 3.5],
    ["set", 0, 3.5],
    ["set", 7, 3.5],
  ])
  assert.deepEqual(ctx.created.filters.map((filter) => filter.frequency.events[0]), [
    ["set", 560, 3.5],
    ["set", 560, 3.5],
    ["set", 560, 3.5],
  ])
  assert.deepEqual(graph.sources.map((source) => source.startCalls), [[], [], []])
  assert.deepEqual(graph.sources.map((source) => source.stopCalls), [[], [], []])
  assert.deepEqual(graph.gain.gain.events, [], "the caller must still own the gain envelope")
  assert.deepEqual(graph.gain.connections, [destination])
  graph.sources.forEach((source, index) => assert.deepEqual(source.connections, [graph.cleanupNodes[index]]))
  graph.cleanupNodes.forEach((filter) => assert.deepEqual(filter.connections, [graph.gain]))
})
