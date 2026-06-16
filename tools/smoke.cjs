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
check("기본 분위기 calm", s.atmosphere === "calm")
check("기본 악기 violin", s.instrument === "violin")
check("기본 음계 C Major", s.style === "C Major")
check("기본 모드 melody", s.mode === "melody")
check("초기 단계 0", s.step === 0)
check("초기 음 수 0", s.noteCount === 0)

check("분위기 카드 6개", qc("#atmosphereGrid .mood-card") === 6, qc("#atmosphereGrid .mood-card"))
check("배경 추가 카드 1개", qc("#atmosphereGrid .upload-card") === 1, qc("#atmosphereGrid .upload-card"))
check("악기 카드(서양) 7개", qc("#instrumentGrid .card") === 7, qc("#instrumentGrid .card"))
check("음계 카드 5개", qc("#styleGrid .card") === 5, qc("#styleGrid .card"))
check("믹스 버전 4개", qc("#versionList .version") === 4, qc("#versionList .version"))
check("단계 탭 5개", qc("[data-step-jump]") === 5)

// 분위기 클릭 → 배경 미리듣기 토글
const firstMood = window.document.querySelector("#atmosphereGrid .mood-card")
firstMood.click()
check("분위기 클릭 시 미리듣기 시작", qc("#atmosphereGrid .mood-card.playing") === 1, qc("#atmosphereGrid .mood-card.playing"))
firstMood.click()
check("같은 분위기 재클릭 시 미리듣기 정지", qc("#atmosphereGrid .mood-card.playing") === 0, qc("#atmosphereGrid .mood-card.playing"))

// 내 배경 음원 추가(업로드)
const upFile = new window.File(["abc"], "내음원.mp3", { type: "audio/mpeg" })
const bgInput = window.document.getElementById("bgUploadInput")
Object.defineProperty(bgInput, "files", { value: [upFile], configurable: true })
bgInput.dispatchEvent(new window.Event("change"))
check("업로드 후 분위기 카드 7개", qc("#atmosphereGrid .mood-card") === 7, qc("#atmosphereGrid .mood-card"))
check("업로드한 분위기 선택됨(내음원)", SD.getStateSummary().atmosphere === "custom-1", SD.getStateSummary().atmosphere)

SD.draw.setPath([
  { x: 0, y: 0.6 },
  { x: 0.5, y: 0.3 },
  { x: 1, y: 0.5 },
])
check("드로잉 후 음 생성(noteCount>0)", SD.getStateSummary().noteCount > 0)

// 다중 획: 두 획이 모두 유지되고 선율이 생성된다
SD.draw.setStrokes([
  [{ x: 0, y: 0.6 }, { x: 0.3, y: 0.4 }],
  [{ x: 0.6, y: 0.3 }, { x: 1, y: 0.55 }],
])
check("다중 획 유지(2개)", SD.draw.getStrokes().length === 2, SD.draw.getStrokes().length)
check("다중 획에서 선율 생성", SD.getStateSummary().noteCount > 0)
check("레시피에 strokes 포함", SD.buildRecipe().strokes.length === 2, SD.buildRecipe().strokes.length)

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
  SD.setStep(4)
} catch (e) {
  threw = e
}
check("setStep(4) 예외 없음", !threw)

SD.loadRecipe({
  duration: 45,
  atmosphere: "exotic",
  instrument: "daegeum",
  style: "gugak",
  version: "ornament",
  mode: "melody",
  path: [
    { x: 0, y: 0.4 },
    { x: 1, y: 0.7 },
  ],
})
s = SD.getStateSummary()
check("loadRecipe 길이 45", s.duration === 45)
check("loadRecipe 악기 daegeum", s.instrument === "daegeum")
check("loadRecipe 무드색 적용", window.document.documentElement.style.getPropertyValue("--accent") === "#8a6fb0")

SD.takes.clearAll()
SD.takes.add(recipe, "테스트")
check("테이크 저장됨", SD.takes.list().length === 1)
check("localStorage 재로드 유지", new window.TakesStore("sda.takes").list().length === 1)

console.log("")
if (errors.length) {
  console.log("실패 " + errors.length + "건")
  process.exit(1)
} else {
  console.log("모든 스모크 검증 통과")
}
