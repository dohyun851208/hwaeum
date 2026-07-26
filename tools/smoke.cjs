/*
 * tools/smoke.cjs — jsdom 통합 스모크 테스트 (선택 사항)
 *
 * 실제 스크립트를 로드·초기화해 DOM 배선·카드 렌더·드로잉→음 생성·레시피 코덱·
 * 단계 이동·테이크 저장을 검증한다. (오디오 재생/시각 렌더는 실제 브라우저에서 확인)
 *
 * 실행: jsdom 설치 후  ->  npm i jsdom  ;  node tools/smoke.cjs
 * (오디오/캔버스는 스텁으로 대체하므로 소리는 나지 않는다.)
 */
const fs = require("fs")
const path = require("path")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")
const read = (p) => fs.readFileSync(path.join(root, p), "utf8")

let html = read("studio.html").replace(/<script[\s\S]*?<\/script>/g, "")

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/sound-drawing-tool/",
})
const { window } = dom
let lastAlert = ""
let alertCalls = 0

function fakeCtx() {
  const target = {}
  return new Proxy(target, {
    get(t, prop) {
      return prop in t ? t[prop] : () => {}
    },
    set(t, prop, val) {
      t[prop] = val
      return true
    },
  })
}

function fakeAudioParam(value = 0) {
  return {
    value,
    cancelScheduledValues() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    setValueAtTime(next) {
      this.value = next
    },
  }
}

function fakeAudioNode(extra) {
  return Object.assign(
    {
      addEventListener() {},
      connect() {
        return this
      },
      disconnect() {},
      removeEventListener() {},
      start() {},
      stop() {},
    },
    extra || {},
  )
}

function fakeAudioCtx() {
  const ctx = fakeCtx()
  ctx.sampleRate = 44100
  ctx.currentTime = 0
  ctx.state = "running"
  ctx.destination = fakeAudioNode()
  ctx.createBiquadFilter = () =>
    fakeAudioNode({
      Q: fakeAudioParam(1),
      frequency: fakeAudioParam(350),
      gain: fakeAudioParam(0),
      type: "lowpass",
    })
  ctx.createBuffer = (channels, length, sampleRate) => ({
    duration: length / (sampleRate || ctx.sampleRate),
    getChannelData: () => new Float32Array(length),
    length,
    numberOfChannels: channels,
    sampleRate: sampleRate || ctx.sampleRate,
  })
  ctx.createBufferSource = () =>
    fakeAudioNode({
      buffer: null,
      detune: fakeAudioParam(0),
      playbackRate: fakeAudioParam(1),
    })
  ctx.createGain = () => fakeAudioNode({ gain: fakeAudioParam(1) })
  ctx.createOscillator = () =>
    fakeAudioNode({
      detune: fakeAudioParam(0),
      frequency: fakeAudioParam(440),
      type: "sine",
    })
  ctx.decodeAudioData = () => Promise.reject(new Error("smoke: no audio decode"))
  ctx.resume = () => Promise.resolve()
  ctx.suspend = () => Promise.resolve()
  return ctx
}

window.HTMLCanvasElement.prototype.getContext = () => fakeCtx()
window.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new window.Blob([""], { type: "image/png" }))
window.scrollTo = () => {}
window.matchMedia =
  window.matchMedia ||
  (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
// 배경 미리듣기(HTMLAudioElement)·objectURL 스텁 — jsdom은 재생/objectURL 미구현
window.HTMLMediaElement.prototype.play = () => Promise.resolve()
window.HTMLMediaElement.prototype.pause = () => {}
window.URL.createObjectURL = () => "blob:smoke"
window.URL.revokeObjectURL = () => {}
window.alert = (message) => {
  lastAlert = String(message)
  alertCalls += 1
}
const smokeImageData = "data:image/png;base64,c21va2U="
window.FileReader = function () {
  this.result = smokeImageData
  this.onload = null
}
window.FileReader.prototype.readAsDataURL = function () {
  if (typeof this.onload === "function") this.onload({ target: this })
}
// 네트워크 없음 — 음원 로드는 실패시키고(합성 폴백 경로) 동기 ReferenceError만 방지
window.fetch = () => Promise.reject(new Error("smoke: no network"))
window.AudioContext = function () {
  return fakeAudioCtx()
}
window.OfflineAudioContext = window.AudioContext

const files = [
  "js/music-core.js",
  "js/manifest.js",
  "js/sample-maps.js",
  "js/sample-maps-western.js",
  "js/audio-plan.js",
  "js/audio-node-scope.js",
  "js/audio-pad-graph.js",
  "js/audio-engine.js",
  "js/drawing.js",
  "js/takes.js",
  "js/share-store.js",
  "js/studio-utils.js",
  "js/studio-export.js",
  "js/studio-setup-render.js",
  "js/studio-transport.js",
  "js/studio.js",
]
for (const f of files) window.eval(read(f))
window.document.dispatchEvent(new window.Event("DOMContentLoaded"))

const errors = []
function check(name, cond, actual) {
  if (cond) console.log("  OK  " + name)
  else {
    console.log("  FAIL: " + name + (actual !== undefined ? "  (actual: " + actual + ")" : ""))
    errors.push(name)
  }
}
const qc = (sel) => window.document.querySelectorAll(sel).length

const SD = window.SoundDrawing
check("window.SoundDrawing 노출", !!SD)
let s = SD.getStateSummary()
const publicApiKeys = [
  "getStateSummary",
  "play",
  "pause",
  "resume",
  "stop",
  "exportAudio",
  "publishSharedWork",
  "loadSharedChannel",
  "exportDrawingImage",
  "exportDrawingVideo",
  "shareLink",
  "loadRecipe",
  "buildRecipe",
  "buildSharedRecipe",
  "setStep",
  "setDrawingInputMode",
  "setAdminMode",
  "engine",
  "draw",
  "takes",
]
const missingPublicApiKeys = publicApiKeys.filter((key) => !(key in SD))
check("공개 QA API 계약 유지", missingPublicApiKeys.length === 0, missingPublicApiKeys.join(","))
const summaryKeys = [
  "duration",
  "atmosphere",
  "instrument",
  "style",
  "version",
  "mode",
  "drawingInputMode",
  "bgOffset",
  "bgEndOffset",
  "composerName",
  "backgroundReason",
  "melodyIntent",
  "hashtags",
  "actionCount",
  "step",
  "noteCount",
  "hasPicture",
  "takes",
  "sharedRecipeLoaded",
  "adminMode",
  "sharedChannel",
  "sharedWorks",
  "effectIds",
  "effectStamps",
  "effectStampId",
  "isPlaying",
  "isPaused",
  "lastMode",
]
const missingSummaryKeys = summaryKeys.filter((key) => !(key in s))
check("상태 요약 계약 유지", missingSummaryKeys.length === 0, missingSummaryKeys.join(","))
check("도달 불가능한 스튜디오 공유 UI 모듈 제거", typeof window.HwaeumStudioShareUI === "undefined")
check("기본 길이 30초", s.duration === 30)
check("기본 배경 없음", s.atmosphere === "none", s.atmosphere)
check("기본 악기 = 매니페스트 첫 악기", s.instrument === window.SDStudioData.instruments[0].id, s.instrument)
check("초기 단계 0", s.step === 0)
check("초기 음 수 0", s.noteCount === 0)

check(
  "배경 카드 = 매니페스트 배경 수",
  qc("#atmosphereGrid .mood-card") === window.SDStudioData.atmospheres.length,
  qc("#atmosphereGrid .mood-card") + "/" + window.SDStudioData.atmospheres.length,
)
check("단계 이름은 배경 음악 고르기", window.document.body.textContent.includes("배경 음악 고르기"))
check("2단계 악기 영역은 미리 듣기 문구를 쓴다", window.document.body.textContent.includes("이 배경에 어울리는 악기 미리 듣기"))
check(
  "배경 하위 범주 표시",
  Array.from(window.document.querySelectorAll("#atmosphereGrid .atmosphere-group-label"))
    .map((node) => node.textContent.trim())
    .join("|") === "배경 없음|분위기|소리풍경|리듬장단|내가 찾은 음악",
  Array.from(window.document.querySelectorAll("#atmosphereGrid .atmosphere-group-label"))
    .map((node) => node.textContent.trim())
    .join("|"),
)
check("배경 추가 카드 1개", qc("#atmosphereGrid .upload-card") === 1, qc("#atmosphereGrid .upload-card"))
const findMusicLink = window.document.querySelector("#atmosphereGrid .upload-action-secondary")
check("찾아보기 버튼은 Pixabay Music으로 연결", findMusicLink && findMusicLink.getAttribute("href") === "https://pixabay.com/music/")
check("찾아보기 버튼은 새 탭으로 열림", findMusicLink && findMusicLink.getAttribute("target") === "_blank")
const westernInstrumentCount = window.SDStudioData.instruments.filter((instrument) => instrument.group === "서양").length
check("악기 카드(서양) 매니페스트 수와 일치", qc("#instrumentGrid .card") === westernInstrumentCount, qc("#instrumentGrid .card"))
const westernFamilyLabels = Array.from(window.document.querySelectorAll("#instrumentGrid .instrument-family-head strong"))
  .map((node) => node.textContent.trim())
  .join("|")
check("서양 악기 분류 제목 표시", westernFamilyLabels === "관악기|현악기", westernFamilyLabels)
check("악기마다 감상 노트 입력칸", qc("#instrumentGrid .instrument-note-field") === westernInstrumentCount, qc("#instrumentGrid .instrument-note-field"))
check("악기 설명은 카드에 미리 보이지 않음", qc("#instrumentGrid .card-copy > span") === 0, qc("#instrumentGrid .card-copy > span"))
const firstNoteSlot = window.document.querySelector("#instrumentGrid .instrument-card-slot")
check(
  "감상 노트 슬롯도 악기 톤 색을 물려받는다",
  firstNoteSlot && firstNoteSlot.style.getPropertyValue("--instrument-color").trim() !== "",
  firstNoteSlot && firstNoteSlot.style.getPropertyValue("--instrument-color"),
)
check(
  "예시 답안은 눌러야 열림",
  qc("#instrumentGrid .instrument-answer[hidden]") === westernInstrumentCount,
  qc("#instrumentGrid .instrument-answer[hidden]"),
)
const firstAnswerBtn = window.document.querySelector("#instrumentGrid .instrument-answer-btn")
firstAnswerBtn.click()
check("예시 답안 보기 클릭 시 한 개만 열림", qc("#instrumentGrid .instrument-answer:not([hidden])") === 1, qc("#instrumentGrid .instrument-answer:not([hidden])"))
check("전자 악기 그룹 제거", qc("#instrumentGroups .group-tab") === 2, qc("#instrumentGroups .group-tab"))
check("신디 선택지 제거", window.SDStudioData.instruments.every((instrument) => instrument.id !== "synth"))
check("스타일 선택 카드 제거", qc("#styleGrid") === 0, qc("#styleGrid"))
check("연주 형태 토글 제거", qc("[data-mode]") === 0, qc("[data-mode]"))
check("믹스 선택 UI 제거", qc("#versionList") === 0 && !window.document.body.textContent.includes("믹스"), qc("#versionList"))
check("단계 탭 5개", qc("[data-step-jump]") === 5)
check(
  "국악 음원 출처 표기",
  window.document.getElementById("audioModeNote").textContent.trim() === "국악 음원 출처: 국립국악원 디지털음원 (공공누리 제1유형·출처표시)",
)
check("드로잉 참고 그림 영역 존재", qc("#drawingReferenceImg") === 1, qc("#drawingReferenceImg"))

const picInput = window.document.getElementById("picInput")
const picFile = new window.File(["img"], "그림.png", { type: "image/png" })
Object.defineProperty(picInput, "files", { value: [picFile], configurable: true })
picInput.dispatchEvent(new window.Event("change"))
check("드로잉 탭 참고 그림은 업로드 그림을 표시", window.document.getElementById("drawingReferenceImg").src === smokeImageData)

const groupTabs = Array.from(window.document.querySelectorAll("#instrumentGroups .group-tab"))
const gugakTab = groupTabs.find((tab) => tab.textContent === "국악")
const westernTab = groupTabs.find((tab) => tab.textContent === "서양")
gugakTab.click()
const gugakFamilyLabels = Array.from(window.document.querySelectorAll("#instrumentGrid .instrument-family-head strong"))
  .map((node) => node.textContent.trim())
  .join("|")
check("국악 악기 분류 제목 표시", gugakFamilyLabels === "관악기|현악기", gugakFamilyLabels)
const examplePlay = window.document.querySelector("#instrumentGrid .example-play")
examplePlay.click()
check("악기 감상 별도 정지 버튼 제거", window.document.getElementById("instrumentPreviewStopBtn") === null)
check(
  "악기 감상 중 카드 아이콘은 정지",
  window.document.querySelector("#instrumentGrid .card.playing .example-play").textContent === "■",
  window.document.querySelector("#instrumentGrid .card.playing .example-play")?.textContent,
)
window.document.querySelector("#instrumentGrid .card.playing .example-play").click()
check("악기 카드 정지 아이콘 재클릭으로 멈춤", qc("#instrumentGrid .card.playing") === 0)
westernTab.click()

// 감상 노트: 그리드가 통째로 다시 그려져도(연주곡 종료·악기 선택) 적던 글과 커서가 남아야 한다.
const noteField = window.document.querySelector("#instrumentGrid .instrument-note-field")
noteField.value = "물결 같은 소리"
noteField.dispatchEvent(new window.Event("input", { bubbles: true }))
noteField.focus()
noteField.setSelectionRange(3, 3)
westernTab.click() // 같은 그룹을 다시 렌더
const restoredNote = window.document.activeElement
check(
  "재렌더 후에도 감상 노트 글과 커서가 남는다",
  restoredNote &&
    restoredNote.dataset.noteInstrument === noteField.dataset.noteInstrument &&
    restoredNote.value === "물결 같은 소리" &&
    restoredNote.selectionStart === 3,
  restoredNote && restoredNote.className + "/" + restoredNote.value + "/" + restoredNote.selectionStart,
)

// 배경 클릭 → 미리듣기 토글
const firstMood = Array.from(window.document.querySelectorAll("#atmosphereGrid .mood-card")).find((card) =>
  card.querySelector(".mood-play"),
)
firstMood.click()
check("배경 클릭 시 미리듣기 시작", qc("#atmosphereGrid .mood-card.playing") === 1, qc("#atmosphereGrid .mood-card.playing"))
firstMood.click()
check("같은 배경 재클릭 시 미리듣기 정지", qc("#atmosphereGrid .mood-card.playing") === 0, qc("#atmosphereGrid .mood-card.playing"))

const bgInput = window.document.getElementById("bgUploadInput")
let bgInputClickCount = 0
bgInput.click = () => {
  bgInputClickCount += 1
}
window.document.querySelector("#atmosphereGrid .upload-action-primary").click()
check("내 배경 음원 추가 클릭 시 저작권 안내창 표시", alertCalls === 1 && lastAlert.includes("저작권 안내"), lastAlert)
check("저작권 안내 후 파일 선택창 호출", bgInputClickCount === 1, bgInputClickCount)
const largeFile = new window.File(["abc"], "큰음원.mp3", { type: "audio/mpeg" })
Object.defineProperty(largeFile, "size", { value: 50 * 1024 * 1024 + 1, configurable: true })
Object.defineProperty(bgInput, "files", { value: [largeFile], configurable: true })
bgInput.dispatchEvent(new window.Event("change"))
check("50MB 초과 배경음 업로드 차단", window.document.getElementById("bgUploadStatus").textContent.includes("50MB"))

// 내 배경 음원 추가(업로드)
const upFile = new window.File(["abc"], "내음원.mp3", { type: "audio/mpeg" })
Object.defineProperty(bgInput, "files", { value: [upFile], configurable: true })
bgInput.dispatchEvent(new window.Event("change"))
check(
  "업로드 후 배경 카드 +1",
  qc("#atmosphereGrid .mood-card") === window.SDStudioData.atmospheres.length,
  qc("#atmosphereGrid .mood-card") + "/" + window.SDStudioData.atmospheres.length,
)
check("업로드한 배경 선택됨(내음원)", SD.getStateSummary().atmosphere === "custom-1", SD.getStateSummary().atmosphere)

SD.draw.setPath([
  { x: 0, y: 0.6 },
  { x: 0.5, y: 0.3 },
  { x: 1, y: 0.5 },
])
check("드로잉 후 음 생성(noteCount>0)", SD.getStateSummary().noteCount > 0)

// 다중 획: 두 획이 모두 유지되고 소리가 생성된다
SD.draw.setStrokes([
  [{ x: 0, y: 0.6 }, { x: 0.3, y: 0.4 }],
  [{ x: 0.6, y: 0.3 }, { x: 1, y: 0.55 }],
])
check("다중 획 유지(2개)", SD.draw.getStrokes().length === 2, SD.draw.getStrokes().length)
check("다중 획에서 소리 생성", SD.getStateSummary().noteCount > 0)
check("레시피에 strokes 포함", SD.buildRecipe().strokes.length === 2, SD.buildRecipe().strokes.length)

// 오케스트라: 획마다 악기를 지정하면 recipe.strokeInstruments 에 1:1로 저장된다
SD.draw.setStrokes(
  [
    [{ x: 0, y: 0.6 }, { x: 0.4, y: 0.4 }],
    [{ x: 0.5, y: 0.3 }, { x: 1, y: 0.55 }],
  ],
  ["violin", "danso"],
)
check(
  "획별 악기 저장(violin/danso)",
  JSON.stringify(SD.buildRecipe().strokeInstruments) === '["violin","danso"]',
  JSON.stringify(SD.buildRecipe().strokeInstruments),
)
check("오케스트라 범례 렌더(현재 악기 표시)", qc("#orchestraLegend .orchestra-current") === 1, qc("#orchestraLegend .orchestra-current"))
check(
  "오케스트라 범례에 선택 악기 최대 개수 표시",
  window.document.querySelector("#orchestraLegend .orchestra-legend-label")?.textContent.trim() === "악기 줄 · 선택 악기",
  window.document.querySelector("#orchestraLegend .orchestra-legend-label")?.textContent.trim(),
)
// 지우개로 한 획을 둘로 쪼개도 그 획의 악기가 양쪽에 유지된다
SD.draw.setStrokes([[{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 0.9, y: 0.5 }]], ["cello"])
SD.draw.setEraseMode(true)
SD.draw._eraseAt({ x: 0.5, y: 0.5 })
SD.draw.setEraseMode(false)
const splitInsts = SD.draw.getStrokeInstruments()
check("지우개로 쪼갠 획도 악기 유지(cello)", splitInsts.length >= 2 && splitInsts.every((i) => i === "cello"), JSON.stringify(splitInsts))

// 배경음악 미니 플레이어 — 요소 존재 + 레시피에 bgOffset(기본 0) 포함
check(
  "배경음악 플레이어 요소 존재",
  qc("#bgPlayer") === 1 &&
    qc("#bgPlayBtn") === 1 &&
    qc("#bgSeek") === 1 &&
    qc("#bgEndSeek") === 1 &&
    qc("#bgStartInput") === 1 &&
    qc("#bgEndInput") === 1,
  qc("#bgPlayer") +
    "/" +
    qc("#bgPlayBtn") +
    "/" +
    qc("#bgSeek") +
    "/" +
    qc("#bgEndSeek") +
    "/" +
    qc("#bgStartInput") +
    "/" +
    qc("#bgEndInput"),
)
check("레시피에 bgOffset 포함(기본 0)", SD.buildRecipe().bgOffset === 0, SD.buildRecipe().bgOffset)
check("레시피에 bgEndOffset 포함(기본 0)", SD.buildRecipe().bgEndOffset === 0, SD.buildRecipe().bgEndOffset)
check("업로드 배경은 구간 선택 슬라이더 표시", window.document.querySelector(".bg-range").hidden === false)
check("드로잉 방식 토글 존재", qc("#drawModePictureBtn") === 1 && qc("#drawModeSoundBtn") === 1)
window.document.getElementById("drawModeSoundBtn").click()
check("소리모드 버튼으로 드로잉 방식 전환", SD.getStateSummary().drawingInputMode === "sound", SD.getStateSummary().drawingInputMode)
window.document.getElementById("drawModePictureBtn").click()
check("그림모드 버튼으로 드로잉 방식 복귀", SD.getStateSummary().drawingInputMode === "picture", SD.getStateSummary().drawingInputMode)
check("펜 버튼 존재", qc("#penBtn") === 1, qc("#penBtn"))
check(
  "펜 버튼에 단축키 표시",
  window.document.querySelector("#penBtn .tool-shortcut-badge")?.textContent === "1",
  window.document.querySelector("#penBtn .tool-shortcut-badge")?.textContent,
)
check(
  "지우개 버튼에 단축키 표시",
  window.document.querySelector("#clearBtn .tool-shortcut-badge")?.textContent === "2",
  window.document.querySelector("#clearBtn .tool-shortcut-badge")?.textContent,
)
check("완성 작곡가/회고 입력칸 존재", qc("#composerInput") === 1 && qc("#bgReasonInput") === 1 && qc("#melodyIntentInput") === 1 && qc("#hashtagsInput") === 1)
check(
  "완성 탭 일괄 내보내기/공유 버튼 제거",
  qc("#exportAudioBtn") === 0 && qc("#exportDrawingImageBtn") === 0 && qc("#exportCoverBtn") === 0 && qc("#shareBtn") === 0,
  qc("#exportAudioBtn") + "/" + qc("#exportDrawingImageBtn") + "/" + qc("#exportCoverBtn") + "/" + qc("#shareBtn"),
)
check(
  "완성 탭은 작품 저장과 공유 버튼을 제공",
  qc("#saveTakeBtn") === 1 && qc("#saveNewTakeBtn") === 0 && qc("#publishShareBtn") === 1 && qc("#myWorksTitle") === 1,
  qc("#saveTakeBtn") + "/" + qc("#saveNewTakeBtn") + "/" + qc("#publishShareBtn") + "/" + qc("#myWorksTitle"),
)
check(
  "완성 탭 공유 진행률은 공유 버튼 바로 아래에 있다",
  qc(".share-publish-panel") === 0 &&
    qc(".take-save-actions #publishShareBtn") === 1 &&
    window.document.querySelector(".completion-detail-panel > .take-save-actions + .publish-progress") != null,
  qc(".share-publish-panel") + "/" + qc(".take-save-actions #publishShareBtn") + "/" + qc(".completion-detail-panel > .take-save-actions + .publish-progress"),
)
check("완성 탭 관리자 모드 버튼 제거", qc("#adminModeBtn") === 0, qc("#adminModeBtn"))
check("완성 탭 음악 멈춤 버튼 제거", qc("#completeStopBtn") === 0, qc("#completeStopBtn"))
check("완성 탭 드로잉 영상 버튼 제거", qc("#exportDrawingVideoBtn") === 0, qc("#exportDrawingVideoBtn"))
check(
  "드로잉 저장 API 노출",
  typeof SD.exportAudio === "function" && typeof SD.exportDrawingImage === "function",
  typeof SD.exportAudio + "/" + typeof SD.exportDrawingImage,
)
check("완성 그림 재생 버튼 존재", qc("#framePlayBtn") === 1, qc("#framePlayBtn"))

// 지우개: 한 획을 그려두고 일부를 지우면 점이 줄어든다
SD.draw.setStrokes([[
  { x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 0.9, y: 0.5 },
]])
const beforeErase = SD.draw.getPath().length
SD.draw.setEraseMode(true)
SD.draw._eraseAt({ x: 0.5, y: 0.5 })
check("지우개로 일부 삭제(점 감소)", SD.draw.getPath().length < beforeErase, SD.draw.getPath().length + "<" + beforeErase)
SD.draw.setEraseMode(false)

// 재생 헤드 요소 존재
check("재생 헤드 요소 존재", qc("#playhead") === 1)
check("상단 재생 제어는 재생/정지 버튼만 표시", qc("#playBtn") === 1 && qc("#pauseBtn") === 0 && qc("#stopBtn") === 1)
const effectCount = Object.keys(window.SDStudioData.effects).length
check("효과음 도장 버튼 존재", qc("#effectList .effect-btn") === effectCount, qc("#effectList .effect-btn") + "/" + effectCount)
check("효과음 도장 버튼 이미지 표시", qc("#effectList .effect-btn img") === effectCount, qc("#effectList .effect-btn img") + "/" + effectCount)
check("새 동물 효과음 도장 표시", /귀뚜라미/.test(window.document.getElementById("effectList").textContent), window.document.getElementById("effectList").textContent)
check("새 효과 도장 표시", /방울pop/.test(window.document.getElementById("effectList").textContent), window.document.getElementById("effectList").textContent)

SD.draw.setPath([
  { x: 0, y: 0.6 },
  { x: 0.5, y: 0.3 },
  { x: 1, y: 0.5 },
])
const recipe = SD.buildRecipe()
check("레시피 path 보존(<=121)", recipe.path.length > 1 && recipe.path.length <= 121)
check("레시피에 업로드 그림 저장", recipe.picture === smokeImageData, recipe.picture)
const back = window.MusicCore.decodeRecipe(window.MusicCore.encodeRecipe(recipe))
check("레시피 코덱 왕복", JSON.stringify(back) === JSON.stringify(recipe))

let threw = null
try {
  SD.setStep(2)
} catch (e) {
  threw = e
}
check("setStep(2) 예외 없음", !threw)
const composeGroupLabels = Array.from(window.document.querySelectorAll("#composeInstrumentList .compose-instrument-group-head strong"))
  .map((node) => node.textContent.trim())
  .join("|")
check("드로잉 탭 악기 큰 분류 표시", composeGroupLabels === "서양|국악", composeGroupLabels)
const composeFamilyLabels = Array.from(window.document.querySelectorAll("#composeInstrumentList .compose-instrument-family-head"))
  .map((node) => node.textContent.trim())
  .join("|")
check("드로잉 탭 악기 세부 분류 표시", composeFamilyLabels === "관악기|현악기|관악기|현악기", composeFamilyLabels)
check("드로잉 탭 악기 버튼은 설명 없이 이름만 표시", qc("#composeInstrumentList .compose-instrument-text small") === 0, qc("#composeInstrumentList .compose-instrument-text small"))
const pitchLabelText = Array.from(window.document.querySelectorAll("#pitchLabels .pitch-label"))
  .map((el) => el.textContent)
  .join("|")
check("음높이 고정 라벨 표시", pitchLabelText.length > 0, pitchLabelText)
const canvasWrap = window.document.querySelector(".canvas-wrap")
const timelineDuration = SD.getStateSummary().duration
check(
  "드로잉 타임라인은 2.5초 칸 폭 고정",
  canvasWrap.dataset.segmentWidth === "240" &&
    canvasWrap.style.getPropertyValue("--timeline-width") === Math.ceil(56 + timelineDuration * 96) + "px",
  canvasWrap.dataset.segmentWidth + "/" + canvasWrap.style.getPropertyValue("--timeline-width"),
)
check(
  "드로잉 타임라인 라벨은 2.5초 간격",
  qc("#paletteLabels .palette-label") === Math.ceil(timelineDuration / 2.5),
  qc("#paletteLabels .palette-label"),
)
canvasWrap.scrollLeft = 360
canvasWrap.dispatchEvent(new window.Event("scroll"))
check(
  "음높이 라벨은 가로 스크롤 중에도 왼쪽에 고정",
  canvasWrap.style.getPropertyValue("--canvas-scroll-left") === "360px",
  canvasWrap.style.getPropertyValue("--canvas-scroll-left"),
)
const firstEffect = window.document.querySelector("#effectList .effect-btn")
let warmedEffectId = ""
const originalWarmEffect = SD.engine.warmEffect
SD.engine.warmEffect = (effect) => {
  warmedEffectId = effect.id
  return Promise.resolve(true)
}
firstEffect.click()
check("효과음 버튼 클릭 시 도장 선택", SD.getStateSummary().effectStampId === "wind1", SD.getStateSummary().effectStampId)
check("효과음 도장 선택 시 음원 미리 준비", warmedEffectId === "wind1", warmedEffectId)
const canvas = window.document.getElementById("drawingCanvas")
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 })
const timelineClientX = (progress) => {
  const labelWidth = SD.draw.pitchLabelGutterCssPx()
  return labelWidth + progress * (1000 - labelWidth)
}
let previewEffectId = ""
const originalPreviewEffect = SD.engine.previewEffect
SD.engine.previewEffect = (effect) => {
  previewEffectId = effect.id
  return Promise.resolve(true)
}
const makeCanvasPointerEvent = (progress, clientY = 300) => {
  const event = new window.Event("pointerdown", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clientX", { value: timelineClientX(progress) })
  Object.defineProperty(event, "clientY", { value: clientY })
  return event
}
canvas.dispatchEvent(makeCanvasPointerEvent(0.25))
check("캔버스 클릭 시 효과음 도장 추가", SD.buildRecipe().effectStamps.length === 1, SD.buildRecipe().effectStamps.length)
check("효과음 도장을 찍으면 바로 미리듣기", previewEffectId === "wind1", previewEffectId)
check("캔버스 효과음 도장 이미지 표시", qc("#effectStampLayer .effect-stamp img") === 1, qc("#effectStampLayer .effect-stamp img"))
check("효과음 도장은 시간 위치를 보존", SD.buildRecipe().effectStamps[0].x === 0.25, SD.buildRecipe().effectStamps[0].x)
window.document.getElementById("undoBtn").click()
check("되돌리기로 효과음 도장 추가 취소", SD.buildRecipe().effectStamps.length === 0, SD.buildRecipe().effectStamps.length)
canvas.dispatchEvent(makeCanvasPointerEvent(0.25))
check("되돌리기 뒤 효과음 도장 다시 추가", SD.buildRecipe().effectStamps.length === 1, SD.buildRecipe().effectStamps.length)
firstEffect.click()
check("효과음 버튼 재클릭 시 도장 선택 해제", SD.getStateSummary().effectStampId === null, SD.getStateSummary().effectStampId)
window.document.getElementById("clearBtn").click()
canvas.dispatchEvent(makeCanvasPointerEvent(0.25))
check("지우개로 효과음 도장 삭제", SD.buildRecipe().effectStamps.length === 0, SD.buildRecipe().effectStamps.length)
window.document.getElementById("undoBtn").click()
check("되돌리기로 지운 효과음 도장 복원", SD.buildRecipe().effectStamps.length === 1, SD.buildRecipe().effectStamps.length)
canvas.dispatchEvent(makeCanvasPointerEvent(0.25))
check("지우개로 효과음 도장 다시 삭제", SD.buildRecipe().effectStamps.length === 0, SD.buildRecipe().effectStamps.length)
window.document.getElementById("penBtn").click()
SD.engine.previewEffect = originalPreviewEffect
SD.engine.warmEffect = originalWarmEffect
SD.engine.ambience = { signature: "smoke", gain: null, nodes: [] }
SD.engine.onState(false, false)
check(
  "배경음이 켜져도 재생 버튼은 전체곡 재생 상태",
  !window.document.getElementById("playBtn").classList.contains("active") &&
    window.document.getElementById("playBtn").querySelector("span").textContent === "▶" &&
    window.document.getElementById("playBtn").getAttribute("aria-label") === "전체 듣기",
)
SD.setStep(3)
check(
  "배경음이 꺼진 뒤 재생 버튼은 재생 상태",
  !window.document.getElementById("playBtn").classList.contains("active") &&
    window.document.getElementById("playBtn").querySelector("span").textContent === "▶" &&
    window.document.getElementById("playBtn").getAttribute("aria-label") === "전체 듣기",
)
let copiedShareUrl = ""
Object.defineProperty(window.navigator, "clipboard", {
  value: {
    writeText: (text) => {
      copiedShareUrl = text
      return Promise.resolve()
    },
  },
  configurable: true,
})
SD.shareLink()
check("레시피 링크 복사는 현재 주소에 복원 해시 생성", window.location.hash.indexOf("#r=") === 0, window.location.hash)
check("레시피 링크 복사는 복사할 링크 생성", copiedShareUrl.indexOf("#r=") > 0, copiedShareUrl)
const copiedRecipeCode = copiedShareUrl.split("#r=")[1] || ""
const copiedRecipe = copiedRecipeCode ? window.MusicCore.decodeRecipe(copiedRecipeCode) : {}
check("공유 링크 레시피는 드로잉 공유 모드", copiedRecipe.shareMode === "drawing", copiedRecipe.shareMode)
check("공유 링크 레시피는 그린 선을 포함", copiedRecipe.strokes && copiedRecipe.strokes.length > 0, JSON.stringify(copiedRecipe.strokes))
check("공유 링크 레시피는 시간순 경로를 포함", copiedRecipe.path && copiedRecipe.path.length > 0, JSON.stringify(copiedRecipe.path))
SD.setStep(2)
window.document.getElementById("clearBtn").click()
check("지우개 버튼으로 지우개 모드 진입", SD.draw.eraseMode === true, SD.draw.eraseMode)
check("지우개 버튼 안내 문구 표시", window.document.getElementById("exportStatus").textContent === "지우개를 선택했어요.", window.document.getElementById("exportStatus").textContent)
window.document.getElementById("penBtn").click()
check("펜 버튼으로 그리기 모드 복귀", SD.draw.eraseMode === false, SD.draw.eraseMode)
check("펜 버튼 안내 문구 표시", window.document.getElementById("exportStatus").textContent === "펜을 선택했어요.", window.document.getElementById("exportStatus").textContent)
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "2", bubbles: true }))
check("키보드 2로 지우개 모드 진입", SD.draw.eraseMode === true, SD.draw.eraseMode)
check("키보드 2 안내 문구 표시", window.document.getElementById("exportStatus").textContent === "지우개를 선택했어요.", window.document.getElementById("exportStatus").textContent)
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "1", bubbles: true }))
check("키보드 1로 펜 모드 복귀", SD.draw.eraseMode === false, SD.draw.eraseMode)
check("키보드 1 안내 문구 표시", window.document.getElementById("exportStatus").textContent === "펜을 선택했어요.", window.document.getElementById("exportStatus").textContent)
const originalPlayForSpace = SD.engine.play
let spacePlayCalls = 0
SD.engine.play = () => {
  spacePlayCalls += 1
  return Promise.resolve("synth")
}
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }))
check("스페이스바로 상단 재생 버튼 동작", spacePlayCalls === 1, spacePlayCalls)
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true }))
check("스페이스바 길게 누름은 반복 토글하지 않음", spacePlayCalls === 1, spacePlayCalls)
window.document.getElementById("hashtagsInput").dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }))
check("입력칸 스페이스바는 재생 단축키로 쓰지 않음", spacePlayCalls === 1, spacePlayCalls)
SD.engine.play = originalPlayForSpace
window.document.getElementById("clearBtn").click()
window.document.querySelector(".compose-instrument:not(.active)")?.click()
check("지우개 모드에서 악기 선택 시 그리기 모드로 복귀", SD.draw.eraseMode === false, SD.draw.eraseMode)
check(
  "악기 선택 후 지우개 버튼 눌림 해제",
  window.document.getElementById("clearBtn").getAttribute("aria-pressed") === "false",
  window.document.getElementById("clearBtn").getAttribute("aria-pressed"),
)
if (SD.draw.eraseMode) window.document.getElementById("clearBtn").click()
const originalEnginePlay = SD.engine.play
SD.draw.setStrokes([])
let emptyDrawingPlayCalled = false
SD.engine.play = (recipe, notes) => {
  emptyDrawingPlayCalled = recipe.strokes.length === 0 && notes.length === 0
  return Promise.resolve("synth")
}
SD.play()
check("선 없이도 배경음악 재생 요청", emptyDrawingPlayCalled)
SD.draw.setStrokes([[{ x: 0.35, y: 0.35 }]])
let singleTapPlayCalled = false
SD.engine.play = () => {
  singleTapPlayCalled = true
  return Promise.resolve("synth")
}
SD.play()
check("점 하나만 찍어도 재생 요청", singleTapPlayCalled)
SD.engine.play = originalEnginePlay
let ambienceRestartCalls = 0
const originalStartAmbience = SD.engine.startAmbience
SD.engine.startAmbience = () => {
  ambienceRestartCalls += 1
  return Promise.resolve()
}
SD.engine.onState(false, false)
check("완성곡 종료 후 드로잉 배경음 자동 재시작 없음", ambienceRestartCalls === 0, ambienceRestartCalls)
SD.engine.startAmbience = originalStartAmbience

SD.setStep(3)
const titleInput = window.document.getElementById("titleInput")
titleInput.value = "잔잔한 선"
titleInput.dispatchEvent(new window.Event("input", { bubbles: true }))
const composerInput = window.document.getElementById("composerInput")
composerInput.value = "3반 김하음"
composerInput.dispatchEvent(new window.Event("input", { bubbles: true }))
const bgReasonInput = window.document.getElementById("bgReasonInput")
const melodyIntentInput = window.document.getElementById("melodyIntentInput")
const hashtagsInput = window.document.getElementById("hashtagsInput")
bgReasonInput.value = "잔잔한 색과 어울리는 배경을 골랐어요."
bgReasonInput.dispatchEvent(new window.Event("input", { bubbles: true }))
melodyIntentInput.value = "위로 올라가는 선으로 밝아지는 느낌을 표현했어요."
melodyIntentInput.dispatchEvent(new window.Event("input", { bubbles: true }))
hashtagsInput.value = "잔잔함, 기대, 봄"
hashtagsInput.dispatchEvent(new window.Event("input", { bubbles: true }))
check("쉼표 입력은 그 자리에서 칩이 됨", qc("#hashtagChipBox .hashtag-chip") === 3, qc("#hashtagChipBox .hashtag-chip"))
const reflectionRecipe = SD.buildRecipe()
check("레시피에 작품 제목 저장", reflectionRecipe.title === "잔잔한 선", reflectionRecipe.title)
check("레시피에 작곡가 이름 저장", reflectionRecipe.composerName === "3반 김하음", reflectionRecipe.composerName)
check("레시피에 배경 선택 이유 저장", reflectionRecipe.backgroundReason === "잔잔한 색과 어울리는 배경을 골랐어요.")
check("레시피에 선율 의도 저장", reflectionRecipe.melodyIntent === "위로 올라가는 선으로 밝아지는 느낌을 표현했어요.")
check("레시피에 설명 단어 3개 저장", JSON.stringify(reflectionRecipe.hashtags) === '["잔잔함","기대","봄"]', JSON.stringify(reflectionRecipe.hashtags))
const linkRecipe = SD.buildSharedRecipe()
check("링크 공유용 레시피는 제목을 초기화", linkRecipe.title === "무제", linkRecipe.title)
check("링크 공유용 레시피는 작곡가 이름을 유지", linkRecipe.composerName === "3반 김하음", linkRecipe.composerName)
check("링크 공유용 레시피는 완성 탭 글을 비움", linkRecipe.backgroundReason === "" && linkRecipe.melodyIntent === "" && linkRecipe.hashtags.length === 0)

SD.loadRecipe({
  duration: 45,
  atmosphere: "calm",
  instrument: "violin",
  style: "bright",
  version: "balanced",
  mode: "melody",
  picture: "data:image/png;base64,bG9hZGVk",
  pictureName: "불러온 그림",
  composerName: "불러온 작곡가",
  bgOffset: 2,
  bgEndOffset: 8,
  path: [],
})
check("loadRecipe는 그림을 상단 썸네일에 복원", window.document.getElementById("picThumb").src === "data:image/png;base64,bG9hZGVk")
check("loadRecipe는 그림을 완성 표지에 복원", window.document.getElementById("frameImg").src === "data:image/png;base64,bG9hZGVk")
check("loadRecipe는 작곡가 입력을 복원", window.document.getElementById("composerInput").value === "불러온 작곡가")
check("기본 배경 loadRecipe는 구간 시작 복원", SD.buildRecipe().bgOffset === 2, SD.buildRecipe().bgOffset)
check("기본 배경 loadRecipe는 구간 끝 복원", SD.buildRecipe().bgEndOffset === 8, SD.buildRecipe().bgEndOffset)
check("기본 배경은 구간 선택 슬라이더 표시", window.document.querySelector(".bg-range").hidden === false)

SD.loadRecipe({
  duration: 45,
  atmosphere: "custom-1",
  instrument: "daegeum",
  style: "gugak",
  version: "ornament",
  mode: "melody",
  bgOffset: 2,
  bgEndOffset: 8,
  backgroundReason: "불러온 이유",
  melodyIntent: "불러온 의도",
  hashtags: ["하나", "둘"],
  path: [
    { x: 0, y: 0.4 },
    { x: 1, y: 0.7 },
  ],
})
s = SD.getStateSummary()
check("loadRecipe 길이 45초 유지", s.duration === 45, s.duration)
check("loadRecipe는 옛 믹스 값을 기본값으로 고정", s.version === "balanced", s.version)
check("loadRecipe 악기 daegeum", s.instrument === "daegeum")
check("loadRecipe 무드색 적용", window.document.documentElement.style.getPropertyValue("--accent") === "#6b8f9c")
check("loadRecipe 업로드 배경 끝 지점 복원", SD.buildRecipe().bgEndOffset === 8, SD.buildRecipe().bgEndOffset)
check("loadRecipe 업로드 배경은 구간 선택 슬라이더 표시", window.document.querySelector(".bg-range").hidden === false)
check("loadRecipe 회고 입력 복원", window.document.getElementById("bgReasonInput").value === "불러온 이유")
check("loadRecipe 설명 단어 칩 복원", qc("#hashtagChipBox .hashtag-chip") === 2 && JSON.stringify(SD.getStateSummary().hashtags) === '["하나","둘"]', JSON.stringify(SD.getStateSummary().hashtags))
SD.draw.setStrokes([[{ x: 0.2, y: 0.4 }, { x: 0.4, y: 0.5 }]], ["daegeum"])
window.document.getElementById("resetComposeBtn").click()
check("초기화는 업로드 배경 시작 구간 유지", SD.buildRecipe().bgOffset === 2, SD.buildRecipe().bgOffset)
check("초기화는 업로드 배경 끝 구간 유지", SD.buildRecipe().bgEndOffset === 8, SD.buildRecipe().bgEndOffset)
check("초기화는 드로잉만 삭제", SD.draw.getStrokes().length === 0 && SD.buildRecipe().effectStamps.length === 0)

SD.takes.clearAll()
const savedTake = SD.takes.add(Object.assign({}, recipe, { title: "테스트" }), "테스트")
check("테이크 저장됨", SD.takes.list().length === 1)
SD.setStep(3)
check("저장된 시도 제목 텍스트 표시", qc(".take-name-text") === 1, qc(".take-name-text"))
check("저장된 시도 제목 입력칸 제거", qc(".take-name-input") === 0, qc(".take-name-input"))
check("저장된 시도 제목 텍스트 내용", window.document.querySelector(".take-name-text").textContent === "테스트", window.document.querySelector(".take-name-text").textContent)
check("저장된 작품 카드에 업로드 그림 표시", window.document.querySelector(".take-cover-img")?.src === smokeImageData, window.document.querySelector(".take-cover-img")?.src)
check("저장된 시도 액션 버튼 3개(음악/이미지/수정)", qc(".take-action") === 3, qc(".take-action"))
check(
  "저장된 시도 액션 버튼 라벨",
  Array.from(window.document.querySelectorAll(".take-action")).map((b) => b.textContent).join("/") === "음악 저장/이미지 저장/수정",
  Array.from(window.document.querySelectorAll(".take-action")).map((b) => b.textContent).join("/"),
)
SD.loadRecipe(Object.assign({}, recipe, { picture: "data:image/png;base64,ZGlydHk=", pictureName: "다른 그림" }))
window.document.querySelector(".take").click()
check("저장된 시도 클릭 시 그림 복원", window.document.getElementById("frameImg").src === smokeImageData)
check("저장된 시도 일시정지 버튼 표시", qc(".take-pause") === 1, qc(".take-pause"))
check("저장된 시도는 재생 전 일시정지 비활성", window.document.querySelector(".take-pause").disabled === true)
const originalTakePlay = SD.engine.play
const originalTakePause = SD.engine.pause
let takePlayCalls = 0
let takePauseCalls = 0
SD.engine.isPlaying = false
SD.engine.isPaused = false
SD.engine.ambience = null
SD.engine.play = () => {
  takePlayCalls += 1
  SD.engine.isPlaying = true
  SD.engine.isPaused = false
  SD.engine.ambience = null
  return Promise.resolve("synth")
}
SD.engine.pause = () => {
  takePauseCalls += 1
  SD.engine.isPlaying = true
  SD.engine.isPaused = true
  return true
}
window.document.querySelector(".take-play").click()
const activeTakePause = window.document.querySelector(".take-pause")
check("저장된 시도 재생 버튼 동작", takePlayCalls === 1, takePlayCalls)
check("저장된 시도 재생 중 일시정지 활성", activeTakePause.disabled === false && activeTakePause.textContent === "❚❚")
activeTakePause.click()
check("저장된 시도 일시정지 버튼 동작", takePauseCalls === 1, takePauseCalls)
check("저장된 시도 일시정지 후 이어듣기 표시", window.document.querySelector(".take-pause").textContent === "▶")
check("저장된 시도 재생 시 완성 제목 반영", window.document.getElementById("titleInput").value === "테스트", window.document.getElementById("titleInput").value)
SD.engine.play = originalTakePlay
SD.engine.pause = originalTakePause
SD.stop()
SD.setAdminMode(true)
check("관리자 모드 켜짐", SD.getStateSummary().adminMode === true)
check("localStorage 재로드 유지", new window.TakesStore("sda.takes").list().length === 1)
const newestTake = SD.takes.add(recipe, "마지막")
const orderedTakes = SD.takes.list()
check(
  "내 작품은 마지막 작품이 위로 쌓임",
  orderedTakes.length === 2 && orderedTakes[0].id === newestTake.id,
  orderedTakes.map((take) => take.name).join("/"),
)

console.log("")
if (errors.length) {
  console.log("실패 " + errors.length + "건")
  process.exit(1)
} else {
  console.log("모든 스모크 검증 통과")
}
