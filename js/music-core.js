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
  function drawableScale(style, asset) {
    return buildDisplayScale(style)
  }

  function playableScale(style, asset) {
    const scale = drawableScale(style, asset)
    const filtered = scale.filter((m) => isPitchPlayable(m, style, asset))
    return filtered.length ? filtered : scale
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
    const full = drawableScale(style, asset)
    const visible = playableScale(style, asset)
    const n = full.length
    const m = visible.length
    const y = clamp01(normY)
    if (!n || !m || m >= n) return y
    const fromBottom = (1 - y) * n
    const band = Math.min(n - 1, Math.floor(fromBottom))
    let frac = Math.max(0, Math.min(1, fromBottom - band))
    let visibleIndex = visible.indexOf(full[band])
    if (visibleIndex === -1) {
      let best = 0
      let bestDist = Infinity
      for (let k = 0; k < m; k++) {
        const dist = Math.abs(full.indexOf(visible[k]) - band)
        if (dist < bestDist) {
          bestDist = dist
          best = k
        }
      }
      visibleIndex = best
      frac = full.indexOf(visible[best]) < band ? 1 : 0
    }
    return 1 - (visibleIndex + frac) / m
  }

  // 화면 y(보이는 칸만) → 저장 y(전체 축)
  function storedYFromDisplay(normY, style, asset) {
    const full = drawableScale(style, asset)
    const visible = playableScale(style, asset)
    const n = full.length
    const m = visible.length
    const y = clamp01(normY)
    if (!n || !m || m >= n) return y
    const fromBottom = (1 - y) * m
    const band = Math.min(m - 1, Math.floor(fromBottom))
    // frac을 1 바로 아래로 캡핑 — 맨 위 픽셀이 이웃한 숨은 칸(예: 파)으로 넘어가지 않게
    const frac = Math.max(0, Math.min(1 - 1e-6, fromBottom - band))
    const fullIndex = full.indexOf(visible[band])
    if (fullIndex === -1) return y
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

  function sampleDrawnTimeline(points, steps) {
    const pts = [...points].sort((a, b) => a.x - b.x)
    const minX = Math.max(0, Math.min(1, pts[0].x))
    const maxX = Math.max(0, Math.min(1, pts[pts.length - 1].x))
    const out = []
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1)
      if (t < minX || t > maxX) {
        out.push(null)
      } else {
        out.push({ t, y: interpY(pts, t) })
      }
    }
    return out
  }

  // --- 선율 / 리듬 자동완성 ---

  // path: 정규화 [{x:0..1, y:0..1}]. 8분음표(0.5초) 격자로 샘플 → 음계 스냅 → 연속 동음 병합.
  function autocompleteMelody(path, opts) {
    const durationSec = opts.durationSec
    const style = opts.style
    const asset = opts.melodyAsset
    const SAMPLE_RATE = 16 // 초당 샘플 수 — 빠른 음(≈8음/초)·짧은 음을 살림(예전 2/초는 0.5초로 뭉갰다)
    const TAP_SEC = 0.16 // 점 찍기/아주 짧은 획을 표현할 최소 음 길이
    if (!path || path.length === 0) return []
    let minX = path[0].x
    let maxX = path[0].x
    for (const p of path) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
    }
    // 점 찍기(가로 폭 ≈ 0) → 짧은 음 하나
    if ((maxX - minX) * durationSec < TAP_SEC) {
      const time = Math.max(0, Math.min(1, minX)) * durationSec
      const midi = quantizePitch(path[0].y, style, asset)
      if (midi == null) return []
      return [
        {
          time: time,
          duration: Math.min(TAP_SEC, Math.max(0.05, durationSec - time)),
          midi: midi,
          velocity: 0.7,
        },
      ]
    }
    const steps = Math.max(1, Math.round(durationSec * SAMPLE_RATE))
    const stepSec = durationSec / steps
    const samples = sampleDrawnTimeline(path, steps)
    const raw = []
    let prev = null
    for (let i = 0; i < steps; i++) {
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
        time: i * stepSec,
        duration: (j - i) * stepSec,
        midi: raw[i],
        velocity: 0.7,
      })
      i = j
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
    const durationSec = opts.durationSec
    const bpm = opts.bpm || 100
    const step = 60 / bpm / 2
    const steps = Math.max(1, Math.floor(durationSec / step))
    const samples = sampleDrawnTimeline(path, steps)
    const hits = []
    for (let i = 0; i < steps; i++) {
      const sample = samples[i]
      if (!sample) continue
      const strength = sample.y
      if (strength > 0.5) {
        hits.push({ time: i * step, velocity: Math.min(1, 0.5 + strength * 0.5) })
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
    const levels = []
    let peak = -Infinity
    for (let w = 0; w < count; w++) {
      let sum = 0
      const base = startFrame + w * winFrames
      for (let i = 0; i < winFrames; i++) {
        const v = channelData[base + i] || 0
        sum += v * v
      }
      const db = 10 * Math.log10(sum / winFrames + 1e-12)
      levels.push(db)
      if (db > peak) peak = db
    }
    const floor = peak - silenceDb
    function longestRun(bandDb) {
      let best = null
      for (let lo = 0; lo < count; lo++) {
        if (levels[lo] < floor) continue
        let hi = lo
        let min = levels[lo]
        let max = levels[lo]
        while (hi + 1 < count && levels[hi + 1] >= floor) {
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
    function toRegion(run) {
      if (!run) return null
      // 경계 창은 어택/감쇠와 걸쳐 있을 수 있어 양끝을 한 창씩 안쪽으로 줄인다.
      const start = from + (run.lo + 1) * windowSec
      const end = from + run.hi * windowSec
      return end - start >= minLoopSec ? { start: start, end: end } : null
    }
    let chosen = null
    for (const band of bands) {
      const region = toRegion(longestRun(band))
      if (!region) continue
      if (region.end - region.start >= targetLoopSec) {
        chosen = region
        break
      }
      if (!chosen || region.end - region.start > chosen.end - chosen.start) chosen = region
    }
    if (!chosen) return null
    return alignLoopEndToStart(channelData, sampleRate, chosen)
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
    encodeRecipe,
    decodeRecipe,
    encodeWav,
  }
})
