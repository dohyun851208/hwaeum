/*
 * music-core.js — 순수 음악/인코딩 로직 (브라우저 전역 + Node 모듈 이중 export)
 *
 * 브라우저: 클래식 <script>로 로드되어 window.MusicCore 에 노출.
 * Node:     require("./js/music-core.js") 로 동일 API 사용 (단위 테스트).
 *
 * 핵심 원칙: 드로잉의 "그리는 속도"와 무관하게, 가로 위치(x)만 시간으로 사용한다.
 *           음높이(y)는 선택한 음계의 가장 가까운 음으로 자동 보정한다.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = api
  else root.MusicCore = api
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  // --- 음계 ---

  const NATURAL_NOTE_CLASSES = [0, 2, 4, 5, 7, 9, 11]

  function pitchBounds(style) {
    return {
      lo: style.lowMidi == null ? 48 : style.lowMidi,
      hi: style.highMidi == null ? 84 : style.highMidi,
    }
  }

  function isNaturalNote(midi) {
    return NATURAL_NOTE_CLASSES.indexOf(((midi % 12) + 12) % 12) !== -1
  }

  function naturalPitchRowCount(lo, hi) {
    let count = 0
    for (let midi = lo; midi <= hi; midi++) {
      if (isNaturalNote(midi)) count++
    }
    return Math.max(1, count)
  }

  function silentEdgeRatio(style) {
    const silentRows = style.silentEdgeRows || 0
    if (!silentRows) return 0
    const bounds = pitchBounds(style)
    const labelRows = naturalPitchRowCount(bounds.lo, bounds.hi)
    return silentRows / Math.max(1, labelRows + silentRows * 2 - 1)
  }

  // style = { root: <midi>, intervals: [반음 오프셋...] }
  function buildScale(style, lo, hi) {
    const bounds = pitchBounds(style)
    lo = lo == null ? bounds.lo : lo
    hi = hi == null ? bounds.hi : hi
    const out = []
    for (let oct = -2; oct <= 3; oct++) {
      for (const iv of style.intervals) out.push(style.root + iv + oct * 12)
    }
    return out.filter((m) => m >= lo && m <= hi).sort((a, b) => a - b)
  }

  function displayPitchBounds(style) {
    const bounds = pitchBounds(style)
    return {
      lo: style.drawLowMidi == null ? bounds.lo : style.drawLowMidi,
      hi: style.drawHighMidi == null ? bounds.hi : style.drawHighMidi,
    }
  }

  function buildDisplayScale(style) {
    if (!style || !Array.isArray(style.drawIntervals)) return buildScale(style)
    const bounds = displayPitchBounds(style)
    return buildScale(
      {
        root: style.drawRoot == null ? style.root : style.drawRoot,
        intervals: style.drawIntervals,
        lowMidi: bounds.lo,
        highMidi: bounds.hi,
      },
      bounds.lo,
      bounds.hi,
    )
  }

  function playableMidiFor(style, asset) {
    if (asset && Array.isArray(asset.playableMidi) && asset.playableMidi.length) return asset.playableMidi
    if (style && Array.isArray(style.playableMidi) && style.playableMidi.length) return style.playableMidi
    return null
  }

  function isPitchPlayable(midi, style, asset) {
    if (midi == null) return false
    const allowed = playableMidiFor(style, asset)
    if (!allowed) return true
    const tr = asset && Number.isFinite(asset.playbackTranspose) ? asset.playbackTranspose : 0
    return allowed.indexOf(midi) !== -1 || allowed.indexOf(midi + tr) !== -1
  }

  // 화면에 그릴 음높이 축. 국악풍은 draw* 설정으로 서양 기본 15칸 축을 유지하고,
  // 실제 발음 가능 여부는 isPitchPlayable()/quantizePitch()에서 따로 관리한다.
  function firstIndexByMidi(scale) {
    const indexes = new Map()
    for (let i = 0; i < scale.length; i++) {
      if (!indexes.has(scale[i])) indexes.set(scale[i], i)
    }
    return indexes
  }

  // 저장 좌표의 전체 축과 화면에 보이는 축을 한 번에 만든다.
  // 이 모델은 공개하지 않고 아래 축 API가 같은 계산 결과를 공유하게 한다.
  function buildPitchAxisModel(style, asset) {
    const full = buildDisplayScale(style)
    const playable = full.filter((midi) => isPitchPlayable(midi, style, asset))
    const visible = playable.length ? playable : full
    return {
      full: full,
      visible: visible,
      fullIndex: firstIndexByMidi(full),
      visibleIndex: firstIndexByMidi(visible),
    }
  }

  function drawableScale(style, asset) {
    return buildPitchAxisModel(style, asset).full
  }

  function playableScale(style, asset) {
    return buildPitchAxisModel(style, asset).visible
  }

  function nearestScaleNote(target, style, asset) {
    const scale = playableScale(style, asset)
    let best = scale[0]
    for (const m of scale) {
      if (Math.abs(m - target) < Math.abs(best - target)) best = m
    }
    return best
  }

  // normY: 0 = 캔버스 맨 위(높은 음), 1 = 맨 아래(낮은 음)
  function quantizePitch(normY, style, asset) {
    const scale = drawableScale(style, asset)
    const clamped = Math.max(0, Math.min(1, normY))
    const edge = silentEdgeRatio(style)
    if (edge > 0 && (clamped < edge || clamped > 1 - edge)) return null
    const playableY = edge > 0 ? (clamped - edge) / (1 - edge * 2) : clamped
    // 음마다 균등한 밴드(1/N). fromBottom(0=맨아래,1=맨위)가 속한 밴드로 스냅 →
    // 끝음(맨 위/아래)도 칸 전체가 히트존이 되어 빠지지 않는다.
    const fromBottom = 1 - playableY
    const idx = Math.floor(fromBottom * scale.length)
    const midi = scale[Math.max(0, Math.min(scale.length - 1, idx))]
    return isPitchPlayable(midi, style, asset) ? midi : null
  }

  // --- 화면 축 ↔ 저장 좌표 변환 ---
  // 저장 y(획·레시피)는 항상 전체 축(서양 15칸) 기준이라 악기를 오가도 음높이가 유지된다.
  // 국악기처럼 발음 가능한 칸만 화면에 보여줄 때는 아래 두 함수로 화면 y와 상호 변환한다.

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0))
  }

  // 저장 y(전체 축) → 화면 y(보이는 칸만). 숨은 칸에 놓인 점(옛 레시피 등)은
  // 가장 가까운 보이는 칸 가장자리에 붙인다.
  function displayYFromStored(normY, style, asset) {
    const axis = buildPitchAxisModel(style, asset)
    const full = axis.full
    const visible = axis.visible
    const n = full.length
    const m = visible.length
    const y = clamp01(normY)
    if (!n || !m || m >= n) return y
    const fromBottom = (1 - y) * n
    const band = Math.min(n - 1, Math.floor(fromBottom))
    let frac = Math.max(0, Math.min(1, fromBottom - band))
    let visibleIndex = axis.visibleIndex.get(full[band])
    if (visibleIndex == null) {
      let best = 0
      let bestDist = Infinity
      for (let k = 0; k < m; k++) {
        const dist = Math.abs(axis.fullIndex.get(visible[k]) - band)
        if (dist < bestDist) {
          bestDist = dist
          best = k
        }
      }
      visibleIndex = best
      frac = axis.fullIndex.get(visible[best]) < band ? 1 : 0
    }
    return 1 - (visibleIndex + frac) / m
  }

  // 화면 y(보이는 칸만) → 저장 y(전체 축)
  function storedYFromDisplay(normY, style, asset) {
    const axis = buildPitchAxisModel(style, asset)
    const full = axis.full
    const visible = axis.visible
    const n = full.length
    const m = visible.length
    const y = clamp01(normY)
    if (!n || !m || m >= n) return y
    const fromBottom = (1 - y) * m
    const band = Math.min(m - 1, Math.floor(fromBottom))
    // frac을 1 바로 아래로 캡핑 — 맨 위 픽셀이 이웃한 숨은 칸(예: 파)으로 넘어가지 않게
    const frac = Math.max(0, Math.min(1 - 1e-6, fromBottom - band))
    const fullIndex = axis.fullIndex.get(visible[band])
    if (fullIndex == null) return y
    return 1 - (fullIndex + frac) / n
  }

  // --- 시간 재샘플링 (속도 무관) ---

  function interpY(norm, t) {
    if (t <= norm[0].x) return norm[0].y
    const last = norm[norm.length - 1]
    if (t >= last.x) return last.y
    for (let i = 1; i < norm.length; i++) {
      if (t <= norm[i].x) {
        const a = norm[i - 1]
        const b = norm[i]
        const span = b.x - a.x || 1
        const r = (t - a.x) / span
        return a.y + (b.y - a.y) * r
      }
    }
    return last.y
  }

  // points: [{x, y}] (x 단위 무관). x를 0..1로 정규화한 뒤 균등 시간 격자에서 보간.
  // → 점 밀도/타이밍이 달라도 같은 모양이면 같은 결과(그리는 속도 무관).
  function resampleByTime(points, steps) {
    const pts = [...points].sort((a, b) => a.x - b.x)
    const minX = pts[0].x
    const maxX = pts[pts.length - 1].x
    const span = maxX - minX || 1
    const norm = pts.map((p) => ({ x: (p.x - minX) / span, y: p.y }))
    const out = []
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1)
      out.push({ t, y: interpY(norm, t) })
    }
    return out
  }

  // 실제 초 단위 격자. 각 칸은 곡 길이 안에서 시작하고 마지막 칸은 곡 끝에서 잘린다.
  // 샘플 위치(t)와 재생 시각(time)을 같은 값에서 계산해 x축과 소리 시간이 어긋나지 않게 한다.
  function timelineBySeconds(durationSec, stepSec) {
    const duration = Math.max(0, Number(durationSec) || 0)
    const step = Number(stepSec)
    if (!(duration > 0) || !(step > 0)) return []
    // 부동소수점 오차로 2.7 / 0.3 같은 정확한 끝 경계가 한 칸 더 생기지 않게 한다.
    const boundaryEpsilon = Math.min(1e-9, duration / 2)
    const count = Math.max(1, Math.ceil((duration - boundaryEpsilon) / step))
    const out = []
    for (let i = 0; i < count; i++) {
      const time = i * step
      if (!(time < duration)) break
      out.push({
        time: time,
        endTime: Math.min(duration, time + step),
        t: time / duration,
      })
    }
    return out
  }

  function sampleDrawnTimeline(points, durationSec, stepSec) {
    if (!points || points.length === 0) return []
    const pts = [...points].sort((a, b) => a.x - b.x)
    const minX = Math.max(0, Math.min(1, pts[0].x))
    const maxX = Math.max(0, Math.min(1, pts[pts.length - 1].x))
    return timelineBySeconds(durationSec, stepSec).map(function (slot) {
      if (slot.t < minX || slot.t > maxX) return null
      return {
        time: slot.time,
        endTime: slot.endTime,
        t: slot.t,
        y: interpY(pts, slot.t),
      }
    })
  }

  // --- 선율 / 리듬 자동완성 ---

  // path: 정규화 [{x:0..1, y:0..1}]. 초당 16회 샘플 → 음계 스냅 → 연속 동음 병합.
  function autocompleteMelody(path, opts) {
    const durationSec = Math.max(0, Number(opts.durationSec) || 0)
    const style = opts.style
    const asset = opts.melodyAsset
    const SAMPLE_RATE = 16 // 초당 샘플 수 — 빠른 음(≈8음/초)·짧은 음을 살림(예전 2/초는 0.5초로 뭉갰다)
    const TAP_SEC = 0.16 // 점 찍기/아주 짧은 획을 표현할 기본 음 길이
    const MIN_TAP_SEC = 0.05 // 곡 끝에서도 들을 수 있게 보장할 최소 길이
    if (!path || path.length === 0 || !(durationSec > 0)) return []
    let minX = path[0].x
    let maxX = path[0].x
    for (const p of path) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
    }
    // 점 찍기(가로 폭 ≈ 0) → 짧은 음 하나
    if ((maxX - minX) * durationSec < TAP_SEC) {
      const requestedTime = Math.max(0, Math.min(1, minX)) * durationSec
      const minimumDuration = Math.min(MIN_TAP_SEC, durationSec)
      const time = Math.min(requestedTime, durationSec - minimumDuration)
      const midi = quantizePitch(path[0].y, style, asset)
      if (midi == null) return []
      return [
        {
          time: time,
          duration: Math.min(TAP_SEC, durationSec - time),
          midi: midi,
          velocity: 0.7,
        },
      ]
    }
    const stepSec = 1 / SAMPLE_RATE
    const samples = sampleDrawnTimeline(path, durationSec, stepSec)
    const raw = []
    let prev = null
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      if (!sample) {
        raw.push(null)
        prev = null
        continue
      }
      let midi = quantizePitch(sample.y, style, asset)
      if (midi == null) {
        raw.push(null)
        prev = null
        continue
      }
      // 큰 도약(>장6도) 완화
      if (prev != null && Math.abs(midi - prev) > 9) {
        midi = nearestScaleNote(midi > prev ? prev + 7 : prev - 7, style, asset)
      }
      prev = midi
      raw.push(midi)
    }
    // 연속 동음 병합 → 길게 그린 음은 한 음으로 지속(레가토). 빈 칸(null)에서만 끊긴다.
    const notes = []
    let i = 0
    while (i < raw.length) {
      if (raw[i] == null) {
        i++
        continue
      }
      let j = i + 1
      while (j < raw.length && raw[j] === raw[i]) j++
      notes.push({
        time: samples[i].time,
        duration: samples[j - 1].endTime - samples[i].time,
        midi: raw[i],
        velocity: 0.7,
      })
      i = j
    }
    // 첫 음은 격자선이 아니라 획이 시작한 바로 그 시각에 낸다.
    // 격자 칸은 minX 이후로만 잡히므로 첫 음은 늘 최대 한 칸(62.5ms)만큼 늦게 났다.
    // 획 시작 시각으로 당기면 "그린 선보다 먼저" 가는 일 없이(정확히 선 위) 그 지연만 사라진다.
    const strokeStartSec = Math.max(0, Math.min(1, minX)) * durationSec
    if (notes.length > 0 && notes[0].time > strokeStartSec) {
      notes[0].duration += notes[0].time - strokeStartSec
      notes[0].time = strokeStartSec
    }
    return notes
  }

  function autocompleteMelodyStrokes(strokes, opts) {
    const notes = []
    const assets = Array.isArray(opts.melodyAssets) ? opts.melodyAssets : null
    ;(strokes || []).forEach(function (stroke, voice) {
      // 획(voice)마다 그 악기의 연주가능음으로 스냅 — 오케스트라에서 악기별 음역이 다를 수 있다.
      const strokeOpts = assets ? Object.assign({}, opts, { melodyAsset: assets[voice] || opts.melodyAsset }) : opts
      autocompleteMelody(stroke, strokeOpts).forEach(function (note) {
        notes.push(
          Object.assign({}, note, {
            voice: voice,
          }),
        )
      })
    })
    notes.sort(function (a, b) {
      if (a.time !== b.time) return a.time - b.time
      if (a.voice !== b.voice) return (a.voice || 0) - (b.voice || 0)
      return a.midi - b.midi
    })
    return notes
  }

  // path → 4/4 8분음표 격자의 타격 온셋. y가 임계 초과인 격자에서 타격.
  function autocompleteRhythm(path, opts) {
    const durationSec = Math.max(0, Number(opts.durationSec) || 0)
    const bpm = opts.bpm || 100
    const step = 60 / bpm / 2
    if (!path || path.length === 0 || !(durationSec > 0)) return []
    const samples = sampleDrawnTimeline(path, durationSec, step)
    const hits = []
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      if (!sample) continue
      const strength = sample.y
      if (strength > 0.5) {
        hits.push({ time: sample.time, velocity: Math.min(1, 0.5 + strength * 0.5) })
      }
    }
    return hits
  }

  // --- 시김새(국악 표현) 파라미터 ---

  // 국악(기)/국악풍일 때만 장식 세그먼트 반환. 오디오 엔진이 이를 피치 자동화로 적용.
  function sigimsaeFor(opts) {
    if (!opts || !opts.gugak) return []
    const beats = opts.durationBeats || 0
    const longTone = beats >= 2
    const veryLong = beats >= 4 // 아주 길게 끈 음 — 짙은 농현(깊게 떠는 지속음)
    const segs = [{ type: "grace", at: 0, semitones: 1, dur: 0.08 }] // 꺾음(앞꾸밈)
    if (beats >= 1) {
      segs.push({
        type: "vibrato",
        at: veryLong ? 0.1 : longTone ? 0.13 : 0.2, // 길수록 일찍 떨기 시작해 오래 농현
        cents: veryLong ? 55 : longTone ? 42 : 18, // 길수록 떠는 폭이 짙어짐(농현)
        rateHz: veryLong ? 6.6 : longTone ? 6.2 : 5.5,
      }) // 떠는음/농현
    }
    // 흘러내림: 길게 끈 음은 끝부분에서만 살짝 — 지속음을 더 오래 유지한 뒤 흘린다
    segs.push({ type: "slide", at: veryLong ? 0.9 : longTone ? 0.82 : 0.7, semitones: longTone ? -0.5 : -1, dur: 0.2 })
    return segs
  }

  // --- 지속음 루프 구간 검출 ---

  // 샘플의 RMS 포락선에서 지속음 루프로 쓸 "충분히 길고 평탄한 구간"을 찾는다.
  // 파일 안에 감쇠(릴리스)가 포함된 샘플을 고정 비율로 루프하면 조용한 꼬리를
  // 물고 돌 때마다 음량이 출렁여 맥동("두두두두")으로 들린다. 어택(평탄부보다
  // 큼)과 감쇠(작아짐)는 평탄 밴드를 벗어나므로 자연히 루프에서 빠진다.
  // 단, 루프는 길이가 우선이다 — 이음매 음량이 맞아도 루프가 짧으면(1초 미만)
  // 소리 질감 자체가 빠르게 반복돼 스터터로 들린다. 그래서 좁은 밴드(3dB)부터
  // 넓혀 가며 목표 길이(0.9초)를 넘는 구간을 찾을 때까지 시도한다.
  // 반환: { start, end } (channelData 기준 절대 초). 못 찾으면 null(호출부 폴백).
  function measureLoopLevels(channelData, startFrame, count, winFrames) {
    const levels = []
    let peak = -Infinity
    let peakMeanSquare = 0
    for (let w = 0; w < count; w++) {
      let sum = 0
      const base = startFrame + w * winFrames
      for (let i = 0; i < winFrames; i++) {
        const value = channelData[base + i] || 0
        sum += value * value
      }
      const meanSquare = sum / winFrames
      const db = meanSquare > 0 ? 10 * Math.log10(meanSquare) : -Infinity
      levels.push(db)
      if (db > peak) peak = db
      if (meanSquare > peakMeanSquare) peakMeanSquare = meanSquare
    }
    return { levels: levels, peak: peak, peakMeanSquare: peakMeanSquare }
  }

  function longestStableRun(levels, floor, bandDb) {
    let best = null
    for (let lo = 0; lo < levels.length; lo++) {
      if (levels[lo] < floor) continue
      let hi = lo
      let min = levels[lo]
      let max = levels[lo]
      while (hi + 1 < levels.length && levels[hi + 1] >= floor) {
        const next = levels[hi + 1]
        if (Math.max(max, next) - Math.min(min, next) > bandDb) break
        if (next < min) min = next
        if (next > max) max = next
        hi++
      }
      if (!best || hi - lo > best.hi - best.lo) best = { lo: lo, hi: hi }
    }
    return best
  }

  function stableRunToRegion(run, from, windowSec, minLoopSec) {
    if (!run) return null
    // 경계 창에는 어택이나 감쇠가 걸쳐 있을 수 있어 양 끝을 한 창씩 줄인다.
    const start = from + (run.lo + 1) * windowSec
    const end = from + run.hi * windowSec
    return end - start >= minLoopSec ? { start: start, end: end } : null
  }

  function chooseStableLoopRegion(levels, floor, bands, from, windowSec, minLoopSec, targetLoopSec) {
    let chosen = null
    for (const band of bands) {
      const run = longestStableRun(levels, floor, band)
      const region = stableRunToRegion(run, from, windowSec, minLoopSec)
      if (!region) continue
      if (region.end - region.start >= targetLoopSec) return region
      if (!chosen || region.end - region.start > chosen.end - chosen.start) chosen = region
    }
    return chosen
  }

  function findStableLoopRegion(channelData, sampleRate, offset, duration, options) {
    const opts = options || {}
    const windowSec = opts.windowSec > 0 ? opts.windowSec : 0.05
    const minLoopSec = opts.minLoopSec > 0 ? opts.minLoopSec : 0.3
    const targetLoopSec = opts.targetLoopSec > 0 ? opts.targetLoopSec : 0.9
    const bands = opts.bandDb > 0 ? [opts.bandDb] : [3, 4.5, 6, 8]
    const silenceDb = opts.silenceDb > 0 ? opts.silenceDb : 30 // 최대 음량 대비 무음 판정 폭
    if (!channelData || !channelData.length || !(sampleRate > 0)) return null
    const total = channelData.length / sampleRate
    const from = Math.min(Math.max(Number(offset) || 0, 0), total)
    const span = Math.min(Math.max(Number(duration) || 0, 0), total - from)
    const winFrames = Math.max(1, Math.round(windowSec * sampleRate))
    const count = Math.floor((span * sampleRate) / winFrames)
    if (count < Math.ceil(minLoopSec / windowSec) + 2) return null
    const startFrame = Math.round(from * sampleRate)
    const measurement = measureLoopLevels(channelData, startFrame, count, winFrames)
    if (!(measurement.peakMeanSquare > 0)) return null
    const levels = measurement.levels
    const floor = measurement.peak - silenceDb
    const chosen = chooseStableLoopRegion(levels, floor, bands, from, windowSec, minLoopSec, targetLoopSec)
    if (!chosen) return null
    return opts.align === false ? chosen : alignLoopEndToStart(channelData, sampleRate, chosen)
  }

  // 안정 구간 [start,end) 안에서 페이드 재료까지 확보한다. 반환 위치 R 직전의
  // 소리를 끝에 섞으므로 마지막 프레임 다음에는 정확히 R의 프레임이 온다.
  // Web Audio에 의존하지 않아 측정 도구와 실제 재생이 같은 접합을 사용한다.
  function sustainLoopFrames(channels, sampleRate, region) {
    if (!channels || !channels.length || !region || !(sampleRate > 0)) return null
    const length = Math.min.apply(null, channels.map((c) => c.length))
    const a = Math.max(0, Math.ceil(region.start * sampleRate))
    const b = Math.min(length, Math.floor(region.end * sampleRate))
    const fade = Math.floor(Math.min(0.08 * sampleRate, Math.max(0.02 * sampleRate, b - a - 0.94 * sampleRate), (b - a) * 0.15))
    if (fade < 8 || b - a - fade < 0.12 * sampleRate) return null
    const start = a + fade
    const lo = Math.max(start + Math.round(0.12 * sampleRate), b - Math.round(0.04 * sampleRate))
    function score(end, stride) {
      let dot = 0, aa = 0, bb = 0
      for (const channel of channels) {
        for (let i = 0; i < fade; i += stride) {
          const x = channel[a + i], y = channel[end - fade + i]
          dot += x * y; aa += x * x; bb += y * y
        }
      }
      return dot / (Math.sqrt(aa * bb) + 1e-20)
    }
    let end = b, correlation = -Infinity
    // 모든 채널을 같은 프레임만큼 움직여 스테레오 위상 관계를 유지한다.
    for (let candidate = lo; candidate <= b; candidate += 4) {
      const value = score(candidate, 4)
      if (value > correlation) { correlation = value; end = candidate }
    }
    const coarse = end
    correlation = -Infinity
    for (let candidate = Math.max(lo, coarse - 4); candidate <= Math.min(b, coarse + 4); candidate++) {
      const value = score(candidate, 1)
      if (value > correlation) { correlation = value; end = candidate }
    }
    return { start, end, fade, correlation, short: (end - start) / sampleRate < 0.9 }
  }

  // 녹음 몸통의 느린 감쇠가 매 반복마다 다시 커지는 맥동을 줄인다.
  // 채널 공통의 완만한 진폭 보정만 사용하며, 구간 평균 에너지는 보존한다.
  // 음별 출력 게인 한도(±3 dB, 베이스만 ±12 dB)와는 별개다.
  function levelSustainSupport(channels, sampleRate, region) {
    const a = Math.ceil(region.start * sampleRate), b = Math.floor(region.end * sampleRate)
    if (b - a < 16) return channels
    const energy = new Float64Array(b - a + 1)
    for (let i = a; i < b; i++) {
      let value = 0
      for (const channel of channels) value += channel[i] * channel[i]
      energy[i - a + 1] = energy[i - a] + value / channels.length
    }
    const target = energy[b - a] / (b - a)
    if (!(target > 1e-20)) return channels
    const hop = Math.max(1, Math.round(0.01 * sampleRate))
    const radius = Math.round(0.04 * sampleRate)
    const gains = []
    for (let t = 0; t <= b - a + hop; t += hop) {
      const lo = Math.max(0, Math.min(b - a - 1, t - radius))
      const hi = Math.min(b - a, t + radius)
      const local = (energy[hi] - energy[lo]) / Math.max(1, hi - lo)
      gains.push(Math.max(0.5, Math.min(2, Math.sqrt(target / Math.max(local, 1e-20)))))
    }
    function gainAt(i) {
      const pos = Math.max(0, Math.min(gains.length - 1.000001, (i - a) / hop))
      const j = Math.floor(pos), x = pos - j
      return gains[j] * (1 - x) + gains[j + 1] * x
    }
    let adjusted = 0
    for (let i = a; i < b; i++) adjusted += (energy[i - a + 1] - energy[i - a]) * Math.pow(gainAt(i), 2)
    const norm = Math.sqrt(energy[b - a] / Math.max(adjusted, 1e-20))
    return channels.map(function (channel) {
      const out = new Float32Array(channel)
      const lead = Math.round(0.08 * sampleRate)
      for (let i = Math.max(0, a - lead); i < Math.min(channel.length, b + lead); i++) {
        const mix = i < a ? (i - a + lead) / lead : i >= b ? (b + lead - i) / lead : 1
        out[i] *= 1 + (gainAt(i) * norm - 1) * mix
      }
      return out
    })
  }

  function crossfadeSustainLoop(channel, frames) {
    const out = new Float32Array(channel)
    for (let i = 0; i < frames.fade; i++) {
      const x = (1 - Math.cos(Math.PI * i / (frames.fade - 1))) / 2
      // 상관 1이면 합이 1, 무상관이면 등전력. 음의 상관은 증폭하지 않는다.
      const power = Math.max(0.5, (1 - x) * (1 - x) + x * x + 2 * Math.max(0, frames.correlation) * x * (1 - x))
      out[frames.end - frames.fade + i] = (
        channel[frames.end - frames.fade + i] * (1 - x) + channel[frames.start - frames.fade + i] * x
      ) / Math.sqrt(power)
    }
    return out
  }

  function pluckedSampleEnd(channel, sampleRate, offset, minimumDuration, boundary) {
    const win = Math.max(1, Math.round(sampleRate * 0.025))
    const start = Math.max(0, Math.round(offset * sampleRate))
    const end = Math.min(channel.length, Math.floor(boundary * sampleRate))
    function energy(at) {
      let sum = 0
      const n = Math.min(win, end - at)
      for (let i = 0; i < n; i++) sum += channel[at + i] * channel[at + i]
      return n > 0 ? sum / n : 0
    }
    let peak = 0
    for (let at = start; at < Math.min(end, start + sampleRate * 0.5); at += win) peak = Math.max(peak, energy(at))
    if (!(peak > 0)) return Math.min(boundary, offset + minimumDuration)
    let quiet = 0
    for (let at = start + Math.ceil(minimumDuration * sampleRate / win) * win; at + win <= end; at += win) {
      quiet = energy(at) < peak * Math.pow(10, -42 / 10) ? quiet + 1 : 0
      if (quiet >= 8) return (at + win) / sampleRate
    }
    return end / sampleRate
  }

  // 루프 끝점(→시작으로 점프하는 지점)을 시작점과 파형이 가장 닮은 위치로 미세 조정한다.
  // 위상이 어긋난 채 크로스페이드하면 두 파형이 간섭·상쇄해 금속성(플랜저) 이음매가 들린다.
  // 시작점 주변 30ms 창과 상호상관이 최대가 되는 지점을 끝점 ±20ms 안에서 찾는다.
  function alignLoopEndToStart(channelData, sampleRate, region) {
    const win = Math.round(0.03 * sampleRate)
    const search = Math.round(0.02 * sampleRate)
    const startIdx = Math.round(region.start * sampleRate)
    const endIdx = Math.round(region.end * sampleRate)
    if (win < 8 || startIdx + win >= channelData.length) return region
    const lo = Math.max(startIdx + win, endIdx - search)
    const hi = Math.min(channelData.length - win - 1, endIdx + search)
    let bestIdx = endIdx
    let bestScore = -Infinity
    for (let cand = lo; cand <= hi; cand++) {
      let dot = 0
      let na = 0
      let nb = 0
      for (let i = 0; i < win; i++) {
        const a = channelData[startIdx + i] || 0
        const b = channelData[cand + i] || 0
        dot += a * b
        na += a * a
        nb += b * b
      }
      const score = dot / (Math.sqrt(na * nb) + 1e-12)
      if (score > bestScore) {
        bestScore = score
        bestIdx = cand
      }
    }
    return { start: region.start, end: bestIdx / sampleRate }
  }

  // --- 레시피 코덱 (공유 링크/저장용; 오디오 미포함) ---

  function b64encode(str) {
    if (typeof Buffer !== "undefined") return Buffer.from(str, "utf8").toString("base64")
    return btoa(unescape(encodeURIComponent(str)))
  }
  function b64decode(b64) {
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8")
    return decodeURIComponent(escape(atob(b64)))
  }
  function encodeRecipe(recipe) {
    return b64encode(JSON.stringify(recipe))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  }
  function decodeRecipe(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/")
    while (b64.length % 4) b64 += "="
    return JSON.parse(b64decode(b64))
  }

  // --- WAV 인코딩 (16-bit PCM) ---

  // audioBuffer: { numberOfChannels, sampleRate, length, getChannelData(c) }
  function encodeWav(audioBuffer) {
    const numCh = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const len = audioBuffer.length
    const blockAlign = numCh * 2
    const dataSize = len * blockAlign
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    let o = 0
    function ws(s) {
      for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i))
    }
    function u32(v) {
      view.setUint32(o, v, true)
      o += 4
    }
    function u16(v) {
      view.setUint16(o, v, true)
      o += 2
    }
    ws("RIFF")
    u32(36 + dataSize)
    ws("WAVE")
    ws("fmt ")
    u32(16)
    u16(1)
    u16(numCh)
    u32(sampleRate)
    u32(sampleRate * blockAlign)
    u16(blockAlign)
    u16(16)
    ws("data")
    u32(dataSize)
    const channels = []
    for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c))
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, channels[c][i]))
        s = s < 0 ? s * 0x8000 : s * 0x7fff
        view.setInt16(o, s, true)
        o += 2
      }
    }
    return buffer
  }

  return {
    buildScale,
    drawableScale,
    playableScale,
    displayYFromStored,
    storedYFromDisplay,
    isPitchPlayable,
    nearestScaleNote,
    quantizePitch,
    interpY,
    resampleByTime,
    autocompleteMelody,
    autocompleteMelodyStrokes,
    autocompleteRhythm,
    sigimsaeFor,
    findStableLoopRegion,
    sustainLoopFrames,
    levelSustainSupport,
    crossfadeSustainLoop,
    pluckedSampleEnd,
    encodeRecipe,
    decodeRecipe,
    encodeWav,
  }
})
