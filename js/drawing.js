/*
 * drawing.js — 드로잉 캔버스 (window.DrawingCanvas)
 *
 * - 좌표는 0..1 정규화로 저장 → 해상도/그리는 속도와 무관, 레시피로 직렬화 가능.
 * - 가로 = 시간, 세로 = 음높이. 음계 가이드 가로선 + 팔레트 구간 분할선 표시.
 * - 그린 원본 선 + music-core로 보정한 음(피아노롤)을 함께 렌더.
 */
;(function (root) {
  "use strict"
  const Core = root.MusicCore

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  function DrawingCanvas(canvas, opts) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.getState = opts.getState // () => { duration, style, mode }
    this.onChange = opts.onChange || function () {}
    this.onPreviewStart = opts.onPreviewStart || function () {}
    this.onPreview = opts.onPreview || function () {}
    this.onPreviewEnd = opts.onPreviewEnd || function () {}
    this.accent = opts.accent || "#5f8f63"
    this.strokes = [] // 정규화 다중 획: [ [{x,y}...], ... ]
    this.currentStroke = null // 그리는 중인 획
    this.notes = []
    this.hits = []
    this.isDrawing = false
    this.eraseMode = false // 지우개 모드
    this.eraseRadius = 0.035 // 정규화 반경
    this.pixelRatio = 1
    this.lastPreviewAt = 0
    this.lastPreviewY = null
    this._bind()
    this.render()
  }

  DrawingCanvas.prototype.setEraseMode = function (on) {
    this.eraseMode = !!on
    this.canvas.style.cursor = this.eraseMode ? "cell" : "crosshair"
  }

  DrawingCanvas.prototype.setAccent = function (color) {
    this.accent = color
    this.render()
  }

  function cleanStroke(stroke) {
    return (stroke || []).map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
  }

  DrawingCanvas.prototype.setStrokes = function (strokes) {
    this.strokes = (strokes || []).map(cleanStroke).filter((s) => s.length > 0)
    this.currentStroke = null
    this.compute()
    this.render()
  }

  // 하위 호환: 단일 path → 하나의 획
  DrawingCanvas.prototype.setPath = function (path) {
    this.setStrokes(path && path.length ? [path] : [])
  }

  DrawingCanvas.prototype.clear = function () {
    this.strokes = []
    this.currentStroke = null
    this.notes = []
    this.hits = []
    this.render()
    this.onChange()
  }

  DrawingCanvas.prototype.getStrokes = function () {
    return this.strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y })))
  }

  // 선율/썸네일/레시피용: 모든 획의 점을 시간(x) 순으로 합친 평탄 경로
  DrawingCanvas.prototype.getPath = function () {
    const all = []
    for (const s of this.strokes) for (const p of s) all.push({ x: p.x, y: p.y })
    all.sort((a, b) => a.x - b.x)
    return all
  }

  DrawingCanvas.prototype._point = function (e) {
    const r = this.canvas.getBoundingClientRect()
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    }
  }

  // 지우개: 커서 반경 안의 점을 지우고, 끊긴 구간은 별도 획으로 분리
  DrawingCanvas.prototype._eraseAt = function (p) {
    const r2 = this.eraseRadius * this.eraseRadius
    const next = []
    for (const stroke of this.strokes) {
      let cur = []
      for (const pt of stroke) {
        const dx = pt.x - p.x
        const dy = pt.y - p.y
        if (dx * dx + dy * dy <= r2) {
          if (cur.length >= 2) next.push(cur)
          cur = []
        } else {
          cur.push(pt)
        }
      }
      if (cur.length >= 2) next.push(cur)
    }
    this.strokes = next
  }

  DrawingCanvas.prototype._bind = function () {
    const self = this
    this.canvas.addEventListener("pointerdown", function (e) {
      const p = self._point(e)
      self.isDrawing = true
      try {
        self.canvas.setPointerCapture(e.pointerId)
      } catch (err) {}
      if (self.eraseMode) {
        self._eraseAt(p)
        self.render()
        return
      }
      // 새 획 시작 — 기존 획은 그대로 둔다(자동 삭제/연결 없음)
      self.currentStroke = [p]
      self.strokes.push(self.currentStroke)
      self._previewStart(p)
      self.render()
    })
    this.canvas.addEventListener("pointermove", function (e) {
      if (!self.isDrawing) return
      const p = self._point(e)
      if (self.eraseMode) {
        self._eraseAt(p)
        self.render()
        return
      }
      const stroke = self.currentStroke
      const last = stroke[stroke.length - 1]
      // 한 획 안에서는 시간(x)이 거꾸로 가지 않게 단조 증가
      if (!last || p.x >= last.x) stroke.push(p)
      else stroke.push({ x: last.x, y: p.y })
      self._preview(p, false)
      self.renderStrokeOnly()
    })
    const finish = function () {
      if (!self.isDrawing) return
      self.isDrawing = false
      if (!self.eraseMode) self.onPreviewEnd()
      self.currentStroke = null
      self.compute()
      self.render()
      self.onChange()
    }
    this.canvas.addEventListener("pointerup", finish)
    this.canvas.addEventListener("pointercancel", finish)
    this.canvas.addEventListener("pointerleave", function () {
      if (self.isDrawing) finish()
    })
  }

  DrawingCanvas.prototype._previewStart = function (point) {
    const now = root.performance && root.performance.now ? root.performance.now() : Date.now()
    this.lastPreviewAt = now
    this.lastPreviewY = point.y
    this.onPreviewStart({ x: point.x, y: point.y })
  }

  DrawingCanvas.prototype._preview = function (point, force) {
    const now = root.performance && root.performance.now ? root.performance.now() : Date.now()
    const movedPitch = this.lastPreviewY == null || Math.abs(point.y - this.lastPreviewY) > 0.045
    if (!force && !movedPitch && now - this.lastPreviewAt < 110) return
    this.lastPreviewAt = now
    this.lastPreviewY = point.y
    this.onPreview({ x: point.x, y: point.y })
  }

  DrawingCanvas.prototype.compute = function () {
    const st = this.getState()
    const path = this.getPath()
    if (path.length < 2) {
      this.notes = []
      this.hits = []
      return
    }
    if (st.mode === "rhythm") {
      this.hits = Core.autocompleteRhythm(path, { durationSec: st.duration, bpm: 100 })
      this.notes = []
    } else {
      this.notes = Core.autocompleteMelody(path, { durationSec: st.duration, style: st.style })
      this.hits = []
    }
  }

  DrawingCanvas.prototype._paletteCount = function () {
    return Math.max(1, Math.ceil(this.getState().duration / 10))
  }

  DrawingCanvas.prototype.resizeToDisplay = function () {
    const r = this.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const deviceRatio = root.devicePixelRatio || 1
    const maxBackingWidth = 12000
    const ratio = Math.max(1, Math.min(2, deviceRatio, maxBackingWidth / r.width))
    const nextW = Math.max(1, Math.round(r.width * ratio))
    const nextH = Math.max(1, Math.round(r.height * ratio))
    this.pixelRatio = ratio
    if (this.canvas.width === nextW && this.canvas.height === nextH) return false
    this.canvas.width = nextW
    this.canvas.height = nextH
    return true
  }

  DrawingCanvas.prototype.renderGrid = function () {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    ctx.clearRect(0, 0, W, H)
    // 화첩 종이 배경
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, W, H)

    // 음계 가이드 가로선
    const st = this.getState()
    const scale = Core.buildScale(st.style)
    ctx.lineWidth = 1 * px
    for (let i = 0; i < scale.length; i++) {
      const y = H - (i / Math.max(1, scale.length - 1)) * H
      ctx.strokeStyle = i % (st.style.intervals.length) === 0 ? "rgba(31,38,38,0.16)" : "rgba(31,38,38,0.06)"
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }

    // 팔레트 구간 분할선 (액자 느낌)
    const count = this._paletteCount()
    const pw = W / count
    for (let i = 1; i < count; i++) {
      ctx.strokeStyle = "rgba(31,38,38,0.22)"
      ctx.setLineDash([6 * px, 6 * px])
      ctx.lineWidth = 1.5 * px
      ctx.beginPath()
      ctx.moveTo(i * pw, 0)
      ctx.lineTo(i * pw, H)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // 각 획을 따로 그린다 — 획끼리 자동으로 이어지지 않음(그린 대로)
  DrawingCanvas.prototype.renderStroke = function () {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 6 * px
    ctx.strokeStyle = this.accent
    ctx.globalAlpha = 0.55
    for (const stroke of this.strokes) {
      if (stroke.length < 2) {
        // 점 하나짜리 획은 작은 점으로 표시
        if (stroke.length === 1) {
          ctx.globalAlpha = 0.55
          ctx.beginPath()
          ctx.arc(stroke[0].x * W, stroke[0].y * H, 3.2 * px, 0, Math.PI * 2)
          ctx.fillStyle = this.accent
          ctx.fill()
        }
        continue
      }
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * W, stroke[0].y * H)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * W, stroke[i].y * H)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  DrawingCanvas.prototype._pitchToY = function (midi, scale) {
    const idx = Math.max(0, scale.indexOf(midi))
    return this.canvas.height - (idx / Math.max(1, scale.length - 1)) * this.canvas.height
  }

  DrawingCanvas.prototype.renderNotes = function () {
    const ctx = this.ctx
    const st = this.getState()
    const W = this.canvas.width
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    if (st.mode === "rhythm") {
      // 리듬: 하단에 타격 막대
      ctx.fillStyle = this.accent
      for (const h of this.hits) {
        const x = (h.time / st.duration) * W
        const barH = (20 + (h.velocity || 0.7) * 60) * px
        ctx.fillRect(x - 3 * px, H - barH, 6 * px, barH)
      }
      return
    }
    const scale = Core.buildScale(st.style)
    const rowH = H / Math.max(1, scale.length - 1)
    for (const n of this.notes) {
      const x = (n.time / st.duration) * W
      const w = Math.max(6 * px, (n.duration / st.duration) * W - 3 * px)
      const y = this._pitchToY(n.midi, scale)
      ctx.fillStyle = this.accent
      ctx.globalAlpha = 0.9
      roundRect(ctx, x + 1 * px, y - rowH * 0.32, w, rowH * 0.64, 5 * px)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  DrawingCanvas.prototype.renderStrokeOnly = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
  }

  DrawingCanvas.prototype.render = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
    this.renderNotes()
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  // 썸네일/커버용: 임의 캔버스에 path를 accent로 렌더
  DrawingCanvas.drawStroke = function (ctx, w, h, path, accent, bg) {
    ctx.fillStyle = bg || "#fbf6ec"
    ctx.fillRect(0, 0, w, h)
    if (!path || path.length < 2) return
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = Math.max(2, w / 60)
    ctx.strokeStyle = accent || "#5f8f63"
    ctx.beginPath()
    ctx.moveTo(path[0].x * w, path[0].y * h)
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x * w, path[i].y * h)
    ctx.stroke()
  }

  root.DrawingCanvas = DrawingCanvas
})(typeof self !== "undefined" ? self : this)
