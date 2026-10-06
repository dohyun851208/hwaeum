const { put, list, del } = require("@vercel/blob")
const {
  MAX_TOTAL_BYTES,
  cleanChannel,
  cleanPin,
  cleanText,
  decodeFile,
  hashOwner,
  hashPass,
  listAll,
  loadChannelMeta,
  metadataFromInput,
  method,
  parseJsonBody,
  readJsonUrl,
  safeWorkId,
  sanitizeMeta,
  send,
  sharedUrl,
  sendError,
} = require("./_utils.cjs")

// 같은 학생(같은 브라우저)이 같은 작품을 같은 갤러리에 다시 공유하면 예전 것을 지운다 — 다시 공유할 때마다
// 새 작품으로 쌓이고 학생은 지울 수 없었다. 소유자가 다르면 아무것도 지우지 않는다(남의 작품 보호).
async function removeReplacedWork(channel, replaceWorkId, ownerHash, newId) {
  const workId = String(replaceWorkId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
  if (!workId || workId === newId || !ownerHash) return false
  try {
    const prefix = "share/channels/" + channel + "/" + workId + "/"
    const blobs = await listAll(list, { prefix, limit: 100 })
    const metaBlob = blobs.find((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    if (!metaBlob) return false
    const previous = await readJsonUrl(metaBlob.url)
    if (!previous || previous.channel !== channel || previous.ownerHash !== ownerHash) return false
    const targets = blobs.map((blob) => blob.pathname || blob.url).filter(Boolean)
    if (targets.length) await del(targets)
    return true
  } catch (error) {
    console.warn("could not replace previous share", workId, error && error.message)
    return false
  }
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return
  try {
    const body = await parseJsonBody(req)
    const channel = cleanChannel(body.channel)
    if (!channel) return send(res, 400, { error: "번호를 적어 주세요." })
    if (!body.ownerKey || !body.ownerId) return send(res, 400, { error: "작품 소유자를 확인하지 못했어요." })

    // 화음 갤러리는 관리자가 먼저 만들어 둬야 하고, 갤러리 코드가 맞아야 올릴 수 있다.
    const channelMeta = await loadChannelMeta(list, readJsonUrl, channel)
    // 409로 보낸다(404는 share-store가 'API 없음 → 로컬 폴백' 신호로 쓰므로 충돌 방지).
    if (!channelMeta) return send(res, 409, { error: "아직 만들어지지 않은 화음 갤러리예요. 관리자가 먼저 화음 갤러리를 만들어 주세요." })
    if (channelMeta.passHash && hashPass(channel, cleanPin(body.pass)) !== channelMeta.passHash) {
      return send(res, 403, { error: "갤러리 코드가 맞지 않아요." })
    }

    const files = body.files || {}
    const cover = decodeFile(files.cover, "image/webp")
    const thumb = decodeFile(files.thumb, "image/webp")
    const drawing = files.drawing ? decodeFile(files.drawing, "image/webp") : null
    const music = decodeFile(files.music, "audio/webm")
    const totalBytes = cover.size + thumb.size + (drawing ? drawing.size : 0) + music.size
    if (totalBytes > MAX_TOTAL_BYTES) return send(res, 413, { error: "압축 후에도 파일이 커요. 그림이나 배경음을 더 작게 줄여 주세요." })

    const id = safeWorkId()
    const base = "share/channels/" + channel + "/" + id + "/"
    const putOptions = { access: "public", addRandomSuffix: false }
    const coverBlob = await put(base + "cover.webp", cover.buffer, Object.assign({}, putOptions, { contentType: cover.contentType }))
    const thumbBlob = await put(base + "thumb.webp", thumb.buffer, Object.assign({}, putOptions, { contentType: thumb.contentType }))
    const drawingBlob = drawing ? await put(base + "drawing.webp", drawing.buffer, Object.assign({}, putOptions, { contentType: drawing.contentType })) : null
    const musicBlob = await put(base + "music.webm", music.buffer, Object.assign({}, putOptions, { contentType: music.contentType }))

    const metadata = metadataFromInput(Object.assign({}, body.metadata, { title: body.title || (body.metadata && body.metadata.title) }))
    const now = new Date().toISOString()
    const meta = {
      id,
      channel,
      title: cleanText(body.title || metadata.title || "무제", 40) || "무제",
      createdAt: now,
      updatedAt: now,
      ownerId: cleanText(body.ownerId, 40),
      ownerHash: hashOwner(body.ownerKey),
      metadata,
      recipe: body.recipe || {},
      files: {
        coverUrl: coverBlob.url,
        coverPathname: coverBlob.pathname,
        thumbUrl: thumbBlob.url,
        thumbPathname: thumbBlob.pathname,
        drawingUrl: drawingBlob ? drawingBlob.url : "",
        drawingPathname: drawingBlob ? drawingBlob.pathname : "",
        musicUrl: musicBlob.url,
        musicPathname: musicBlob.pathname,
        musicType: music.contentType,
        coverBytes: cover.size,
        thumbBytes: thumb.size,
        drawingBytes: drawing ? drawing.size : 0,
        musicBytes: music.size,
        totalBytes,
        metaUrl: "",
        metaPathname: base + "meta.json",
      },
      shareUrl: sharedUrl(req, id, channel),
      schemaVersion: 1,
    }
    const metaBlob = await put(base + "meta.json", JSON.stringify(meta), Object.assign({}, putOptions, { contentType: "application/json; charset=utf-8" }))
    meta.files.metaUrl = metaBlob.url
    meta.files.metaPathname = metaBlob.pathname

    const replaced = await removeReplacedWork(channel, body.replaceWorkId, meta.ownerHash, id)
    send(res, 200, { work: sanitizeMeta(meta), replaced })
  } catch (error) {
    sendError(res, error, "공유 업로드에 실패했어요.")
  }
}
