/*
 * share-store.js — 학급 채널 공유용 브라우저 헬퍼.
 * 원본 파일은 저장하지 않고 압축된 표지/썸네일/최종 음악/레시피만 API로 보낸다.
 */
;(function (root) {
  "use strict"

  const OWNER_STORAGE_KEY = "hwaeum.shareOwner"
  const CHANNEL_STORAGE_KEY = "hwaeum.shareChannel"
  const API_BASE = "/api/share"
  const MAX_UPLOAD_TOTAL_BYTES = 3.5 * 1024 * 1024

  function storage() {
    try {
      return root.localStorage || null
    } catch (e) {
      return null
    }
  }

  function randomId(prefix) {
    const cryptoObj = root.crypto || root.msCrypto
    if (cryptoObj && cryptoObj.randomUUID) return prefix + cryptoObj.randomUUID()
    const bytes = new Uint8Array(16)
    if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(bytes)
    else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    }
    return (
      prefix +
      Array.prototype.map
        .call(bytes, function (b) {
          return ("0" + b.toString(16)).slice(-2)
        })
        .join("")
    )
  }

  function getOwner() {
    const s = storage()
    let parsed = null
    try {
      parsed = s ? JSON.parse(s.getItem(OWNER_STORAGE_KEY) || "null") : null
    } catch (e) {
      parsed = null
    }
    if (parsed && parsed.key && parsed.id) return parsed
    const owner = {
      key: randomId("owner_"),
      id: randomId("student_").replace(/^student_/, "").slice(0, 18),
    }
    try {
      if (s) s.setItem(OWNER_STORAGE_KEY, JSON.stringify(owner))
    } catch (e) {}
    return owner
  }

  function normalizeChannel(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 6)
    return digits
  }

  function rememberChannel(channel) {
    const normalized = normalizeChannel(channel)
    try {
      const s = storage()
      if (s && normalized) s.setItem(CHANNEL_STORAGE_KEY, normalized)
    } catch (e) {}
    return normalized
  }

  function loadChannel() {
    try {
      const s = storage()
      return normalizeChannel(s ? s.getItem(CHANNEL_STORAGE_KEY) : "")
    } catch (e) {
      return ""
    }
  }

  function loadImage(src) {
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

  function drawFallback(ctx, size, accent) {
    ctx.fillStyle = "#1f2a2a"
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 34; i++) {
      ctx.strokeStyle = i % 3 === 0 ? "#fbf6ec" : accent || "#6b8f9c"
      ctx.globalAlpha = 0.16 + (i % 5) * 0.035
      ctx.lineWidth = 2 + (i % 5)
      ctx.beginPath()
      const y = 80 + i * 18
      ctx.moveTo(40, y)
      for (let x = 40; x < size - 40; x += 30) {
        ctx.lineTo(x, y + Math.sin((x + i * 29) / 52) * (22 + (i % 4) * 5))
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  async function renderCoverCanvas(options, size) {
    options = options || {}
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    const img = await loadImage(options.pictureSrc || options.defaultCoverSrc)
    if (img) drawCoverFit(ctx, img, size)
    else drawFallback(ctx, size, options.accent)

    const tags = options.hashtags || ""
    const padH = tags ? Math.round(size * 0.2) : Math.round(size * 0.15)
    ctx.fillStyle = "rgba(20,26,26,0.82)"
    ctx.fillRect(0, size - padH, size, padH)
    ctx.fillStyle = "#fbf6ec"
    ctx.font = "700 " + Math.round(size * 0.052) + "px Georgia, serif"
    ctx.fillText(fitCanvasLine(ctx, options.title || "무제", size - Math.round(size * 0.1)), Math.round(size * 0.047), size - padH + Math.round(size * 0.064))
    if (tags) {
      ctx.font = "800 " + Math.round(size * 0.03) + "px 'Segoe UI', sans-serif"
      ctx.fillText(fitCanvasLine(ctx, tags, size - Math.round(size * 0.1)), Math.round(size * 0.047), size - padH + Math.round(size * 0.12))
    }

    const cx = size / 2
    const cy = (size - padH) / 2
    const r = Math.round(size * 0.07)
    ctx.fillStyle = "rgba(20,26,26,0.55)"
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fbf6ec"
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.3, cy - r * 0.42)
    ctx.lineTo(cx - r * 0.3, cy + r * 0.42)
    ctx.lineTo(cx + r * 0.48, cy)
    ctx.closePath()
    ctx.fill()
    return canvas
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob)
          else reject(new Error("이미지를 압축하지 못했어요."))
        },
        type,
        quality,
      )
    })
  }

  async function createImageBlobs(options) {
    const coverCanvas = await renderCoverCanvas(options, 720)
    const thumbCanvas = await renderCoverCanvas(options, 320)
    return {
      cover: await canvasToBlob(coverCanvas, "image/webp", 0.62),
      thumb: await canvasToBlob(thumbCanvas, "image/webp", 0.5),
    }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader()
      reader.onload = function () {
        const result = String(reader.result || "")
        resolve(result.indexOf(",") === -1 ? result : result.split(",")[1])
      }
      reader.onerror = function () {
        reject(new Error("파일을 읽지 못했어요."))
      }
      reader.readAsDataURL(blob)
    })
  }

  async function encodeBlob(blob) {
    return {
      contentType: blob.type || "application/octet-stream",
      size: blob.size || 0,
      contentBase64: await blobToBase64(blob),
    }
  }

  async function parseResponse(response) {
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (e) {
      data = null
    }
    if (response.ok) return data || {}
    const message =
      data && data.error
        ? data.error
        : response.status === 404
          ? "공유 API를 찾지 못했어요. Vercel 배포 환경에서 확인해 주세요."
          : "공유 서버 요청에 실패했어요."
    throw new Error(message)
  }

  async function postJson(path, body) {
    const response = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return parseResponse(response)
  }

  async function publishWork(payload) {
    const channel = rememberChannel(payload.channel)
    if (!channel) throw new Error("공유 채널 번호를 적어 주세요.")
    const owner = getOwner()
    const cover = payload.coverBlob
    const thumb = payload.thumbBlob
    const music = payload.musicBlob
    const total = (cover ? cover.size : 0) + (thumb ? thumb.size : 0) + (music ? music.size : 0)
    if (!cover || !thumb || !music) throw new Error("공유 파일을 만들지 못했어요.")
    if (total > MAX_UPLOAD_TOTAL_BYTES) throw new Error("압축 후에도 파일이 커요. 그림이나 배경음악을 더 짧고 작은 파일로 바꿔 주세요.")

    return postJson("/publish", {
      channel: channel,
      ownerKey: owner.key,
      ownerId: owner.id,
      title: payload.title || "무제",
      recipe: payload.recipe,
      metadata: payload.metadata || {},
      files: {
        cover: await encodeBlob(cover),
        thumb: await encodeBlob(thumb),
        music: await encodeBlob(music),
      },
    })
  }

  async function listChannel(channel) {
    const normalized = rememberChannel(channel)
    if (!normalized) throw new Error("공유 채널 번호를 적어 주세요.")
    const response = await fetch(API_BASE + "/channel?channel=" + encodeURIComponent(normalized))
    const data = await parseResponse(response)
    return {
      channel: normalized,
      works: Array.isArray(data.works) ? data.works : [],
    }
  }

  async function deleteWork(work, adminPin) {
    if (!work || !work.id || !work.channel) throw new Error("삭제할 작품을 찾지 못했어요.")
    const owner = getOwner()
    return postJson("/delete", {
      channel: work.channel,
      workId: work.id,
      ownerKey: owner.key,
      adminPin: adminPin || "",
    })
  }

  function formatBytes(size) {
    const n = Number(size) || 0
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + "MB"
    return Math.max(1, Math.round(n / 1024)) + "KB"
  }

  root.HwaeumShareStore = {
    getOwner: getOwner,
    normalizeChannel: normalizeChannel,
    rememberChannel: rememberChannel,
    loadChannel: loadChannel,
    createImageBlobs: createImageBlobs,
    publishWork: publishWork,
    listChannel: listChannel,
    deleteWork: deleteWork,
    formatBytes: formatBytes,
  }
})(window)
