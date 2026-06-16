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

test("자족형 구조: 음원 폴더가 앱 폴더 안에 있고 serve는 앱 폴더를 그대로 띄운다", () => {
  // 음원을 상대경로(sound/...)로 앱 폴더 안에 두어, 폴더 하나만 복사하면 어디서든 동작.
  assert.ok(fs.existsSync(path.join(projectDir, "sound")), "앱 폴더 안에 sound/ 가 없다")
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"))
  assert.match(pkg.scripts.serve, /http\.server/)
  assert.doesNotMatch(pkg.scripts.serve, /--directory/, "serve가 더 이상 상위 폴더를 띄우면 안 된다")
})

test("음원 src 경로는 상대경로(sound/...)여야 한다 — 상위(../) 참조 금지", () => {
  const data = loadManifest()
  const offenders = collectAssets(data).filter((a) => /^\.\.\//.test(a.src))
  assert.deepEqual(offenders, [], "src에 ../ 상위 참조가 남아있다")
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
