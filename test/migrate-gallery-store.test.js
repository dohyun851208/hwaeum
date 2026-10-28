const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { backup, upload, groupByChannel, rewriteOrigin, decideChannelConflict } = require("../tools/migrate-gallery-store.cjs")

const OLD = "https://old.public.blob.vercel-storage.com"
const NEW = "https://new.public.blob.vercel-storage.com"

function workMeta(id, channel) {
  return JSON.stringify({
    id,
    channel,
    title: "봄",
    files: { coverUrl: `${OLD}/share/channels/${channel}/${id}/cover.webp`, musicUrl: `${OLD}/share/channels/${channel}/${id}/music.webm`, metaUrl: "" },
    shareUrl: `https://hwaeum.vercel.app/channel.html?channel=${channel}&work=${id}`,
  })
}

// 옛 저장소: 1000번(작품 하나) + 502번(작품 없음)
const SOURCE = {
  "share/channels/1000/channel.json": JSON.stringify({ channel: "1000", ownerHash: "old-owner", passHash: "old-pass" }),
  "share/channels/1000/w_a/cover.webp": "COVER",
  "share/channels/1000/w_a/music.webm": "MUSIC",
  "share/channels/1000/w_a/meta.json": workMeta("w_a", "1000"),
  "share/channels/502/channel.json": JSON.stringify({ channel: "502", ownerHash: "o2", passHash: "p2" }),
}
const manifest = { blobs: Object.entries(SOURCE).map(([pathname, body]) => ({ pathname, url: `${OLD}/${pathname}`, size: Buffer.byteLength(body) })) }

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwaeum-migrate-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function sourceFetch(calls) {
  return async (url) => {
    calls.push(url)
    const body = SOURCE[url.slice(OLD.length + 1)]
    return new Response(body, { status: body === undefined ? 404 : 200 })
  }
}

async function backedUp(t) {
  const dir = tempDir(t)
  await backup(manifest, dir, { fetchImpl: sourceFetch([]), log() {} })
  return dir
}

function newStore(initial = {}) {
  const files = new Map(Object.entries(initial))
  const puts = []
  return {
    puts,
    files,
    list: async ({ prefix }) => ({ blobs: [...files.keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, url: `${NEW}/${pathname}` })), hasMore: false }),
    put: async (pathname, body, options) => {
      if (files.has(pathname) && !options.allowOverwrite) throw new Error("already exists: " + pathname)
      files.set(pathname, String(body))
      puts.push({ pathname, body: String(body), options })
      return { pathname, url: `${NEW}/${pathname}` }
    },
    fetchImpl: async (url) => new Response(files.get(url.slice(NEW.length + 1))),
  }
}

test("a still-blocked old store stops at the first file without saving anything", async (t) => {
  const dir = tempDir(t)
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return new Response("Your store is blocked\n", { status: 403 })
  }
  await assert.rejects(() => backup(manifest, dir, { fetchImpl, log() {} }), { code: "OLD_STORE_BLOCKED" })
  assert.equal(calls.length, 1)
  assert.deepEqual(fs.readdirSync(dir), [])
})

test("backup keeps every file at its path and resumes without downloading again", async (t) => {
  const dir = tempDir(t)
  const first = []
  const result = await backup(manifest, dir, { fetchImpl: sourceFetch(first), log() {} })
  assert.equal(result.downloaded, 5)
  assert.equal(fs.readFileSync(path.join(dir, "share", "channels", "1000", "w_a", "music.webm"), "utf8"), "MUSIC")
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
  assert.equal(index.sourceOrigin, OLD)
  assert.equal(index.files.length, 5)

  const again = []
  const resumed = await backup(manifest, dir, { fetchImpl: sourceFetch(again), log() {} })
  assert.deepEqual(again, [])
  assert.equal(resumed.skipped, 5)
})

test("a file whose size differs from the list is not accepted as a backup", async (t) => {
  const dir = tempDir(t)
  const fetchImpl = async () => new Response("short")
  await assert.rejects(() => backup(manifest, dir, { fetchImpl, log() {} }), /크기가 달라요/)
})

test("files are grouped into galleries and works with meta.json kept apart", () => {
  const groups = groupByChannel(manifest.blobs)
  assert.deepEqual(groups.map((g) => [g.channel, g.works.length, !!g.channelFile]), [["1000", 1, true], ["502", 0, true]])
  assert.equal(groups[0].works[0].meta.pathname, "share/channels/1000/w_a/meta.json")
  assert.deepEqual(groups[0].works[0].media.map((f) => path.posix.basename(f.pathname)), ["cover.webp", "music.webm"])
})

test("only the storage origin changes in work addresses", () => {
  const text = rewriteOrigin(workMeta("w_a", "1000"), OLD, NEW)
  const meta = JSON.parse(text)
  assert.equal(meta.files.coverUrl, `${NEW}/share/channels/1000/w_a/cover.webp`)
  assert.equal(meta.shareUrl, "https://hwaeum.vercel.app/channel.html?channel=1000&work=w_a")
})

test("the preview uploads nothing", async (t) => {
  const dir = await backedUp(t)
  const store = newStore()
  const report = await upload(dir, Object.assign({ log() {} }, store))
  assert.deepEqual(report.map((r) => [r.channel, r.decision]), [["1000", "create"], ["502", "create"]])
  assert.deepEqual(store.puts, [])
})

test("writing to a fresh store uploads each work's files before its meta.json, with new addresses", async (t) => {
  const dir = await backedUp(t)
  const store = newStore()
  await upload(dir, Object.assign({ write: true, log() {} }, store))
  assert.deepEqual(store.puts.map((p) => p.pathname), [
    "share/channels/1000/channel.json",
    "share/channels/1000/w_a/cover.webp",
    "share/channels/1000/w_a/music.webm",
    "share/channels/1000/w_a/meta.json",
    "share/channels/502/channel.json",
  ])
  assert.ok(store.puts.every((p) => p.options.allowOverwrite === false))
  const meta = JSON.parse(store.files.get("share/channels/1000/w_a/meta.json"))
  assert.equal(meta.files.musicUrl, `${NEW}/share/channels/1000/w_a/music.webm`)
  assert.ok(!store.files.get("share/channels/1000/w_a/meta.json").includes(OLD))
})

test("running again after an interruption skips what is already in the new store", async (t) => {
  const dir = await backedUp(t)
  const store = newStore({ "share/channels/502/channel.json": SOURCE["share/channels/502/channel.json"], "share/channels/1000/channel.json": SOURCE["share/channels/1000/channel.json"], "share/channels/1000/w_a/cover.webp": "COVER" })
  await upload(dir, Object.assign({ write: true, decide: () => "merge", log() {} }, store))
  assert.deepEqual(store.puts.map((p) => p.pathname), ["share/channels/1000/w_a/music.webm", "share/channels/1000/w_a/meta.json"])
})

test("a recreated gallery number follows the decision for that gallery", async (t) => {
  const dir = await backedUp(t)
  const recreated = JSON.stringify({ channel: "1000", ownerHash: "new-owner", passHash: "new-pass" })
  const seen = []
  const decide = (oldMeta, newMeta) => {
    seen.push([oldMeta.ownerHash, newMeta.ownerHash])
    return decisions.shift()
  }
  let decisions = ["skip"]
  let store = newStore({ "share/channels/1000/channel.json": recreated })
  let report = await upload(dir, Object.assign({ write: true, decide, log() {} }, store))
  assert.deepEqual(seen, [["old-owner", "new-owner"]])
  assert.equal(report[0].decision, "skip")
  assert.deepEqual(store.puts.map((p) => p.pathname), ["share/channels/502/channel.json"])

  decisions = ["merge"]
  store = newStore({ "share/channels/1000/channel.json": recreated })
  await upload(dir, Object.assign({ write: true, decide, log() {} }, store))
  assert.equal(store.files.get("share/channels/1000/channel.json"), recreated)
  assert.ok(store.files.has("share/channels/1000/w_a/meta.json"))

  decisions = ["restore"]
  store = newStore({ "share/channels/1000/channel.json": recreated })
  await upload(dir, Object.assign({ write: true, decide, log() {} }, store))
  const restored = store.puts.find((p) => p.pathname === "share/channels/1000/channel.json")
  assert.equal(restored.options.allowOverwrite, true)
  assert.equal(JSON.parse(store.files.get("share/channels/1000/channel.json")).ownerHash, "old-owner")
})

test("a gallery recreated by the same teacher or with the same code is merged, any other is skipped", () => {
  const old = { channel: "1000", ownerHash: "teacher-a", passHash: "code-1234" }
  assert.equal(decideChannelConflict(old, { ownerHash: "teacher-a", passHash: "code-9999" }), "merge")
  assert.equal(decideChannelConflict(old, { ownerHash: "other-browser", passHash: "code-1234" }), "merge")
  assert.equal(decideChannelConflict(old, { ownerHash: "teacher-b", passHash: "code-5555" }), "skip")
  assert.equal(decideChannelConflict({ channel: "1000" }, { channel: "1000" }), "skip")
})
