/*
 * drawing-renderer.js — 피치 축과 캔버스 렌더링. 입력/획/실행 취소 상태는 DrawingCanvas가 소유한다.
 * 같은 렌더 메서드를 화면과 이미지·영상 내보내기에 사용한다.
 */
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory
  else root.SDDrawingRenderer = factory
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict"

  const Core = deps.core
  const TIMELINE_GRID_SECONDS = 2.5
  const PITCH_LABEL_GUTTER_CSS_PX = 56
  const methods = {}

  // === § 2  피치 행 지오메트리 & 레이블 헬퍼 (순수) ===

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  const NOTE_NAMES = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"]
  const NOTE_COLORS = [
    "#c96f66",
    "#c77a59",
    "#c9854b",
    "#c29148",
    "#b89d45",
    "#789b69",
    "#5d9680",
    "#3f918d",
    "#4b869f",
    "#587bb0",
    "#716fa8",
    "#897da7",
  ]
  // 계이름만 반환(옥타브 숫자 없음). 악기마다 음역대가 달라 적힌 옥타브 숫자가
  // 실제 들리는 소리와 어긋날 수 있어, 축 라벨에는 계이름만 표시한다.
  function noteLetter(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12]
  }

  function soundingMidi(midi, asset) {
    const tr = asset && Number.isFinite(asset.playbackTranspose) ? asset.playbackTranspose : 0
    return midi + tr
  }

  function noteColorForMidi(midi, asset) {
    if (midi == null) return "#6f7472"
    return NOTE_COLORS[((soundingMidi(midi, asset) % 12) + 12) % 12] || NOTE_COLORS[0]
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || "").replace("#", "")
    if (value.length !== 6) return "rgba(31,38,38," + alpha + ")"
    const n = parseInt(value, 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")"
  }

  function noteColorRgba(midi, asset, alpha) {
    return hexToRgba(noteColorForMidi(midi, asset), alpha)
  }

  // 저장 좌표 기준의 전체 음높이 축은 MusicCore의 축 계약을 그대로 쓴다.
  function drawableScaleFor(style, asset) {
    return Core.drawableScale(style, asset)
  }

  // 축 라벨에 쓸 계이름. 악기 transpose 를 반영하되 옥타브 숫자는 떼고 계이름만 보여준다.
  // (악기마다 음역대가 달라 옥타브 숫자가 실제 소리와 어긋날 수 있어서. 높은 음=위, 낮은 음=아래는 그대로.)
  function soundingLabel(midi, asset) {
    return noteLetter(soundingMidi(midi, asset))
  }

  // 악기가 낼 수 있는 칸만 축에 보여준다 — 국악기는 10칸이 화면 전체를 채우고,
  // 서양 악기는 15칸 전체가 보인다. (저장 좌표는 늘 전체 축 기준 → 악기를 오가도 음 유지)
  function visibleRowsForStyle(style, asset) {
    return Core.playableScale(style, asset)
  }

  function pitchRowsForStyle(style, asset) {
    const rows = visibleRowsForStyle(style, asset)
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
        color: noteColorForMidi(midi, asset),
        softColor: noteColorRgba(midi, asset, 0.12),
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

  methods._paletteCount = function () {
    return Math.max(1, Math.ceil(this.getState().duration / 10))
  }

  methods.resizeToDisplay = function () {
    const r = this.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const deviceRatio = deps.getPixelRatio() || 1
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

  methods.renderGrid = function () {
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

    // 음높이 칸: 악기를 바꿔도 같은 위치를 쓰고, 낼 수 없는 음은 비활성 행으로 표시한다.
    const st = this.getState()
    const rowInfo = pitchRowsForStyle(st.style, st.melodyAsset)
    const rowCount = rowInfo.length
    const gridLineWidth = Math.max(1, Math.round(px))
    const duration = Math.max(1, Number(st.duration) || 30)
    for (let i = 0; i < rowCount; i++) {
      const bounds = pitchRowBoundsY(i, rowCount, H)
      ctx.fillStyle = rowInfo[i].selected ? noteColorRgba(rowInfo[i].midi, st.melodyAsset, 0.035) : "rgba(31,38,38,0.035)"
      ctx.fillRect(labelGutter, bounds.top, W - labelGutter, Math.max(1, bounds.bottom - bounds.top))
    }
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

  methods._pitchLabelGutter = function () {
    const px = this.pixelRatio || 1
    return PITCH_LABEL_GUTTER_CSS_PX * px
  }

  methods.pitchLabelGutterCssPx = function () {
    return this._pitchLabelGutter() / (this.pixelRatio || 1)
  }

  methods._timelineLeft = function () {
    return this._pitchLabelGutter()
  }

  methods._timelineWidth = function () {
    return Math.max(1, this.canvas.width - this._timelineLeft())
  }

  methods._timeToX = function (ratio) {
    // 구간 끝 뒤에 잠시 보관한 획은 캔버스 밖에 그려 브라우저 클리핑에 맡긴다.
    return this._timelineLeft() + Math.max(0, Number(ratio) || 0) * this._timelineWidth()
  }

  methods.renderPitchLabels = function () {
    const ctx = this.ctx
    if (typeof ctx.fillText !== "function") return
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    const st = this.getState()
    const rowInfo = pitchRowsForStyle(st.style, st.melodyAsset)
    const rows = rowInfo.map((row) => row.midi)
    const asset = st.melodyAsset
    const labelGutter = this._pitchLabelGutter()
    const fontSize = Math.max(10, Math.round(12 * px))
    if (typeof ctx.save === "function") ctx.save()
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, labelGutter, H)
    for (let i = 0; i < rowInfo.length; i++) {
      const bounds = pitchRowBoundsY(i, rowInfo.length, H)
      ctx.fillStyle = rowInfo[i].selected ? noteColorRgba(rowInfo[i].midi, asset, 0.08) : "rgba(31,38,38,0.035)"
      ctx.fillRect(0, bounds.top, labelGutter, Math.max(1, bounds.bottom - bounds.top))
    }
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
    for (let i = 0; i < rows.length; i++) {
      const y = pitchRowCenterY(i, rows.length, H)
      ctx.fillStyle = rowInfo[i].selected ? noteColorForMidi(rows[i], asset) : "rgba(31,38,38,0.3)"
      ctx.fillText(soundingLabel(rows[i], asset), labelGutter / 2, clamp(y, fontSize, H - fontSize))
    }
    if (typeof ctx.restore === "function") ctx.restore()
  }

  // --- 마법의 선율: 선 위 장식(모두 결정적이라 다시 그려도 깜빡이지 않고, 내보낸 그림에도 그대로 담긴다) ---

  // 획 위에서 정규화 시간 x에 해당하는 저장 y. 한 획 안의 x는 단조 증가한다.
  function strokeYAt(stroke, x) {
    const last = stroke.length - 1
    if (last < 0) return null
    if (x <= stroke[0].x) return stroke[0].y
    if (x >= stroke[last].x) return stroke[last].y
    let lo = 0
    let hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (stroke[mid].x <= x) lo = mid
      else hi = mid
    }
    const a = stroke[lo]
    const b = stroke[hi]
    const span = b.x - a.x
    return span > 1e-9 ? a.y + (b.y - a.y) * ((x - a.x) / span) : b.y
  }

  // 자리마다 늘 같은 값을 주는 0..1 값(반짝임 위치·크기용)
  function hashUnit(a, b) {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return s - Math.floor(s)
  }

  // 선 옆에 박히는 금빛 네 갈래 반짝임
  function paintGlint(ctx, x, y, r) {
    const k = r * 0.28
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + k, y - k)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x + k, y + k)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - k, y + k)
    ctx.lineTo(x - r, y)
    ctx.lineTo(x - k, y - k)
    ctx.closePath()
    ctx.fill()
  }

  // 점 하나짜리 획(탭)은 아주 짧은 선 — 선과 같은 빛무리·빛·선 세 겹의 작은 점으로 그린다.
  function paintTapDot(ctx, x, y, color, px) {
    ctx.fillStyle = color
    ;[[9, 0.07], [5, 0.16], [2.8, 0.92]].forEach(function (layer) {
      ctx.globalAlpha = layer[1]
      ctx.beginPath()
      ctx.arc(x, y, layer[0] * px, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // 선율 봉우리 위로 떠오르는 음표. beamed면 두 음을 이은 ♫, 아니면 꼬리 달린 ♪
  function paintFloatingNote(ctx, x, y, color, px, beamed) {
    if (typeof ctx.ellipse !== "function" || typeof ctx.quadraticCurveTo !== "function") return
    const heads = beamed ? [[x - 3.4 * px, y + 1.2 * px], [x + 3.4 * px, y - 0.6 * px]] : [[x, y]]
    const stem = 8.6 * px
    ctx.globalAlpha = 0.88
    ctx.fillStyle = color
    ctx.strokeStyle = color
    heads.forEach(function (h) {
      ctx.beginPath()
      ctx.ellipse(h[0], h[1], 2.5 * px, 1.8 * px, -0.42, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.lineWidth = 1.1 * px
    ctx.beginPath()
    heads.forEach(function (h) {
      ctx.moveTo(h[0] + 2.2 * px, h[1] - 0.5 * px)
      ctx.lineTo(h[0] + 2.2 * px, h[1] - stem)
    })
    if (!beamed) {
      ctx.moveTo(x + 2.2 * px, y - stem)
      ctx.quadraticCurveTo(x + 6.6 * px, y - stem + 3 * px, x + 4.8 * px, y - stem + 6.4 * px)
    }
    ctx.stroke()
    if (beamed) {
      ctx.lineWidth = 2.1 * px
      ctx.beginPath()
      ctx.moveTo(heads[0][0] + 2.2 * px, heads[0][1] - stem)
      ctx.lineTo(heads[1][0] + 2.2 * px, heads[1][1] - stem)
      ctx.stroke()
    }
  }

  // 각 획을 따로 그린다 — 획끼리 자동으로 이어지지 않음(그린 대로).
  // 마법의 선율: 은은한 빛무리 위에 또렷한 선과 위쪽 윤기를 겹치고, 선을 따라 금빛 반짝임을 박는다.
  // 음 계산이 끝나면(손을 떼면) 선율의 봉우리에 음표가 떠오른다.
  methods.renderStroke = function () {
    const ctx = this.ctx
    const self = this
    const H = this.canvas.height
    const px = this.pixelRatio || 1
    const st = this.getState()
    const view = this._viewContext(st)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    for (let si = 0; si < this.strokes.length; si++) {
      const stroke = this.strokes[si]
      const instrumentId = this.strokeInstruments[si]
      // 지금 축에 없는 음을 쓰는 악기의 획은 숨긴다(지워지진 않음 — 서양 축으로 오면 다시 보인다)
      if (!view.strokeVisible(instrumentId)) continue
      const color = this._colorFor(instrumentId)
      if (stroke.length < 2) {
        if (stroke.length === 1) paintTapDot(ctx, this._timeToX(stroke[0].x), view.toDisplayY(stroke[0].y) * H, color, px)
        continue
      }
      const pts = stroke.map(function (p) {
        return [self._timeToX(p.x), view.toDisplayY(p.y) * H]
      })
      const last = pts.length - 1
      // 점과 점 사이의 가운데를 지나는 곡선으로 이어 꺾인 마디 없이 흐르게 한다(저장 좌표·음은 그대로).
      const smooth = typeof ctx.quadraticCurveTo === "function"
      const trace = function (dy) {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1] + dy)
        if (smooth) {
          for (let i = 1; i < last; i++) {
            ctx.quadraticCurveTo(pts[i][0], pts[i][1] + dy, (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2 + dy)
          }
          ctx.lineTo(pts[last][0], pts[last][1] + dy)
        } else {
          for (let i = 1; i <= last; i++) ctx.lineTo(pts[i][0], pts[i][1] + dy)
        }
      }
      // 한 경로를 한 번에 이어 그려 점 사이의 round cap이 겹쳐 구슬처럼 진해지는 현상을 막는다.
      trace(0)
      ctx.strokeStyle = color
      ctx.lineWidth = 18 * px
      ctx.globalAlpha = 0.07
      ctx.stroke()
      ctx.lineWidth = 10 * px
      ctx.globalAlpha = 0.16
      ctx.stroke()
      ctx.lineWidth = 5.6 * px
      ctx.globalAlpha = 0.92
      ctx.stroke()
      trace(-1.3 * px)
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 1.4 * px
      ctx.globalAlpha = 0.55
      ctx.stroke()
      this._paintGlints(pts, si, px)
    }
    this._paintFloatingNotes(st, view, H, px)
    ctx.globalAlpha = 1
  }

  // 선을 따라 약 96px마다 금빛 반짝임을 선 양옆에 번갈아 박는다. 자리는 획 번호와 순서로 정한다.
  methods._paintGlints = function (pts, si, px) {
    const ctx = this.ctx
    const gap = 96 * px
    let travelled = gap * 0.45
    let lastX = pts[0][0]
    let lastY = pts[0][1]
    let k = 0
    ctx.fillStyle = "#e2ab3c"
    for (let i = 1; i < pts.length; i++) {
      const x = pts[i][0]
      const y = pts[i][1]
      const len = Math.hypot(x - lastX, y - lastY)
      travelled += len
      if (travelled >= gap && len > 0) {
        travelled -= gap
        const r = hashUnit(si + 1, k + 1)
        const off = (7 + r * 5) * px * (k % 2 ? 1 : -1)
        ctx.globalAlpha = 0.55 + r * 0.35
        paintGlint(ctx, x - ((y - lastY) / len) * off, y + ((x - lastX) / len) * off, (2.2 + r * 1.8) * px)
        k++
      }
      lastX = x
      lastY = y
    }
  }

  // 실제로 연주될 음(this.notes) 가운데 선율의 봉우리(앞뒤 음보다 높은 음) 위로 약 2초 간격으로 음표가 떠오른다.
  // 오래 비면 봉우리가 아니어도 떠오르고, 획마다 첫 음에는 늘 떠오른다. 음표는 그 시각의 선 높이 위에 둔다.
  methods._paintFloatingNotes = function (st, view, H, px) {
    // 지우개로 긋는 중에는 획이 쪼개져 음 목록의 획 번호가 낡았다. 손을 떼고 다시 계산되면 그린다.
    if (st.mode === "rhythm" || (this.isDrawing && this.eraseMode) || !this.notes || !this.notes.length) return
    const ctx = this.ctx
    const duration = Math.max(1, Number(st.duration) || 30)
    const byVoice = {}
    for (const note of this.notes) {
      const stroke = this.strokes[note.voice]
      if (!stroke || stroke.length < 2) continue
      if (!byVoice[note.voice]) byVoice[note.voice] = []
      byVoice[note.voice].push(note)
    }
    Object.keys(byVoice).forEach((key) => {
      const voice = Number(key)
      const instrumentId = this.strokeInstruments[voice]
      if (!view.strokeVisible(instrumentId)) return
      const stroke = this.strokes[voice]
      const color = this._colorFor(instrumentId)
      const notes = byVoice[key]
      let lastFloat = -Infinity
      let floats = 0
      notes.forEach((note, i) => {
        const t = note.time / duration
        const y = strokeYAt(stroke, t)
        if (y == null) return
        const x = this._timeToX(t)
        const cy = view.toDisplayY(y) * H
        const prev = notes[i - 1]
        const next = notes[i + 1]
        const peak = (!prev || note.midi >= prev.midi) && (!next || note.midi >= next.midi)
        const gap = note.time - lastFloat
        if (gap >= 4.8 || (gap >= 2.2 && peak)) {
          lastFloat = note.time
          paintFloatingNote(ctx, x + 3 * px, Math.max(14 * px, cy - 16 * px), color, px, floats % 2 === 1)
          floats++
        }
      })
    })
  }

  // 음(midi) → 세로 위치. 음높이 칸과 같은 음 목록(scale)으로 줄을 맞춘다.
  methods._pitchToY = function (midi, scale) {
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

  methods.renderNotes = function () {
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
    const rows = visibleRowsForStyle(st.style, st.melodyAsset)
    const view = this._viewContext(st)
    const rowH = H / Math.max(1, rows.length)
    const timelineWidth = this._timelineWidth()
    for (const n of this.notes) {
      const instrumentId = this._instrumentForNote(n)
      // 지금 축에서 숨긴 악기의 보정 음 막대도 함께 숨긴다(소리는 그대로)
      if (!view.strokeVisible(instrumentId)) continue
      const x = this._timeToX(n.time / st.duration)
      const w = Math.max(6 * px, (n.duration / st.duration) * timelineWidth - 3 * px)
      const y = this._pitchToY(n.midi, rows)
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

  methods.renderStrokeOnly = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
    this.renderPitchLabels()
  }

  methods.render = function () {
    this.resizeToDisplay()
    this.renderGrid()
    this.renderStroke()
    if (this.getState().mode === "rhythm") this.renderNotes()
    this.renderPitchLabels()
  }

  // 썸네일/커버용: 임의 캔버스에 path를 accent로 렌더
  function drawStroke(ctx, w, h, path, accent, bg) {
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

  return {
    methods,
    drawableScaleFor,
    visibleRowsForStyle,
    drawStroke,
    pitchLabelsForStyle,
    pitchRowsForStyle,
    noteColorForMidi,
    noteColorRgba,
  }
})
