const { list } = require("@vercel/blob")
const { cleanChannel, cleanPin, hashPass, listAll, listedMeta, loadChannelMeta, method, readJsonUrl, sanitizeChannelMeta, send, sendError } = require("./_utils.cjs")

// 작품 정보는 여러 개를 함께 읽는다(하나씩 읽으면 작품이 많은 갤러리가 느리게 열렸다).
const READ_CONCURRENCY = 8

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return
  try {
    const query = req.query || Object.fromEntries(new URL(req.url || "/", "http://localhost").searchParams.entries())
    const channel = cleanChannel(query.channel || "")
    if (!channel) return send(res, 400, { error: "번호를 적어 주세요." })

    // 화음 갤러리가 코드로 잠겨 있으면 코드가 맞아야 작품 목록을 내준다.
    const channelMeta = await loadChannelMeta(list, readJsonUrl, channel)
    if (channelMeta && channelMeta.passHash) {
      const pass = cleanPin(query.pass || "")
      const passOk = !!pass && hashPass(channel, pass) === channelMeta.passHash
      if (!passOk) {
        return send(res, 200, {
          channel: sanitizeChannelMeta(channelMeta),
          locked: true,
          passError: !!pass,
          works: [],
        })
      }
    }

    const prefix = "share/channels/" + channel + "/"
    const blobs = await listAll(list, { prefix, limit: 1000 })
    const metas = blobs.filter((blob) => /\/meta\.json$/.test(blob.pathname || ""))
    const works = []
    for (let start = 0; start < metas.length; start += READ_CONCURRENCY) {
      const batch = await Promise.all(
        metas.slice(start, start + READ_CONCURRENCY).map(async (blob) => {
          try {
            const meta = await readJsonUrl(blob.url)
            return meta && meta.channel === channel ? listedMeta(meta) : null
          } catch (error) {
            console.warn("skip broken shared work", blob.pathname, error && error.message)
            return null
          }
        }),
      )
      batch.forEach((meta) => {
        if (meta) works.push(meta)
      })
    }
    works.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    send(res, 200, { channel: sanitizeChannelMeta(channelMeta), locked: false, works })
  } catch (error) {
    sendError(res, error, "화음 갤러리를 불러오지 못했어요.")
  }
}
