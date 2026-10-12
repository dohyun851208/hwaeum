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
  return { AudioEngine: sandbox.AudioEngine, anchor, calls, sandbox }
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


test("a sample that failed to load is fetched again later instead of staying synthesized forever", async () => {
  const { AudioEngine, sandbox } = loadEngine()
  const engine = new AudioEngine()
  const ctx = { decodeAudioData: async () => ({ duration: 1 }) }
  let fetches = 0
  let online = false
  sandbox.fetch = async () => {
    fetches += 1
    if (!online) throw new TypeError("Failed to fetch")
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
  }

  assert.equal(await engine.loadBuffer(ctx, "sound/flute/A4.mp3"), null)
  assert.equal(fetches, 1)
  assert.equal(await engine.loadBuffer(ctx, "sound/flute/A4.mp3"), null, "바로 다시 부르면 받지 않고 합성음으로 둔다")
  assert.equal(fetches, 1)

  online = true
  engine.loadFailedAt.set("sound/flute/A4.mp3", Date.now() - 60000) // 잠시 뒤
  const buffer = await engine.loadBuffer(ctx, "sound/flute/A4.mp3")
  assert.equal(fetches, 2, "연결이 돌아오면 다시 받는다")
  assert.deepEqual(JSON.parse(JSON.stringify(buffer)), { duration: 1 })
  assert.equal(engine.loadFailedAt.has("sound/flute/A4.mp3"), false)
})

test("synthesized fallback melody is trimmed to the measured level of the real samples", () => {
  const engine = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")
  const table = engine.match(/const SYNTH_MELODY_TRIM_DB = \{([\s\S]*?)\n  \}/)
  assert.ok(table, "SYNTH_MELODY_TRIM_DB 표가 있어야 한다")
  const ids = Array.from(table[1].matchAll(/(\w+):\s*(-?\d+(?:\.\d+)?)/g), (entry) => entry[1])
  assert.deepEqual(ids.sort(), ["cello", "clarinet", "daegeum", "danso", "doubleBass", "flute", "frenchHorn", "gayageum", "haegeum", "oboe", "sogeum", "viola", "violin"])
  // 두 합성 선율 경로 모두 보정 노드를 거친다.
  assert.equal((engine.match(/scheduleSynthMelody\(ctx, synthMelodyOutput\(ctx, melodyGain, inst, start\)/g) || []).length, 2)
  assert.doesNotMatch(engine, /scheduleSynthMelody\(ctx, melodyGain,/)
  assert.match(engine, /NOTE_PREVIEW_SYNTH_GAIN \* previewOutputGain\(plan\) \* noteMelodyOutputGain\(plan, note\) \* synthMelodyTrim\(plan\.instrument\)/)
})
