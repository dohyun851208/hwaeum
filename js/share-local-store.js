/*
 * share-local-store.js — 서버 없는 교실 환경의 IndexedDB 갤러리 저장소.
 * 데이터베이스 트랜잭션과 Blob URL의 수명은 이 모듈에서 관리한다.
 */
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory
  else root.HwaeumLocalShareStore = factory
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict"

  const { root, randomId, normalizeChannel, forgetChannel } = deps
  const LOCAL_DB_NAME = "hwaeum.shareChannel"
  const LOCAL_DB_VERSION = 2
  const LOCAL_STORE_NAME = "works"
  const LOCAL_CHANNEL_STORE_NAME = "channels"
  // 로컬(서버 없는) 폴백에서만 쓰는 관리자 공통 코드 검문. 배포 환경은 서버(_utils.cjs)가 진짜 검문소.
  const LOCAL_ADMIN_PIN = "8624"
  const objectUrlCache = new Map()

  function indexedDb() {
    try {
      return root.indexedDB || null
    } catch (e) {
      return null
    }
  }

  function openLocalDb() {
    const idb = indexedDb()
    if (!idb) return Promise.reject(new Error("이 브라우저에서는 로컬 화음 갤러리 저장을 사용할 수 없어요."))
    return new Promise(function (resolve, reject) {
      const req = idb.open(LOCAL_DB_NAME, LOCAL_DB_VERSION)
      let failed = false
      req.onupgradeneeded = function () {
        const db = req.result
        if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) db.createObjectStore(LOCAL_STORE_NAME, { keyPath: "id" })
        if (!db.objectStoreNames.contains(LOCAL_CHANNEL_STORE_NAME)) db.createObjectStore(LOCAL_CHANNEL_STORE_NAME, { keyPath: "channel" })
      }
      req.onsuccess = function () {
        if (failed) { req.result.close(); return }
        req.result.onversionchange = function () { req.result.close() }
        resolve(req.result)
      }
      req.onerror = function () {
        failed = true
        reject(req.error || new Error("로컬 화음 갤러리 저장소를 열지 못했어요."))
      }
      req.onblocked = function () {
        failed = true
        reject(new Error("다른 탭에서 화음 갤러리 저장소를 사용 중입니다. 잠시 뒤 다시 시도해 주세요."))
      }
    })
  }

  function withLocalStore(mode, action, storeName) {
    const names = Array.isArray(storeName) ? storeName : [storeName || LOCAL_STORE_NAME]
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
          tx = db.transaction(names, mode)
          tx.oncomplete = function () { finish(resolve, result) }
          tx.onerror = function () { finish(reject, tx.error || new Error("로컬 화음 갤러리 저장에 실패했어요.")) }
          tx.onabort = function () { finish(reject, tx.error || new Error("로컬 화음 갤러리 저장을 취소했어요.")) }
          const store = tx.objectStore(names[0])
          action(store, function (value) {
            result = value
          }, tx)
        } catch (e) {
          // close() alone lets queued writes commit; abort keeps this operation atomic.
          try { if (tx) tx.abort() } catch (abortError) {}
          finish(reject, e)
        }
      })
    })
  }

  function publicLocalChannel(record) {
    return { channel: record.channel, displayName: record.displayName || "", hasPass: !!record.pass }
  }

  function objectUrlFor(workId, kind, blob) {
    if (!blob || !root.URL || !root.URL.createObjectURL) return ""
    const key = workId + ":" + kind + ":" + (blob.size || 0) + ":" + (blob.type || "")
    if (!objectUrlCache.has(key)) objectUrlCache.set(key, root.URL.createObjectURL(blob))
    return objectUrlCache.get(key)
  }

  function releaseObjectUrls(workId) {
    for (const [key, url] of objectUrlCache) {
      if (workId != null && !key.startsWith(workId + ":")) continue
      if (root.URL && root.URL.revokeObjectURL) root.URL.revokeObjectURL(url)
      objectUrlCache.delete(key)
    }
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
    const drawing = files.drawing || null
    const music = files.music || null
    const coverBytes = cover ? cover.size || 0 : 0
    const thumbBytes = thumb ? thumb.size || 0 : 0
    const drawingBytes = drawing ? drawing.size || 0 : 0
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
        drawingUrl: objectUrlFor(record.id, "drawing", drawing),
        musicUrl: objectUrlFor(record.id, "music", music),
        musicType: music ? music.type || "audio/webm" : "",
        coverBytes: coverBytes,
        thumbBytes: thumbBytes,
        drawingBytes: drawingBytes,
        musicBytes: musicBytes,
        totalBytes: coverBytes + thumbBytes + drawingBytes + musicBytes,
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
      throw new Error("화음 갤러리를 만들려면 관리자 공통 코드가 필요해요.")
    }
    const existing = await getLocalChannel(channel)
    // 갤러리 코드가 정확히 맞으면 다른 브라우저 프로필이라도 같은 선생님으로 본다.
    if (existing && existing.ownerId && existing.ownerId !== owner.id && existing.pass !== pin) {
      throw new Error("이미 다른 선생님이 사용 중인 화음 갤러리예요. 다른 번호를 써 주세요.")
    }
    const now = new Date().toISOString()
    const record = {
      channel: channel,
      displayName: displayName || (existing && existing.displayName) || "",
      ownerId: (existing && existing.ownerId) || owner.id,
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
    if (!channelRecord) throw new Error("아직 만들어지지 않은 화음 갤러리예요. 관리자가 먼저 화음 갤러리를 만들어 주세요.")
    if (channelRecord.pass && pin !== channelRecord.pass) throw new Error("갤러리 코드가 맞지 않아요.")
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
        drawing: payload.drawingBlob || null,
        music: payload.musicBlob,
      },
    }
    await withLocalStore("readwrite", function (store) {
      store.put(record)
    })
    // 같은 작품을 다시 공유했다 — 이 브라우저가 올린 예전 것이면 지운다(서버와 같은 규칙).
    let replaced = false
    const previousId = String(payload.replaceWorkId || "")
    if (previousId && previousId !== record.id) {
      const previous = await getLocalWork(channel, previousId)
      if (previous && previous.ownerId === owner.id) {
        await withLocalStore("readwrite", function (store) {
          store.delete(previousId)
        })
        replaced = true
      }
    }
    return { work: localPublicWork(record), localOnly: true, replaced: replaced }
  }

  async function getLocalWork(channel, workId) {
    return (
      (await withLocalStore("readonly", function (store, setResult) {
        const req = store.get(workId)
        req.onsuccess = function () {
          const record = req.result
          setResult(record && record.channel === channel ? record : null)
        }
      })) || null
    )
  }

  async function copyLocalWork(work, targetChannel, targetPass, sourcePass, owner) {
    const sourceChannel = normalizeChannel(work && work.channel)
    const workId = work && work.id
    if (!sourceChannel || !workId) throw new Error("복사할 작품을 찾지 못했어요.")
    if (!targetChannel) throw new Error("복사할 갤러리 번호를 적어 주세요.")
    if (sourceChannel === targetChannel) throw new Error("다른 갤러리 번호를 적어 주세요.")

    const sourceChannelRecord = await getLocalChannel(sourceChannel)
    if (sourceChannelRecord && sourceChannelRecord.pass && sourcePass !== sourceChannelRecord.pass) {
      throw new Error("원래 갤러리 코드를 다시 확인해 주세요.")
    }
    const targetChannelRecord = await getLocalChannel(targetChannel)
    if (!targetChannelRecord) throw new Error("아직 만들어지지 않은 화음 갤러리예요. 관리자가 먼저 화음 갤러리를 만들어 주세요.")
    if (targetChannelRecord.pass && targetPass !== targetChannelRecord.pass) throw new Error("갤러리 코드가 맞지 않아요.")

    const source = await getLocalWork(sourceChannel, workId)
    if (!source) throw new Error("복사할 작품을 찾지 못했어요.")
    const now = new Date().toISOString()
    const record = {
      id: randomId("local_"),
      channel: targetChannel,
      title: source.title || "무제",
      createdAt: now,
      updatedAt: now,
      ownerId: owner.id,
      metadata: JSON.parse(JSON.stringify(source.metadata || {})),
      recipe: JSON.parse(JSON.stringify(source.recipe || {})),
      files: {
        cover: source.files && source.files.cover,
        thumb: source.files && source.files.thumb,
        drawing: source.files && source.files.drawing ? source.files.drawing : null,
        music: source.files && source.files.music,
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
    const outcome =
      (await withLocalStore("readwrite", function (store, setResult) {
        const req = store.get(work.id)
        req.onsuccess = function () {
          const record = req.result
          if (!record || record.channel !== work.channel) {
            setResult({ found: false, allowed: false })
            return
          }
          const allowed = String(adminPin || "").trim() === LOCAL_ADMIN_PIN
          if (allowed) store.delete(record.id)
          setResult({ found: true, allowed: allowed })
        }
      })) || { found: false, allowed: false }
    if (!outcome.found) throw new Error("이미 삭제되었거나 없는 작품입니다.")
    if (!outcome.allowed) throw new Error("이 작품을 삭제하려면 관리자 공통 코드가 필요해요.")
    releaseObjectUrls(work.id)
    return { ok: true, deleted: work.id, localOnly: true }
  }

  async function deleteLocalChannel(channel, adminPin) {
    const channelRecord = await getLocalChannel(channel)
    if (!channelRecord) throw new Error("삭제할 화음 갤러리를 찾지 못했어요.")
    if (String(adminPin || "").trim() !== LOCAL_ADMIN_PIN) throw new Error("화음 갤러리를 삭제하려면 관리자 공통 코드가 필요해요.")
    const deletedIds =
      (await withLocalStore("readwrite", function (store, setResult, tx) {
        const req = store.getAll()
        req.onsuccess = function () {
          const ids = []
          const records = req.result || []
          records.forEach(function (record) {
            if (record && record.channel === channel) {
              store.delete(record.id)
              ids.push(record.id)
            }
          })
          setResult(ids)
        }
        tx.objectStore(LOCAL_CHANNEL_STORE_NAME).delete(channel)
      }, [LOCAL_STORE_NAME, LOCAL_CHANNEL_STORE_NAME])) || []
    deletedIds.forEach(releaseObjectUrls)
    forgetChannel(channel)
    return { ok: true, deleted: channel, deletedWorks: deletedIds.length, localOnly: true }
  }


  return {
    available: () => !!indexedDb(),
    dispose: () => releaseObjectUrls(),
    claimLocalChannel, publishLocalWork, copyLocalWork, listLocalWorks, deleteLocalWork, deleteLocalChannel,
  }
})
