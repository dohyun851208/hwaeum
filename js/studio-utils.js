/*
 * studio-utils.js - pure helpers shared by the studio runtime and Node tests.
 *
 * Keep this file free of DOM, Web Audio, Canvas, and localStorage access.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = api
  else root.HwaeumStudioUtils = api
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  function round3(value) {
    return Math.round(value * 1000) / 1000
  }

  function normalizeDuration(value, options) {
    const opts = options || {}
    const min = opts.min == null ? 1 : opts.min
    const fallback = opts.fallback == null ? 30 : opts.fallback
    const n = Number(value)
    return round3(Math.max(min, isFinite(n) ? n : fallback))
  }

  // Snap a background range length to whole timeline segments (one bar = one segment).
  // The canvas draws a grid line every segment and labels every segment, so a length that
  // is not a whole multiple leaves a stub bar and makes the last label collide with the
  // one before it. Keeps at least one bar and never runs past maxSeconds.
  function snapDurationToSegments(value, segmentSeconds, maxSeconds) {
    const segment = Number(segmentSeconds)
    const raw = Number(value)
    const safeRaw = isFinite(raw) ? Math.max(0, raw) : 0
    if (!isFinite(segment) || segment <= 0) return round3(safeRaw)
    const max = Number(maxSeconds)
    const hasMax = isFinite(max) && max > 0
    // A background shorter than a single bar cannot be snapped - use all of it.
    if (hasMax && max < segment) return round3(max)
    let bars = Math.round(safeRaw / segment)
    if (hasMax) bars = Math.min(bars, Math.floor((max + 0.001) / segment))
    return round3(Math.max(1, bars) * segment)
  }

  function secondsLabel(value) {
    const n = round3(Math.max(0, Number(value) || 0))
    const whole = Math.round(n)
    if (Math.abs(n - whole) < 0.001) return whole + "\uCD08"
    return n.toFixed(1).replace(/\.0$/, "") + "\uCD08"
  }

  function clampNumber(value, min, max) {
    const n = parseFloat(value)
    if (!isFinite(n)) return min
    return Math.max(min, Math.min(max, n))
  }

  function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value) || 0))
  }

  function cleanText(value, max) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  }

  function normalizePictureData(value) {
    const data = String(value || "")
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(data) ? data : ""
  }

  // Tags split on commas/newlines and '#' (so "#봄 #여름" becomes two tags), but not on spaces,
  // so a multi-word tag stays one tag. Hangul jamo (ㅋㅋㅋ) is kept like other letters.
  function normalizeHashtags(value) {
    const raw = Array.isArray(value) ? value.join(",") : String(value || "")
    const seen = {}
    return raw
      .split(/[,\n#]+/)
      .map((tag) =>
        tag
          .replace(/^[\s#]+/, "")
          .replace(/[^\w\u3131-\u318E\uAC00-\uD7A3\- ]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 24)
          .trim(),
      )
      .filter(Boolean)
      .filter((tag) => {
        const key = tag.toLowerCase()
        if (seen[key]) return false
        seen[key] = true
        return true
      })
      .slice(0, 3)
  }

  function hashtagText(value) {
    return normalizeHashtags(value)
      .map((tag) => "#" + tag)
      .join(" ")
  }

  function keywordText(value) {
    return normalizeHashtags(value).join(", ")
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")"
  }

  function simplifyPoints(points, maxPoints, pitchAt) {
    const source = points || []
    if (!maxPoints || maxPoints < 1) return []
    if (pitchAt && source.length) {
      // 음 경계 전후의 점은 솎지 않는다. 짧은 복귀를 버리면 떨림이 긴 새 음으로 변한다.
      const keep = new Set([0, source.length - 1])
      let previous = pitchAt(source[0])
      for (let i = 1; i < source.length; i++) {
        const pitch = pitchAt(source[i])
        if (pitch !== previous) { keep.add(i - 1); keep.add(i) }
        previous = pitch
      }
      const count = Math.min(maxPoints, source.length)
      for (let i = 0; i < count && keep.size < maxPoints; i++) keep.add(Math.floor(i * source.length / count))
      // 정규화 좌표의 소수 셋째 자리 반올림도 긴 작품에서는 체류 시간을 바꾼다.
      return Array.from(keep).sort((a, b) => a - b).map(i => ({ x: source[i].x, y: source[i].y }))
    }
    if (source.length <= maxPoints) {
      return source.map((p) => ({ x: round3(p.x), y: round3(p.y) }))
    }
    const out = []
    const step = source.length / maxPoints
    for (let i = 0; i < maxPoints; i++) {
      const p = source[Math.floor(i * step)]
      out.push({ x: round3(p.x), y: round3(p.y) })
    }
    const last = source[source.length - 1]
    out.push({ x: round3(last.x), y: round3(last.y) })
    return out
  }

  function simplifyPath(path) {
    if (!path || path.length < 2) return path ? path.slice() : []
    return simplifyPoints(path, 120)
  }

  function simplifyStrokes(strokes) {
    return (strokes || []).map((stroke) => simplifyPoints(stroke, 70)).filter((stroke) => stroke.length > 0)
  }

  function simplifyEffectStamps(stamps, effects) {
    const effectMap = effects || {}
    return (stamps || [])
      .filter((stamp) => stamp && effectMap[stamp.id])
      .map((stamp) => {
        const out = {
          id: stamp.id,
          // 구간을 줄여 끝 너머(x>1)로 간 도장은 지우지 않고 그대로 둔다(다시 늘리면 같은 초에 나타난다).
          x: round3(Math.max(0, Number(stamp.x) || 0)),
          y: round3(Math.max(0, Math.min(1, stamp.y == null ? 0.5 : stamp.y))),
        }
        // 학생이 길이 띠 끝을 끌어 줄인 길이(초, 0.1초 단위). 줄이지 않은 도장에는 없다.
        const duration = Number(stamp.duration)
        if (duration > 0) out.duration = Math.max(0.1, Math.round(duration * 10) / 10)
        return out
      })
  }

  return {
    clampNumber: clampNumber,
    clampUnit: clampUnit,
    cleanText: cleanText,
    hashtagText: hashtagText,
    hexToRgba: hexToRgba,
    keywordText: keywordText,
    normalizeDuration: normalizeDuration,
    normalizeHashtags: normalizeHashtags,
    normalizePictureData: normalizePictureData,
    round3: round3,
    secondsLabel: secondsLabel,
    simplifyEffectStamps: simplifyEffectStamps,
    snapDurationToSegments: snapDurationToSegments,
    simplifyPath: simplifyPath,
    simplifyPoints: simplifyPoints,
    simplifyStrokes: simplifyStrokes,
  }
})
