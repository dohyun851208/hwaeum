/*
 * drawing.js — 드로잉 캔버스 (window.DrawingCanvas)
 *
 * - 좌표는 0..1 정규화로 저장 → 해상도/그리는 속도와 무관, 레시피로 직렬화 가능.
 * - 가로 = 시간, 세로 = 음높이. 음높이 칸을 나누는 가로선 표시.
 * - 원본 선은 끊김 없는 마법의 선율(빛무리·윤기·금빛 반짝임, 봉우리 음표)로 렌더한다.
 *   음 보정 막대는 그리지 않는다(보정은 소리에만 적용).
 */
;(function (root) {
  "use strict"

  // === § 1  모듈 전역 · 상수 ===

  const Core = root.MusicCore
  const ERASER_PITCH_RADIUS = 0.035
  const ERASER_TIME_RADIUS_SECONDS = 0.5

  if (!root.SDDrawingRenderer) throw new Error("drawing-renderer.js must load before drawing.js")
  const renderer = root.SDDrawingRenderer({ core: Core, getPixelRatio: () => root.devicePixelRatio })
  const { drawableScaleFor, visibleRowsForStyle } = renderer

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

  // === § 3  DrawingCanvas 생성자 & 기본 API ===

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
    this.melodyAssetForInstrument = opts.melodyAssetForInstrument || null
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
    this.eraseRadius = ERASER_PITCH_RADIUS // 세로 정규화 반경
    const eraseTimeRadius = opts.eraseTimeRadiusSeconds != null ? Number(opts.eraseTimeRadiusSeconds) : NaN
    this.eraseTimeRadiusSeconds = Number.isFinite(eraseTimeRadius)
      ? Math.max(0.05, eraseTimeRadius)
      : ERASER_TIME_RADIUS_SECONDS
    this.flowMode = false
    this.flowActive = false
    this.flowY = 0.5
    this.pixelRatio = 1
    this.lastPreviewAt = 0
    this.lastPreviewY = null
    this.drawingGestureHasUndo = false
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
    this._initBrushCursor()
    this.render()
  }

  DrawingCanvas.prototype._syncCursor = function () {
    if (this.eraseMode) this.canvas.style.cursor = "cell"
    else if (this.canvas.classList && this.canvas.classList.contains("stamp-mode")) this.canvas.style.cursor = "copy"
    else if (this.brushCursor && !this.brushCursor.hidden) this.canvas.style.cursor = "none"
    else this.canvas.style.cursor = "crosshair"
  }

  DrawingCanvas.prototype.setEraseMode = function (on) {
    this.eraseMode = !!on
    if (this.eraseMode) this._hideBrushCursor()
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
    this._setBrushInstrument()
  }

  // 악기 그림(instrument-brush.js)을 SVG 노드로 만든다. 잘못된 마크업이면 그림 없이 둔다.
  function brushIconNode(doc, id) {
    const brush = root.InstrumentBrush
    if (!brush || typeof root.DOMParser !== "function") return null
    const parsed = new root.DOMParser().parseFromString(brush.icon(id), "image/svg+xml")
    if (parsed.getElementsByTagName("parsererror").length) return null
    return doc.importNode(parsed.documentElement, true)
  }

  // 선택 악기의 그림을 실제 포인터 옆에 연주 자세로 띄운다. 장식은 저장/내보내기 캔버스 밖에 둔다.
  DrawingCanvas.prototype._setBrushInstrument = function () {
    if (!this.brushCursor) return
    const cursor = this.brushCursor
    cursor.dataset.instrument = this.activeInstrument || ""
    cursor.style.setProperty("--brush-color", this._colorFor(this.activeInstrument))
    const pose = root.InstrumentBrush ? root.InstrumentBrush.poseStyle(this.activeInstrument) : {}
    Object.keys(pose).forEach(function (name) { cursor.style.setProperty(name, pose[name]) })
    const holder = cursor.querySelector(".instrument-brush-icon")
    const icon = brushIconNode(this.canvas.ownerDocument, this.activeInstrument)
    if (icon) holder.replaceChildren(icon)
    else holder.replaceChildren()
  }

  // 붓끝이 있는 음 칸 — 뜯는 악기처럼 "새 음"에 맞춰 붓끝 효과를 피울 때 쓴다.
  DrawingCanvas.prototype._brushNoteAt = function (e) {
    const st = this.getState ? this.getState() : null
    if (!st || st.mode === "rhythm" || !Core.quantizePitch) return null
    return Core.quantizePitch(this._point(e).y, st.style, this._assetForInstrument(this.activeInstrument, st))
  }

  DrawingCanvas.prototype._hideBrushCursor = function () {
    if (!this.brushCursor) return
    this.brushCursor.hidden = true
    this.brushCursor.classList.remove("is-painting")
    this._syncCursor()
  }

  DrawingCanvas.prototype._initBrushCursor = function () {
    const doc = this.canvas.ownerDocument
    if (!doc || !doc.body) return // 순수 렌더 테스트·썸네일에는 DOM 장식이 필요 없다.
    const self = this
    const cursor = doc.createElement("div")
    cursor.className = "instrument-brush-cursor"
    cursor.hidden = true
    cursor.setAttribute("aria-hidden", "true")
    cursor.innerHTML = '<span class="instrument-brush-tip"></span><span class="instrument-brush-icon"></span>'
    const sparks = doc.createElement("div")
    sparks.className = "instrument-brush-sparks"
    sparks.setAttribute("aria-hidden", "true")
    doc.body.appendChild(sparks)
    doc.body.appendChild(cursor)
    this.brushCursor = cursor
    this._setBrushInstrument()
    const reduced = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null
    if (reduced && reduced.addEventListener) {
      reduced.addEventListener("change", function () { if (reduced.matches) sparks.replaceChildren() })
    }
    let lastSpark = 0
    let lastX = null
    let lastY = null
    let lastNote = null
    function move(e) {
      if (self.eraseMode || self.canvas.classList.contains("stamp-mode") || e.pointerType === "touch") {
        self._hideBrushCursor()
        return
      }
      const rect = self.canvas.getBoundingClientRect()
      const sc = self.scrollContainer && self.scrollContainer.getBoundingClientRect()
      if (e.clientX < Math.max(rect.left, sc ? sc.left : 0) || e.clientX > Math.min(rect.right, sc ? sc.right : Infinity) ||
          e.clientY < rect.top || e.clientY > rect.bottom) {
        self._hideBrushCursor()
        return
      }
      cursor.hidden = false
      cursor.style.transform = "translate3d(" + e.clientX + "px," + e.clientY + "px,0)"
      const painting = self.isDrawing && !!self.currentStroke
      cursor.classList.toggle("is-painting", painting)
      self._syncCursor()
      if (!painting) {
        lastNote = null
        return
      }
      const brush = root.InstrumentBrush
      if (!brush || (reduced && reduced.matches)) return
      // 악기마다 소리 내는 방식(trait.family)과 소리 성격(trait.spark)에 맞는 붓끝 효과를 피운다.
      const trait = brush.trait(self.activeInstrument)
      const note = self._brushNoteAt(e)
      const now = root.performance.now()
      const motion = {
        sinceLast: now - lastSpark,
        moved: lastX == null ? Infinity : Math.hypot(e.clientX - lastX, e.clientY - lastY),
        newNote: note !== lastNote,
      }
      lastNote = note
      if (!brush.shouldSparkle(trait, motion)) return
      lastSpark = now
      lastX = e.clientX
      lastY = e.clientY
      // 효과 개수를 제한해 오래 그려도 DOM이 계속 늘어나지 않게 한다.
      while (sparks.children.length >= 18) sparks.firstElementChild.remove()
      const spark = brush.spark(trait, sparks.children.length)
      const dot = doc.createElement("i")
      dot.className = "instrument-brush-spark is-" + spark.kind
      dot.style.left = e.clientX + "px"
      dot.style.top = e.clientY + "px"
      dot.style.setProperty("--spark-color", spark.accent ? trait.accent : self._colorFor(self.activeInstrument))
      dot.style.setProperty("--spark-size", spark.size + "px")
      dot.style.setProperty("--spark-x", spark.x + "px")
      dot.style.setProperty("--spark-y", spark.y + "px")
      dot.style.setProperty("--spark-rot", spark.rot + "deg")
      dot.style.setProperty("--spark-life", spark.life + "ms")
      dot.addEventListener("animationend", function () { dot.remove() }, { once: true })
      sparks.appendChild(dot)
    }
    this.canvas.addEventListener("pointerenter", move)
    this.canvas.addEventListener("pointermove", move)
    this.canvas.addEventListener("pointerdown", move)
    this.canvas.addEventListener("pointerup", function () {
      cursor.classList.remove("is-painting")
      lastNote = null
    })
    this.canvas.addEventListener("pointercancel", function () { self._hideBrushCursor(); sparks.replaceChildren() })
    this.canvas.addEventListener("pointerleave", function () { self._hideBrushCursor() })
    root.addEventListener("blur", function () { self._hideBrushCursor(); sparks.replaceChildren() })
    doc.addEventListener("visibilitychange", function () { if (doc.hidden) { self._hideBrushCursor(); sparks.replaceChildren() } })
    doc.addEventListener("scroll", function () { if (!self.isDrawing) self._hideBrushCursor() }, true)
    // 도장 선택·단계 이동 중에 캔버스 위로 커서가 남지 않게 한다.
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(function () { self._hideBrushCursor() })
      observer.observe(this.canvas, { attributes: true, attributeFilter: ["class"] })
      observer.observe(doc.body, { attributes: true, attributeFilter: ["data-step"] })
    }
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

  DrawingCanvas.prototype._assetForInstrument = function (id, state) {
    if (this.melodyAssetForInstrument) {
      const asset = this.melodyAssetForInstrument(id)
      if (asset) return asset
    }
    return state && state.melodyAsset ? state.melodyAsset : null
  }

  // 현재 축(선택 악기 기준) 정보 — 렌더 한 번에 한 번만 계산해서 재사용한다.
  // reduced=true(국악기 등 일부 칸만 보임)일 때:
  //  - toDisplayY: 저장 y(전체 축) → 화면 y(보이는 칸만)
  //  - strokeVisible: 이 악기의 획을 지금 축에서 보여줄지 (서양 획은 국악 축에서 숨김·유지)
  DrawingCanvas.prototype._viewContext = function (st) {
    const self = this
    const style = st && st.style
    const viewAsset = st ? st.melodyAsset : null
    const full = style ? drawableScaleFor(style, viewAsset) : []
    const viewRows = style ? visibleRowsForStyle(style, viewAsset) : []
    const reduced = full.length > 0 && viewRows.length > 0 && viewRows.length < full.length
    const visibilityCache = {}
    return {
      reduced: reduced,
      toDisplayY: function (y) {
        if (!reduced || !Core.displayYFromStored) return y
        return Core.displayYFromStored(y, style, viewAsset)
      },
      strokeVisible: function (instrumentId) {
        if (!reduced) return true
        const key = instrumentId == null ? "" : String(instrumentId)
        if (visibilityCache[key] != null) return visibilityCache[key]
        const strokeAsset = self._assetForInstrument(instrumentId, st)
        let visible = true
        if (strokeAsset !== viewAsset) {
          const strokeRows = visibleRowsForStyle(style, strokeAsset)
          visible = strokeRows.every(function (midi) {
            return viewRows.indexOf(midi) !== -1
          })
        }
        visibilityCache[key] = visible
        return visible
      },
    }
  }

  // 화면 y(보이는 칸 기준) → 저장 y(전체 축 기준). 포인터 입력에서 한 번만 변환한다.
  DrawingCanvas.prototype._displayToStoredY = function (y, st) {
    const state = st || (this.getState ? this.getState() : null)
    if (!state || state.mode === "rhythm" || !Core.storedYFromDisplay) return y
    return Core.storedYFromDisplay(y, state.style, state.melodyAsset)
  }

  DrawingCanvas.prototype._pointIsDrawable = function (p, state, asset) {
    const st = state || (this.getState ? this.getState() : null)
    if (!st || st.mode === "rhythm" || !Core.quantizePitch) return true
    const melodyAsset = asset || this._assetForInstrument(this.activeInstrument, st)
    return Core.quantizePitch(p.y, st.style, melodyAsset) != null
  }

  DrawingCanvas.prototype._startStrokeSegment = function (p) {
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
    const st = this.getState ? this.getState() : null
    const asset = this._assetForInstrument(active, st)
    if (!this._pointIsDrawable(p, st, asset)) return false
    if (!this.drawingGestureHasUndo) {
      this._pushUndo()
      this.drawingGestureHasUndo = true
    }
    this.currentStroke = [p]
    this.strokes.push(this.currentStroke)
    this.strokeInstruments.push(active)
    this._previewStart(p)
    this.render()
    return true
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
    const st = this.getState ? this.getState() : null
    const asset = this._assetForInstrument(active, st)
    if (!this._pointIsDrawable(p, st, asset)) {
      this.isDrawing = false
      return false
    }
    this._pushUndo()
    this.drawingGestureHasUndo = true
    this.isDrawing = true
    // 진행 위치를 먼저 읽는다 — 읽는 동안 배경 재생이 시작되며 flowRecord가 불리면 점 하나짜리 획이
    // 따로 생겨(0.16초 음) 겹쳤다. 획을 만든 뒤에야 '음악에 맞춰 그리는 중'으로 바꾼다.
    const flowProgress = clamp(this.getFlowProgress(), 0, 1)
    this.flowActive = true
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
    if (!this.flowActive) return false
    const x = clamp(Number(progress) || 0, 0, 1)
    const y = clamp(this.flowY, 0, 1)
    const point = { x: x, y: y }
    const active = this.activeInstrument
    const st = this.getState ? this.getState() : null
    const asset = this._assetForInstrument(active, st)
    if (!this._pointIsDrawable(point, st, asset)) {
      if (this.currentStroke) {
        this.currentStroke = null
        this.onPreviewEnd()
        this.compute()
        this.render()
        this.onChange()
      }
      return false
    }
    if (!this.currentStroke) {
      this.currentStroke = [point]
      this.strokes.push(this.currentStroke)
      this.strokeInstruments.push(active)
      this._previewStart(point)
      this.compute()
      this.render()
      this.onChange()
      return true
    }
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
    this.drawingGestureHasUndo = false
    this.currentStroke = null
    this.onPreviewEnd()
    if (notifyFlowEnd) this.onFlowEnd()
    this.compute()
    this.render()
    this.onChange()
    return true
  }

  function cleanStroke(stroke) {
    return (stroke || []).map((p) => {
      const x = Number(p && p.x)
      return { x: Math.max(0, isFinite(x) ? x : 0), y: clamp(Number(p && p.y) || 0, 0, 1) }
    })
  }

  // 배경 구간을 줄이는 동안 새 끝점 뒤의 획은 지우지 않고 화면 밖에 보관한다.
  // 재생·레시피에는 현재 구간(0..1)에 걸친 부분만 넘기며, 경계를 가로지르는 선은
  // 끝점에서 잘라 시각과 소리가 같은 시각에 멈추게 한다.
  function visibleStroke(stroke) {
    const source = stroke || []
    const out = []
    for (let i = 0; i < source.length; i++) {
      const point = source[i]
      if (point.x <= 1) {
        out.push({ x: Math.max(0, point.x), y: point.y })
        continue
      }
      const previous = i > 0 ? source[i - 1] : null
      if (previous && previous.x < 1 && point.x > previous.x) {
        const progress = (1 - previous.x) / (point.x - previous.x)
        out.push({ x: 1, y: previous.y + (point.y - previous.y) * progress })
      }
      break
    }
    return out
  }

  function copyStoredStrokes(strokes) {
    return (strokes || []).map((stroke) => cleanStroke(stroke))
  }

  function retimeStoredStrokes(strokes, previousDuration, nextDuration) {
    const previous = Number(previousDuration)
    const next = Number(nextDuration)
    if (!(previous > 0) || !(next > 0) || Math.abs(previous - next) < 1e-9) return
    const factor = previous / next
    ;(strokes || []).forEach((stroke) => {
      ;(stroke || []).forEach((point) => {
        point.x = Math.max(0, (Number(point.x) || 0) * factor)
      })
    })
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

  // 지우개 타원 밖에 남은 연속 점들을 획 조각으로 나눈다.
  // 한 점짜리 조각도 탭 음표로 렌더·재생되므로 버리지 않는다.
  function strokeFragmentsOutsideEraser(stroke, center, radiusX, radiusY) {
    const fragments = []
    let current = []
    const flush = function () {
      if (current.length) fragments.push(current)
      current = []
    }
    ;(stroke || []).forEach(function (point) {
      const dx = point.x - center.x
      const dy = point.y - center.y
      const inside = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1
      if (inside) flush()
      else current.push(point)
    })
    flush()
    return fragments
  }

  // === § 4  Undo 시스템 ===

  DrawingCanvas.prototype._snapshot = function () {
    return {
      // 현재 구간 밖에 잠시 숨은 획도 undo에서 되살릴 수 있게 원본 좌표를 보관한다.
      strokes: copyStoredStrokes(this.strokes),
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
    // 그리는 도중에 되돌리면 손을 떼도 finish()가 그냥 돌아가 펜 소리가 계속 울렸다 — 여기서 끝낸다.
    if (this.isDrawing) this.onPreviewEnd()
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

  // 특정 악기로 그린 획을 모두 지운다. 지우개처럼 undo 가능.
  DrawingCanvas.prototype.clearInstrument = function (id) {
    const next = []
    const nextInst = []
    for (let i = 0; i < this.strokes.length; i++) {
      if (this.strokeInstruments[i] !== id) {
        next.push(this.strokes[i])
        nextInst.push(this.strokeInstruments[i])
      }
    }
    if (next.length === this.strokes.length) return false
    this._pushUndo()
    this.pendingUndoSnapshot = null
    this.currentStroke = null
    this.isDrawing = false
    this.strokes = next
    this.strokeInstruments = nextInst
    this.compute()
    this.render()
    this.onChange()
    return true
  }

  DrawingCanvas.prototype.getStrokes = function () {
    return this.strokes.map(visibleStroke)
  }

  // 선율/썸네일/레시피용: 모든 획의 점을 시간(x) 순으로 합친 평탄 경로
  DrawingCanvas.prototype.getPath = function () {
    const all = []
    for (const s of this.getStrokes()) for (const p of s) all.push({ x: p.x, y: p.y })
    all.sort((a, b) => a.x - b.x)
    return all
  }

  // 정규화 x 좌표가 가리키던 '초'를 유지한 채 새 구간 길이에 맞춰 좌표만 바꾼다.
  // 예: 30초 도화지의 x=1/3(10초) → 40초 도화지의 x=1/4(여전히 10초).
  DrawingCanvas.prototype.retimeDuration = function (previousDuration, nextDuration) {
    const previous = Number(previousDuration)
    const next = Number(nextDuration)
    if (!(previous > 0) || !(next > 0) || Math.abs(previous - next) < 1e-9) return false
    retimeStoredStrokes(this.strokes, previous, next)
    this.undoStack.forEach((snapshot) => retimeStoredStrokes(snapshot && snapshot.strokes, previous, next))
    if (this.pendingUndoSnapshot) retimeStoredStrokes(this.pendingUndoSnapshot.strokes, previous, next)
    return true
  }

  DrawingCanvas.prototype._point = function (e) {
    const r = this.canvas.getBoundingClientRect()
    const labelGutter = typeof this.pitchLabelGutterCssPx === "function" ? this.pitchLabelGutterCssPx() : 0
    const timelineWidth = Math.max(1, r.width - labelGutter)
    const displayY = clamp((e.clientY - r.top) / r.height, 0, 1)
    return {
      x: clamp((e.clientX - r.left - labelGutter) / timelineWidth, 0, 1),
      // 저장 좌표는 항상 전체 축 기준 — 국악기 축(보이는 칸만)에서 그려도 음높이가 유지된다.
      y: clamp(this._displayToStoredY(displayY), 0, 1),
    }
  }

  // 지우개: 커서 반경 안의 점을 지우고, 끊긴 구간은 별도 획으로 분리
  DrawingCanvas.prototype._eraseAt = function (p) {
    const st = this.getState ? this.getState() : null
    const duration = Math.max(1, Number(st && st.duration) || 30)
    const rx = Math.max(0.001, this.eraseTimeRadiusSeconds / duration)
    const ry = Math.max(0.001, this.eraseRadius)
    const view = this._viewContext(st)
    const next = []
    const nextInst = []
    for (let si = 0; si < this.strokes.length; si++) {
      const stroke = this.strokes[si]
      const inst = this.strokeInstruments[si]
      // 지금 축에서 안 보이는 획(예: 국악 축의 서양 획)은 지워지지 않게 보호
      if (!view.strokeVisible(inst)) {
        next.push(stroke)
        nextInst.push(inst)
        continue
      }
      const fragments = strokeFragmentsOutsideEraser(stroke, p, rx, ry)
      fragments.forEach(function (fragment) {
        next.push(fragment)
        nextInst.push(inst)
      })
    }
    const changed = !sameStrokeState(this.strokes, this.strokeInstruments, next, nextInst)
    this.strokes = next
    this.strokeInstruments = nextInst
    return changed
  }

  // === § 5  포인터 이벤트 바인딩 & 자동 스크롤 ===

  DrawingCanvas.prototype._bind = function () {
    const self = this
    this.canvas.addEventListener("pointerdown", function (e) {
      // 오른쪽 단추(메뉴)로는 그리지 않는다.
      if (e.pointerType === "mouse" && e.button !== 0) return
      // 음 이름 칸 위에서 누르면 0초 자리에 숨은 점 음이 생겼다 — 칸 밖에서만 그린다.
      if (self._isOverPitchLabels(e)) return
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
      self.drawingGestureHasUndo = false
      if (!self._startStrokeSegment(p)) self.currentStroke = null
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
      self.drawingGestureHasUndo = false
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

  DrawingCanvas.prototype._isOverPitchLabels = function (e) {
    const sc = this.scrollContainer
    const labels = sc && typeof sc.querySelector === "function" ? sc.querySelector(".pitch-labels") : null
    if (!labels || typeof labels.getBoundingClientRect !== "function") return false
    const r = labels.getBoundingClientRect()
    return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }

  // 포인터 위치(p: 0..1)를 현재 모드대로 반영 — pointermove와 자동 스크롤 루프가 공유
  DrawingCanvas.prototype._applyPointer = function (p) {
    if (this.eraseMode) {
      if (this._eraseAt(p)) this._commitPendingUndo()
      this.render()
      return
    }
    if (!this._pointIsDrawable(p)) {
      if (this.currentStroke) {
        this.currentStroke = null
        this.onPreviewEnd()
        this.compute()
        this.render()
        this.onChange()
      }
      return
    }
    const stroke = this.currentStroke
    if (!stroke) {
      this._startStrokeSegment(p)
      return
    }
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
    } else if (this.eraseMode && clientX < rect.left + zone && sc.scrollLeft > 0) {
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

  // === § 6  라이브 미리듣기 ===

  DrawingCanvas.prototype._previewStart = function (point) {
    const now = root.performance && root.performance.now ? root.performance.now() : Date.now()
    this.lastPreviewAt = now
    this.lastPreviewY = point.y
    this.onPreviewStart({ x: point.x, y: point.y })
  }

  DrawingCanvas.prototype._preview = function (point, force) {
    const now = root.performance && root.performance.now ? root.performance.now() : Date.now()
    const state = this.getState ? this.getState() : null
    const asset = this._assetForInstrument(this.activeInstrument, state)
    // 경계를 다시 넘은 입력을 110ms 제한으로 버리면 엔진의 70ms 체류 타이머를
    // 취소할 수 없다. 칸이 바뀌는 입력은 작게 움직여도 즉시 전달한다.
    const movedPitch = this.lastPreviewY == null ||
      Core.quantizePitch(point.y, state && state.style, asset) !== Core.quantizePitch(this.lastPreviewY, state && state.style, asset)
    if (!force && !movedPitch && now - this.lastPreviewAt < 110) return
    this.lastPreviewAt = now
    this.lastPreviewY = point.y
    this.onPreview({ x: point.x, y: point.y })
  }

  // === § 7  계산 & 렌더링 ===

  DrawingCanvas.prototype.compute = function () {
    const st = this.getState()
    const path = this.getPath()
    if (st.mode === "rhythm") {
      // 리듬형은 타임라인 샘플이 필요 → 점 2개 이상일 때만
      this.hits = path.length >= 2 ? Core.autocompleteRhythm(path, { durationSec: st.duration, bpm: 100 }) : []
      this.notes = []
    } else {
      // 선율형은 점 하나(점 찍기)도 짧은 음으로 표현
      const melodyAsset = st.melodyAsset || this._assetForInstrument(this.activeInstrument, st)
      const melodyAssets = this.strokeInstruments.map((id) => this._assetForInstrument(id, st) || melodyAsset)
      const visibleStrokes = this.getStrokes()
      this.notes =
        visibleStrokes.length >= 1
          ? Core.autocompleteMelodyStrokes(visibleStrokes, {
              durationSec: st.duration,
              style: st.style,
              melodyAsset: melodyAsset,
              melodyAssets: melodyAssets,
            })
          : []
      this.hits = []
    }
  }

  // Rendering methods keep the public DrawingCanvas API used by exports and tests.
  Object.assign(DrawingCanvas.prototype, renderer.methods)
  ;["drawStroke", "pitchLabelsForStyle", "pitchRowsForStyle", "noteColorForMidi", "noteColorRgba"].forEach(function (name) {
    DrawingCanvas[name] = renderer[name]
  })

  root.DrawingCanvas = DrawingCanvas
})(typeof self !== "undefined" ? self : this)
