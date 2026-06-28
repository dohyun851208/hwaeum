/*
 * drawing.js — 드로잉 캔버스 (window.DrawingCanvas)
 *
 * - 좌표는 0..1 정규화로 저장 → 해상도/그리는 속도와 무관, 레시피로 직렬화 가능.
 * - 가로 = 시간, 세로 = 음높이. 음높이 칸을 나누는 가로선 표시.
 * - 그린 원본 선 + music-core로 보정한 음(피아노롤)을 함께 렌더.
 */
;(function (root) {
  "use strict"
  const Core = root.MusicCore
  const TIMELINE_GRID_SECONDS = 2.5
  const PITCH_LABEL_GUTTER_CSS_PX = 56

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  // 음 이름만 반환(옥타브 숫자 없음). 악기마다 음역대가 달라 적힌 옥타브 숫자가
  // 실제 들리는 소리와 어긋날 수 있어, 축 라벨에는 음 이름만 표시한다.
  function noteLetter(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12]
  }

  // 그릴 수 있는 음 목록(음계 ∩ 악기 연주가능음). 축·격자·렌더·quantize 가 모두 이 한 목록을 공유한다.
  function drawableScaleFor(style, asset) {
    return (Core.drawableScale || Core.buildScale)(style, asset)
  }

  // 축 라벨에 쓸 음 이름. 악기 transpose 를 반영하되 옥타브 숫자는 떼고 음 이름만 보여준다.
  // (악기마다 음역대가 달라 옥타브 숫자가 실제 소리와 어긋날 수 있어서. 높은 음=위, 낮은 음=아래는 그대로.)
  function soundingLabel(midi, asset) {
    const tr = asset && asset.playbackTranspose ? asset.playbackTranspose : 0
    return noteLetter(midi + tr)
  }

  function pitchRowsForStyle(style, asset) {
    const rows = drawableScaleFor(style, asset)
    return rows.map((midi, i) => {
      const bounds = pitchRowBoundsRatio(i, rows.length)
      return {
        midi: midi,
        label: soundingLabel(midi, asset),
        top: pitchRowCenterRatio(i, rows.length) * 100,
        rowTop: bounds.top * 100,
        rowBottom: bounds.bottom * 100,
        rowHeight: (bounds.bottom - bounds.top) * 100,
        selected: true,
      }
    })
  }

  function pitchLabelsForStyle(style, asset) {
    return pitchRowsForStyle(style, asset).filter((row) => row.midi != null)
  }

  function pitchRowCenterRatio(rowIndex, rowCount) {
    const count = Math.max(1, rowCount)
    const index = clamp(rowIndex, 0, count - 1)
    return 1 - (index + 0.5) / count
  }

  function pitchRowCenterY(rowIndex, rowCount, height) {
    return pitchRowCenterRatio(rowIndex, rowCount) * height
  }

  function pitchRowBoundsY(rowIndex, rowCount, height) {
    const bounds = pitchRowBoundsRatio(rowIndex, rowCount)
    return {
      top: bounds.top * height,
      bottom: bounds.bottom * height,
    }
  }

  function pitchRowBoundsRatio(rowIndex, rowCount) {
    const count = Math.max(1, rowCount)
    const index = clamp(rowIndex, 0, count - 1)
    return {
      top: 1 - (index + 1) / count,
      bottom: 1 - index / count,
    }
  }

  function pitchRowBoundaryY(boundaryIndex, rowCount, height) {
    const count = Math.max(1, rowCount)
    const index = clamp(boundaryIndex, 0, count)
    return height - (index / count) * height
  }

  function crispLinePosition(value, lineWidth, min, max) {
    const width = Math.max(1, Math.round(lineWidth || 1))
    const offset = width % 2 ? 0.5 : 0
    const pos = Math.round(value) + offset
    if (typeof min === "number" && typeof max === "number") {
      return clamp(pos, min + offset, max - offset)
    }
    return pos
  }

  function DrawingCanvas(canvas, opts) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.getState = opts.getState // () => { duration, style, mode }
    this.onChange = opts.onChange || function () {}
    this.onPreviewStart = opts.onPreviewStart || function () {}
    this.onPreview = opts.onPreview || function () {}
    this.onPreviewEnd = opts.onPreviewEnd || function () {}
    this.onFlowStart = opts.onFlowStart || function () {}
    this.onFlowEnd = opts.onFlowEnd || function () {}
    this.getFlowProgress = opts.getFlowProgress || function () { return 0 }
    this.accent = opts.accent || "#5f8f63"
    this.strokes = [] // 정규화 다중 획: [ [{x,y}...], ... ]
    this.strokeInstruments = [] // 각 획의 악기 id(획과 1:1, 지우개로 쪼개져도 유지) — 오케스트라용
    this.undoStack = []
    this.maxUndo = opts.maxUndo || 30
    this.pendingUndoSnapshot = null
    this.activeInstrument = opts.activeInstrument != null ? opts.activeInstrument : null // 다음에 그릴 획의 악기
    this.instrumentColor = opts.instrumentColor || null // (id) => 색. 없으면 accent
    this.maxInstruments = opts.maxInstruments || 4 // 동시에 쌓을 수 있는 악기 수
    this.onInstrumentLimit = opts.onInstrumentLimit || function () {}
    this.currentStroke = null // 그리는 중인 획
    this.notes = []
    this.hits = []
    this.isDrawing = false
    this.eraseMode = false // 지우개 모드
    this.eraseRadius = 0.035 // 정규화 반경
    this.flowMode = false
    this.flowActive = false
    this.flowY = 0.5
    this.pixelRatio = 1
    this.lastPreviewAt = 0
    this.lastPreviewY = null
    // 가장자리 자동 스크롤 — 긴 타임라인에서 끝까지 이어 그리기
    this.scrollContainer =
      opts.scrollContainer ||
      (canvas.closest ? canvas.closest(".canvas-wrap") : null) ||
      canvas.parentElement ||
      null
    this._edgeZone = 64 // 좌/우 가장자리 감지 폭(px)
    this._edgeDir = 0 // -1 왼쪽 / +1 오른쪽 / 0 멈춤
    this._edgeDepth = 0 // 가장자리에 얼마나 깊이 들어왔나(0..1) → 스크롤 속도
    this._autoScrollRAF = null
    this._lastClientX = 0
    this._lastClientY = 0
    this._bind()
    this.render()
  }

  DrawingCanvas.prototype._syncCursor = function () {
    if (this.eraseMode) this.canvas.style.cursor = "cell"
    else if (this.flowMode) this.canvas.style.cursor = "ns-resize"
    else this.canvas.style.cursor = "crosshair"
  }

  DrawingCanvas.prototype.setEraseMode = function (on) {
    this.eraseMode = !!on
    this._syncCursor()
  }

  // 따라 그리기: 가로(시간)는 studio의 시계가 기록하고, 펜은 세로(음높이)만 조절한다.
  DrawingCanvas.prototype.setFlowMode = function (on) {
    this.flowMode = !!on
    if (this.flowMode) {
      this._stopAutoScroll()
    } else {
      this.finishFlowStroke(false)
    }
    this._syncCursor()
  }

  DrawingCanvas.prototype.setAccent = function (color) {
    this.accent = color
    this.render()
  }

  // 다음에 그릴 획에 입힐 악기. 이미 그린 획은 바뀌지 않는다.
  DrawingCanvas.prototype.setActiveInstrument = function (id) {
    this.activeInstrument = id != null ? id : null
  }

  DrawingCanvas.prototype.getStrokeInstruments = function () {
    return this.strokeInstruments.slice()
  }

  // 현재 그려진 획들의 서로 다른 악기 수(빈 슬롯 제외)
  DrawingCanvas.prototype.distinctInstrumentCount = function () {
    const set = {}
    for (const id of this.strokeInstruments) if (id != null) set[id] = true
    return Object.keys(set).length
  }

  DrawingCanvas.prototype._colorFor = function (id) {
    if (this.instrumentColor) {
      const c = this.instrumentColor(id)
      if (c) return c
    }
    return this.accent
  }

  DrawingCanvas.prototype._instrumentForNote = function (note) {
    if (!note || note.voice == null) return this.activeInstrument
    return this.strokeInstruments[note.voice] != null ? this.strokeInstruments[note.voice] : this.activeInstrument
  }

  DrawingCanvas.prototype._startFlowStroke = function (p) {
    const active = this.activeInstrument
    if (
      active != null &&
      this.strokeInstruments.indexOf(active) === -1 &&
      this.distinctInstrumentCount() >= this.maxInstruments
    ) {
      this.isDrawing = false
      this.onInstrumentLimit(this.maxInstruments)
      return false
    }
    this._pushUndo()
    this.isDrawing = true
    this.flowActive = true
    const flowProgress = clamp(this.getFlowProgress(), 0, 1)
    this.flowY = clamp(p && p.y != null ? p.y : this.flowY, 0, 1)
    this.currentStroke = [{ x: flowProgress, y: this.flowY }]
    this.strokes.push(this.currentStroke)
    this.strokeInstruments.push(active)
    this._previewStart(this.currentStroke[0])
    this.onFlowStart()
    this.render()
    return true
  }

  DrawingCanvas.prototype.flowRecord = function (progress) {
    if (!this.flowActive || !this.currentStroke) return false
    const x = clamp(Number(progress) || 0, 0, 1)
    const y = clamp(this.flowY, 0, 1)
    const stroke = this.currentStroke
    const last = stroke[stroke.length - 1]
    if (last && Math.abs(last.x - x) < 1e-4) {
      last.y = y
    } else if (!last || x > last.x) {
      stroke.push({ x: x, y: y })
    } else {
      return false
    }
    this._preview({ x: x, y: y }, false)
    this.compute()
    this.renderStrokeOnly()
    this.onChange()
    return true
  }

  DrawingCanvas.prototype.finishFlowStroke = function (notifyFlowEnd) {
    if (!this.flowActive) return false
    this.flowActive = false
    this.isDrawing = false
    this.pendingUndoSnapshot = null
    this.currentStroke = null
    this.onPreviewEnd()
    if (notifyFlowEnd) this.onFlowEnd()
    this.compute()
    this.render()
    this.onChange()
    return true
  }

  function cleanStroke(stroke) {
    return (stroke || []).map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
  }

  function sameStrokeState(aStrokes, aInsts, bStrokes, bInsts) {
    if (aStrokes.length !== bStrokes.length || aInsts.length !== bInsts.length) return false
    for (let i = 0; i < aInsts.length; i++) if (aInsts[i] !== bInsts[i]) return false
    for (let i = 0; i < aStrokes.length; i++) {
      const a = aStrokes[i]
      const b = bStrokes[i]
      if (a.length !== b.length) return false
      for (let j = 0; j < a.length; j++) {
        if (a[j].x !== b[j].x || a[j].y !== b[j].y) return false
      }
    }
    return true
  }

  DrawingCanvas.prototype._snapshot = function () {
    return {
      strokes: this.getStrokes(),
      strokeInstruments: this.getStrokeInstruments(),
    }
  }

  DrawingCanvas.prototype._pushUndoSnapshot = function (snapshot) {
    if (!snapshot) return
    this.undoStack.push({
      strokes: (snapshot.strokes || []).map(cleanStroke),
      strokeInstruments: (snapshot.strokeInstruments || []).slice(),
    })
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift()
  }

  DrawingCanvas.prototype._pushUndo = function () {
    this._pushUndoSnapshot(this._snapshot())
  }

  DrawingCanvas.prototype._commitPendingUndo = function () {
    if (!this.pendingUndoSnapshot) return
    this._pushUndoSnapshot(this.pendingUndoSnapshot)
    this.pendingUndoSnapshot = null
  }

  DrawingCanvas.prototype.canUndo = function () {
    return this.undoStack.length > 0
  }

  DrawingCanvas.prototype.clearUndoHistory = function () {
    this.undoStack = []
    this.pendingUndoSnapshot = null
  }

  DrawingCanvas.prototype.undo = function () {
    if (!this.undoStack.length) return false
    const snapshot = this.undoStack.pop()
    this.pendingUndoSnapshot = null
    this.isDrawing = false
    this.currentStroke = null
    this._stopAutoScroll()
    this.strokes = (snapshot.strokes || []).map(cleanStroke).filter((s) => s.length > 0)
    this.strokeInstruments = this.strokes.map((_, i) =>
      snapshot.strokeInstruments && snapshot.strokeInstruments[i] != null ? snapshot.strokeInstruments[i] : null,
    )
    this.compute()
    this.render()
    this.onChange()
    return true
  }

  DrawingCanvas.prototype.setStrokes = function (strokes, instruments) {
    const cleaned = []
    const insts = []
    ;(strokes || []).forEach((s, i) => {
      const c = cleanStroke(s)
      if (c.length > 0) {
        cleaned.push(c)
        insts.push(instruments && instruments[i] != null ? instruments[i] : this.activeInstrument)
      }
    })
    this.strokes = cleaned
    this.strokeInstruments = insts
    this.currentStroke = null
    this.compute()
    this.render()
  }

  // 하위 호환: 단일 path → 하나의 획(악기 지정 가능)
  DrawingCanvas.prototype.setPath = function (path, instrument) {
    this.setStrokes(path && path.length ? [path] : [], instrument != null ? [instrument] : null)
  }

  DrawingCanvas.prototype.clear = function (recordUndo) {
    if (recordUndo !== false && this.strokes.length) this._pushUndo()
    this.pendingUndoSnapshot = null
    this.strokes = []
    this.strokeInstruments = []
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
    const labelGutter = typeof this.pitchLabelGutterCssPx === "function" ? this.pitchLabelGutterCssPx() : 0
    const timelineWidth = Math.max(1, r.width - labelGutter)
    return {
      x: clamp((e.clientX - r.left - labelGutter) / timelineWidth, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    }
  }

  // 지우개: 커서 반경 안의 점을 지우고, 끊긴 구간은 별도 획으로 분리
  DrawingCanvas.prototype._eraseAt = function (p) {
    const r2 = this.eraseRadius * this.eraseRadius
    const next = []
    const nextInst = []
    for (let si = 0; si < this.strokes.length; si++) {
      const stroke = this.strokes[si]
      const inst = this.strokeInstruments[si]
      let cur = []
      for (const pt of stroke) {
        const dx = pt.x - p.x
        const dy = pt.y - p.y
        if (dx * dx + dy * dy <= r2) {
          if (cur.length >= 2) {
            next.push(cur)
            nextInst.push(inst)
          }
          cur = []
        } else {
          cur.push(pt)
        }
      }
      if (cur.length >= 2) {
        next.push(cur)
        nextInst.push(inst)
      }
    }
    const changed = !sameStrokeState(this.strokes, this.strokeInstruments, next, nextInst)
    this.strokes = next
    this.strokeInstruments = nextInst
    return changed
  }

  DrawingCanvas.prototype._bind = function () {
    const self = this
    this.canvas.addEventListener("pointerdown", function (e) {
      const p = self._point(e)
      self._lastClientX = e.clientX
      self._lastClientY = e.clientY
      self.isDrawing = true
      try {
        self.canvas.setPointerCapture(e.pointerId)
      } catch (err) {}
      if (self.eraseMode) {
        self.pendingUndoSnapshot = self._snapshot()
        if (self._eraseAt(p)) self._commitPendingUndo()
        self.render()
        return
      }
      if (self.flowMode) {
        self._startFlowStroke(p)
        return
      }
      // 악기 제한: 새 악기로 줄을 시작하려는데 이미 한도(기본 4개)면 막는다(줄을 지우면 자리가 생김)
      const active = self.activeInstrument
      if (
        active != null &&
        self.strokeInstruments.indexOf(active) === -1 &&
        self.distinctInstrumentCount() >= self.maxInstruments
      ) {
        self.isDrawing = false
        self.onInstrumentLimit(self.maxInstruments)
        return
      }
      // 새 획 시작 — 기존 획은 그대로 둔다(자동 삭제/연결 없음)
      self._pushUndo()
      self.currentStroke = [p]
      self.strokes.push(self.currentStroke)
      self.strokeInstruments.push(active)
      self._previewStart(p)
      self.render()
    })
    this.canvas.addEventListener("pointermove", function (e) {
      if (!self.isDrawing) return
      self._lastClientX = e.clientX
      self._lastClientY = e.clientY
      if (self.flowMode && !self.eraseMode) {
        if (self.flowActive) {
          const fp = self._point(e)
          self.flowY = fp.y
          self._preview({ x: self.currentStroke ? self.currentStroke[self.currentStroke.length - 1].x : 0, y: fp.y }, false)
        }
        return
      }
      self._maybeAutoScroll(e.clientX)
      // 가장자리 자동 스크롤 중에는 rAF 루프가 점을 찍는다(x·y를 함께 전진 → 계단현상 방지).
      // 그 외에는 평소처럼 포인터 위치를 그대로 반영.
      if (self._edgeDir === 0) self._applyPointer(self._point(e))
    })
    const finish = function () {
      if (!self.isDrawing) return
      if (self.flowMode && self.flowActive) {
        self.finishFlowStroke(true)
        return
      }
      self.isDrawing = false
      self.pendingUndoSnapshot = null
      self._stopAutoScroll()
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

  // 포인터 위치(p: 0..1)를 현재 모드대로 반영 — pointermove와 자동 스크롤 루프가 공유
  DrawingCanvas.prototype._applyPointer = function (p) {
    if (this.eraseMode) {
      if (this._eraseAt(p)) this._commitPendingUndo()
      this.render()
      return
    }
    const stroke = this.currentStroke
    if (!stroke) return
    const last = stroke[stroke.length - 1]
    // 한 획 안에서는 시간(x)이 거꾸로 가지 않게 단조 증가
    if (!last || p.x >= last.x) stroke.push(p)
    else stroke.push({ x: last.x, y: p.y })
    this._preview(p, false)
    this.renderStrokeOnly()
  }

  // 그리는 중 포인터가 좌/우 가장자리에 닿으면 타임라인을 따라 스크롤(끝까지 이어 그리기)
  DrawingCanvas.prototype._maybeAutoScroll = function (clientX) {
    const sc = this.scrollContainer
    if (!sc || typeof sc.getBoundingClientRect !== "function") return
    const rect = sc.getBoundingClientRect()
    const zone = this._edgeZone
    const maxScroll = sc.scrollWidth - sc.clientWidth
    let dir = 0
    let depth = 0
    if (maxScroll > 1 && clientX > rect.right - zone && sc.scrollLeft < maxScroll - 1) {
      dir = 1
      depth = clamp((clientX - (rect.right - zone)) / zone, 0, 1)
    } else if (clientX < rect.left + zone && sc.scrollLeft > 0) {
      dir = -1
      depth = clamp((rect.left + zone - clientX) / zone, 0, 1)
    }
    this._edgeDir = dir
    this._edgeDepth = depth
    if (dir !== 0) this._startAutoScroll()
    else this._stopAutoScroll()
  }

  DrawingCanvas.prototype._startAutoScroll = function () {
    if (this._autoScrollRAF != null) return
    if (typeof root.requestAnimationFrame !== "function") return
    const self = this
    const tick = function () {
      self._autoScrollRAF = null
      const sc = self.scrollContainer
      if (!self.isDrawing || self._edgeDir === 0 || !sc) return
      const maxScroll = sc.scrollWidth - sc.clientWidth
      const step = (4 + self._edgeDepth * 14) * self._edgeDir // px/frame, 가장자리에 깊을수록 빠름
      const before = sc.scrollLeft
      sc.scrollLeft = clamp(before + step, 0, maxScroll)
      if (sc.scrollLeft !== before) {
        // 스크롤로 캔버스가 이동 → 같은 화면 위치가 더 끝쪽 시간(x)으로 매핑됨 → 선이 이어짐
        self._applyPointer(self._point({ clientX: self._lastClientX, clientY: self._lastClientY }))
      }
      const atEnd =
        (self._edgeDir > 0 && sc.scrollLeft >= maxScroll) ||
        (self._edgeDir < 0 && sc.scrollLeft <= 0)
      if (atEnd) {
        self._edgeDir = 0
        return
      }
      self._autoScrollRAF = root.requestAnimationFrame(tick)
    }
    this._autoScrollRAF = root.requestAnimationFrame(tick)
  }

  DrawingCanvas.prototype._stopAutoScroll = function () {
    if (this._autoScrollRAF != null && typeof root.cancelAnimationFrame === "function") {
      root.cancelAnimationFrame(this._autoScrollRAF)
    }
    this._autoScrollRAF = null
    this._edgeDir = 0
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
    if (st.mode === "rhythm") {
      // 리듬형은 타임라인 샘플이 필요 → 점 2개 이상일 때만
      this.hits = path.length >= 2 ? Core.autocompleteRhythm(path, { durationSec: st.duration, bpm: 100 }) : []
      this.notes = []
    } else {
      // 선율형은 점 하나(점 찍기)도 짧은 음으로 표현
      this.notes =
        this.strokes.length >= 1 ? Core.autocompleteMelodyStrokes(this.strokes, { durationSec: st.duration, style: st.style }) : []
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
    const labelGutter = this._pitchLabelGutter()
    ctx.clearRect(0, 0, W, H)
    // 화첩 종이 배경
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, labelGutter, H)

    // 음높이 칸: 그릴 수 있는 음마다 한 칸. 각 음이 줄 위가 아니라 칸 안(중앙)에 들어가도록 경계선을 그린다.
    const st = this.getState()
    const rows = drawableScaleFor(st.style, st.melodyAsset)
    const rowCount = rows.length
    const gridLineWidth = Math.max(1, Math.round(px))
    const duration = Math.max(1, Number(st.duration) || 30)
    ctx.lineWidth = gridLineWidth
    const drawVerticalLine = function (t) {
      const x = labelGutter + ((W - labelGutter) * t) / duration
      const crispX = crispLinePosition(x, gridLineWidth, 0, W)
      ctx.strokeStyle = "rgba(32,41,42,0.09)"
      ctx.beginPath()
      ctx.moveTo(crispX, 0)
      ctx.lineTo(crispX, H)
      ctx.stroke()
    }
    let lastGridTime = 0
    for (let t = 0; t <= duration + 0.0001; t += TIMELINE_GRID_SECONDS) {
      lastGridTime = Math.min(t, duration)
      drawVerticalLine(lastGridTime)
    }
    if (Math.abs(lastGridTime - duration) > 0.0001) drawVerticalLine(duration)

    ctx.strokeStyle = "rgba(32,41,42,0.09)"
    for (let i = 0; i <= rowCount; i++) {
      const y = crispLinePosition(pitchRowBoundaryY(i, rowCount, H), gridLineWidth, 0, H)
      ctx.beginPath()
      ctx.moveTo(labelGutter, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
  }

  DrawingCanvas.prototype._pitchLabelGutter = function () {
    const px = this.pixelRatio || 1
    return PITCH_LABEL_GUTTER_CSS_PX * px
  }

  DrawingCanvas.prototype.pitchLabelGutterCssPx = function () {
    return this._pitchLabelGutter() / (this.pixelRatio || 1)
  }

  DrawingCanvas.prototype._timelineLeft = function () {
    return this._pitchLabelGutter()
  }

  DrawingCanvas.prototype._timelineWidth = function () {
    return Math.max(1, this.canvas.width - this._timelineLeft())
  }

  DrawingCanvas.prototype._timeToX = function (ratio) {
    return this._timelineLeft() + clamp(ratio || 0, 0, 1) * this._timelineWidth()
  }

  DrawingCanvas.prototype.renderPitchLabels = function () {
    const ctx = this.ctx
    if (typeof ctx.fillText !== "function") return
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    const st = this.getState()
    const rows = drawableScaleFor(st.style, st.melodyAsset)
    const asset = st.melodyAsset
    const labelGutter = this._pitchLabelGutter()
    const fontSize = Math.max(10, Math.round(12 * px))
    if (typeof ctx.save === "function") ctx.save()
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, labelGutter, H)
    const gridLineWidth = Math.max(1, Math.round(px))
    ctx.strokeStyle = "rgba(32,41,42,0.09)"
    ctx.lineWidth = gridLineWidth
    for (let i = 0; i <= rows.length; i++) {
      const y = crispLinePosition(pitchRowBoundaryY(i, rows.length, H), gridLineWidth, 0, H)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(labelGutter, y)
      ctx.stroke()
    }
    ctx.font = "700 " + fontSize + "px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "rgba(31,38,38,0.74)"
    for (let i = 0; i < rows.length; i++) {
      const y = pitchRowCenterY(i, rows.length, H)
      ctx.fillText(soundingLabel(rows[i], asset), labelGutter / 2, clamp(y, fontSize, H - fontSize))
    }
    if (typeof ctx.restore === "function") ctx.restore()
  }

  // 각 획을 따로 그린다 — 획끼리 자동으로 이어지지 않음(그린 대로)
  DrawingCanvas.prototype.renderStroke = function () {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 19.2 * px
    ctx.globalAlpha = 0.6
    // 획마다 그 획의 악기 색으로 — 오케스트라에서 어떤 줄이 어떤 악기인지 한눈에
    for (let si = 0; si < this.strokes.length; si++) {
      const stroke = this.strokes[si]
      const color = this._colorFor(this.strokeInstruments[si])
      ctx.strokeStyle = color
      if (stroke.length < 2) {
        // 점 하나짜리 획은 작은 점으로 표시
        if (stroke.length === 1) {
          ctx.beginPath()
          ctx.arc(this._timeToX(stroke[0].x), stroke[0].y * H, 10.24 * px, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
        }
        continue
      }
      ctx.beginPath()
      ctx.moveTo(this._timeToX(stroke[0].x), stroke[0].y * H)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(this._timeToX(stroke[i].x), stroke[i].y * H)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // 음(midi) → 세로 위치. 음높이 칸과 같은 음 목록(scale)으로 줄을 맞춘다.
  DrawingCanvas.prototype._pitchToY = function (midi, scale) {
    let idx = scale.indexOf(midi)
    if (idx < 0) {
      // 목록에 없으면 가장 가까운 음의 칸으로
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < scale.length; i++) {
        const d = Math.abs(scale[i] - midi)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      idx = best
    }
    return pitchRowCenterY(idx, scale.length, this.canvas.height)
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
        const x = this._timeToX(h.time / st.duration)
        const barH = (20 + (h.velocity || 0.7) * 60) * px
        ctx.fillRect(x - 3 * px, H - barH, 6 * px, barH)
      }
      return
    }
    const rows = drawableScaleFor(st.style, st.melodyAsset)
    const rowH = H / Math.max(1, rows.length)
    const timelineWidth = this._timelineWidth()
    for (const n of this.notes) {
      const x = this._timeToX(n.time / st.duration)
      const w = Math.max(6 * px, (n.duration / st.duration) * timelineWidth - 3 * px)
      const y = this._pitchToY(n.midi, rows)
      const instrumentId = this._instrumentForNote(n)
      const color = this._colorFor(instrumentId)
      const x1 = x + 2 * px
      const x2 = x + w
      ctx.strokeStyle = color
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.globalAlpha = 0.2
      ctx.lineWidth = Math.max(4 * px, rowH * 0.128)
      ctx.beginPath()
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()
      ctx.globalAlpha = 0.95
      ctx.lineWidth = Math.max(1.6 * px, rowH * 0.06)
      ctx.beginPath()
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  DrawingCanvas.prototype.renderStrokeOnly = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
    this.renderPitchLabels()
  }

  DrawingCanvas.prototype.render = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
    this.renderNotes()
    this.renderPitchLabels()
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

  DrawingCanvas.pitchLabelsForStyle = pitchLabelsForStyle
  DrawingCanvas.pitchRowsForStyle = pitchRowsForStyle

  root.DrawingCanvas = DrawingCanvas
})(typeof self !== "undefined" ? self : this)
