const { list } = require("@vercel/blob")
const { cleanChannel, cleanPin, hashPass, listAll, loadChannelMeta, method, readJsonUrl, sanitizeMeta, send, sendError } = require("./_utils.cjs")

// 작품 하나의 전체 정보(그림이 든 레시피까지)를 돌려준다. 갤러리 목록은 그림을 빼고 가볍게 보내므로
// "스튜디오에서 보기"처럼 원래 그림이 필요할 때만 이걸 읽는다. 잠긴 갤러리는 코드가 맞아야 한다.
module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return
  try {
    const query = req.query || Object.fromEntries(new URL(req.url || "/", "http://localhost").searchParams.entries())
    const channel = cleanChannel(query.channel || "")
    const workId = String(query.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
    if (!channel || !workId) return send(res, 400, { error: "작품을 찾지 못했어요." })

    const channelMeta = await loadChannelMeta(list, readJsonUrl, channel)
    if (channelMeta && channelMeta.passHash) {
      const pass = cleanPin(query.pass || "")
      if (!pass || hashPass(channel, pass) !== channelMeta.passHash) return send(res, 403, { error: "갤러리 코드가 맞지 않아요." })
    }

    const prefix = "share/channels/" + channel + "/" + workId + "/"
    const blobs = await listAll(list, { prefix, limit: 20 })
    const metaBlob = blobs.find((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    if (!metaBlob) return send(res, 404, { error: "이미 삭제되었거나 없는 작품이에요." })
    const meta = await readJsonUrl(metaBlob.url)
    if (!meta || meta.channel !== channel) return send(res, 404, { error: "이미 삭제되었거나 없는 작품이에요." })
    send(res, 200, { work: sanitizeMeta(meta) })
  } catch (error) {
    sendError(res, error, "작품 정보를 읽지 못했어요.")
  }
}
