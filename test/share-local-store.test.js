const assert = require("node:assert/strict")
const test = require("node:test")
const createLocalStore = require("../js/share-local-store.js")

// Transactional IndexedDB double: requests run asynchronously, writes become visible
// only on commit, and abort discards every queued write across both object stores.
function harness() {
  const tables = { works: new Map(), channels: new Map() }
  const calls = { closed: 0, revoked: [], transactions: [], forgotten: [] }
  let failChannelDelete = false
  let sequence = 0
  const indexedDB = {
    open() {
      const request = {}
      const db = {
        close() { calls.closed++ },
        transaction(names, mode) {
          calls.transactions.push({ names, mode })
          const draft = Object.fromEntries(names.map((name) => [name, new Map(tables[name])]))
          let pending = 0
          let active = true
          const tx = {
            abort() {
              if (!active) return
              active = false
              queueMicrotask(() => tx.onabort && tx.onabort())
            },
            objectStore(name) {
              assert.ok(names.includes(name))
              return {
                get(key) { return enqueue(() => structuredClone(draft[name].get(key))) },
                getAll() { return enqueue(() => structuredClone([...draft[name].values()])) },
                put(value) { return enqueue(() => draft[name].set(name === "works" ? value.id : value.channel, structuredClone(value))) },
                delete(key) {
                  if (name === "channels" && failChannelDelete) throw new Error("injected delete failure")
                  return enqueue(() => draft[name].delete(key))
                },
              }
            },
          }
          function complete() {
            if (!active || pending) return
            active = false
            if (mode === "readwrite") for (const name of names) tables[name] = draft[name]
            if (tx.oncomplete) tx.oncomplete()
          }
          function enqueue(action) {
            pending++
            const req = {}
            queueMicrotask(() => {
              if (!active) return
              try {
                req.result = action()
                if (req.onsuccess) req.onsuccess()
                pending--
                queueMicrotask(complete)
              } catch (error) {
                tx.error = error
                tx.abort()
              }
            })
            return req
          }
          queueMicrotask(complete)
          return tx
        },
      }
      queueMicrotask(() => { request.result = db; request.onsuccess() })
      return request
    },
  }
  const root = {
    indexedDB, location: { href: "http://localhost/studio.html" },
    URL: { createObjectURL: () => "blob:test-" + ++sequence, revokeObjectURL: (url) => calls.revoked.push(url) },
  }
  const store = createLocalStore({ root, randomId: (prefix) => prefix + ++sequence, normalizeChannel: String, forgetChannel: (channel) => calls.forgotten.push(channel) })
  const owner = { id: "teacher", key: "owner-key" }
  const file = new Blob(["sample"], { type: "audio/webm" })
  const publish = (channel = "107", pass = "1234") => store.publishLocalWork({ title: "봄", coverBlob: file, thumbBlob: file, musicBlob: file, recipe: { path: [{ x: 0.1, y: 0.5 }] } }, channel, owner, pass)
  return { store, tables, calls, owner, publish, failDelete() { failChannelDelete = true } }
}

test("local gallery requires its code and never exposes owner credentials or raw blobs", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "교실", h.owner, "8624")
  await assert.rejects(h.publish("107", "9999"), /코드가 맞지/)
  const { work } = await h.publish()
  const locked = await h.store.listLocalWorks("107", "9999")
  assert.equal(locked.locked, true)
  assert.deepEqual(locked.works, [])
  const visible = await h.store.listLocalWorks("107", "1234")
  assert.equal(visible.works.length, 1)
  assert.equal(visible.works[0].id, work.id)
  assert.equal(visible.meta.hasPass, true)
  assert.equal(visible.meta.pass, undefined)
  assert.equal(visible.works[0].ownerKey, undefined)
  assert.equal(visible.works[0].files.music, undefined)
  assert.equal(h.calls.closed, h.calls.transactions.length)
})

test("copying a local work preserves its recipe and checks both gallery codes", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "원래", h.owner, "8624")
  await h.store.claimLocalChannel("108", "5678", "복사", h.owner, "8624")
  const { work } = await h.publish()
  await assert.rejects(h.store.copyLocalWork(work, "108", "5678", "9999", h.owner), /원래 갤러리/)
  const result = await h.store.copyLocalWork(work, "108", "5678", "1234", h.owner)
  assert.notEqual(result.work.id, work.id)
  assert.deepEqual(result.work.recipe, work.recipe)
  assert.equal(result.work.channel, "108")
  assert.equal((await h.store.listLocalWorks("107", "1234")).works.length, 1)
})

test("deleting a work releases its URLs only after an authorized committed delete", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "교실", h.owner, "8624")
  const { work } = await h.publish()
  await assert.rejects(h.store.deleteLocalWork(work, "wrong"), /관리자 공통 코드/)
  assert.equal(h.calls.revoked.length, 0)
  await h.store.deleteLocalWork(work, "8624")
  assert.equal(h.tables.works.size, 0)
  assert.equal(h.calls.revoked.length, 3)
  h.store.dispose()
  assert.equal(h.calls.revoked.length, 3, "already released URLs are not released twice")
})

test("gallery deletion removes its metadata and works in one transaction, leaving other galleries intact", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "교실", h.owner, "8624")
  await h.store.claimLocalChannel("108", "1234", "다른 교실", h.owner, "8624")
  await h.publish()
  await h.publish()
  await h.publish("108")
  const result = await h.store.deleteLocalChannel("107", "8624")
  assert.equal(result.deletedWorks, 2)
  assert.deepEqual(h.calls.transactions.at(-1).names, ["works", "channels"])
  assert.equal(h.tables.works.size, 1)
  assert.deepEqual([...h.tables.channels.keys()], ["108"])
  assert.equal(h.calls.revoked.length, 6)
  assert.deepEqual(h.calls.forgotten, ["107"])
})

test("failed gallery deletion aborts all writes and retains usable work URLs", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "교실", h.owner, "8624")
  await h.publish()
  h.failDelete()
  await assert.rejects(h.store.deleteLocalChannel("107", "8624"), /injected delete failure/)
  assert.equal(h.tables.works.size, 1)
  assert.equal(h.tables.channels.size, 1)
  assert.equal(h.calls.revoked.length, 0)
  assert.deepEqual(h.calls.forgotten, [])
  assert.equal(h.calls.closed, h.calls.transactions.length)
})

test("an open request succeeding after it was blocked closes its late connection", async () => {
  const req = {}
  let closed = 0
  const store = createLocalStore({ root: { indexedDB: { open: () => req } } })
  const result = store.listLocalWorks("107", "1234")
  req.onblocked()
  await assert.rejects(result, /다른 탭/)
  req.result = { close() { closed++ } }
  req.onsuccess()
  assert.equal(closed, 1)
})

test("sharing the same work again replaces the earlier copy from this browser but never someone else's", async () => {
  const h = harness()
  await h.store.claimLocalChannel("107", "1234", "교실", h.owner, "8624")
  const first = await h.publish()
  const payload = { title: "봄", coverBlob: new Blob(["a"]), thumbBlob: new Blob(["a"]), musicBlob: new Blob(["a"]), recipe: {}, replaceWorkId: first.work.id }
  const second = await h.store.publishLocalWork(payload, "107", h.owner, "1234")
  assert.equal(second.replaced, true)
  let listed = await h.store.listLocalWorks("107", "1234")
  assert.deepEqual(listed.works.map((work) => work.id), [second.work.id])

  const stranger = { id: "other-student", key: "other-key" }
  const third = await h.store.publishLocalWork(Object.assign({}, payload, { replaceWorkId: second.work.id }), "107", stranger, "1234")
  assert.equal(third.replaced, false, "다른 학생이 올린 작품은 지우지 않는다")
  listed = await h.store.listLocalWorks("107", "1234")
  assert.equal(listed.works.length, 2)
})
