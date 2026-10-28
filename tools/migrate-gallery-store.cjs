/*
 * migrate-gallery-store.cjs — 정지됐던 옛 갤러리 저장소의 작품을 새 저장소로 옮기기
 *
 * 2026-10-26 옛 저장소(hwaeum-gallery2)가 무료 한도를 넘어 정지되어 새 저장소로 바꿨다
 * (docs/decisions/2026-10-27-gallery-storage-outage.md). 옛 파일은 지워지지 않았고, 정지가 풀리면
 * (지원 요청 CSE_01smh5t2gIqUHj3y 또는 30일 뒤) 공개 주소로 다시 읽힌다. 열려 있는 동안 먼저 이 PC에 받아 두고,
 * 그다음 새 저장소로 올린다.
 *
 * 실행:
 *   node tools/migrate-gallery-store.cjs backup <목록.json> <백업 폴더>
 *       목록(output/transfer-20261027/blob-manifest-before.json)의 파일을 공개 주소에서 받아 폴더에 경로 그대로 둔다.
 *       이미 받은 파일(크기 같음)은 건너뛰므로 끊겨도 다시 돌리면 이어진다. 아직 막혀 있으면 첫 파일에서 멈춘다.
 *   node tools/migrate-gallery-store.cjs upload <백업 폴더>           무엇을 옮길지 보여 주기만 한다
 *   node tools/migrate-gallery-store.cjs upload <백업 폴더> --write   실제로 새 저장소에 올린다
 *       새 저장소 토큰은 환경 변수 NEW_BLOB_READ_WRITE_TOKEN(Vercel 대시보드의 새 저장소 화면 → .env.local)에 둔다.
 *
 * 경로는 옛 저장소와 같게 올린다. 작품마다 표지·썸네일·그림·음악을 먼저 올리고 meta.json을 마지막에 올린다 —
 * 갤러리는 meta.json이 있는 작품만 보여 주므로 반쯤 옮겨진 작품이 보이지 않는다. meta.json 속 파일 주소는
 * 저장소 주소 앞부분만 새 저장소로 바꾼다. 새 저장소에 이미 있는 파일은 다시 올리지 않고, 아무것도 지우지 않는다.
 */
const fs = require("fs")
const path = require("path")

const DOWNLOAD_CONCURRENCY = 6
const CONTENT_TYPES = { ".json": "application/json; charset=utf-8", ".webp": "image/webp", ".webm": "audio/webm" }

function blockedError() {
  const error = new Error("옛 저장소가 아직 막혀 있어요(403 Your store is blocked). 정지가 풀린 뒤 다시 돌려 주세요.")
  error.code = "OLD_STORE_BLOCKED"
  return error
}

function localPath(dir, pathname) {
  return path.join(dir, ...pathname.split("/"))
}

async function forEachLimit(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

// 1단계 — 목록의 파일을 받아 <폴더>/<경로>에 두고, 경로·크기·형식을 index.json에 남긴다.
async function backup(manifest, dir, { fetchImpl = fetch, log = console.log } = {}) {
  const blobs = manifest.blobs || manifest
  if (!blobs.length) throw new Error("목록에 파일이 없어요.")
  const indexFile = path.join(dir, "index.json")
  const previous = new Map()
  if (fs.existsSync(indexFile)) JSON.parse(fs.readFileSync(indexFile, "utf8")).files.forEach((f) => previous.set(f.pathname, f))
  const files = new Map()
  let downloaded = 0
  let skipped = 0

  async function fetchOne(blob) {
    const file = localPath(dir, blob.pathname)
    if (fs.existsSync(file) && fs.statSync(file).size === blob.size && previous.has(blob.pathname)) {
      files.set(blob.pathname, previous.get(blob.pathname))
      skipped += 1
      return
    }
    const response = await fetchImpl(blob.url, { cache: "no-store" })
    if (!response.ok) {
      if (response.status === 403 && /your store is blocked/i.test(await response.text())) throw blockedError()
      throw new Error(blob.pathname + " 받기 실패: HTTP " + response.status)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length !== blob.size) throw new Error(blob.pathname + " 크기가 달라요: " + buffer.length + " ≠ " + blob.size)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, buffer)
    const contentType = response.headers.get("content-type") || CONTENT_TYPES[path.extname(blob.pathname)] || "application/octet-stream"
    files.set(blob.pathname, { pathname: blob.pathname, size: blob.size, contentType })
    downloaded += 1
  }

  // 막혀 있으면 930번 실패하지 않게 첫 파일로 먼저 확인한다.
  await fetchOne(blobs[0])
  await forEachLimit(blobs.slice(1), DOWNLOAD_CONCURRENCY, fetchOne)
  const sourceOrigin = new URL(blobs[0].url).origin
  const ordered = blobs.map((blob) => files.get(blob.pathname))
  fs.writeFileSync(indexFile, JSON.stringify({ sourceOrigin, at: new Date().toISOString(), files: ordered }, null, 2))
  log(`백업 끝: 새로 받음 ${downloaded} · 이미 있음 ${skipped} · 모두 ${ordered.length}개 → ${dir}`)
  return { downloaded, skipped, total: ordered.length }
}

// share/channels/<번호>/channel.json 과 share/channels/<번호>/<작품>/<파일> 을 갤러리·작품 단위로 묶는다.
function groupByChannel(files) {
  const channels = new Map()
  for (const file of files) {
    const parts = file.pathname.split("/")
    if (parts[0] !== "share" || parts[1] !== "channels" || parts.length < 4) continue
    const id = parts[2]
    if (!channels.has(id)) channels.set(id, { channel: id, channelFile: null, works: new Map() })
    const channel = channels.get(id)
    if (parts.length === 4 && parts[3] === "channel.json") channel.channelFile = file
    else if (parts.length === 5) {
      if (!channel.works.has(parts[3])) channel.works.set(parts[3], { id: parts[3], meta: null, media: [] })
      const work = channel.works.get(parts[3])
      if (parts[4] === "meta.json") work.meta = file
      else work.media.push(file)
    }
  }
  return [...channels.values()].map((channel) => Object.assign(channel, { works: [...channel.works.values()] }))
}

// meta.json 속 옛 저장소 주소를 새 저장소 주소로 바꾼다. 경로가 같으므로 앞부분(origin)만 바꾸면 된다.
function rewriteOrigin(text, oldOrigin, newOrigin) {
  return text.split(oldOrigin + "/").join(newOrigin + "/")
}

// 새 저장소에 같은 번호의 갤러리가 이미 있을 때(정지 뒤 선생님이 다시 만든 경우) 옛 갤러리를 어떻게 할지 정한다.
//   oldMeta, newMeta: channel.json 내용 { channel, displayName, ownerHash, passHash, createdAt, updatedAt }
//   ownerHash가 같으면 같은 브라우저에서 만든 것(같은 선생님일 가능성이 큼), passHash가 같으면 같은 갤러리 코드다.
// 돌려줄 값:
//   "merge"   — 새로 만든 갤러리 정보(이름·코드·주인)는 그대로 두고, 옛 작품만 그 안에 넣는다
//   "restore" — 옛 갤러리 정보로 되돌리고 옛 작품을 넣는다(새로 올린 작품도 남지만 코드가 옛 코드로 바뀐다)
//   "skip"    — 이 번호는 옮기지 않고 보고만 한다(사람이 나중에 정함)
// 2026-10-28 사용자 결정: 같은 선생님이 다시 만들었으면 합치고, 다른 선생님일 수 있으면 건너뛴다(남의 반에 작품이 보이지 않게).
// 갤러리 코드 해시는 번호를 소금으로 치므로, 같은 번호에 같은 코드를 정했으면 해시가 같다.
function decideChannelConflict(oldMeta, newMeta) {
  const sameOwner = !!oldMeta.ownerHash && oldMeta.ownerHash === newMeta.ownerHash
  const samePass = !!oldMeta.passHash && oldMeta.passHash === newMeta.passHash
  return sameOwner || samePass ? "merge" : "skip"
}

// 2단계 — 백업 폴더를 새 저장소로 올린다. write가 false면 계획만 돌려준다.
async function upload(dir, { list, put, fetchImpl = fetch, write = false, decide = decideChannelConflict, log = console.log }) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
  const existing = new Map()
  let cursor
  do {
    const page = await list({ prefix: "share/", limit: 1000, cursor })
    page.blobs.forEach((blob) => existing.set(blob.pathname, blob.url))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  let newOrigin = existing.size ? new URL(existing.values().next().value).origin : null

  async function putFile(file, body, allowOverwrite) {
    const result = await put(file.pathname, body, { access: "public", addRandomSuffix: false, allowOverwrite: !!allowOverwrite, contentType: file.contentType })
    newOrigin = new URL(result.url).origin
    existing.set(file.pathname, result.url)
  }

  const report = []
  for (const channel of groupByChannel(index.files)) {
    const entry = { channel: channel.channel, works: channel.works.length, decision: "create", uploaded: 0 }
    report.push(entry)
    if (!channel.channelFile) {
      entry.decision = "skip"
      entry.reason = "옛 갤러리 정보(channel.json)가 없음"
      continue
    }
    const oldMeta = JSON.parse(fs.readFileSync(localPath(dir, channel.channelFile.pathname), "utf8"))
    if (existing.has(channel.channelFile.pathname)) {
      const response = await fetchImpl(existing.get(channel.channelFile.pathname), { cache: "no-store" })
      if (!response.ok) throw new Error(channel.channel + "번 새 갤러리 정보를 읽지 못했어요: HTTP " + response.status)
      entry.decision = decide(oldMeta, await response.json())
      if (!["merge", "restore", "skip"].includes(entry.decision)) throw new Error("알 수 없는 결정: " + entry.decision)
    }
    if (!write || entry.decision === "skip") continue

    if (entry.decision !== "merge") {
      await putFile(channel.channelFile, fs.readFileSync(localPath(dir, channel.channelFile.pathname)), entry.decision === "restore")
    }
    for (const work of channel.works) {
      if (!work.meta || existing.has(work.meta.pathname)) continue
      for (const file of work.media) {
        if (!existing.has(file.pathname)) await putFile(file, fs.readFileSync(localPath(dir, file.pathname)))
      }
      if (!newOrigin) throw new Error("새 저장소 주소를 알 수 없어요.")
      const text = rewriteOrigin(fs.readFileSync(localPath(dir, work.meta.pathname), "utf8"), index.sourceOrigin, newOrigin)
      await putFile(work.meta, text)
      entry.uploaded += 1
    }
  }

  for (const entry of report) {
    log(`${entry.channel}번 · 작품 ${entry.works}개 · ${entry.decision}${entry.reason ? " (" + entry.reason + ")" : ""}${write ? " · 올림 " + entry.uploaded : ""}`)
  }
  if (!write) log("미리 보기만 했어요. 실제로 올리려면 --write 를 붙여 주세요.")
  return report
}

async function main(argv) {
  const [command, first, second] = argv
  if (command === "backup" && first && second) {
    const manifest = JSON.parse(fs.readFileSync(first, "utf8"))
    return backup(manifest, second)
  }
  if (command === "upload" && first) {
    const token = process.env.NEW_BLOB_READ_WRITE_TOKEN
    if (!token) throw new Error("환경 변수 NEW_BLOB_READ_WRITE_TOKEN 에 새 저장소 토큰을 넣어 주세요.")
    const blob = require("@vercel/blob")
    return upload(first, {
      list: (options) => blob.list(Object.assign({ token }, options)),
      put: (pathname, body, options) => blob.put(pathname, body, Object.assign({ token }, options)),
      write: argv.includes("--write"),
    })
  }
  throw new Error("사용법: backup <목록.json> <백업 폴더> | upload <백업 폴더> [--write]")
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { backup, upload, groupByChannel, rewriteOrigin, decideChannelConflict }
