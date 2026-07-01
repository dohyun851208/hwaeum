;(function (root) {
  "use strict"

  // Canvas 스냅샷·파일 다운로드 유틸리티 팩토리.
  // studio.js에서 createStudioExport(deps)로 호출하여 반환된 함수들을 destructure.
  root.HwaeumStudioExport = function createStudioExport(deps) {
    const { state, el, D, draw, StudioUtils, timelineLabelTimes, getDuration } = deps

    // ── 커버·썸네일 ──────────────────────────────────────────────

    function drawCoverFit(ctx, img, size) {
      const r = Math.max(size / img.width, size / img.height)
      const dw = img.width * r
      const dh = img.height * r
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
    }

    function fitCanvasLine(ctx, text, maxWidth) {
      let out = String(text || "")
      if (ctx.measureText(out).width <= maxWidth) return out
      while (out.length > 1 && ctx.measureText(out + "...").width > maxWidth) out = out.slice(0, -1)
      return out + "..."
    }

    // ── 캔버스 기본 도형 ─────────────────────────────────────────

    function roundCanvasRect(ctx, x, y, w, h, r) {
      r = Math.min(r, h / 2, w / 2)
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    // ── 이미지 로딩 ──────────────────────────────────────────────

    function loadCanvasImage(src) {
      return new Promise(function (resolve) {
        if (!src) {
          resolve(null)
          return
        }
        const img = new Image()
        let done = false
        const finish = function (value) {
          if (done) return
          done = true
          resolve(value)
        }
        img.onload = function () {
          finish(img)
        }
        img.onerror = function () {
          finish(null)
        }
        img.src = src
        if (img.complete) finish(img)
      })
    }

    async function stampImageMap() {
      const ids = []
      state.effectStamps.forEach((stamp) => {
        if (ids.indexOf(stamp.id) === -1) ids.push(stamp.id)
      })
      const pairs = await Promise.all(
        ids.map(function (id) {
          const effect = D.effects[id]
          return loadCanvasImage(effect && effect.image).then((img) => [id, img])
        }),
      )
      const out = {}
      pairs.forEach((pair) => {
        out[pair[0]] = pair[1]
      })
      return out
    }

    // ── 타임라인 스냅샷 렌더 ─────────────────────────────────────

    function snapshotTimelineX(width, progress) {
      const labelWidth =
        draw && typeof draw._timelineLeft === "function" ? Math.min(Math.max(0, draw._timelineLeft()), Math.max(0, width - 1)) : 0
      return labelWidth + StudioUtils.clampUnit(progress) * Math.max(1, width - labelWidth)
    }

    function drawSnapshotTimeLabels(ctx, w, h) {
      const duration = getDuration()
      const times = timelineLabelTimes()
      const fontSize = Math.max(18, Math.round(w * 0.013))
      ctx.save()
      ctx.font = "800 " + fontSize + "px 'Segoe UI', sans-serif"
      ctx.textBaseline = "middle"
      ctx.textAlign = "center"
      times.forEach((time) => {
        const text = StudioUtils.secondsLabel(time)
        const metrics = ctx.measureText(text)
        const pillW = Math.max(48, metrics.width + 18)
        const pillH = fontSize + 14
        const x = Math.max(pillW / 2 + 8, Math.min(w - pillW / 2 - 8, snapshotTimelineX(w, time / duration)))
        const y = Math.max(pillH / 2 + 8, fontSize + 8)
        ctx.fillStyle = "rgba(251,246,236,0.92)"
        roundCanvasRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2)
        ctx.fill()
        ctx.strokeStyle = "rgba(31,38,38,0.12)"
        ctx.stroke()
        ctx.fillStyle = "rgba(31,38,38,0.72)"
        ctx.fillText(text, x, y)
      })
      ctx.restore()
    }

    function drawSnapshotStamps(ctx, w, h, images) {
      state.effectStamps.forEach((stamp) => {
        const effect = D.effects[stamp.id]
        if (!effect) return
        const size = Math.max(44, Math.min(76, Math.round(w * 0.04)))
        const x = Math.max(size / 2, Math.min(w - size / 2, snapshotTimelineX(w, stamp.x || 0)))
        const y = Math.max(size / 2, Math.min(h - size / 2, (stamp.y == null ? 0.5 : stamp.y) * h))
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate((-4 * Math.PI) / 180)
        ctx.shadowColor = "rgba(31,38,38,0.16)"
        ctx.shadowBlur = Math.max(8, size * 0.22)
        ctx.shadowOffsetY = Math.max(4, size * 0.12)
        ctx.fillStyle = "rgba(251,246,236,0.88)"
        roundCanvasRect(ctx, -size / 2, -size / 2, size, size, Math.max(10, size * 0.24))
        ctx.fill()
        ctx.shadowColor = "transparent"
        ctx.strokeStyle = "rgba(31,38,38,0.18)"
        ctx.stroke()
        const img = images[stamp.id]
        if (img) {
          ctx.drawImage(img, -size * 0.38, -size * 0.38, size * 0.76, size * 0.76)
        } else {
          ctx.fillStyle = "rgba(31,38,38,0.78)"
          ctx.font = "800 " + Math.max(10, Math.round(size * 0.18)) + "px 'Segoe UI', sans-serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(fitCanvasLine(ctx, effect.label, size * 0.78), 0, 0)
        }
        ctx.restore()
      })
    }

    function drawSnapshotPlayhead(ctx, w, h, progress) {
      if (progress == null) return
      const x = snapshotTimelineX(w, progress)
      ctx.save()
      ctx.strokeStyle = "rgba(31,38,38,0.92)"
      ctx.lineWidth = Math.max(3, Math.round(w * 0.0022))
      ctx.shadowColor = "rgba(251,246,236,0.74)"
      ctx.shadowBlur = Math.max(2, Math.round(w * 0.0015))
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.shadowColor = "rgba(31,38,38,0.18)"
      ctx.shadowBlur = Math.max(4, Math.round(w * 0.003))
      ctx.fillStyle = "rgba(183,138,47,0.96)"
      ctx.beginPath()
      ctx.arc(x, Math.max(18, h * 0.055), Math.max(8, Math.round(w * 0.007)), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    async function renderDrawingSnapshotCanvas(options) {
      options = options || {}
      draw.render()
      const w = el.canvas.width || 1440
      const h = el.canvas.height || 540
      const cv = document.createElement("canvas")
      cv.width = w
      cv.height = h
      const ctx = cv.getContext("2d")
      ctx.drawImage(el.canvas, 0, 0, w, h)
      drawSnapshotTimeLabels(ctx, w, h)
      drawSnapshotStamps(ctx, w, h, await stampImageMap())
      drawSnapshotPlayhead(ctx, w, h, options.playheadProgress)
      return cv
    }

    // ── 파일 다운로드 유틸 ───────────────────────────────────────

    function canvasToBlob(canvas, type, quality) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob)
          else reject(new Error("canvas toBlob failed"))
        }, type, quality)
      })
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    function safeName() {
      const t = (state.title || "무제").replace(/[^\w가-힣 _-]/g, "").trim() || "무제"
      return t + "_" + state.atmosphere.label
    }

    function supportedVideoMime() {
      if (!window.MediaRecorder) return ""
      const list = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      for (const type of list) {
        if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) return type
      }
      return ""
    }

    return {
      drawCoverFit,
      fitCanvasLine,
      roundCanvasRect,
      loadCanvasImage,
      stampImageMap,
      snapshotTimelineX,
      drawSnapshotTimeLabels,
      drawSnapshotStamps,
      drawSnapshotPlayhead,
      renderDrawingSnapshotCanvas,
      canvasToBlob,
      downloadBlob,
      safeName,
      supportedVideoMime,
    }
  }
})(window)
