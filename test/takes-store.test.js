const assert = require("assert/strict")
const fs = require("fs")
const path = require("path")
const test = require("node:test")
const vm = require("vm")

const projectDir = path.resolve(__dirname, "..")

function loadTakesStore(initialValue) {
  const store = new Map()
  if (initialValue !== undefined) store.set("sda.takes", initialValue)
  const sandbox = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        store.set(key, value)
      },
    },
    DrawingCanvas: {
      drawStroke() {},
    },
  }
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "takes.js"), "utf8"), sandbox, { filename: "takes.js" })
  return { TakesStore: sandbox.TakesStore, store }
}

test("TakesStore adds new attempts at the top", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")

  const first = takes.add({ duration: 30 }, "처음")
  const second = takes.add({ duration: 30 }, "마지막")
  const items = takes.list()

  assert.equal(items.length, 2)
  assert.equal(items[0].id, second.id)
  assert.equal(items[1].id, first.id)
})

test("TakesStore loads saved attempts newest first", () => {
  const saved = JSON.stringify([
    { id: "new", name: "나중", createdAt: "2026-01-02T00:00:00.000Z", recipe: { duration: 30 } },
    { id: "old", name: "먼저", createdAt: "2026-01-01T00:00:00.000Z", recipe: { duration: 30 } },
  ])
  const { TakesStore } = loadTakesStore(saved)
  const takes = new TakesStore("sda.takes")

  assert.deepEqual(
    Array.from(takes.list(), (take) => take.id),
    ["new", "old"],
  )
})

test("TakesStore setTitle updates the visible name and recipe title", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const take = takes.add({ duration: 30, title: "처음 제목" }, "처음 제목")

  assert.equal(takes.setTitle(take.id, "새 제목"), true)
  const saved = takes.get(take.id)
  assert.equal(saved.name, "새 제목")
  assert.equal(saved.recipe.title, "새 제목")
})

test("TakesStore update overwrites an existing attempt without adding a new one", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const take = takes.add({ duration: 30, title: "처음 제목" }, "처음 제목")

  const updated = takes.update(take.id, { duration: 45, title: "고친 제목" }, "고친 제목")
  const items = takes.list()

  assert.equal(items.length, 1)
  assert.equal(updated.id, take.id)
  assert.equal(updated.createdAt, take.createdAt)
  assert.equal(updated.name, "고친 제목")
  assert.equal(updated.recipe.duration, 45)
  assert.equal(updated.recipe.title, "고친 제목")
})

test("TakesStore update moves the changed attempt to the top", () => {
  const saved = JSON.stringify([
    { id: "old", name: "먼저", createdAt: "2026-01-01T00:00:00.000Z", recipe: { duration: 30 } },
    { id: "new", name: "나중", createdAt: "2026-01-02T00:00:00.000Z", recipe: { duration: 30 } },
  ])
  const { TakesStore } = loadTakesStore(saved)
  const takes = new TakesStore("sda.takes")

  takes.update("old", { duration: 45, title: "다시 저장" }, "다시 저장")

  assert.deepEqual(
    Array.from(takes.list(), (take) => take.id),
    ["old", "new"],
  )
})

test("TakesStore keeps the recipe picture for later restore", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const picture = "data:image/png;base64,cGlj"
  const take = takes.add({ duration: 30, picture, pictureName: "그림" }, "그림 작품")

  const saved = takes.get(take.id)
  assert.equal(saved.recipe.picture, picture)
  assert.equal(saved.recipe.pictureName, "그림")
})

function loadTakesStoreWithQuota(limitChars) {
  const store = new Map()
  const sandbox = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        let total = String(value).length
        store.forEach((stored, storedKey) => {
          if (storedKey !== key) total += String(stored).length
        })
        if (total > limitChars) {
          const error = new Error("quota")
          error.name = "QuotaExceededError"
          throw error
        }
        store.set(key, String(value))
      },
    },
    DrawingCanvas: { drawStroke() {} },
  }
  sandbox.self = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(projectDir, "js", "takes.js"), "utf8"), sandbox, { filename: "takes.js" })
  return { TakesStore: sandbox.TakesStore, store }
}

test("TakesStore refuses a 25th attempt instead of silently deleting the oldest", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const first = takes.add({ duration: 30 }, "첫 작품")
  for (let i = 1; i < 24; i += 1) assert.ok(takes.add({ duration: 30 }, "작품 " + i))

  assert.equal(takes.add({ duration: 30 }, "넘친 작품"), null)
  assert.equal(takes.lastError, "full")
  assert.equal(takes.list().length, 24)
  assert.ok(takes.get(first.id), "가장 오래된 작품이 남아 있어야 한다")
})

test("TakesStore reports a full browser storage and keeps memory in step with what was saved", () => {
  const { TakesStore, store } = loadTakesStoreWithQuota(3000)
  const takes = new TakesStore("sda.takes")
  const saved = takes.add({ duration: 30, picture: "data:image/jpeg;base64," + "a".repeat(900) }, "들어간 작품")
  assert.ok(saved)

  const tooBig = takes.add({ duration: 30, picture: "data:image/jpeg;base64," + "b".repeat(2500) }, "넘친 작품")
  assert.equal(tooBig, null)
  assert.equal(takes.lastError, "quota")
  assert.deepEqual(Array.from(takes.list(), (take) => take.name), ["들어간 작품"])
  const reopened = new TakesStore("sda.takes")
  assert.deepEqual(Array.from(reopened.list(), (take) => take.name), ["들어간 작품"])
  assert.equal(reopened.get(saved.id).recipe.picture.length, 23 + 900)
  assert.ok(store.get("sda.takes.pictures"))

  const before = takes.get(saved.id).recipe.duration
  assert.equal(takes.update(saved.id, { duration: 45, picture: "data:image/jpeg;base64," + "c".repeat(2500) }, "고친 작품"), null)
  assert.equal(takes.lastError, "quota")
  assert.equal(takes.get(saved.id).recipe.duration, before)
})

test("TakesStore stores a picture shared by several attempts only once", () => {
  const { TakesStore, store } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const picture = "data:image/jpeg;base64," + "x".repeat(5000)
  takes.add({ duration: 30, picture }, "하나")
  takes.add({ duration: 30, picture }, "둘")
  takes.add({ duration: 30, picture }, "셋")

  assert.ok(store.get("sda.takes").length < 2000, "목록에는 그림 대신 열쇠만 들어간다")
  assert.equal(Object.keys(JSON.parse(store.get("sda.takes.pictures"))).length, 1)
  const reopened = new TakesStore("sda.takes")
  reopened.list().forEach((take) => assert.equal(take.recipe.picture, picture))

  const only = reopened.list()[0]
  reopened.list().slice(1).forEach((take) => reopened.remove(take.id))
  reopened.remove(only.id)
  assert.deepEqual(JSON.parse(store.get("sda.takes.pictures")), {}, "아무도 쓰지 않는 그림은 정리된다")
})

test("TakesStore reads attempts saved by another tab before changing the list", () => {
  const { TakesStore } = loadTakesStore()
  const tabA = new TakesStore("sda.takes")
  const tabB = new TakesStore("sda.takes")
  const fromA = tabA.add({ duration: 30 }, "A 탭 작품")
  const fromB = tabB.add({ duration: 30 }, "B 탭 작품")

  assert.ok(tabB.get(fromA.id), "B 탭이 저장할 때 A 탭 작품을 지우지 않는다")
  tabA.refresh()
  assert.ok(tabA.get(fromB.id))
})

test("TakesStore still reads attempts saved with the picture inside the recipe", () => {
  const picture = "data:image/png;base64,b2xk"
  const { TakesStore } = loadTakesStore(JSON.stringify([{ id: "old", name: "옛 작품", createdAt: "2026-01-01T00:00:00.000Z", recipe: { duration: 30, picture } }]))
  const takes = new TakesStore("sda.takes")
  assert.equal(takes.get("old").recipe.picture, picture)
})

test("TakesStore remembers which gallery work each attempt was shared as", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")
  const take = takes.add({ duration: 30 }, "봄")
  assert.equal(takes.sharedWorkId(take.id, "107"), "")
  assert.equal(takes.markShared(take.id, "107", "w_abc"), true)
  takes.update(take.id, { duration: 45 }, "봄") // 다시 저장해도 공유 기록은 남는다
  const reopened = new TakesStore("sda.takes")
  assert.equal(reopened.sharedWorkId(take.id, "107"), "w_abc")
  assert.equal(reopened.sharedWorkId(take.id, "108"), "")
})
