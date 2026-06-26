const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const path = require("path")

// manifest.js 는 브라우저 전역(window/self.SDStudioData)에 노출된다.
// self 를 빈 객체로 흉내내 Node 에서 로드한다.
function loadData() {
  const code = fs.readFileSync(path.join(__dirname, "../js/manifest.js"), "utf8")
  const fn = new Function("self", code + "\n;return self.SDStudioData")
  return fn({})
}

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, "../js/audio-engine.js"), "utf8")

// schedule() 의 선율 음표 envelope 피크 계수 (velocity 0.7 × 0.85) 와 master 게인.
const MELODY_ENV_PEAK = 0.7 * 0.85
const MASTER = 0.85

// 배경은 연속음이라 padGain 그대로, 선율은 음표 피크라 envelope 를 곱한 값으로 비교한다.
function bgFactor(v) {
  return v.padGain * MASTER
}
function melodyPeakFactor(v) {
  return v.melodyGain * MELODY_ENV_PEAK * MASTER
}

test("녹음 배경 패드에 추가 부스트(×1.25)가 없어야 한다 — 녹음/합성 패드 일관성", () => {
  // 녹음 배경만 padGain×1.25 로 키우면 합성 패드보다 커지고 선율이 묻힌다.
  assert.ok(
    !/padGain\s*\*\s*1\.25/.test(ENGINE_SRC),
    "audio-engine.js 의 배경 패드가 padGain 보다 크게 증폭되고 있다"
  )
})

test("균형(balanced) 믹스: 선율이 배경 위로 또렷하되 배경을 덮지는 않아야 한다", () => {
  // 사용자 피드백(2026-06-22): 선율이 배경에 묻힌다 → 균형에서도 선율이 배경 위로 또렷하게.
  // 2026-06-23 요청으로 선율을 ×2 더 키움 → 상한을 완화(배경이 들리는 선은 유지).
  const v = loadData().versions.find((x) => x.id === "balanced")
  const bg = bgFactor(v)
  const mel = melodyPeakFactor(v)
  assert.ok(mel <= bg * 3.2, `선율 피크(${mel.toFixed(3)}) 가 배경(${bg.toFixed(3)})을 과하게 덮는다`)
  assert.ok(mel >= bg * 0.9, `선율 피크(${mel.toFixed(3)}) 가 배경(${bg.toFixed(3)})에 묻힌다`)
})

test("선율 강조(drawing): 선율이 배경보다 앞선다", () => {
  const v = loadData().versions.find((x) => x.id === "drawing")
  assert.ok(melodyPeakFactor(v) > bgFactor(v), "선율 강조인데 선율이 배경보다 크지 않다")
})

test("공간 강조(scene): 네 믹스 중 배경 비중이 가장 크다", () => {
  // 선율 ×2(2026-06-23) 후엔 절대값으로 배경<선율이 되지만,
  // scene 은 여전히 선율/배경 비율이 가장 낮은(가장 배경 지향적인) 믹스여야 한다.
  const vs = loadData().versions
  const ratio = (v) => melodyPeakFactor(v) / bgFactor(v)
  const sceneRatio = ratio(vs.find((x) => x.id === "scene"))
  const minRatio = Math.min(...vs.map(ratio))
  assert.ok(sceneRatio === minRatio, `공간 강조가 가장 배경 지향적이지 않다 (scene ${sceneRatio.toFixed(2)}, min ${minRatio.toFixed(2)})`)
})

test("선율 비중 순서: 선율 강조 > 균형 > 공간 강조", () => {
  const vs = loadData().versions
  const g = (id) => vs.find((x) => x.id === id).melodyGain
  assert.ok(g("drawing") > g("balanced") && g("balanced") > g("scene"), "선율 비중 순서가 어긋난다")
})
