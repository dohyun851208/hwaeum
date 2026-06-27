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

  // 실제로 "그릴 수 있는" 음 목록 = 음계 ∩ 악기 연주가능음(playableMidi).
  // 서양 악기는 playableMidi가 없어 음계 전체. 국악기는 연주 가능한 음만 남긴다.
  // 축·quantize·렌더가 이 한 목록을 공유해야 "그린 칸 = 들리는 음"이 맞는다.
  function drawableScale(style, asset) {
    const scale = buildScale(style)
    if (!asset || !Array.isArray(asset.playableMidi) || !asset.playableMidi.length) return scale
    const tr = asset.playbackTranspose || 0
    const filtered = scale.filter((m) => asset.playableMidi.indexOf(m) !== -1 || asset.playableMidi.indexOf(m + tr) !== -1)
    return filtered.length ? filtered : scale
  }

  function nearestScaleNote(target, style, asset) {
    const scale = drawableScale(style, asset)
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
    return scale[Math.max(0, Math.min(scale.length - 1, idx))]
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
    nearestScaleNote,
    quantizePitch,
    interpY,
    resampleByTime,
    autocompleteMelody,
    autocompleteMelodyStrokes,
    autocompleteRhythm,
    sigimsaeFor,
    encodeRecipe,
    decodeRecipe,
    encodeWav,
  }
})
