const crypto = require("crypto")

const ADMIN_PIN = process.env.HWAEUM_ADMIN_PIN || "8624"
const MAX_TITLE_LENGTH = 40
const MAX_TEXT_LENGTH = 220
const MAX_CHANNEL_LENGTH = 6
const MAX_FILE_BYTES = 2.5 * 1024 * 1024
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024

function send(res, status, data) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(data))
}

function method(req, res, allowed) {
  if (allowed.indexOf(req.method) !== -1) return true
  res.setHeader("Allow", allowed.join(", "))
  send(res, 405, { error: "지원하지 않는 요청입니다." })
  return false
}

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function cleanChannel(value) {
  return String(value || "").replace(/\D/g, "").slice(0, MAX_CHANNEL_LENGTH)
}

function safeWorkId() {
  return "w_" + Date.now().toString(36) + "_" + crypto.randomBytes(6).toString("hex")
}

function hashOwner(ownerKey) {
  return crypto.createHash("sha256").update(String(ownerKey || "")).digest("hex")
}

function hashAdmin(pin) {
  return cleanText(pin, 24) === ADMIN_PIN
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return null
  const clone = JSON.parse(JSON.stringify(meta))
  delete clone.ownerHash
  return clone
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body)
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body || "{}"))
    } catch (e) {
      return Promise.reject(new Error("요청 내용을 읽지 못했어요."))
    }
  }
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
      if (raw.length > 6 * 1024 * 1024) {
        reject(new Error("공유 파일이 너무 커요."))
        req.destroy()
      }
    })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(new Error("요청 내용을 읽지 못했어요."))
      }
    })
    req.on("error", reject)
  })
}

function decodeFile(file, fallbackType) {
  if (!file || !file.contentBase64) throw new Error("공유 파일이 빠졌어요.")
  const contentType = cleanText(file.contentType || fallbackType || "application/octet-stream", 80)
  const buffer = Buffer.from(String(file.contentBase64), "base64")
  if (!buffer.length) throw new Error("빈 파일은 공유할 수 없어요.")
  if (buffer.length > MAX_FILE_BYTES) throw new Error("압축 파일 하나가 너무 커요.")
  return { buffer, contentType, size: buffer.length }
}

function metadataFromInput(input) {
  const raw = input && typeof input === "object" ? input : {}
  return {
    title: cleanText(raw.title, MAX_TITLE_LENGTH),
    composerName: cleanText(raw.composerName, 40),
    backgroundReason: cleanText(raw.backgroundReason, MAX_TEXT_LENGTH),
    melodyIntent: cleanText(raw.melodyIntent, MAX_TEXT_LENGTH),
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.map((tag) => cleanText(tag, 24)).filter(Boolean).slice(0, 3) : [],
    atmosphereLabel: cleanText(raw.atmosphereLabel, 40),
    instrumentLabel: cleanText(raw.instrumentLabel, 40),
    duration: Math.max(1, Math.min(120, Number(raw.duration) || 30)),
  }
}

async function listAll(list, options) {
  const out = []
  let cursor
  do {
    const page = await list(Object.assign({}, options, { cursor }))
    out.push.apply(out, page.blobs || [])
    cursor = page.hasMore ? page.cursor : ""
  } while (cursor)
  return out
}

async function readJsonUrl(url) {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("공유 작품 정보를 읽지 못했어요.")
  return response.json()
}

function sharedUrl(req, workId, channel) {
  const proto = req.headers["x-forwarded-proto"] || "https"
  const host = req.headers["x-forwarded-host"] || req.headers.host || ""
  return host ? proto + "://" + host + "/?shareChannel=" + encodeURIComponent(channel) + "#work=" + encodeURIComponent(workId) : ""
}

module.exports = {
  MAX_TOTAL_BYTES,
  cleanChannel,
  cleanText,
  decodeFile,
  hashAdmin,
  hashOwner,
  listAll,
  metadataFromInput,
  method,
  parseJsonBody,
  readJsonUrl,
  safeWorkId,
  sanitizeMeta,
  send,
  sharedUrl,
}
