const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const { BlobStoreSuspendedError } = require("@vercel/blob")
const utils = require("../api/share/_utils.cjs")

const channelBlob = { pathname: "share/channels/1004/channel.json", url: "https://storage.test/channel.json" }
const workBlob = { pathname: "share/channels/1004/w_1/meta.json", url: "https://storage.test/work.json" }
const channelMeta = { channel: "1004", ownerHash: "original-owner", passHash: utils.hashPass("1004", "1234") }

function loadHandler(name, blob) {
  const sandbox = {
    module: { exports: {} },
    require: (id) => id === "@vercel/blob" ? blob : utils,
    console: { error() {}, warn() {} },
    URL,
    SyntaxError,
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../api/share", name + ".js"), "utf8"), sandbox)
  return sandbox.module.exports
}

async function request(handler, req) {
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value }, end(body) { this.data = JSON.parse(body) } }
  await handler(req, res)
  return res
}

function fixture(t, blobs, respond, putError) {
  t.mock.method(console, "error", () => {})
  t.mock.method(globalThis, "fetch", respond)
  const writes = []
  const blob = {
    list: async ({ prefix }) => ({ blobs: blobs.filter((item) => item.pathname.startsWith(prefix)), hasMore: false }),
    put: async (pathname, body) => {
      writes.push({ pathname, body: JSON.parse(body) })
      if (putError) throw putError
    },
  }
  return { writes, handler: (name) => loadHandler(name, blob) }
}

const listRequest = { method: "GET", query: { channel: "1004", pass: "1234" } }
const claimRequest = { method: "POST", body: { channel: "1004", ownerKey: "new-browser", pass: "1234", adminPin: process.env.HWAEUM_ADMIN_PIN || "8624" } }
const blocked = () => new Response("Your store is blocked\n", { status: 403 })
const json = (data) => new Response(JSON.stringify(data))

test("a suspended store reports an outage instead of an absent gallery and prevents overwriting it", async (t) => {
  const f = fixture(t, [channelBlob, workBlob], blocked)
  for (const [name, req] of [["channel", listRequest], ["channel-claim", claimRequest]]) {
    const res = await request(f.handler(name), req)
    assert.equal(res.statusCode, 503)
    assert.match(res.data.error, /저장소 이용이 일시 중지/)
    assert.equal(res.data.works, undefined)
    assert.equal(res.data.claimed, undefined)
    assert.equal(res.headers["Cache-Control"], "no-store")
  }
  assert.deepEqual(f.writes, [])
})

test("a network failure reading gallery permissions also prevents a claim", async (t) => {
  const f = fixture(t, [channelBlob], () => { throw new TypeError("fetch failed") })
  const res = await request(f.handler("channel-claim"), claimRequest)
  assert.equal(res.statusCode, 503)
  assert.match(res.data.error, /저장소에 연결하지 못했어요/)
  assert.deepEqual(f.writes, [])
})

test("invalid gallery metadata is not treated as permission to overwrite the gallery", async (t) => {
  const f = fixture(t, [channelBlob], () => json(null))
  const res = await request(f.handler("channel-claim"), claimRequest)
  assert.equal(res.statusCode, 500)
  assert.deepEqual(f.writes, [])
})

test("a genuinely absent gallery can still be created", async (t) => {
  const f = fixture(t, [], () => { throw new Error("no file should be fetched") })
  const res = await request(f.handler("channel-claim"), claimRequest)
  assert.equal(res.statusCode, 200)
  assert.equal(res.data.claimed, true)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].pathname, channelBlob.pathname)
})

test("suspended writes to a new gallery use the same Korean service error", async (t) => {
  const f = fixture(t, [], () => {}, new BlobStoreSuspendedError())
  const res = await request(f.handler("channel-claim"), claimRequest)
  assert.equal(res.statusCode, 503)
  assert.match(res.data.error, /저장소 이용이 일시 중지/)
})

test("work read failures after a successful gallery read do not become an empty gallery", async (t) => {
  const f = fixture(t, [channelBlob, workBlob], (url) => url === channelBlob.url ? json(channelMeta) : blocked())
  const res = await request(f.handler("channel"), listRequest)
  assert.equal(res.statusCode, 503)
  assert.equal(res.data.works, undefined)
})

test("HTTP failures reading a work return a service error", async (t) => {
  const f = fixture(t, [channelBlob, workBlob], (url) => url === channelBlob.url ? json(channelMeta) : new Response("Unavailable", { status: 503 }))
  const res = await request(f.handler("channel"), listRequest)
  assert.equal(res.statusCode, 503)
  assert.match(res.data.error, /저장소에 연결하지 못했어요/)
})

test("a malformed work JSON is skipped while healthy works remain visible", async (t) => {
  const healthy = { pathname: "share/channels/1004/w_2/meta.json", url: "https://storage.test/healthy.json" }
  const f = fixture(t, [channelBlob, workBlob, healthy], (url) => {
    if (url === channelBlob.url) return json(channelMeta)
    if (url === workBlob.url) return new Response("invalid JSON")
    return json({ id: "w_2", channel: "1004", ownerHash: "hidden" })
  })
  const res = await request(f.handler("channel"), listRequest)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.data.works.map((work) => work.id), ["w_2"])
  assert.equal(res.data.works[0].ownerHash, undefined)
})

test("healthy galleries still require the right code before returning works", async (t) => {
  const f = fixture(t, [channelBlob, workBlob], (url) => {
    assert.equal(url, channelBlob.url, "locked galleries must not read works")
    return json(channelMeta)
  })
  const res = await request(f.handler("channel"), { method: "GET", query: { channel: "1004" } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.data.locked, true)
  assert.deepEqual(res.data.works, [])
  assert.equal(res.data.channel.passHash, undefined)
})
