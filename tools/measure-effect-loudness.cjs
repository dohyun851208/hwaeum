/*
 * measure-effect-loudness.cjs — 효과음 도장끼리 크기 맞추기
 *
 * 도장 파일은 크기가 제각각이다(새 −14 LUFS, 가랑비 −38 LUFS). 모든 도장을 같은 EFFECT_GAIN 으로 틀면
 * 작은 녹음은 배경에 묻힌다. 이 도구는 각 파일의 통합 크기(EBU R128)를 재서, 새소리와 같은 크기가 되는
 * gain 을 js/manifest.js 의 effects[].gain 후보로 낸다. 엔진은 미리듣기와 전체 재생에 같은 gain 을 곱한다.
 *
 * 실행:
 *   node tools/measure-effect-loudness.cjs          표와 추천 gain
 *   node tools/measure-effect-loudness.cjs --check  manifest gain 이 추천값과 0.5 dB 넘게 다르면 실패
 *
 * 효과음 파일을 바꾸거나 build-nature-effects.py 로 다시 만든 뒤에 돌리고, 추천값으로 manifest 를 고친다.
 * ffmpeg 필요. 도장 파일은 모두 모노다(스테레오 파일을 넣으면 같은 숫자라도 3 dB 작게 들리니 모노로 만든다).
 */
const fs = require("fs")
const path = require("path")
const vm = require("vm")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
// 사용자가 "새소리 정도로 맞춰 달라"고 했다(2026-10-05).
const REFERENCE_ID = "animalBird"
// 새소리보다 몇 dB 크게(+)·작게(−) 둘지. 이름의 세기를 따른다(먼 천둥 < 번개, 가랑비 < 소나기).
// 2026-10-05 사용자가 들어 보고 "번개·흑동고래가 작고 바람이 전반적으로 작다"고 해서 센 소리를 새보다 키웠다.
// 산들바람의 −3 dB도 없앴다(바람은 배경음악과 같은 대역이라 묻힌다).
const LEVEL_DB = {
  rain1: -3, // 가랑비
  thunder1: -3, // 먼 천둥
  thunder2: 6, // 번개
  thunder3: 4, // 폭풍우
  wind2: 4, // 거센바람
  wind3: 3, // 회오리바람
  animalWhale: 3, // 흑동고래 — 울음이 배경음악·선율과 같은 대역이라 묻힌다
}
// 미리듣기는 마스터 리미터를 거치지 않고 바로 나가므로, 키운 뒤의 피크가 이 값을 넘지 않게 gain 을 묶는다.
const PREVIEW_PEAK_LIMIT_DB = -1
const CHECK_TOLERANCE_DB = 0.5

function loadEffects() {
  const sandbox = {}
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js/manifest.js"), "utf8"), sandbox, { filename: "manifest.js" })
  return sandbox.SDStudioData.effects
}

function engineConst(name) {
  const src = fs.readFileSync(path.join(ROOT, "js/audio-engine.js"), "utf8")
  const match = src.match(new RegExp(`const ${name} = ([\\d.]+)`))
  if (!match) throw new Error(`${name} not found in js/audio-engine.js`)
  return Number(match[1])
}

function measure(file) {
  const result = spawnSync(
    "ffmpeg",
    ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128,astats=metadata=0:measure_perchannel=none", "-f", "null", "-"],
    { encoding: "utf8" },
  )
  const summary = result.stderr.split("Summary:").pop()
  const lufs = Number((summary.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1])
  const peak = Number((result.stderr.match(/Peak level dB:\s+(-?[\d.]+)/) || [])[1])
  if (!isFinite(lufs) || !isFinite(peak)) throw new Error(`measure failed: ${file}\n${result.stderr.slice(-600)}`)
  return { lufs, peak }
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function main() {
  const effects = loadEffects()
  const previewDb = 20 * Math.log10(engineConst("EFFECT_PREVIEW_GAIN"))
  const measured = {}
  Object.keys(effects).forEach((id) => {
    measured[id] = measure(path.join(ROOT, effects[id].src))
  })
  const reference = measured[REFERENCE_ID].lufs
  let mismatches = 0
  console.log(`기준: ${effects[REFERENCE_ID].label} ${reference.toFixed(1)} LUFS`)
  console.log("id               이름        크기    피크    목표  보정 dB  추천 gain  manifest")
  Object.keys(effects).forEach((id) => {
    const { lufs, peak } = measured[id]
    const target = reference + (LEVEL_DB[id] || 0)
    const wantedDb = target - lufs
    const maxDb = PREVIEW_PEAK_LIMIT_DB - previewDb - peak
    const gainDb = Math.min(wantedDb, maxDb)
    const gain = round2(Math.pow(10, gainDb / 20))
    const current = effects[id].gain == null ? 1 : effects[id].gain
    const diffDb = 20 * Math.log10(current / gain)
    if (Math.abs(diffDb) > CHECK_TOLERANCE_DB) mismatches += 1
    console.log(
      [
        id.padEnd(15),
        effects[id].label.padEnd(8),
        lufs.toFixed(1).padStart(6),
        peak.toFixed(1).padStart(6),
        target.toFixed(1).padStart(6),
        ((gainDb >= 0 ? "+" : "") + gainDb.toFixed(1)).padStart(7),
        String(gain).padStart(9),
        String(current).padStart(9),
        gainDb < wantedDb ? `피크 때문에 ${(wantedDb - gainDb).toFixed(1)} dB 덜 키움` : "",
      ].join("  "),
    )
  })
  if (process.argv.includes("--check") && mismatches) {
    console.error(`manifest gain 이 추천값과 ${CHECK_TOLERANCE_DB} dB 넘게 다른 도장: ${mismatches}개`)
    process.exitCode = 1
  }
}

main()
