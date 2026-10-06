const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

// share-store.js를 가짜 fetch·로컬 갤러리로 띄운다. respond(url, init)이 응답을 정한다.
function loadShareStore(respond, options) {
  options = options || {}
  const calls = { local: [] }
  const memory = new Map()
  const sandbox = {
    location: { protocol: options.protocol || "https:" },
    localStorage: {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
    fetch: async (url, init) => respond(url, init),
    HwaeumLocalShareStore: () => ({
      available: () => true,
      dispose() {},
      claimLocalChannel: async () => {
        calls.local.push("claim")
        return { localOnly: true }
      },
      publishLocalWork: async () => {
        calls.local.push("publish")
        return { localOnly: true, work: { id: "local_1" } }
      },
      copyLocalWork: async () => ({ localOnly: true }),
      listLocalWorks: async (channel) => {
        calls.local.push("list")
        return { channel, meta: null, locked: false, passError: false, works: [], localOnly: true }
      },
      deleteLocalWork: async () => ({ localOnly: true }),
      deleteLocalChannel: async () => ({ localOnly: true }),
    }),
    console,
    Uint8Array,
    Math,
    JSON,
  }
  sandbox.self = sandbox
  sandbox.window = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8"), sandbox, { filename: "share-store.js" })
  return { store: sandbox.HwaeumShareStore, calls, memory }
}

function textResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

test("a dropped connection on the real site shows an error instead of an empty local gallery", async () => {
  const { store, calls } = loadShareStore(() => {
    throw new TypeError("Failed to fetch")
  })
  await assert.rejects(() => store.listChannel("486", ""), /공유 서버에 연결하지 못했어요/)
  assert.deepEqual(calls.local, [])
})

test("a server error that happens to mention fetch is shown, not treated as a missing API", async () => {
  const { store, calls } = loadShareStore(() => textResponse(500, JSON.stringify({ error: "blob fetch failed" })))
  await assert.rejects(() => store.listChannel("486", ""), /blob fetch failed/)
  assert.deepEqual(calls.local, [])

  const gateway = loadShareStore(() => textResponse(504, "<html>Gateway Timeout</html>"))
  await assert.rejects(() => gateway.store.listChannel("486", ""), /잠시 답하지 못했어요/)
  assert.deepEqual(gateway.calls.local, [])
})

test("a static server without the share API still uses this browser's gallery", async () => {
  const { store, calls } = loadShareStore((url, init) =>
    init && init.method === "POST" ? textResponse(501, "<html>Unsupported method</html>") : textResponse(404, "<html>Not Found</html>"),
  )
  const listed = await store.listChannel("486", "")
  assert.equal(listed.localOnly, true)
  await store.claimChannel({ channel: "486", pin: "1234", adminPin: "8624" })
  assert.deepEqual(calls.local, ["list", "claim"])
})

test("a page opened as a file uses this browser's gallery", async () => {
  const { store, calls } = loadShareStore(() => {
    throw new TypeError("Failed to fetch")
  }, { protocol: "file:" })
  const listed = await store.listChannel("486", "")
  assert.equal(listed.localOnly, true)
  assert.deepEqual(calls.local, ["list"])
})

test("the gallery list leaves out each recipe's picture so a full class gallery stays under the response limit", () => {
  const { listedMeta, sanitizeMeta } = require("../api/share/_utils.cjs")
  const picture = "data:image/jpeg;base64," + "A".repeat(100000)
  const meta = { id: "w_1", channel: "486", ownerHash: "secret", recipe: { picture, strokes: [[{ x: 0, y: 0.5 }]] }, files: { thumbUrl: "t.webp" } }

  const listed = listedMeta(meta)
  assert.equal(listed.recipe.picture, "")
  assert.equal(listed.recipe.pictureOmitted, true)
  assert.deepEqual(listed.recipe.strokes, meta.recipe.strokes, "그림 말고는 그대로 둔다")
  assert.equal(listed.ownerHash, undefined)
  assert.ok(JSON.stringify(listed).length < 1000)
  assert.equal(meta.recipe.picture, picture, "원본은 바꾸지 않는다")
  assert.equal(sanitizeMeta(meta).recipe.picture, picture, "작품 하나를 읽을 때는 그림까지 준다")
})

test("a gallery code remembered on a shared classroom PC is forgotten after a school day", () => {
  const { store, memory } = loadShareStore(() => textResponse(404, "<html></html>"))
  store.rememberPass("107", "2468")
  assert.equal(store.loadPass("107"), "2468")
  const saved = JSON.parse(memory.get("hwaeum.channelPass.107"))
  memory.set("hwaeum.channelPass.107", JSON.stringify({ pin: saved.pin, at: saved.at - 9 * 60 * 60 * 1000 }))
  assert.equal(store.loadPass("107"), "", "8시간이 지나면 다음 반 학생에게 채워지지 않는다")
  memory.set("hwaeum.channelPass.108", "1357")
  assert.equal(store.loadPass("108"), "", "시각이 없는 옛 기록도 쓰지 않는다")
})

test("re-sharing only removes the earlier work when the same student owns it", () => {
  const publish = fs.readFileSync(path.join(projectDir, "api", "share", "publish.js"), "utf8")
  const body = publish.slice(publish.indexOf("async function removeReplacedWork"), publish.indexOf("module.exports"))
  assert.match(body, /previous\.ownerHash !== ownerHash\) return false/)
  assert.match(body, /await del\(targets\)/)
  assert.match(publish, /const replaced = await removeReplacedWork\(channel, body\.replaceWorkId, meta\.ownerHash, id\)/)
})
