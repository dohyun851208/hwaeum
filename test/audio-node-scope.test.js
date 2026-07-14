const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const AudioNodeScope = require("../js/audio-node-scope.js")

const projectDir = path.resolve(__dirname, "..")

function makeNode() {
  return {
    disconnectCalls: 0,
    stopCalls: [],
    onended: null,
    disconnect() {
      this.disconnectCalls += 1
    },
    stop(when) {
      this.stopCalls.push(when)
    },
    emitEnded() {
      if (typeof this.onended === "function") this.onended({ type: "ended" })
    },
  }
}

test("audio-node-scope supports both CommonJS and the classic browser global", () => {
  assert.equal(typeof AudioNodeScope, "function")

  const sandbox = {}
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "audio-node-scope.js"), "utf8"), sandbox, {
    filename: "audio-node-scope.js",
  })

  assert.equal(typeof sandbox.SDAudioNodeScope, "function")
})

test("ended nodes preserve their previous callback, leave the scope, and disconnect their graph", () => {
  const scope = new AudioNodeScope("preview")
  const source = makeNode()
  const gain = makeNode()
  const filter = makeNode()
  let previousEndedCalls = 0
  source.onended = function () {
    previousEndedCalls += 1
  }

  scope.track(source, [gain, filter])
  assert.equal(scope.size, 1)

  source.emitEnded()

  assert.equal(previousEndedCalls, 1)
  assert.equal(scope.size, 0)
  assert.equal(source.disconnectCalls, 1)
  assert.equal(gain.disconnectCalls, 1)
  assert.equal(filter.disconnectCalls, 1)
})

test("EventTarget ended listeners preserve onended and automatically release browser-style nodes", () => {
  class BrowserSource extends EventTarget {
    constructor() {
      super()
      this.disconnectCalls = 0
      this.stopCalls = []
      this.onended = null
    }

    disconnect() {
      this.disconnectCalls += 1
    }

    stop(when) {
      this.stopCalls.push(when)
    }

    emitEnded() {
      const event = new Event("ended")
      if (typeof this.onended === "function") this.onended(event)
      this.dispatchEvent(event)
    }
  }

  const scope = new AudioNodeScope("browser-preview")
  const source = new BrowserSource()
  const gain = makeNode()
  let previousEndedCalls = 0
  const previousOnended = function () {
    previousEndedCalls += 1
  }
  source.onended = previousOnended

  scope.track(source, gain)
  assert.equal(source.onended, previousOnended, "addEventListener path must not replace the existing handler")
  assert.equal(scope.size, 1)

  source.emitEnded()

  assert.equal(previousEndedCalls, 1)
  assert.equal(scope.size, 0)
  assert.equal(source.disconnectCalls, 1)
  assert.equal(gain.disconnectCalls, 1)
})

test("stopAll is idempotent and a later ended event can still reach the original callback", () => {
  const scope = new AudioNodeScope("transport")
  const source = makeNode()
  const gain = makeNode()
  let previousEndedCalls = 0
  source.onended = function () {
    previousEndedCalls += 1
  }

  scope.track(source, gain)
  scope.track(source, gain)
  scope.stopAll(4)
  scope.stopAll(8)

  assert.equal(scope.size, 0)
  assert.deepEqual(source.stopCalls, [4])
  assert.equal(source.disconnectCalls, 1)
  assert.equal(gain.disconnectCalls, 1)

  source.emitEnded()
  assert.equal(previousEndedCalls, 1)
})
