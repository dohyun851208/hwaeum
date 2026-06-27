const { list } = require("@vercel/blob")
const { cleanChannel, listAll, method, readJsonUrl, sanitizeMeta, send } = require("./_utils.cjs")

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return
  try {
    const query = req.query || Object.fromEntries(new URL(req.url || "/", "http://localhost").searchParams.entries())
    const channel = cleanChannel(query.channel || "")
    if (!channel) return send(res, 400, { error: "공유 채널 번호를 적어 주세요." })
    const prefix = "share/channels/" + channel + "/"
    const blobs = await listAll(list, { prefix, limit: 1000 })
    const metas = blobs.filter((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    const works = []
    for (const blob of metas) {
      try {
        const meta = await readJsonUrl(blob.url)
        if (meta && meta.channel === channel) works.push(sanitizeMeta(meta))
      } catch (error) {
        console.warn("skip broken shared work", blob.pathname, error && error.message)
      }
    }
    works.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    send(res, 200, { channel, works })
  } catch (error) {
    console.error(error)
    const message =
      String(error && error.message).indexOf("BLOB_READ_WRITE_TOKEN") !== -1
        ? "Vercel Blob 저장소가 아직 연결되지 않았어요. BLOB_READ_WRITE_TOKEN을 설정해 주세요."
        : error && error.message
          ? error.message
          : "공유 채널을 불러오지 못했어요."
    send(res, 500, { error: message })
  }
}
