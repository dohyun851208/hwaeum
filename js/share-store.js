/*
 * share-store.js — 학급 채널 공유용 브라우저 헬퍼.
 * 원본 파일은 저장하지 않고 압축된 표지/썸네일/최종 음악/레시피만 API로 보낸다.
 */
;(function (root) {
  "use strict"

  const OWNER_STORAGE_KEY = "hwaeum.shareOwner"
  const CHANNEL_STORAGE_KEY = "hwaeum.shareChannel"
  const API_BASE = "/api/share"
  const LOCAL_DB_NAME = "hwaeum.shareChannel"
  const LOCAL_DB_VERSION = 2
  const LOCAL_STORE_NAME = "works"
  const LOCAL_CHANNEL_STORE_NAME = "channels"
  const MIN_PIN_LENGTH = 4
  // 로컬(서버 없는) 폴백에서만 쓰는 1차 관리자 번호 검문. 배포 환경은 서버(_utils.cjs)가 진짜 검문소.
  const LOCAL_ADMIN_PIN = "8624"
  const MAX_UPLOAD_TOTAL_BYTES = 3.5 * 1024 * 1024
  const objectUrlCache = new Map()

  function storage() {
    try {
      return root.localStorage || null
    } catch (e) {
      return null
    }
  }

  function indexedDb() {
    try {
      return root.indexedDB || null
    } catch (e) {
      return null
    }
  }

  function openLocalDb() {
    const idb = indexedDb()
    if (!idb) return Promise.reject(new Error("이 브라우저에서는 로컬 채널 저장을 사용할 수 없어요."))
    return new Promise(function (resolve, reject) {
      const req = idb.open(LOCAL_DB_NAME, LOCAL_DB_VERSION)
      req.onupgradeneeded = function () {
        const db = req.result
        if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) db.createObjectStore(LOCAL_STORE_NAME, { keyPath: "id" })
        if (!db.objectStoreNames.contains(LOCAL_CHANNEL_STORE_NAME)) db.createObjectStore(LOCAL_CHANNEL_STORE_NAME, { keyPath: "channel" })
      }
      req.onsuccess = function () {
        resolve(req.result)
      }
      req.onerror = function () {
        reject(req.error || new Error("로컬 채널 저장소를 열지 못했어요."))
      }
      req.onblocked = function () {
        reject(new Error("다른 탭에서 채널 저장소를 사용 중입니다. 잠시 뒤 다시 시도해 주세요."))
      }
    })
  }

  function withLocalStore(mode, action, storeName) {
    const name = storeName || LOCAL_STORE_NAME
    return openLocalDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        let result
        let settled = false
        const finish = function (fn, value) {
          if (settled) return
          settled = true
          try {
            db.close()
          } catch (e) {}
          fn(value)
        }
        let tx
        try {
          tx = db.transaction(name, mode)
          const store = tx.objectStore(name)
          action(store, function (value) {
            result = value
          })
        } catch (e) {
          finish(reject, e)
          return
        }
        tx.oncomplete = function () {
          finish(resolve, result)
        }
        tx.onerror = function () {
          finish(reject, tx.error || new Error("로컬 채널 저장에 실패했어요."))
        }
        tx.onabort = function () {
          finish(reject, tx.error || new Error("로컬 채널 저장을 취소했어요."))
        }
      })
    })
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

  // 2차 비밀번호는 숫자만 받는다.
  function cleanPin(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 12)
  }

  // 입력한 2차 비밀번호를 세션에 잠깐 둔다(채널별). 새로고침해도 다시 안 묻게.
  const PASS_SESSION_PREFIX = "hwaeum.channelPass."
  function rememberPass(channel, pin) {
    const normalized = normalizeChannel(channel)
    const digits = cleanPin(pin)
    try {
      const s = root.sessionStorage
      if (!s || !normalized) return digits
      if (digits) s.setItem(PASS_SESSION_PREFIX + normalized, digits)
      else s.removeItem(PASS_SESSION_PREFIX + normalized)
    } catch (e) {}
    return digits
  }

  function loadPass(channel) {
    const normalized = normalizeChannel(channel)
    try {
      const s = root.sessionStorage
      return s && normalized ? cleanPin(s.getItem(PASS_SESSION_PREFIX + normalized)) : ""
    } catch (e) {
      return ""
    }
  }

  function publicLocalChannel(record) {
    return { channel: record.channel, displayName: record.displayName || "", hasPass: !!record.pass }
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

  function objectUrlFor(workId, kind, blob) {
    if (!blob || !root.URL || !root.URL.createObjectURL) return ""
    const key = workId + ":" + kind + ":" + (blob.size || 0) + ":" + (blob.type || "")
    if (!objectUrlCache.has(key)) objectUrlCache.set(key, root.URL.createObjectURL(blob))
    return objectUrlCache.get(key)
  }

  function localShareUrl(workId, channel) {
    try {
      const url = new URL("./channel.html", root.location && root.location.href ? root.location.href : "/")
      url.search = "?channel=" + encodeURIComponent(channel)
      url.hash = "work=" + encodeURIComponent(workId)
      return url.href
    } catch (e) {
      return ""
    }
  }

  function localPublicWork(record) {
    record = record || {}
    const files = record.files || {}
    const cover = files.cover || null
    const thumb = files.thumb || null
    const music = files.music || null
    const coverBytes = cover ? cover.size || 0 : 0
    const thumbBytes = thumb ? thumb.size || 0 : 0
    const musicBytes = music ? music.size || 0 : 0
    return {
      id: record.id,
      channel: record.channel,
      title: record.title || "무제",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ownerId: record.ownerId,
      metadata: record.metadata || {},
      recipe: record.recipe || {},
      files: {
        coverUrl: objectUrlFor(record.id, "cover", cover),
        thumbUrl: objectUrlFor(record.id, "thumb", thumb),
        musicUrl: objectUrlFor(record.id, "music", music),
        musicType: music ? music.type || "audio/webm" : "",
        coverBytes: coverBytes,
        thumbBytes: thumbBytes,
        musicBytes: musicBytes,
        totalBytes: coverBytes + thumbBytes + musicBytes,
      },
      shareUrl: localShareUrl(record.id, record.channel),
      localOnly: true,
      schemaVersion: 1,
    }
  }

  async function getLocalChannel(channel) {
    return (
      (await withLocalStore(
        "readonly",
        function (store, setResult) {
          const req = store.get(channel)
          req.onsuccess = function () {
            setResult(req.result || null)
          }
        },
        LOCAL_CHANNEL_STORE_NAME,
      )) || null
    )
  }

  async function claimLocalChannel(channel, pin, displayName, owner, adminPin) {
    if (String(adminPin || "").trim() !== LOCAL_ADMIN_PIN) {
      throw new Error("채널을 만들려면 1차 관리자 번호가 필요해요.")
    }
    const existing = await getLocalChannel(channel)
    if (existing && existing.ownerId && existing.ownerId !== owner.id) {
      throw new Error("이미 다른 선생님이 점유한 채널이에요. 다른 번호를 써 주세요.")
    }
    const now = new Date().toISOString()
    const record = {
      channel: channel,
      displayName: displayName || (existing && existing.displayName) || "",
      ownerId: owner.id,
      pass: pin,
      createdAt: (existing && existing.createdAt) || now,
      updatedAt: now,
    }
    await withLocalStore(
      "readwrite",
      function (store) {
        store.put(record)
      },
      LOCAL_CHANNEL_STORE_NAME,
    )
    return { channel: publicLocalChannel(record), claimed: !existing, localOnly: true }
  }

  async function publishLocalWork(payload, channel, owner, pin) {
    const channelRecord = await getLocalChannel(channel)
    if (!channelRecord) throw new Error("아직 만들어지지 않은 채널이에요. 관리자가 먼저 채널을 만들어 주세요.")
    if (channelRecord.pass && pin !== channelRecord.pass) throw new Error("채널 2차 비밀번호가 맞지 않아요.")
    const now = new Date().toISOString()
    const record = {
      id: randomId("local_"),
      channel: channel,
      title: payload.title || "무제",
      createdAt: now,
      updatedAt: now,
      ownerId: owner.id,
      metadata: payload.metadata || {},
      recipe: payload.recipe || {},
      files: {
        cover: payload.coverBlob,
        thumb: payload.thumbBlob,
        music: payload.musicBlob,
      },
    }
    await withLocalStore("readwrite", function (store) {
      store.put(record)
    })
    return { work: localPublicWork(record), localOnly: true }
  }

  async function listLocalWorks(channel, pin) {
    const channelRecord = await getLocalChannel(channel)
    const meta = channelRecord ? publicLocalChannel(channelRecord) : null
    if (channelRecord && channelRecord.pass && pin !== channelRecord.pass) {
      return { channel: channel, meta: meta, locked: true, passError: !!pin, works: [], localOnly: true }
    }
    const records =
      (await withLocalStore("readonly", function (store, setResult) {
        const req = store.getAll()
        req.onsuccess = function () {
          setResult(req.result || [])
        }
      })) || []
    const works = records
      .filter(function (record) {
        return record && record.channel === channel
      })
      .sort(function (a, b) {
        return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")
      })
      .map(localPublicWork)
    return { channel: channel, meta: meta, locked: false, passError: false, works: works, localOnly: true }
  }

  async function deleteLocalWork(work, adminPin) {
    const owner = getOwner()
    const outcome =
      (await withLocalStore("readwrite", function (store, setResult) {
        const req = store.get(work.id)
        req.onsuccess = function () {
          const record = req.result
          if (!record || record.channel !== work.channel) {
            setResult({ found: false, allowed: false })
            return
          }
          const allowed = record.ownerId === owner.id || !!adminPin
          if (allowed) store.delete(record.id)
          setResult({ found: true, allowed: allowed })
        }
      })) || { found: false, allowed: false }
    if (!outcome.found) throw new Error("이미 삭제되었거나 없는 작품입니다.")
    if (!outcome.allowed) throw new Error("이 작품을 삭제할 권한이 없어요.")
    return { ok: true, deleted: work.id, localOnly: true }
  }

  async function deleteLocalChannel(channel, pin) {
    const channelRecord = await getLocalChannel(channel)
    if (!channelRecord) throw new Error("삭제할 채널을 찾지 못했어요.")
    if (!channelRecord.pass || pin !== channelRecord.pass) throw new Error("채널 2차 비밀번호가 맞지 않아요.")
    const deletedWorks =
      (await withLocalStore("readwrite", function (store, setResult) {
        const req = store.getAll()
        req.onsuccess = function () {
          let count = 0
          const records = req.result || []
          records.forEach(function (record) {
            if (record && record.channel === channel) {
              store.delete(record.id)
              count += 1
            }
          })
          setResult(count)
        }
      })) || 0
    await withLocalStore(
      "readwrite",
      function (store) {
        store.delete(channel)
      },
      LOCAL_CHANNEL_STORE_NAME,
    )
    forgetChannel(channel)
    return { ok: true, deleted: channel, deletedWorks: deletedWorks, localOnly: true }
  }

  function shouldUseLocalShare(error) {
    if (!indexedDb()) return false
    const status = error && Number(error.status)
    const message = String((error && error.message) || "")
    if (status === 404 || status === 405 || status === 501 || status === 0) return true
    return /공유 API를 찾지 못|Failed to fetch|NetworkError|Load failed|fetch/.test(message)
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
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  async function postJson(path, body) {
    const response = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return parseResponse(response)
  }

  async function claimChannel(options) {
    options = options || {}
    const channel = normalizeChannel(options.channel)
    if (!channel) throw new Error("공유 채널 번호를 적어 주세요.")
    const pin = cleanPin(options.pin)
    if (pin.length < MIN_PIN_LENGTH) throw new Error("2차 비밀번호는 숫자 " + MIN_PIN_LENGTH + "자리 이상으로 정해 주세요.")
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
    if (!channel) throw new Error("공유 채널 번호를 적어 주세요.")
    const pin = cleanPin(payload.pass)
    const owner = getOwner()
    const cover = payload.coverBlob
    const thumb = payload.thumbBlob
    const music = payload.musicBlob
    const total = (cover ? cover.size : 0) + (thumb ? thumb.size : 0) + (music ? music.size : 0)
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
      files: {
        cover: await encodeBlob(cover),
        thumb: await encodeBlob(thumb),
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

  async function listChannel(channel, pass) {
    const normalized = rememberChannel(channel)
    if (!normalized) throw new Error("공유 채널 번호를 적어 주세요.")
    const pin = cleanPin(pass)
    try {
      const url = API_BASE + "/channel?channel=" + encodeURIComponent(normalized) + (pin ? "&pass=" + encodeURIComponent(pin) : "")
      const response = await fetch(url)
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

  async function deleteWork(work, adminPin) {
    if (!work || !work.id || !work.channel) throw new Error("삭제할 작품을 찾지 못했어요.")
    if (work.localOnly) return deleteLocalWork(work, adminPin)
    const owner = getOwner()
    try {
      return await postJson("/delete", {
        channel: work.channel,
        workId: work.id,
        ownerKey: owner.key,
        adminPin: adminPin || "",
      })
    } catch (error) {
      if (/^local_/.test(work.id || "")) return deleteLocalWork(work, adminPin)
      throw error
    }
  }

  async function deleteChannel(channel, pass) {
    const normalized = normalizeChannel(channel)
    if (!normalized) throw new Error("삭제할 채널 번호를 적어 주세요.")
    const pin = cleanPin(pass)
    if (pin.length < MIN_PIN_LENGTH) throw new Error("2차 비밀번호는 숫자 " + MIN_PIN_LENGTH + "자리 이상으로 넣어 주세요.")
    try {
      const result = await postJson("/channel-delete", {
        channel: normalized,
        pass: pin,
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
    listChannel: listChannel,
    deleteWork: deleteWork,
    deleteChannel: deleteChannel,
    formatBytes: formatBytes,
    MIN_PIN_LENGTH: MIN_PIN_LENGTH,
  }
})(window)
