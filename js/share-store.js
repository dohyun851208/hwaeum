/*
 * share-store.js — 화음 갤러리 공유용 브라우저 헬퍼.
 * 원본 파일은 저장하지 않고 압축된 표지/썸네일/최종 음악/레시피만 API로 보낸다.
 */
;(function (root) {
  "use strict"

  const OWNER_STORAGE_KEY = "hwaeum.shareOwner"
  const CHANNEL_STORAGE_KEY = "hwaeum.shareChannel"
  const API_BASE = "/api/share"
  const MIN_PIN_LENGTH = 4
  const MAX_UPLOAD_TOTAL_BYTES = 3.5 * 1024 * 1024

  if (!root.HwaeumLocalShareStore) throw new Error("share-local-store.js must load before share-store.js")
  const localStore = root.HwaeumLocalShareStore({ root, randomId, normalizeChannel, forgetChannel })
  const { claimLocalChannel, publishLocalWork, copyLocalWork, listLocalWorks, deleteLocalWork, deleteLocalChannel } = localStore
  if (root.addEventListener) root.addEventListener("pagehide", function (event) {
    if (!event.persisted) localStore.dispose()
  })

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
    const digits = String(value || "").replace(/\D/g, "").slice(0, 4)
    return digits
  }

  // 갤러리 코드는 숫자만 받는다.
  function cleanPin(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6)
  }

  // 입력한 갤러리 코드를 이 브라우저에 기억한다(갤러리별). 새로고침·재방문 때 다시 안 묻게.
  // 컴퓨터실 공용 PC에서는 다음 반 학생에게 앞 반의 코드가 채워졌으므로, 하루 수업 시간(8시간)이 지나면 잊는다.
  const PASS_STORAGE_PREFIX = "hwaeum.channelPass."
  const PASS_REMEMBER_MS = 8 * 60 * 60 * 1000
  function rememberPass(channel, pin) {
    const normalized = normalizeChannel(channel)
    const digits = cleanPin(pin)
    try {
      const s = storage()
      if (!s || !normalized) return digits
      if (digits) s.setItem(PASS_STORAGE_PREFIX + normalized, JSON.stringify({ pin: digits, at: Date.now() }))
      else s.removeItem(PASS_STORAGE_PREFIX + normalized)
    } catch (e) {}
    return digits
  }

  function loadPass(channel) {
    const normalized = normalizeChannel(channel)
    try {
      const s = storage()
      if (!s || !normalized) return ""
      const saved = JSON.parse(s.getItem(PASS_STORAGE_PREFIX + normalized) || "null")
      // 시각이 없는 옛 기록과 오래된 기록은 쓰지 않는다.
      if (!saved || typeof saved !== "object" || !(Date.now() - Number(saved.at) < PASS_REMEMBER_MS)) return ""
      return cleanPin(saved.pin)
    } catch (e) {
      return ""
    }
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

  function forgetChannel(channel) {
    const normalized = normalizeChannel(channel)
    try {
      const s = storage()
      if (s && (!normalized || normalizeChannel(s.getItem(CHANNEL_STORAGE_KEY)) === normalized)) s.removeItem(CHANNEL_STORAGE_KEY)
    } catch (e) {}
    if (normalized) rememberPass(normalized, "")
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
    // 투명한 그림은 스튜디오 그림 칸처럼 크림색 위에 놓는다(그대로 두면 어두운 갤러리 벽에서 검게 보였다).
    ctx.fillStyle = "#fffaf0"
    ctx.fillRect(0, 0, size, size)
    if (img) drawCoverFit(ctx, img, size)
    else drawFallback(ctx, size, options.accent)
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

  // 이 브라우저용(로컬) 갤러리는 공유 API가 아예 없는 곳에서만 쓴다 — 정적 서버("웹으로 열기.bat")나 파일로 연 경우.
  // 운영에서 연결이 끊기거나 서버 오류가 났을 때 로컬로 빠지면 빈 갤러리나 "만들었어요(이 브라우저에만 저장됨)"처럼
  // 엉뚱한 결과가 보였다. 진짜 API는 늘 JSON으로 답하므로, JSON이 아닌 404·405·501만 'API 없음'으로 본다.
  function shouldUseLocalShare(error) {
    if (!localStore.available()) return false
    if (error && error.apiMissing) return true
    return !!(root.location && root.location.protocol === "file:")
  }

  const NETWORK_ERROR_MESSAGE = "공유 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤 다시 해 주세요."

  // fetch 자체가 실패(연결 끊김)하면 영어 오류 대신 알아들을 수 있는 말로 바꾼다.
  async function requestApi(url, init) {
    try {
      return await fetch(url, init)
    } catch (error) {
      if (root.location && root.location.protocol === "file:") {
        const missing = new Error("공유 API를 찾지 못했어요.")
        missing.apiMissing = true
        throw missing
      }
      const failed = new Error(NETWORK_ERROR_MESSAGE)
      failed.network = true
      throw failed
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
    const apiMissing = !data && (response.status === 404 || response.status === 405 || response.status === 501)
    const message =
      data && data.error
        ? data.error
        : apiMissing
          ? "공유 API를 찾지 못했어요. Vercel 배포 환경에서 확인해 주세요."
          : "공유 서버가 잠시 답하지 못했어요. 잠시 뒤 다시 해 주세요."
    const error = new Error(message)
    error.status = response.status
    error.apiMissing = apiMissing
    throw error
  }

  async function postJson(path, body) {
    const response = await requestApi(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return parseResponse(response)
  }

  async function claimChannel(options) {
    options = options || {}
    const channel = normalizeChannel(options.channel)
    if (!channel) throw new Error("번호를 적어 주세요.")
    const pin = cleanPin(options.pin)
    if (pin.length < MIN_PIN_LENGTH) throw new Error("갤러리 코드는 숫자 " + MIN_PIN_LENGTH + "자리 이상으로 정해 주세요.")
    const owner = getOwner()
    const body = {
      channel: channel,
      ownerKey: owner.key,
      ownerId: owner.id,
      adminPin: String(options.adminPin || ""),
      displayName: options.displayName || "",
      pass: pin,
    }
    try {
      return await postJson("/channel-claim", body)
    } catch (error) {
      if (!shouldUseLocalShare(error)) throw error
      return claimLocalChannel(channel, pin, options.displayName || "", owner, options.adminPin)
    }
  }

  async function publishWork(payload) {
    const channel = rememberChannel(payload.channel)
    if (!channel) throw new Error("번호를 적어 주세요.")
    const pin = cleanPin(payload.pass)
    const owner = getOwner()
    const cover = payload.coverBlob
    const thumb = payload.thumbBlob
    const drawing = payload.drawingBlob
    const music = payload.musicBlob
    const total = (cover ? cover.size : 0) + (thumb ? thumb.size : 0) + (drawing ? drawing.size : 0) + (music ? music.size : 0)
    if (!cover || !thumb || !music) throw new Error("공유 파일을 만들지 못했어요.")
    if (total > MAX_UPLOAD_TOTAL_BYTES) throw new Error("압축 후에도 파일이 커요. 그림이나 배경음악을 더 짧고 작은 파일로 바꿔 주세요.")

    const body = {
      channel: channel,
      ownerKey: owner.key,
      ownerId: owner.id,
      pass: pin,
      title: payload.title || "무제",
      recipe: payload.recipe,
      metadata: payload.metadata || {},
      replaceWorkId: payload.replaceWorkId || "",
      files: {
        cover: await encodeBlob(cover),
        thumb: await encodeBlob(thumb),
        drawing: drawing ? await encodeBlob(drawing) : null,
        music: await encodeBlob(music),
      },
    }
    try {
      return await postJson("/publish", body)
    } catch (error) {
      if (!shouldUseLocalShare(error)) throw error
      return publishLocalWork(payload, channel, owner, pin)
    }
  }

  async function copyWork(work, options) {
    options = options || {}
    if (!work || !work.id || !work.channel) throw new Error("복사할 작품을 찾지 못했어요.")
    const sourceChannel = normalizeChannel(work.channel)
    const targetChannel = normalizeChannel(options.channel)
    if (!targetChannel) throw new Error("복사할 갤러리 번호를 적어 주세요.")
    if (sourceChannel === targetChannel) throw new Error("다른 갤러리 번호를 적어 주세요.")
    const pin = cleanPin(options.pass)
    if (pin.length < MIN_PIN_LENGTH) throw new Error("갤러리 코드는 숫자 " + MIN_PIN_LENGTH + "자리 이상으로 정해 주세요.")
    const sourcePass = cleanPin(options.sourcePass)
    const owner = getOwner()
    if (work.localOnly) return copyLocalWork(work, targetChannel, pin, sourcePass, owner)
    try {
      return await postJson("/copy", {
        sourceChannel: sourceChannel,
        workId: work.id,
        sourcePass: sourcePass,
        targetChannel: targetChannel,
        pass: pin,
        ownerKey: owner.key,
        ownerId: owner.id,
      })
    } catch (error) {
      if (/^local_/.test(work.id || "") || shouldUseLocalShare(error)) return copyLocalWork(work, targetChannel, pin, sourcePass, owner)
      throw error
    }
  }

  async function listChannel(channel, pass) {
    const normalized = rememberChannel(channel)
    if (!normalized) throw new Error("번호를 적어 주세요.")
    const pin = cleanPin(pass)
    try {
      const url = API_BASE + "/channel?channel=" + encodeURIComponent(normalized) + (pin ? "&pass=" + encodeURIComponent(pin) : "")
      const response = await requestApi(url)
      const data = await parseResponse(response)
      return {
        channel: normalized,
        meta: data.channel || null,
        locked: !!data.locked,
        passError: !!data.passError,
        works: Array.isArray(data.works) ? data.works : [],
      }
    } catch (error) {
      if (!shouldUseLocalShare(error)) throw error
      return listLocalWorks(normalized, pin)
    }
  }

  // 작품 하나의 전체 정보(그림이 든 레시피까지). 갤러리 목록은 그림을 빼고 오므로 스튜디오로 가져갈 때 쓴다.
  async function getWork(channel, workId, pass) {
    const normalized = normalizeChannel(channel)
    const id = String(workId || "")
    if (!normalized || !id) throw new Error("작품을 찾지 못했어요.")
    const pin = cleanPin(pass)
    try {
      const url =
        API_BASE + "/work?channel=" + encodeURIComponent(normalized) + "&id=" + encodeURIComponent(id) + (pin ? "&pass=" + encodeURIComponent(pin) : "")
      const data = await parseResponse(await requestApi(url))
      return data.work || null
    } catch (error) {
      if (!shouldUseLocalShare(error)) throw error
      const local = await listLocalWorks(normalized, pin)
      return (local.works || []).find((work) => work && work.id === id) || null
    }
  }

  async function deleteWork(work, adminPin) {
    if (!work || !work.id || !work.channel) throw new Error("삭제할 작품을 찾지 못했어요.")
    const pin = String(adminPin || "").trim()
    if (!pin) throw new Error("이 작품을 삭제하려면 관리자 공통 코드가 필요해요.")
    if (work.localOnly) return deleteLocalWork(work, pin)
    try {
      return await postJson("/delete", {
        channel: work.channel,
        workId: work.id,
        adminPin: pin,
      })
    } catch (error) {
      if (/^local_/.test(work.id || "")) return deleteLocalWork(work, pin)
      throw error
    }
  }

  async function deleteChannel(channel, adminPin) {
    const normalized = normalizeChannel(channel)
    if (!normalized) throw new Error("삭제할 번호를 적어 주세요.")
    const pin = String(adminPin || "").trim()
    if (!pin) throw new Error("화음 갤러리를 삭제하려면 관리자 공통 코드가 필요해요.")
    try {
      const result = await postJson("/channel-delete", {
        channel: normalized,
        adminPin: pin,
      })
      forgetChannel(normalized)
      return result
    } catch (error) {
      if (!shouldUseLocalShare(error)) throw error
      return deleteLocalChannel(normalized, pin)
    }
  }

  function formatBytes(size) {
    const n = Number(size) || 0
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + "MB"
    return Math.max(1, Math.round(n / 1024)) + "KB"
  }

  root.HwaeumShareStore = {
    getOwner: getOwner,
    normalizeChannel: normalizeChannel,
    cleanPin: cleanPin,
    rememberChannel: rememberChannel,
    loadChannel: loadChannel,
    rememberPass: rememberPass,
    loadPass: loadPass,
    createImageBlobs: createImageBlobs,
    claimChannel: claimChannel,
    publishWork: publishWork,
    copyWork: copyWork,
    listChannel: listChannel,
    getWork: getWork,
    deleteWork: deleteWork,
    deleteChannel: deleteChannel,
    formatBytes: formatBytes,
    MIN_PIN_LENGTH: MIN_PIN_LENGTH,
  }
})(window)
