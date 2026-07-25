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
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const setupRender = fs.readFileSync(path.join(projectDir, "js", "studio-setup-render.js"), "utf8")
  const start = setupRender.indexOf("function renderComposeInstruments()")
  const end = setupRender.indexOf("function selectInstrument(", start)
  const renderComposeInstruments = setupRender.slice(start, end)
  const wrapperStart = studio.indexOf("function renderComposeInstruments()")
  const wrapperEnd = studio.indexOf("function renderOrchestraLegend()", wrapperStart)
  const wrapper = studio.slice(wrapperStart, wrapperEnd)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.doesNotMatch(renderComposeInstruments, /\.sort\([\s\S]*state\.instrument\.id/)
  assert.match(wrapper, /return renderComposeInstrumentsFromSetup\(\)/)
})

test("배경음악 구간 선택은 src가 있는 배경 음원에 열린다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const transport = fs.readFileSync(path.join(projectDir, "js", "studio-transport.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(source, /function canSelectBgRange\(\)[\s\S]*bg && bg\.src/)
  assert.match(transport, /bgRange\.hidden = !canSelectRange/)
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
  assert.match(html, /id="playBtn"[\s\S]*aria-label="전체 듣기"/)
  assert.match(css, /body:not\(\[data-step="2"\]\) \.transport[\s\S]*display:\s*none/)
  const refColStart = html.indexOf('<div class="drawing-ref-col">')
  const figureEnd = html.indexOf("</figure>", refColStart)
  const refColEnd = html.indexOf("</div>", figureEnd)
  const transportStart = html.indexOf('<div class="transport"', refColStart)
  assert.ok(refColStart >= 0 && figureEnd > refColStart && refColEnd > figureEnd)
  assert.ok(transportStart > refColEnd)
  assert.doesNotMatch(css, /\.drawing-workspace\.reference-collapsed \.transport\s*\{[\s\S]*display:\s*none/)
  assert.match(css, /\.drawing-workspace\.reference-collapsed > \.transport[\s\S]*grid-column:\s*2/)
})

test("드로잉 도구 버튼은 키보드 숫자 배지를 보인다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(html, /id="penBtn"[\s\S]*aria-keyshortcuts="1"[\s\S]*class="tool-shortcut-badge"[^>]*>1<\/span>[\s\S]*id="clearBtn"/)
  assert.match(html, /id="clearBtn"[\s\S]*aria-keyshortcuts="2"[\s\S]*class="tool-shortcut-badge"[^>]*>2<\/span>/)
  assert.match(html, /id="undoBtn"[\s\S]*aria-keyshortcuts="3"[\s\S]*class="tool-shortcut-badge"[^>]*>3<\/span>[\s\S]*id="resetComposeBtn"/)
  assert.match(html, /id="resetComposeBtn"[\s\S]*aria-keyshortcuts="4"[\s\S]*class="tool-shortcut-badge"[^>]*>4<\/span>[\s\S]*id="playheadStartBtn"/)
  assert.match(html, /id="playheadStartBtn"[\s\S]*aria-keyshortcuts="5"[\s\S]*class="tool-shortcut-badge"[^>]*>5<\/span>/)
  assert.match(css, /\.tool-shortcut-badge\s*\{[\s\S]*position:\s*absolute[\s\S]*right:\s*5px[\s\S]*bottom:\s*4px/)
  assert.match(source, /event\.key === "3"[\s\S]*announceUndoLastAction\(\)/)
  assert.match(source, /event\.key === "4"[\s\S]*resetCompose\(\)/)
  assert.match(source, /event\.key === "5"[\s\S]*movePlayheadToStart\(true\)/)
})

test("드로잉 읽기 표시는 길이 다음에 시도한 횟수를 보여준다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const start = html.indexOf('<div class="readouts">')
  const end = html.indexOf('<div class="orchestra-legend"', start)
  const readouts = html.slice(start, end)
  const updateStart = source.indexOf("function updateReadouts()")
  const updateEnd = source.indexOf("function instrumentLabelById", updateStart)
  const updateReadouts = source.slice(updateStart, updateEnd)

  assert.ok(start >= 0)
  assert.ok(end > start)
  assert.match(readouts, /<span class="k">길이<\/span>[\s\S]*<span class="k">시도한 횟수<\/span>/)
  assert.doesNotMatch(readouts, /소리 수/)
  assert.match(updateReadouts, /el\.noteReadout\.textContent = actionCountLabel\(state\.actionCount\)/)
  assert.doesNotMatch(updateReadouts, /draw\.notes\.length/)
  assert.match(source, /actionCount: normalizeActionCount\(state\.actionCount\)/)
  assert.match(source, /state\.actionCount = normalizeActionCount\(recipe\.actionCount\)/)
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

test("완성 화면은 작품 저장과 공유를 한곳에서 제공한다", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")

  assert.match(html, /id="drawingSaveTakeBtn"[^>]*>저장<\/button>/)
  assert.match(html, /id="drawingSaveNewTakeBtn"[^>]*>새 시도로 저장<\/button>/)
  assert.match(html, /id="saveTakeBtn"[^>]*>저장<\/button>/)
  assert.doesNotMatch(html, /id="saveNewTakeBtn"/)
  assert.match(html, /id="myWorksTitle"[^>]*>내 작품<\/h3>/)
  assert.match(html, /id="publishShareBtn"[^>]*>화음 갤러리에 공유하기<\/button>/)
  const completionStart = html.indexOf('<section class="screen completion-screen"')
  const completionEnd = html.indexOf('<section class="screen share-screen"', completionStart)
  const completionHtml = html.slice(completionStart, completionEnd)
  assert.match(completionHtml, /<div class="actions-row take-save-actions">[\s\S]*id="saveTakeBtn"[\s\S]*id="publishShareBtn"/)
  assert.doesNotMatch(completionHtml, /data-step-prev/)
  assert.doesNotMatch(completionHtml, /data-step-next/)
  assert.match(source, /drawingSaveTakeBtn: \$\("drawingSaveTakeBtn"\)/)
  assert.match(source, /drawingSaveNewTakeBtn: \$\("drawingSaveNewTakeBtn"\)/)
  assert.match(source, /if \(el\.drawingSaveTakeBtn\) el\.drawingSaveTakeBtn\.addEventListener\("click", saveTake\)/)
  assert.match(source, /if \(el\.drawingSaveNewTakeBtn\) el\.drawingSaveNewTakeBtn\.addEventListener\("click", saveNewTake\)/)
  assert.match(source, /if \(el\.publishShareBtn\) el\.publishShareBtn\.addEventListener\("click", publishCurrentTake\)/)
  assert.match(source, /takes\.update\(state\.activeTakeId, recipe, name\)/)
  assert.match(source, /cover\.className = "take-cover"/)
  assert.match(source, /makeTakeActionButton\("수정"/)
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
  const end = source.indexOf("// === § 25  공유 & 화음 갤러리 ===", start)
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

test("갤러리 스튜디오 보기는 복사본을 3단계로 복원한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")

  assert.match(source, /const STUDIO_COPY_STORAGE_PREFIX = "hwaeum\.studioCopy\."/)
  assert.match(source, /if \(h\.indexOf\("#copy="\) === 0\)/)
  assert.match(source, /const payload = takeStudioCopyPayload\(decodeURIComponent\(h\.slice\(6\)\)\)/)
  assert.match(source, /loadRecipe\(studioCopyRecipe\(payload\.recipe\)\)/)
  assert.match(source, /state\.sharedRecipeLoaded = true/)
  assert.match(source, /state\.activeTakeId = null/)
  assert.match(source, /const atmosphere = D\.atmospheres\.find\(\(a\) => a\.id === copy\.atmosphere\)/)
  assert.match(source, /copy\.atmosphere = defaultAtmosphere\(\)\.id/)
  assert.match(source, /copy\.bgOffset = 0/)
  assert.match(source, /copy\.bgEndOffset = 0/)
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

test("효과음 목록은 내부 스크롤 없이 전체 화면 흐름에서 펼쳐진다", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const effectListStart = css.indexOf(".effect-list {")
  const effectListEnd = css.indexOf(".effect-btn {", effectListStart)
  const effectListBlock = css.slice(effectListStart, effectListEnd)
  const stepEffectListStart = css.indexOf('body[data-step="2"] .effect-list {')
  const stepEffectListEnd = css.indexOf('body[data-step="2"] .effect-btn {', stepEffectListStart)
  const stepEffectListBlock = css.slice(stepEffectListStart, stepEffectListEnd)

  assert.ok(effectListStart >= 0)
  assert.ok(effectListEnd > effectListStart)
  assert.match(effectListBlock, /flex-wrap:\s*wrap/)
  assert.match(effectListBlock, /overflow:\s*visible/)
  assert.doesNotMatch(effectListBlock, /max-height/)
  assert.doesNotMatch(effectListBlock, /overflow-y:\s*auto/)
  assert.doesNotMatch(effectListBlock, /scrollbar-gutter/)
  assert.ok(stepEffectListStart >= 0)
  assert.ok(stepEffectListEnd > stepEffectListStart)
  assert.doesNotMatch(stepEffectListBlock, /max-height/)
})

test("드로잉 악기 버튼은 효과음 버튼과 같은 시작 열에서 시작한다", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const stripStart = css.indexOf(".compose-control-strip {")
  const stripEnd = css.indexOf(".instrument-strip {", stripStart)
  const stripBlock = css.slice(stripStart, stripEnd)
  const compactStripStart = css.indexOf('body[data-step="2"] .compose-control-strip {', css.indexOf("@media (min-width: 1081px) and (max-height: 820px)"))
  const compactStripEnd = css.indexOf('body[data-step="2"] .instrument-strip {', compactStripStart)
  const compactStripBlock = css.slice(compactStripStart, compactStripEnd)
  const groupStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group {')
  const groupEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-list {', groupStart)
  const groupBlock = css.slice(groupStart, groupEnd)
  const groupHeadStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head {')
  const groupHeadEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head strong {', groupHeadStart)
  const groupHeadBlock = css.slice(groupHeadStart, groupHeadEnd)

  assert.ok(stripStart >= 0)
  assert.ok(stripEnd > stripStart)
  assert.match(stripBlock, /--control-label-width:\s*52px/)
  assert.match(stripBlock, /--control-label-gap:\s*12px/)
  assert.match(stripBlock, /grid-template-columns:\s*var\(--control-label-width\) minmax\(0, 1fr\)/)
  assert.match(stripBlock, /gap:\s*var\(--control-label-gap\)/)
  assert.ok(compactStripStart >= 0)
  assert.ok(compactStripEnd > compactStripStart)
  assert.match(compactStripBlock, /--control-label-width:\s*48px/)
  assert.match(compactStripBlock, /--control-label-gap:\s*10px/)
  assert.ok(groupStart >= 0)
  assert.ok(groupEnd > groupStart)
  assert.match(groupBlock, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(groupBlock, /grid-template-columns:\s*48px minmax\(0, 1fr\)/)
  assert.ok(groupHeadStart >= 0)
  assert.ok(groupHeadEnd > groupHeadStart)
  assert.match(groupHeadBlock, /position:\s*absolute/)
  assert.match(groupHeadBlock, /left:\s*calc\(-1 \* \(var\(--control-label-width\) \+ var\(--control-label-gap\)\)\)/)
  assert.match(groupHeadBlock, /width:\s*var\(--control-label-width\)/)
})

test("drawing instrument buttons match the effect stamp box size", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const effectStart = css.indexOf(".effect-btn {")
  const effectEnd = css.indexOf(".effect-btn img {", effectStart)
  const effectBlock = css.slice(effectStart, effectEnd)
  const instrumentStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument {')
  const instrumentEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument img {', instrumentStart)
  const instrumentBlock = css.slice(instrumentStart, instrumentEnd)
  const groupListStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-list {')
  const groupListEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-family,', groupListStart)
  const groupListBlock = css.slice(groupListStart, groupListEnd)
  const groupHeadStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head {')
  const groupHeadEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head strong {', groupHeadStart)
  const groupHeadBlock = css.slice(groupHeadStart, groupHeadEnd)

  assert.ok(effectStart >= 0)
  assert.ok(effectEnd > effectStart)
  assert.match(effectBlock, /width:\s*72px/)
  assert.match(effectBlock, /min-height:\s*72px/)
  assert.ok(instrumentStart >= 0)
  assert.ok(instrumentEnd > instrumentStart)
  assert.match(instrumentBlock, /min-height:\s*72px/)
  assert.match(instrumentBlock, /padding:\s*6px 6px 7px/)
  assert.ok(groupListStart >= 0)
  assert.ok(groupListEnd > groupListStart)
  assert.match(groupListBlock, /grid-template-columns:\s*repeat\(auto-fit,\s*72px\)/)
  assert.ok(groupHeadStart >= 0)
  assert.ok(groupHeadEnd > groupHeadStart)
  assert.match(groupHeadBlock, /min-height:\s*72px/)

  const compactMediaStart = css.indexOf("@media (min-width: 1081px) and (max-height: 820px)")
  const compactEffectStart = css.indexOf('body[data-step="2"] .effect-btn {', compactMediaStart)
  const compactEffectEnd = css.indexOf('body[data-step="2"] .effect-btn img {', compactEffectStart)
  const compactEffectBlock = css.slice(compactEffectStart, compactEffectEnd)
  const compactInstrumentMediaStart = css.indexOf("@media (min-width: 1081px) and (max-height: 820px)", groupHeadEnd)
  const compactInstrumentStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument {', compactInstrumentMediaStart)
  const compactInstrumentEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument img {', compactInstrumentStart)
  const compactInstrumentBlock = css.slice(compactInstrumentStart, compactInstrumentEnd)
  const compactGroupListStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-list {', compactInstrumentMediaStart)
  const compactGroupListEnd = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head {', compactGroupListStart)
  const compactGroupListBlock = css.slice(compactGroupListStart, compactGroupListEnd)
  const compactGroupHeadStart = css.indexOf('body[data-step="2"] .instrument-strip .compose-instrument-group-head {', compactInstrumentMediaStart)
  const compactGroupHeadEnd = css.indexOf("}", compactGroupHeadStart)
  const compactGroupHeadBlock = css.slice(compactGroupHeadStart, compactGroupHeadEnd)

  assert.ok(compactEffectStart >= 0)
  assert.ok(compactEffectEnd > compactEffectStart)
  assert.match(compactEffectBlock, /width:\s*66px/)
  assert.match(compactEffectBlock, /min-height:\s*66px/)
  assert.ok(compactInstrumentMediaStart > groupHeadEnd)
  assert.ok(compactInstrumentStart >= 0)
  assert.ok(compactInstrumentEnd > compactInstrumentStart)
  assert.match(compactInstrumentBlock, /min-height:\s*66px/)
  assert.match(compactInstrumentBlock, /padding:\s*5px 5px 6px/)
  assert.ok(compactGroupListStart >= 0)
  assert.ok(compactGroupListEnd > compactGroupListStart)
  assert.match(compactGroupListBlock, /grid-template-columns:\s*repeat\(auto-fit,\s*66px\)/)
  assert.ok(compactGroupHeadStart >= 0)
  assert.ok(compactGroupHeadEnd > compactGroupHeadStart)
  assert.match(compactGroupHeadBlock, /min-height:\s*66px/)
})
