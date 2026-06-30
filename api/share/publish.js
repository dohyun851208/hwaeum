const { put, list } = require("@vercel/blob")
const {
  MAX_TOTAL_BYTES,
  cleanChannel,
  cleanPin,
  cleanText,
  decodeFile,
  hashOwner,
  hashPass,
  loadChannelMeta,
  metadataFromInput,
  method,
  parseJsonBody,
  readJsonUrl,
  safeWorkId,
  sanitizeMeta,
  send,
  sharedUrl,
} = require("./_utils.cjs")

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return
  try {
    const body = await parseJsonBody(req)
    const channel = cleanChannel(body.channel)
    if (!channel) return send(res, 400, { error: "공유 채널 번호를 적어 주세요." })
    if (!body.ownerKey || !body.ownerId) return send(res, 400, { error: "작품 소유자를 확인하지 못했어요." })

    // 채널은 관리자가 먼저 만들어 둬야 하고, 채널 비밀번호가 맞아야 올릴 수 있다.
    const channelMeta = await loadChannelMeta(list, readJsonUrl, channel)
    // 409로 보낸다(404는 share-store가 'API 없음 → 로컬 폴백' 신호로 쓰므로 충돌 방지).
    if (!channelMeta) return send(res, 409, { error: "아직 만들어지지 않은 채널이에요. 관리자가 먼저 채널을 만들어 주세요." })
    if (channelMeta.passHash && hashPass(channel, cleanPin(body.pass)) !== channelMeta.passHash) {
      return send(res, 403, { error: "채널 비밀번호가 맞지 않아요." })
    }

    const files = body.files || {}
    const cover = decodeFile(files.cover, "image/webp")
    const thumb = decodeFile(files.thumb, "image/webp")
    const music = decodeFile(files.music, "audio/webm")
    const totalBytes = cover.size + thumb.size + music.size
    if (totalBytes > MAX_TOTAL_BYTES) return send(res, 413, { error: "압축 후에도 파일이 커요. 그림이나 배경음을 더 작게 줄여 주세요." })

    const id = safeWorkId()
    const base = "share/channels/" + channel + "/" + id + "/"
    const putOptions = { access: "public", addRandomSuffix: false }
    const coverBlob = await put(base + "cover.webp", cover.buffer, Object.assign({}, putOptions, { contentType: cover.contentType }))
    const thumbBlob = await put(base + "thumb.webp", thumb.buffer, Object.assign({}, putOptions, { contentType: thumb.contentType }))
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
        musicUrl: musicBlob.url,
        musicPathname: musicBlob.pathname,
        musicType: music.contentType,
        coverBytes: cover.size,
        thumbBytes: thumb.size,
        musicBytes: music.size,
        totalBytes,
      },
      shareUrl: sharedUrl(req, id, channel),
      schemaVersion: 1,
    }
    const metaBlob = await put(base + "meta.json", JSON.stringify(meta), Object.assign({}, putOptions, { contentType: "application/json; charset=utf-8" }))
    meta.files.metaUrl = metaBlob.url
    meta.files.metaPathname = metaBlob.pathname
    await put(base + "meta.json", JSON.stringify(meta), Object.assign({}, putOptions, { contentType: "application/json; charset=utf-8", allowOverwrite: true }))

    send(res, 200, { work: sanitizeMeta(meta) })
  } catch (error) {
    console.error(error)
    const message =
      String(error && error.message).indexOf("BLOB_READ_WRITE_TOKEN") !== -1
        ? "Vercel Blob 저장소가 아직 연결되지 않았어요. BLOB_READ_WRITE_TOKEN을 설정해 주세요."
        : error && error.message
          ? error.message
          : "공유 업로드에 실패했어요."
    send(res, 500, { error: message })
  }
}
