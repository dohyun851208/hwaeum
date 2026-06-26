const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadManifest() {
  const sandbox = {}
  sandbox.self = sandbox
  const code = fs.readFileSync(path.join(projectDir, "js", "manifest.js"), "utf8")
  vm.runInNewContext(code, sandbox, { filename: "manifest.js" })
  return sandbox.SDStudioData
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("서양 악기 목록은 목관, 금관, 현악기 순서를 유지한다", () => {
  const data = loadManifest()

  const westernLabels = Array.from(data.instruments)
    .filter((instrument) => instrument.group === "서양")
    .map((instrument) => instrument.label)

  assert.deepEqual(westernLabels, ["플루트", "오보에", "클라리넷", "호른", "만돌린", "바이올린", "비올라", "첼로", "더블베이스"])
})

test("국악 악기는 요청한 다섯 악기만 지정 순서로 보여준다", () => {
  const data = loadManifest()

  const gugakLabels = data.instruments.filter((instrument) => instrument.group === "국악").map((instrument) => instrument.label)

  assert.deepEqual(plain(gugakLabels), ["소금", "대금", "해금", "가야금", "산조아쟁"])
})

test("악기별 실제 재생 음역 규칙을 manifest에 선언한다", () => {
  const data = loadManifest()

  assert.equal(data.melodies.flute.playbackTranspose, 12)
  assert.equal(data.melodies.oboe.playbackTranspose, 12)
  assert.equal(data.melodies.clarinet.playbackTranspose, 0)
  assert.equal(data.melodies.mandolin.playbackTranspose, 0)
  assert.equal(data.melodies.violin.playbackTranspose, 0)
  assert.equal(data.melodies.viola.playbackTranspose, 0)
  assert.equal(data.melodies.frenchHorn.playbackTranspose, -12)
  assert.equal(data.melodies.cello.playbackTranspose, -12)
  assert.equal(data.melodies.doubleBass.playbackTranspose, -24)
  assert.deepEqual(plain(data.melodies.sogeum.playableMidi), [67, 69, 72, 74, 76, 79])
  assert.deepEqual(plain(data.melodies.ajaeng.playableMidi), [55, 57, 60, 62, 64, 67, 69])
})

test("팔레트 스타일은 기본 음역 G3부터 G5까지와 위아래 무음 줄을 가진다", () => {
  const data = loadManifest()

  for (const style of data.styles) {
    assert.equal(style.lowMidi, 55, style.label)
    assert.equal(style.highMidi, 79, style.label)
    assert.equal(style.silentEdgeRows, 1, style.label)
  }
})

test("작곡 악기 목록은 선택 악기를 맨 앞으로 재정렬하지 않는다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = source.indexOf("function renderComposeInstruments()")
  const end = source.indexOf("function renderOrchestraLegend()", start)
  const renderComposeInstruments = source.slice(start, end)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.doesNotMatch(renderComposeInstruments, /\.sort\([\s\S]*state\.instrument\.id/)
})

test("배경음악 구간 선택은 업로드한 배경 음원에만 열린다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(source, /function canSelectBgRange\(\)[\s\S]*bg\.custom/)
  assert.match(source, /bgRange\.hidden = !canSelectRange/)
  assert.match(css, /\.bg-range\[hidden\][\s\S]*display:\s*none/)
  assert.match(source, /bgOffset: recipeBgOffset\(\)/)
  assert.match(source, /bgEndOffset: recipeBgEndOffset\(\)/)
})

test("초기화는 업로드 배경 구간 설정을 지우지 않는다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = source.indexOf("function resetCompose()")
  const end = source.indexOf("// --- 시도(테이크) ---", start)
  const resetCompose = source.slice(start, end)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.doesNotMatch(resetCompose, /state\.bgOffset\s*=\s*0/)
  assert.doesNotMatch(resetCompose, /state\.bgEndOffset\s*=\s*0/)
  assert.match(resetCompose, /draw\.clear\(false\)/)
  assert.match(resetCompose, /setupBgPlayer\(true\)/)
})

test("레시피 불러오기도 업로드 배경 구간 설정을 유지한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = source.indexOf("function loadRecipe(recipe)")
  const end = source.indexOf("// --- 내보내기 ---", start)
  const loadRecipe = source.slice(start, end)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.match(loadRecipe, /state\.bgEndOffset = recipe\.bgEndOffset \|\| 0/)
  assert.match(loadRecipe, /setupBgPlayer\(true\)/)
})
