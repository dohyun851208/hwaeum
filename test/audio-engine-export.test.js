const { scriptFiles } = require("../tools/runtime-scripts.cjs")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadEngine() {
  const calls = {
    appended: [],
    clicked: [],
    createdUrls: [],
    removed: [],
    revokedUrls: [],
    timers: [],
  }
  const anchor = {
    href: "",
    download: "",
    click() {
      calls.clicked.push(this)
    },
  }
  const sandbox = {
    document: {
      body: {
        appendChild(node) {
          calls.appended.push(node)
        },
        removeChild(node) {
          calls.removed.push(node)
        },
      },
      createElement(tagName) {
        assert.equal(tagName, "a")
        return anchor
      },
    },
    setTimeout(callback, delay) {
      calls.timers.push({ callback, delay })
      return calls.timers.length
    },
    URL: {
      createObjectURL(blob) {
        calls.createdUrls.push(blob)
        return "blob:test-export"
      },
      revokeObjectURL(url) {
        calls.revokedUrls.push(url)
      },
    },
  }
  sandbox.self = sandbox
  const files = scriptFiles({ from: "music-core.js", through: "audio-engine.js" })
  for (const file of files) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return { AudioEngine: sandbox.AudioEngine, anchor, calls }
}

test("exportCompressedAudio returns the generated Blob type and cleans up its temporary download", async () => {
  const { AudioEngine, anchor, calls } = loadEngine()
  const engine = new AudioEngine()
  const blob = { size: 321, type: "audio/webm;codecs=opus" }
  engine.renderCompressedAudioBlob = async () => blob

  const result = await engine.exportCompressedAudio({}, [], "student-song.webm")

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    size: 321,
    mimeType: "audio/webm;codecs=opus",
  })
  assert.deepEqual(calls.createdUrls, [blob])
  assert.equal(anchor.href, "blob:test-export")
  assert.equal(anchor.download, "student-song.webm")
  assert.deepEqual(calls.appended, [anchor])
  assert.deepEqual(calls.clicked, [anchor])
  assert.deepEqual(calls.removed, [anchor])

  assert.equal(calls.timers.length, 1)
  assert.equal(calls.timers[0].delay, 2000)
  assert.deepEqual(calls.revokedUrls, [])
  calls.timers[0].callback()
  assert.deepEqual(calls.revokedUrls, ["blob:test-export"])
})
