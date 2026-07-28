const { del, list } = require("@vercel/blob")
const { cleanChannel, hashAdmin, listAll, loadChannelMeta, method, parseJsonBody, readJsonUrl, send } = require("./_utils.cjs")

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST", "DELETE"])) return
  try {
    const body = await parseJsonBody(req)
    const channel = cleanChannel(body.channel)
    if (!channel) return send(res, 400, { error: "삭제할 번호를 적어 주세요." })
    if (!hashAdmin(body.adminPin)) return send(res, 403, { error: "화음 갤러리를 삭제하려면 관리자 공통 코드가 필요해요." })

    const channelMeta = await loadChannelMeta(list, readJsonUrl, channel)
    if (!channelMeta) return send(res, 404, { error: "삭제할 화음 갤러리를 찾지 못했어요." })

    const prefix = "share/channels/" + channel + "/"
    const blobs = await listAll(list, { prefix, limit: 1000 })
    const targets = blobs.map((blob) => blob.pathname || blob.url).filter(Boolean)
    if (targets.length) await del(targets)
    send(res, 200, { ok: true, deleted: channel, deletedCount: targets.length })
  } catch (error) {
    console.error(error)
    const message =
      String(error && error.message).indexOf("BLOB_READ_WRITE_TOKEN") !== -1
        ? "Vercel Blob 저장소가 아직 연결되지 않았어요. BLOB_READ_WRITE_TOKEN을 설정해 주세요."
        : error && error.message
          ? error.message
          : "화음 갤러리를 삭제하지 못했어요."
    send(res, 500, { error: message })
  }
}
