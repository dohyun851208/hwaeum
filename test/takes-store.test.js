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

test("TakesStore adds new attempts at the bottom", () => {
  const { TakesStore } = loadTakesStore()
  const takes = new TakesStore("sda.takes")

  const first = takes.add({ duration: 30 }, "처음")
  const second = takes.add({ duration: 30 }, "마지막")
  const items = takes.list()

  assert.equal(items.length, 2)
  assert.equal(items[0].id, first.id)
  assert.equal(items[1].id, second.id)
})

test("TakesStore loads saved attempts oldest first", () => {
  const saved = JSON.stringify([
    { id: "new", name: "나중", createdAt: "2026-01-02T00:00:00.000Z", recipe: { duration: 30 } },
    { id: "old", name: "먼저", createdAt: "2026-01-01T00:00:00.000Z", recipe: { duration: 30 } },
  ])
  const { TakesStore } = loadTakesStore(saved)
  const takes = new TakesStore("sda.takes")

  assert.deepEqual(
    Array.from(takes.list(), (take) => take.id),
    ["old", "new"],
  )
})
