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

const GUGAK_PALETTE_MIDI = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]

function familyLabels(data, group) {
  const result = {}
  for (const instrument of data.instruments.filter((item) => item.group === group)) {
    if (!result[instrument.family]) result[instrument.family] = []
    result[instrument.family].push(instrument.label)
  }
  return result
}

test("서양 악기 목록은 관악기, 현악기 순서를 유지한다", () => {
  const data = loadManifest()

  const westernLabels = Array.from(data.instruments)
    .filter((instrument) => instrument.group === "서양")
    .map((instrument) => instrument.label)

  assert.deepEqual(westernLabels, ["플루트", "오보에", "클라리넷", "호른", "바이올린", "비올라", "첼로", "더블베이스"])
})

test("서양 악기는 관악기와 현악기로 나누어 보여준다", () => {
  const data = loadManifest()

  assert.deepEqual(familyLabels(data, "서양"), {
    관악기: ["플루트", "오보에", "클라리넷", "호른"],
    현악기: ["바이올린", "비올라", "첼로", "더블베이스"],
  })
})

test("악기 카드 설명 문구는 수업용 표현을 사용한다", () => {
  const data = loadManifest()
  const details = Object.fromEntries(data.instruments.map((instrument) => [instrument.id, instrument.detail]))

  assert.deepEqual(details, {
    flute: "가볍고 투명한 소리",
    oboe: "애잔하고 맑은 소리",
    clarinet: "둥글고 부드러운 소리",
    frenchHorn: "웅장하고 포근한 소리",
    violin: "선명하고 화려한 소리",
    viola: "차분하고 은은한 소리",
    cello: "깊고 풍부한 소리",
    doubleBass: "낮고 묵직한 소리",
    sogeum: "청아한 소리",
    daegeum: "깊게 울리는 소리",
    danso: "고요한 소리",
    haegeum: "애절한 소리",
    gayageum: "맑게 뜯는 소리",
  })
})

test("국악 악기는 요청한 다섯 악기만 지정 순서로 보여준다", () => {
  const data = loadManifest()

  const gugakLabels = data.instruments.filter((instrument) => instrument.group === "국악").map((instrument) => instrument.label)

  assert.deepEqual(plain(gugakLabels), ["소금", "대금", "단소", "해금", "가야금"])
})

test("국악 악기는 관악기와 현악기로 나누어 보여준다", () => {
  const data = loadManifest()

  assert.deepEqual(familyLabels(data, "국악"), {
    관악기: ["소금", "대금", "단소"],
    현악기: ["해금", "가야금"],
  })
})

test("모든 악기는 분류 이름을 가진다", () => {
  const data = loadManifest()

  assert.equal(data.instruments.filter((instrument) => !instrument.family).length, 0)
})

test("악기별 실제 재생 음역 규칙을 manifest에 선언한다", () => {
  const data = loadManifest()

  assert.equal(data.melodies.flute.playbackTranspose, 12)
  assert.equal(data.melodies.oboe.playbackTranspose, 12)
  assert.equal(data.melodies.clarinet.playbackTranspose, 0)
  assert.equal(data.melodies.violin.playbackTranspose, 0)
  assert.equal(data.melodies.viola.playbackTranspose, 0)
  assert.equal(data.melodies.frenchHorn.playbackTranspose, -12)
  assert.equal(data.melodies.cello.playbackTranspose, -12)
  assert.equal(data.melodies.doubleBass.playbackTranspose, -24)
  assert.equal(data.melodies.sogeum.playbackTranspose, 12)
  for (const id of ["sogeum", "daegeum", "haegeum", "gayageum"]) {
    assert.deepEqual(plain(data.melodies[id].playableMidi), GUGAK_PALETTE_MIDI, id)
  }
})

test("팔레트 스타일은 무음 줄 없이 정해진 기본 음역을 쓴다", () => {
  const data = loadManifest()

  for (const style of data.styles) {
    assert.equal(style.lowMidi, 55, style.label)
    assert.equal(style.silentEdgeRows || 0, 0, style.label)
    if (style.id === "gugak") {
      assert.equal(style.highMidi, 76, style.label)
    } else {
      assert.equal(style.highMidi, 79, style.label)
    }
  }
})

test("국악 팔레트는 악기와 무관하게 G-A-C-D-E-G-A-C-D-E 순서다", () => {
  const data = loadManifest()
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  const labels = (midis) => Array.from(midis, (midi) => names[((midi % 12) + 12) % 12])
  const expectedLabels = ["G", "A", "C", "D", "E", "G", "A", "C", "D", "E"]

  for (const id of ["sogeum", "daegeum", "haegeum", "gayageum"]) {
    assert.deepEqual(labels(data.melodies[id].playableMidi), expectedLabels, id)
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

test("배경음악 구간 선택은 src가 있는 배경 음원에 열린다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(source, /function canSelectBgRange\(\)[\s\S]*bg && bg\.src/)
  assert.match(source, /bgRange\.hidden = !canSelectRange/)
  assert.match(css, /\.bg-range\[hidden\][\s\S]*display:\s*none/)
  assert.match(source, /bgOffset: recipeBgOffset\(\)/)
  assert.match(source, /bgEndOffset: recipeBgEndOffset\(\)/)
})

test("드로잉 화면 전체 재생은 상단 재생 버튼만 사용한다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.doesNotMatch(html, /id="composePlay"/)
  assert.doesNotMatch(source, /composePlay/)
  assert.match(html, /id="playBtn"[\s\S]*aria-label="전체곡 재생"/)
  assert.match(css, /body:not\(\[data-step="2"\]\) \.transport[\s\S]*display:\s*none/)
})

test("완성 화면 그림에는 재생 버튼이 있고 음악 저장은 WebM만 사용한다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const engine = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")

  assert.match(source, /function ensureFramePlayButton\(\)/)
  assert.match(source, /framePlayBtn/)
  // 음악 저장은 완성 탭 일괄 버튼이 아니라 시도별 버튼으로 옮겼고, 여전히 WebM만 사용한다.
  assert.doesNotMatch(html, /id="exportAudioBtn"/)
  assert.match(source, /makeTakeActionButton\("음악 저장"[^)]*WebM/)
  assert.doesNotMatch(html, /exportWavBtn|오디오 내보내기\(WAV\)/)
  assert.match(source, /function exportAudio\(\)/)
  assert.match(source, /exportCompressedAudio/)
  assert.doesNotMatch(source, /exportWav/)
  assert.match(engine, /exportCompressedAudio/)
  assert.doesNotMatch(engine, /AudioEngine\.prototype\.exportWav/)
})

test("드로잉 화면에서 믹스 선택 UI를 제거한다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")

  assert.doesNotMatch(html, /id="versionList"/)
  assert.doesNotMatch(html, />믹스</)
  assert.match(source, /function defaultVersion\(\)[\s\S]*D\.versions\[0\]/)
  assert.match(source, /state\.version = defaultVersion\(\)/)
  assert.doesNotMatch(source, /state\.version\.label \+ " 재생 중/)
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

test("레시피 불러오기도 배경 구간 설정과 길이를 유지한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = source.indexOf("function loadRecipe(recipe)")
  const end = source.indexOf("// --- 내보내기 ---", start)
  const loadRecipe = source.slice(start, end)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.match(loadRecipe, /state\.duration = normalizeDuration\(recipe\.duration \|\| DEFAULT_DURATION_SECONDS\)/)
  assert.match(loadRecipe, /state\.bgEndOffset = Math\.max\(0, Number\(recipe\.bgEndOffset\) \|\| 0\)/)
  assert.match(loadRecipe, /setupBgPlayer\(true\)/)
})

test("레시피 링크 공유는 드로잉 단계에서 시작하고 완성 탭 글을 제외한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = source.indexOf("function buildSharedRecipe()")
  const end = source.indexOf("function stampEffectAtPointer", start)
  const buildSharedRecipe = source.slice(start, end)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.match(buildSharedRecipe, /title: "무제"/)
  assert.match(buildSharedRecipe, /backgroundReason: ""/)
  assert.match(buildSharedRecipe, /melodyIntent: ""/)
  assert.match(buildSharedRecipe, /hashtags: \[\]/)
  assert.match(buildSharedRecipe, /composerName: cleanText\(state\.composerName, COMPOSER_NAME_MAX\)/)
  assert.match(source, /Core\.encodeRecipe\(buildSharedRecipe\(\)\)/)
  assert.match(source, /const restoredRecipeLink = restoreFromHash\(\)[\s\S]*setStep\(restoredRecipeLink \? DRAWING_STEP : 0\)/)
  assert.match(source, /state\.sharedRecipeLoaded = true/)
  assert.match(source, /const items = state\.sharedRecipeLoaded \? \[\] : takes\.list\(\)/)
})

test("step 2 default atmosphere selection is no background music", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const stateStart = source.indexOf("const state = {")
  const stateEnd = source.indexOf("const bgPreview = new Audio()", stateStart)
  const stateBlock = source.slice(stateStart, stateEnd)

  assert.ok(stateStart >= 0)
  assert.ok(stateEnd > stateStart)
  assert.match(source, /const DEFAULT_ATMOSPHERE_ID = "none"/)
  assert.match(source, /function defaultAtmosphere\(\)[\s\S]*DEFAULT_ATMOSPHERE_ID/)
  assert.match(stateBlock, /atmosphere: defaultAtmosphere\(\)/)
  assert.doesNotMatch(stateBlock, /atmosphere: D\.atmospheres\[0\]/)
})

test("국악 음원 출처 표기는 2단계에서만 보인다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const expected = "국악 음원 출처: 국립국악원 디지털음원 (공공누리 제1유형·출처표시)"

  assert.match(html, new RegExp('<span class="muted" id="audioModeNote" hidden>' + expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "</span>"))
  assert.match(source, /const SOUND_STEP = 1/)
  assert.match(source, /function syncAudioModeNote\(\)/)
  assert.match(source, /el\.audioModeNote\.hidden = state\.step !== SOUND_STEP/)
  assert.match(source, /state\.step = nextStep[\s\S]*syncAudioModeNote\(\)/)
  assert.doesNotMatch(html + source, /실제 음원을 우선 사용하고/)
  assert.doesNotMatch(html + source, /국악 음원 출처: 국립국악원\./)
})
