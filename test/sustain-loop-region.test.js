const test = require("node:test")
const assert = require("node:assert")
const core = require("../js/music-core.js")

const SAMPLE_RATE = 1000

// 진폭이 곧 RMS가 되도록 ±amp 교대 신호를 만든다. seg.to 가 있으면 구간 안에서 선형 변화.
function toneOf(segments) {
  const totalSec = segments.reduce((sum, seg) => sum + seg.seconds, 0)
  const data = new Float32Array(Math.round(totalSec * SAMPLE_RATE))
  let frame = 0
  for (const seg of segments) {
    const frames = Math.round(seg.seconds * SAMPLE_RATE)
    const from = seg.amp
    const to = seg.to == null ? seg.amp : seg.to
    for (let i = 0; i < frames; i++, frame++) {
      const amp = from + (to - from) * (frames > 1 ? i / (frames - 1) : 0)
      data[frame] = (frame % 2 ? 1 : -1) * amp
    }
  }
  return data
}

test("평탄한 지속음은 몸통 대부분을 루프 구간으로 쓴다", () => {
  const data = toneOf([{ seconds: 2.4, amp: 0.4 }])
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4)
  assert.ok(region, "평탄한 소리에서는 루프 구간이 나와야 한다")
  assert.ok(region.start <= 0.2)
  assert.ok(region.end >= 2.0)
})

test("어택과 감쇠 꼬리는 루프 구간에서 빠진다 (더블베이스형 포락선)", () => {
  // 실측 doubleBass_As2 형태: 큰 어택 → 1.2초까지 지속 → 이후 급감쇠.
  const data = toneOf([
    { seconds: 0.15, amp: 0.9 },
    { seconds: 1.05, amp: 0.4 },
    { seconds: 1.2, amp: 0.02 },
  ])
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4)
  assert.ok(region, "지속 구간이 충분히 길면 루프 구간이 나와야 한다")
  assert.ok(region.start >= 0.15, "어택(평탄부보다 4dB 이상 큼)은 제외: " + region.start)
  assert.ok(region.end <= 1.25, "감쇠 꼬리(고정 비율이면 1.87까지 물고 돎)는 제외: " + region.end)
  assert.ok(region.end - region.start >= 0.3, "루프가 너무 짧으면 안 된다")
})

test("짧은 완전 평탄 구간보다, 조금 출렁여도 긴 구간을 고른다 (스터터 방지)", () => {
  // 0.5초 완전 평탄 + 1.9초 완만한 출렁임(±5.5dB). 좁은 밴드만 고집하면 0.5초짜리
  // 루프가 나와 반복이 초당 2회로 빨라져 "두두두" 스터터로 들린다 — 폭을 넓혀서라도
  // 목표 길이(0.9초) 이상의 구간을 골라야 한다.
  const segs = [{ seconds: 0.5, amp: 0.4 }]
  for (let i = 0; i < 19; i++) segs.push({ seconds: 0.1, amp: i % 2 ? 0.4 : 0.76 })
  const data = toneOf(segs)
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4)
  assert.ok(region)
  assert.ok(region.end - region.start >= 0.9, "루프가 목표 길이보다 짧다: " + (region.end - region.start))
})

test("지속 구간이 너무 짧으면 null을 돌려 현행 방식으로 폴백한다", () => {
  const data = toneOf([
    { seconds: 0.2, amp: 0.5 },
    { seconds: 2.2, amp: 0.001 },
  ])
  assert.equal(core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4), null)
})

test("offset/duration 창 안에서만 찾는다 (긴 원본을 구간으로 쓰는 악기)", () => {
  // 앞 음(다른 음높이) + 사이 정적 + 대상 음. 대상 구간만 넘기면 그 안에서 찾아야 한다.
  const data = toneOf([
    { seconds: 1.0, amp: 0.7 },
    { seconds: 0.2, amp: 0.001 },
    { seconds: 1.8, amp: 0.4 },
  ])
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 1.2, 1.8)
  assert.ok(region)
  assert.ok(region.start >= 1.2, "구간 시작 이전으로 나가면 안 된다: " + region.start)
  assert.ok(region.end <= 3.0, "구간 끝 이후로 나가면 안 된다: " + region.end)
  assert.ok(region.end - region.start >= 0.3)
})

test("루프 끝점을 시작점과 같은 위상으로 정렬한다 (금속성 이음매 방지)", () => {
  // 48Hz 사인파 — 주기(약 20.8샘플)가 창 크기와 어긋나 있어, 정렬 없이는 루프 양끝 위상이
  // 제각각이 되고 크로스페이드에서 상쇄(플랜저 기계음)가 생긴다.
  const data = new Float32Array(2400)
  for (let i = 0; i < data.length; i++) data[i] = 0.4 * Math.sin((2 * Math.PI * 48 * i) / SAMPLE_RATE)
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4)
  assert.ok(region)
  const win = 30
  const s = Math.round(region.start * SAMPLE_RATE)
  const e = Math.round(region.end * SAMPLE_RATE)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < win; i++) {
    dot += data[s + i] * data[e + i]
    na += data[s + i] * data[s + i]
    nb += data[e + i] * data[e + i]
  }
  const corr = dot / (Math.sqrt(na * nb) + 1e-12)
  assert.ok(corr >= 0.9, "루프 양끝 파형이 닮아야 한다 (상관 " + corr.toFixed(3) + ")")
})

test("데이터가 없거나 너무 짧으면 null", () => {
  assert.equal(core.findStableLoopRegion(null, SAMPLE_RATE, 0, 2.4), null)
  assert.equal(core.findStableLoopRegion(new Float32Array(0), SAMPLE_RATE, 0, 2.4), null)
  assert.equal(core.findStableLoopRegion(toneOf([{ seconds: 0.2, amp: 0.4 }]), SAMPLE_RATE, 0, 0.2), null)
})

test("완전 무음은 안정 루프 구간으로 오인하지 않는다", () => {
  assert.equal(core.findStableLoopRegion(new Float32Array(2400), SAMPLE_RATE, 0, 2.4), null)
})

test("검색 창 밖에 소리가 있어도 검색 창이 무음이면 null을 돌려준다", () => {
  const data = toneOf([
    { seconds: 1, amp: 0.4 },
    { seconds: 1.4, amp: 0 },
  ])
  assert.equal(core.findStableLoopRegion(data, SAMPLE_RATE, 1, 1.4), null)
})

test("아주 작은 비무음 지속음은 상대 음량 기준으로 찾는다", () => {
  const data = toneOf([{ seconds: 2.4, amp: 1e-7 }])
  assert.ok(core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4))
})

test("극미세 신호 뒤의 디지털 무음은 안정 루프 구간에 포함하지 않는다", () => {
  const data = toneOf([
    { seconds: 1.2, amp: 1e-7 },
    { seconds: 1.2, amp: 0 },
  ])
  const region = core.findStableLoopRegion(data, SAMPLE_RATE, 0, 2.4)

  assert.ok(region, "충분히 긴 극미세 비무음 구간은 계속 검출해야 한다")
  assert.ok(region.end <= 1.2, "정확한 0 RMS 구간을 안정 루프로 선택하면 안 된다: " + region.end)
})

test("루프 페이드의 앞 재료도 안정 구간 안에 있고 접합 직전은 돌아갈 프레임의 직전이다", () => {
  for (const sr of [44100, 48000]) {
    const x = new Float32Array(sr * 2)
    for (let i = sr * .2; i < x.length; i++) x[i] = .4 * Math.sin(2 * Math.PI * 197.3 * i / sr)
    const support = { start: .25, end: 1.5 }
    const f = core.sustainLoopFrames([x], sr, support)
    assert.ok(f.start - f.fade >= Math.ceil(support.start * sr))
    assert.ok((f.end - f.start) / sr >= .9)
    const y = core.crossfadeSustainLoop(x, f)
    assert.equal(y[f.end - 1], x[f.start - 1])
    const peak = Math.max(...y.subarray(f.end - f.fade, f.end))
    assert.ok(peak < .405, "동위상 접합에서 +3dB가 생기면 안 된다")
  }
})

test("지속 구간의 느린 감쇠를 완화하되 평균 에너지와 두 채널의 관계는 보존한다", () => {
  const sr = 10000, a = 1000, b = 19000
  const x = new Float32Array(20000)
  for (let i = 0; i < x.length; i++) x[i] = (.7 - .5 * i / x.length) * Math.sin(2 * Math.PI * 200 * i / sr)
  const out = core.levelSustainSupport([x, Float32Array.from(x, (v) => -v)], sr, { start: a / sr, end: b / sr })
  let before = 0, after = 0
  for (let i = a; i < b; i++) { before += x[i] ** 2; after += out[0][i] ** 2; assert.equal(out[0][i], -out[1][i]) }
  assert.ok(Math.abs(10 * Math.log10(after / before)) < .001)
  const rms = (v) => Math.sqrt(v.reduce((s, x) => s + x*x, 0) / v.length)
  assert.ok(Math.abs(20 * Math.log10(rms(out[0].subarray(2000, 4000)) / rms(out[0].subarray(15000, 17000)))) < 1)
})

test("뜯는음 끝은 자연 감쇠 이후이고 다음 발음 앞이다", () => {
  const sr = 10000, x = new Float32Array(40000)
  for (let i = 0; i < x.length; i++) x[i] = i < 25000 ? Math.exp(-i / sr * 4) * Math.sin(2*Math.PI*220*i/sr) : .5
  const end = core.pluckedSampleEnd(x, sr, 0, .4, 2.45)
  assert.ok(end > 1.2 && end < 2.45, String(end))
})

test("느린 감쇠를 고르면서 3~8Hz의 자연 진폭 비브라토는 90% 이상 보존한다", () => {
  const sr = 8000
  for (const hz of [3, 4, 5, 6, 7, 8]) {
    const x = Float32Array.from({ length: sr * 6 }, (_, i) => (1 + .15*Math.sin(2*Math.PI*hz*i/sr))*Math.exp(-.08*i/sr)*Math.sin(2*Math.PI*200*i/sr))
    const out = core.levelSustainSupport([x], sr, { start: 0, end: 6 })[0]
    function depth(pcm) {
      const levels = []
      for (let i = sr; i < sr * 5; i += 80) {
        let e = 0
        for (let j = i; j < i + 80; j++) e += pcm[j] ** 2
        levels.push(Math.log(Math.max(1e-20, e / 80)))
      }
      let a = 0, b = 0
      // 원래의 느린 기울기를 선형 회귀로 제거하고 변조 주파수만 비교한다.
      const mean = levels.reduce((s,v)=>s+v,0)/levels.length
      let xy=0, xx=0
      for(let i=0;i<levels.length;i++){const t=i-(levels.length-1)/2;xy+=t*(levels[i]-mean);xx+=t*t}
      for (let i = 0; i < levels.length; i++) {
        const v = levels[i] - mean - xy/xx*(i-(levels.length-1)/2)
        a += v*Math.sin(2*Math.PI*hz*i*.01); b += v*Math.cos(2*Math.PI*hz*i*.01)
      }
      return Math.hypot(a,b)
    }
    const retained = depth(out)/depth(x)
    assert.ok(retained >= .9 && retained < 1.1, hz + "Hz 비브라토 보존율 " + retained)
  }
})
