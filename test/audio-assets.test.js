const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadManifest() {
  const sandbox = {}
  const files = ["manifest.js", "sample-maps.js"]
  sandbox.self = sandbox
  for (const file of files) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return sandbox.SDStudioData
}

function collectAssets(data) {
  const entries = []
  for (const group of ["backgrounds", "pads", "melodies", "effects"]) {
    for (const [id, asset] of Object.entries(data[group])) {
      if (asset.src) entries.push({ group, id, src: asset.src })
    }
  }
  return entries
}

function collectInstrumentImages(data) {
  return Array.from(data.instruments).filter((instrument) => instrument.image)
}

test("manifest audio src entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectAssets(data)
    .map((asset) => ({ ...asset, filePath: path.resolve(projectDir, asset.src) }))
    .filter((asset) => !fs.existsSync(asset.filePath))

  assert.deepEqual(missing, [])
})

test("instrument image entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectInstrumentImages(data)
    .map((instrument) => ({ id: instrument.id, image: instrument.image, filePath: path.resolve(projectDir, instrument.image) }))
    .filter((instrument) => !fs.existsSync(instrument.filePath))

  assert.deepEqual(missing, [])
})

test("serve script exposes the sibling sound directory used by audio src paths", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"))
  assert.match(pkg.scripts.serve, /--directory\s+\.\./)
})

test("detected sample maps provide playable note segments for gugak melody assets", () => {
  const data = loadManifest()
  const gugak = Object.entries(data.melodies).filter(([, asset]) => asset.group === "국악")
  const missing = gugak.filter(([, asset]) => !Array.isArray(asset.sampleMap) || asset.sampleMap.length === 0)

  assert.deepEqual(
    missing.map(([id]) => id),
    [],
  )

  for (const [id, asset] of gugak) {
    let prevMidi = -Infinity
    for (const item of asset.sampleMap) {
      assert.equal(typeof item.midi, "number", id + " midi")
      assert.equal(typeof item.offset, "number", id + " offset")
      assert.equal(typeof item.duration, "number", id + " duration")
      assert.ok(item.midi >= prevMidi, id + " sorted midi")
      assert.ok(item.offset >= 0, id + " offset non-negative")
      assert.ok(item.duration > 0.05, id + " duration")
      assert.ok(item.confidence >= 0.9, id + " confidence")
      prevMidi = item.midi
    }
  }
})

test("index loads detected sample maps before the audio engine", () => {
  const html = fs.readFileSync(path.join(projectDir, "index.html"), "utf8")
  assert.ok(html.indexOf("./js/manifest.js") < html.indexOf("./js/sample-maps.js"))
  assert.ok(html.indexOf("./js/sample-maps.js") < html.indexOf("./js/audio-engine.js"))
})
