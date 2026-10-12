const { put, list } = require("@vercel/blob")
const {
  MAX_TOTAL_BYTES,
  cleanChannel,
  cleanPin,
  cleanText,
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

function cleanWorkId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80)
}

async function fetchFile(url, fallbackType) {
  if (!url) return null
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("복사할 작품 파일을 읽지 못했어요.")
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error("복사할 작품 파일이 비어 있어요.")
  return {
    buffer,
    contentType: cleanText(response.headers.get("content-type") || fallbackType || "application/octet-stream", 80),
    size: buffer.length,
  }
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return
  try {
    const body = await parseJsonBody(req)
    const sourceChannel = cleanChannel(body.sourceChannel)
    const targetChannel = cleanChannel(body.targetChannel)
    const workId = cleanWorkId(body.workId)
    if (!sourceChannel || !targetChannel || !workId) return send(res, 400, { error: "복사할 작품과 갤러리 번호를 확인해 주세요." })
    if (sourceChannel === targetChannel) return send(res, 400, { error: "다른 갤러리 번호를 적어 주세요." })
    if (!body.ownerKey || !body.ownerId) return send(res, 400, { error: "작품 소유자를 확인하지 못했어요." })

    const sourceChannelMeta = await loadChannelMeta(list, readJsonUrl, sourceChannel)
    if (sourceChannelMeta && sourceChannelMeta.passHash && hashPass(sourceChannel, cleanPin(body.sourcePass)) !== sourceChannelMeta.passHash) {
      return send(res, 403, { error: "원래 갤러리 코드를 다시 확인해 주세요." })
    }

    const targetChannelMeta = await loadChannelMeta(list, readJsonUrl, targetChannel)
    if (!targetChannelMeta) return send(res, 409, { error: "아직 만들어지지 않은 화음 갤러리예요. 관리자가 먼저 화음 갤러리를 만들어 주세요." })
    if (targetChannelMeta.passHash && hashPass(targetChannel, cleanPin(body.pass)) !== targetChannelMeta.passHash) {
      return send(res, 403, { error: "갤러리 코드가 맞지 않아요." })
    }

    const sourcePrefix = "share/channels/" + sourceChannel + "/" + workId + "/"
    const sourceBlobs = await listAll(list, { prefix: sourcePrefix, limit: 100 })
    const sourceMetaBlob = sourceBlobs.find((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    if (!sourceMetaBlob) return send(res, 404, { error: "복사할 작품을 찾지 못했어요." })

    const sourceMeta = await readJsonUrl(sourceMetaBlob.url)
    if (!sourceMeta || sourceMeta.channel !== sourceChannel || sourceMeta.id !== workId) return send(res, 404, { error: "복사할 작품을 찾지 못했어요." })

    const sourceFiles = sourceMeta.files || {}
    const cover = await fetchFile(sourceFiles.coverUrl, "image/webp")
    const thumb = await fetchFile(sourceFiles.thumbUrl || sourceFiles.coverUrl, "image/webp")
    const drawing = sourceFiles.drawingUrl ? await fetchFile(sourceFiles.drawingUrl, "image/webp") : null
    const music = await fetchFile(sourceFiles.musicUrl, sourceFiles.musicType || "audio/webm")
    if (!cover || !thumb || !music) return send(res, 400, { error: "복사할 작품 파일이 부족해요." })
    const totalBytes = cover.size + thumb.size + (drawing ? drawing.size : 0) + music.size
    if (totalBytes > MAX_TOTAL_BYTES) return send(res, 413, { error: "복사할 작품 파일이 너무 커요." })

    const id = safeWorkId()
    const base = "share/channels/" + targetChannel + "/" + id + "/"
    const putOptions = { access: "public", addRandomSuffix: false }
    const coverBlob = await put(base + "cover.webp", cover.buffer, Object.assign({}, putOptions, { contentType: cover.contentType }))
    const thumbBlob = await put(base + "thumb.webp", thumb.buffer, Object.assign({}, putOptions, { contentType: thumb.contentType }))
    const drawingBlob = drawing ? await put(base + "drawing.webp", drawing.buffer, Object.assign({}, putOptions, { contentType: drawing.contentType })) : null
    const musicBlob = await put(base + "music.webm", music.buffer, Object.assign({}, putOptions, { contentType: music.contentType }))

    const metadata = metadataFromInput(Object.assign({}, sourceMeta.metadata, { title: sourceMeta.title || (sourceMeta.metadata && sourceMeta.metadata.title) }))
    const now = new Date().toISOString()
    const meta = {
      id,
      channel: targetChannel,
      title: cleanText(sourceMeta.title || metadata.title || "무제", 40) || "무제",
      createdAt: now,
      updatedAt: now,
      ownerId: cleanText(body.ownerId, 40),
      ownerHash: hashOwner(body.ownerKey),
      metadata,
      recipe: sourceMeta.recipe || {},
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
      shareUrl: sharedUrl(req, id, targetChannel),
      schemaVersion: 1,
    }
    const metaBlob = await put(base + "meta.json", JSON.stringify(meta), Object.assign({}, putOptions, { contentType: "application/json; charset=utf-8" }))
    meta.files.metaUrl = metaBlob.url
    meta.files.metaPathname = metaBlob.pathname

    send(res, 200, { work: sanitizeMeta(meta) })
  } catch (error) {
    sendError(res, error, "공유 작품을 복사하지 못했어요.")
  }
}
