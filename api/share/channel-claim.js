const { put, list } = require("@vercel/blob")
const {
  channelMetaPathname,
  cleanChannel,
  cleanPin,
  cleanText,
  hashAdmin,
  hashOwner,
  hashPass,
  loadChannelMeta,
  method,
  parseJsonBody,
  readJsonUrl,
  sanitizeChannelMeta,
  send,
} = require("./_utils.cjs")

const MIN_PIN_LENGTH = 4

// 관리자(8624)가 채널을 만들고 점유한다. 이미 다른 선생님이 점유한 채널은 거절한다.
// 같은 선생님(ownerKey 일치)이면 표시 명칭·2차 비밀번호를 고칠 수 있다.
module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return
  try {
    const body = await parseJsonBody(req)
    const channel = cleanChannel(body.channel)
    if (!channel) return send(res, 400, { error: "공유 채널 번호를 적어 주세요." })
    if (!hashAdmin(body.adminPin)) return send(res, 403, { error: "채널을 만들려면 관리자 PIN이 필요해요." })
    if (!body.ownerKey) return send(res, 400, { error: "선생님 정보를 확인하지 못했어요." })

    const pass = cleanPin(body.pass)
    if (pass.length < MIN_PIN_LENGTH) return send(res, 400, { error: "2차 비밀번호는 숫자 " + MIN_PIN_LENGTH + "자리 이상으로 정해 주세요." })

    const displayName = cleanText(body.displayName, 40)
    const ownerHash = hashOwner(body.ownerKey)
    const existing = await loadChannelMeta(list, readJsonUrl, channel)
    if (existing && existing.ownerHash && existing.ownerHash !== ownerHash) {
      return send(res, 403, { error: "이미 다른 선생님이 점유한 채널이에요. 다른 번호를 써 주세요." })
    }

    const now = new Date().toISOString()
    const meta = {
      channel,
      displayName: displayName || (existing && existing.displayName) || "",
      ownerHash,
      passHash: hashPass(channel, pass),
      createdAt: (existing && existing.createdAt) || now,
      updatedAt: now,
      schemaVersion: 1,
    }
    await put(channelMetaPathname(channel), JSON.stringify(meta), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
    })

    send(res, 200, { channel: sanitizeChannelMeta(meta), claimed: !existing })
  } catch (error) {
    console.error(error)
    const message =
      String(error && error.message).indexOf("BLOB_READ_WRITE_TOKEN") !== -1
        ? "Vercel Blob 저장소가 아직 연결되지 않았어요. BLOB_READ_WRITE_TOKEN을 설정해 주세요."
        : (error && error.message) || "채널을 만들지 못했어요."
    send(res, 500, { error: message })
  }
}
