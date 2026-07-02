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

  function normalizeHashtags(value) {
    const raw = Array.isArray(value) ? value.join(" ") : String(value || "")
    const seen = {}
    return raw
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, "").replace(/[^\w\uAC00-\uD7A3-]/g, "").trim())
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
    return normalizeHashtags(value).join(" ")
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")"
  }

  function simplifyPoints(points, maxPoints) {
    const source = points || []
    if (!maxPoints || maxPoints < 1) return []
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
      .map((stamp) => ({
        id: stamp.id,
        x: round3(Math.max(0, Math.min(1, stamp.x || 0))),
        y: round3(Math.max(0, Math.min(1, stamp.y == null ? 0.5 : stamp.y))),
      }))
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
    simplifyPath: simplifyPath,
    simplifyPoints: simplifyPoints,
    simplifyStrokes: simplifyStrokes,
  }
})
