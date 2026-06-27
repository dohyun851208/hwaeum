const { del, list } = require("@vercel/blob")
const { cleanChannel, hashAdmin, hashOwner, listAll, method, parseJsonBody, readJsonUrl, send } = require("./_utils.cjs")

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST", "DELETE"])) return
  try {
    const body = await parseJsonBody(req)
    const channel = cleanChannel(body.channel)
    const workId = String(body.workId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
    if (!channel || !workId) return send(res, 400, { error: "삭제할 작품을 찾지 못했어요." })

    const prefix = "share/channels/" + channel + "/" + workId + "/"
    const blobs = await listAll(list, { prefix, limit: 100 })
    const metaBlob = blobs.find((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    if (!metaBlob) return send(res, 404, { error: "이미 삭제되었거나 없는 작품입니다." })

    const meta = await readJsonUrl(metaBlob.url)
    const ownerOk = meta && meta.ownerHash && body.ownerKey && meta.ownerHash === hashOwner(body.ownerKey)
    const adminOk = hashAdmin(body.adminPin)
    if (!ownerOk && !adminOk) return send(res, 403, { error: "이 작품을 삭제할 권한이 없어요." })

    const targets = blobs.map((blob) => blob.pathname || blob.url).filter(Boolean)
    if (targets.length) await del(targets)
    send(res, 200, { ok: true, deleted: workId })
  } catch (error) {
    console.error(error)
    const message =
      String(error && error.message).indexOf("BLOB_READ_WRITE_TOKEN") !== -1
        ? "Vercel Blob 저장소가 아직 연결되지 않았어요. BLOB_READ_WRITE_TOKEN을 설정해 주세요."
        : error && error.message
          ? error.message
          : "공유 작품을 삭제하지 못했어요."
    send(res, 500, { error: message })
  }
}
