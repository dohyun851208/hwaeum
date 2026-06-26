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

let html = read("index.html").replace(/<script[\s\S]*?<\/script>/g, "")

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
// 네트워크 없음 — 음원 로드는 실패시키고(합성 폴백 경로) 동기 ReferenceError만 방지
window.fetch = () => Promise.reject(new Error("smoke: no network"))
window.AudioContext = function () {
  this.sampleRate = 44100
  this.currentTime = 0
  this.state = "running"
}
window.OfflineAudioContext = window.AudioContext

const files = [
  "js/music-core.js",
  "js/manifest.js",
  "js/audio-engine.js",
  "js/drawing.js",
  "js/takes.js",
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
check("기본 길이 30초", s.duration === 30)
check("기본 배경 calm", s.atmosphere === "calm")
check("기본 악기 = 매니페스트 첫 악기", s.instrument === window.SDStudioData.instruments[0].id, s.instrument)
check("초기 단계 0", s.step === 0)
check("초기 음 수 0", s.noteCount === 0)

check(
  "배경 카드 = 매니페스트 배경 수",
  qc("#atmosphereGrid .mood-card") === window.SDStudioData.atmospheres.length,
  qc("#atmosphereGrid .mood-card") + "/" + window.SDStudioData.atmospheres.length,
)
check("단계 이름은 배경/악기", window.document.body.textContent.includes("배경/악기"))
check(
  "배경 하위 범주 표시",
  Array.from(window.document.querySelectorAll("#atmosphereGrid .atmosphere-group-label"))
    .map((node) => node.textContent.trim())
    .join("|") === "분위기|소리풍경|리듬장단",
  Array.from(window.document.querySelectorAll("#atmosphereGrid .atmosphere-group-label"))
    .map((node) => node.textContent.trim())
    .join("|"),
)
check("배경 추가 카드 1개", qc("#atmosphereGrid .upload-card") === 1, qc("#atmosphereGrid .upload-card"))
const findMusicLink = window.document.querySelector("#atmosphereGrid .upload-action-secondary")
check("찾아보기 버튼은 Pixabay Music으로 연결", findMusicLink && findMusicLink.getAttribute("href") === "https://pixabay.com/music/")
check("찾아보기 버튼은 새 탭으로 열림", findMusicLink && findMusicLink.getAttribute("target") === "_blank")
check("악기 카드(서양) 9개", qc("#instrumentGrid .card") === 9, qc("#instrumentGrid .card"))
check("전자 악기 그룹 제거", qc("#instrumentGroups .group-tab") === 2, qc("#instrumentGroups .group-tab"))
check("신디 선택지 제거", window.SDStudioData.instruments.every((instrument) => instrument.id !== "synth"))
check("스타일 선택 카드 제거", qc("#styleGrid") === 0, qc("#styleGrid"))
check("연주 형태 토글 제거", qc("[data-mode]") === 0, qc("[data-mode]"))
check("믹스 선택 UI 제거", qc("#versionList") === 0 && !window.document.body.textContent.includes("믹스"), qc("#versionList"))
check("단계 탭 4개", qc("[data-step-jump]") === 4)
check("국악 음원 출처 표기", window.document.getElementById("audioModeNote").textContent.includes("국립국악원"))

const groupTabs = Array.from(window.document.querySelectorAll("#instrumentGroups .group-tab"))
const gugakTab = groupTabs.find((tab) => tab.textContent === "국악")
const westernTab = groupTabs.find((tab) => tab.textContent === "서양")
gugakTab.click()
const examplePlay = window.document.querySelector("#instrumentGrid .example-play")
examplePlay.click()
check("악기 감상 중 정지 버튼 표시", window.document.getElementById("instrumentPreviewStopBtn").hidden === false)
check(
  "악기 감상 중 카드 아이콘은 정지",
  window.document.querySelector("#instrumentGrid .card.playing .example-play").textContent === "■",
  window.document.querySelector("#instrumentGrid .card.playing .example-play")?.textContent,
)
window.document.getElementById("instrumentPreviewStopBtn").click()
check("악기 감상 정지 버튼으로 멈춤", qc("#instrumentGrid .card.playing") === 0 && window.document.getElementById("instrumentPreviewStopBtn").hidden === true)
westernTab.click()

// 배경 클릭 → 미리듣기 토글
const firstMood = window.document.querySelector("#atmosphereGrid .mood-card")
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
  qc("#bgPlayer") === 1 && qc("#bgPlayBtn") === 1 && qc("#bgSeek") === 1 && qc("#bgEndSeek") === 1,
  qc("#bgPlayer") + "/" + qc("#bgPlayBtn") + "/" + qc("#bgSeek") + "/" + qc("#bgEndSeek"),
)
check("레시피에 bgOffset 포함(기본 0)", SD.buildRecipe().bgOffset === 0, SD.buildRecipe().bgOffset)
check("레시피에 bgEndOffset 포함(기본 0)", SD.buildRecipe().bgEndOffset === 0, SD.buildRecipe().bgEndOffset)
check("업로드 배경은 구간 선택 슬라이더 표시", window.document.querySelector(".bg-range").hidden === false)
check("펜 버튼 존재", qc("#penBtn") === 1, qc("#penBtn"))
check("완성 회고 입력칸 존재", qc("#bgReasonInput") === 1 && qc("#melodyIntentInput") === 1 && qc("#hashtagsInput") === 1)
check(
  "드로잉 저장 버튼 존재",
  qc("#exportDrawingImageBtn") === 1 && qc("#exportDrawingVideoBtn") === 1,
  qc("#exportDrawingImageBtn") + "/" + qc("#exportDrawingVideoBtn"),
)
check(
  "드로잉 저장 API 노출",
  typeof SD.exportDrawingImage === "function" && typeof SD.exportDrawingVideo === "function",
  typeof SD.exportDrawingImage + "/" + typeof SD.exportDrawingVideo,
)

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
check("일시정지 버튼 존재", qc("#pauseBtn") === 1)
check("효과음 도장 버튼 존재", qc("#effectList .effect-btn") >= 22, qc("#effectList .effect-btn"))
check("효과음 도장 버튼 이미지 표시", qc("#effectList .effect-btn img") >= 22, qc("#effectList .effect-btn img"))
check("새 동물 효과음 도장 표시", /귀뚜라미/.test(window.document.getElementById("effectList").textContent), window.document.getElementById("effectList").textContent)
check("새 효과 도장 표시", /방울pop/.test(window.document.getElementById("effectList").textContent), window.document.getElementById("effectList").textContent)

SD.draw.setPath([
  { x: 0, y: 0.6 },
  { x: 0.5, y: 0.3 },
  { x: 1, y: 0.5 },
])
const recipe = SD.buildRecipe()
check("레시피 path 보존(<=121)", recipe.path.length > 1 && recipe.path.length <= 121)
const back = window.MusicCore.decodeRecipe(window.MusicCore.encodeRecipe(recipe))
check("레시피 코덱 왕복", JSON.stringify(back) === JSON.stringify(recipe))

let threw = null
try {
  SD.setStep(2)
} catch (e) {
  threw = e
}
check("setStep(2) 예외 없음", !threw)
const pitchLabelText = Array.from(window.document.querySelectorAll("#pitchLabels .pitch-label"))
  .map((el) => el.textContent)
  .join("|")
check("음높이 고정 라벨 표시", pitchLabelText.includes("G3") && pitchLabelText.includes("G5"), pitchLabelText)
const canvasWrap = window.document.querySelector(".canvas-wrap")
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
let previewEffectId = ""
const originalPreviewEffect = SD.engine.previewEffect
SD.engine.previewEffect = (effect) => {
  previewEffectId = effect.id
  return Promise.resolve(true)
}
const stampEvent = new window.Event("pointerdown", { bubbles: true, cancelable: true })
Object.defineProperty(stampEvent, "clientX", { value: 250 })
Object.defineProperty(stampEvent, "clientY", { value: 300 })
canvas.dispatchEvent(stampEvent)
check("캔버스 클릭 시 효과음 도장 추가", SD.buildRecipe().effectStamps.length === 1, SD.buildRecipe().effectStamps.length)
check("효과음 도장을 찍으면 바로 미리듣기", previewEffectId === "wind1", previewEffectId)
check("캔버스 효과음 도장 이미지 표시", qc("#effectStampLayer .effect-stamp img") === 1, qc("#effectStampLayer .effect-stamp img"))
check("효과음 도장은 시간 위치를 보존", SD.buildRecipe().effectStamps[0].x === 0.25, SD.buildRecipe().effectStamps[0].x)
firstEffect.click()
check("효과음 버튼 재클릭 시 도장 선택 해제", SD.getStateSummary().effectStampId === null, SD.getStateSummary().effectStampId)
window.document.getElementById("clearBtn").click()
const eraseStampEvent = new window.Event("pointerdown", { bubbles: true, cancelable: true })
Object.defineProperty(eraseStampEvent, "clientX", { value: 250 })
Object.defineProperty(eraseStampEvent, "clientY", { value: 300 })
canvas.dispatchEvent(eraseStampEvent)
check("지우개로 효과음 도장 삭제", SD.buildRecipe().effectStamps.length === 0, SD.buildRecipe().effectStamps.length)
window.document.getElementById("penBtn").click()
SD.engine.previewEffect = originalPreviewEffect
SD.engine.warmEffect = originalWarmEffect
SD.engine.ambience = { signature: "smoke", gain: null, nodes: [] }
SD.engine.onState(false, false)
check("배경음이 켜지면 일시정지 버튼 활성화", window.document.getElementById("pauseBtn").disabled === false)
check("완성 페이지 음악 멈춤 버튼도 활성화", window.document.getElementById("completeStopBtn").disabled === false)
SD.setStep(3)
check("배경음이 꺼진 뒤 일시정지 버튼 비활성화", window.document.getElementById("pauseBtn").disabled === true)
check("완성 페이지 음악 멈춤 버튼 비활성화", window.document.getElementById("completeStopBtn").disabled === true)
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
window.document.getElementById("shareBtn").click()
check("공유 버튼은 현재 주소에 복원 해시 생성", window.location.hash.indexOf("#r=") === 0, window.location.hash)
check("공유 버튼은 복사할 링크 생성", copiedShareUrl.indexOf("#r=") > 0, copiedShareUrl)
SD.setStep(2)
window.document.getElementById("clearBtn").click()
check("지우개 버튼으로 지우개 모드 진입", SD.draw.eraseMode === true, SD.draw.eraseMode)
window.document.getElementById("penBtn").click()
check("펜 버튼으로 그리기 모드 복귀", SD.draw.eraseMode === false, SD.draw.eraseMode)
window.document.getElementById("clearBtn").click()
window.document.querySelector(".compose-instrument:not(.active)")?.click()
check("지우개 모드에서 악기 선택 시 그리기 모드로 복귀", SD.draw.eraseMode === false, SD.draw.eraseMode)
check(
  "악기 선택 후 지우개 버튼 눌림 해제",
  window.document.getElementById("clearBtn").getAttribute("aria-pressed") === "false",
  window.document.getElementById("clearBtn").getAttribute("aria-pressed"),
)
if (SD.draw.eraseMode) window.document.getElementById("clearBtn").click()
SD.draw.setStrokes([[{ x: 0.35, y: 0.35 }]])
let singleTapPlayCalled = false
const originalEnginePlay = SD.engine.play
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
const bgReasonInput = window.document.getElementById("bgReasonInput")
const melodyIntentInput = window.document.getElementById("melodyIntentInput")
const hashtagsInput = window.document.getElementById("hashtagsInput")
bgReasonInput.value = "잔잔한 색과 어울리는 배경을 골랐어요."
bgReasonInput.dispatchEvent(new window.Event("input", { bubbles: true }))
melodyIntentInput.value = "위로 올라가는 선으로 밝아지는 느낌을 표현했어요."
melodyIntentInput.dispatchEvent(new window.Event("input", { bubbles: true }))
hashtagsInput.value = "#잔잔함 #기대 #봄"
hashtagsInput.dispatchEvent(new window.Event("input", { bubbles: true }))
const reflectionRecipe = SD.buildRecipe()
check("레시피에 배경 선택 이유 저장", reflectionRecipe.backgroundReason === "잔잔한 색과 어울리는 배경을 골랐어요.")
check("레시피에 선율 의도 저장", reflectionRecipe.melodyIntent === "위로 올라가는 선으로 밝아지는 느낌을 표현했어요.")
check("레시피에 해시태그 3개 저장", JSON.stringify(reflectionRecipe.hashtags) === '["잔잔함","기대","봄"]', JSON.stringify(reflectionRecipe.hashtags))

SD.loadRecipe({
  duration: 45,
  atmosphere: "calm",
  instrument: "violin",
  style: "bright",
  version: "balanced",
  mode: "melody",
  bgOffset: 2,
  bgEndOffset: 8,
  path: [],
})
check("기본 배경 loadRecipe는 구간 값을 버림", SD.buildRecipe().bgEndOffset === 0, SD.buildRecipe().bgEndOffset)
check("기본 배경은 구간 선택 슬라이더 숨김", window.document.querySelector(".bg-range").hidden === true)

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
check("loadRecipe 길이 30 고정(옛 45초 레시피도 정규화)", s.duration === 30, s.duration)
check("loadRecipe는 옛 믹스 값을 기본값으로 고정", s.version === "balanced", s.version)
check("loadRecipe 악기 daegeum", s.instrument === "daegeum")
check("loadRecipe 무드색 적용", window.document.documentElement.style.getPropertyValue("--accent") === "#6b8f9c")
check("loadRecipe 업로드 배경 끝 지점 복원", SD.buildRecipe().bgEndOffset === 8, SD.buildRecipe().bgEndOffset)
check("loadRecipe 업로드 배경은 구간 선택 슬라이더 표시", window.document.querySelector(".bg-range").hidden === false)
check("loadRecipe 회고 입력 복원", window.document.getElementById("bgReasonInput").value === "불러온 이유")
check("loadRecipe 해시태그 입력 복원", window.document.getElementById("hashtagsInput").value === "#하나 #둘")
SD.draw.setStrokes([[{ x: 0.2, y: 0.4 }, { x: 0.4, y: 0.5 }]], ["daegeum"])
window.document.getElementById("resetComposeBtn").click()
check("초기화는 업로드 배경 시작 구간 유지", SD.buildRecipe().bgOffset === 2, SD.buildRecipe().bgOffset)
check("초기화는 업로드 배경 끝 구간 유지", SD.buildRecipe().bgEndOffset === 8, SD.buildRecipe().bgEndOffset)
check("초기화는 드로잉만 삭제", SD.draw.getStrokes().length === 0 && SD.buildRecipe().effectStamps.length === 0)

SD.takes.clearAll()
const savedTake = SD.takes.add(recipe, "테스트")
check("테이크 저장됨", SD.takes.list().length === 1)
check("테이크 이름 수정 저장됨", SD.takes.rename(savedTake.id, "1번 학생") && SD.takes.get(savedTake.id).name === "1번 학생")
SD.setAdminMode(true)
check("관리자 모드 켜짐", SD.getStateSummary().adminMode === true)
check("관리자 이름 입력 표시", qc(".take-name-input") === 1, qc(".take-name-input"))
const nameInput = window.document.querySelector(".take-name-input")
const nameSave = window.document.querySelector(".take-name-save")
nameInput.value = "홍길동"
nameSave.click()
check("관리자 이름 저장 반영", SD.takes.get(savedTake.id).name === "홍길동", SD.takes.get(savedTake.id).name)
check("localStorage 재로드 유지", new window.TakesStore("sda.takes").list().length === 1)

console.log("")
if (errors.length) {
  console.log("실패 " + errors.length + "건")
  process.exit(1)
} else {
  console.log("모든 스모크 검증 통과")
}
