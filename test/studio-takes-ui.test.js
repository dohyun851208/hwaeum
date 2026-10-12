const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const createStudioTakesUI = require("../js/studio-takes-ui.js")
const StudioUtils = require("../js/studio-utils.js")

const projectDir = path.resolve(__dirname, "..")

function createHarness(options) {
  options = options || {}
  const calls = { add: [], update: [], loadRecipe: [], commit: 0 }
  const state = {
    title: "봄 노래",
    step: 2,
    activeTakeId: options.activeTakeId || null,
    playingTakeId: null,
    sharedRecipeLoaded: !!options.sharedRecipeLoaded,
  }
  const el = {
    takesList: { innerHTML: "", appendChild() {} },
    takesEmpty: { style: {}, textContent: "" },
    takesCount: { textContent: "" },
    titleInput: { value: "" },
    statusText: { textContent: "" },
    exportStatus: { textContent: "" },
  }
  const takes = {
    lastError: "",
    maxTakes: 24,
    list() {
      return []
    },
    update(id, recipe, name) {
      calls.update.push({ id, recipe, name })
      if (options.updateFails) {
        takes.lastError = "quota"
        return null
      }
      return options.updateMiss ? null : { id, recipe, name }
    },
    add(recipe, name) {
      if (options.addFails) {
        takes.lastError = options.addFails
        return null
      }
      const take = { id: "new-take", recipe, name }
      calls.add.push(take)
      return take
    },
    remove(id) {
      calls.remove = (calls.remove || []).concat(id)
      return true
    },
  }
  const recipe = { title: state.title, atmosphere: "none", duration: 30 }
  const controller = createStudioTakesUI({
    root: {
      confirm(message) {
        calls.confirm = (calls.confirm || []).concat(message)
        return options.confirm !== false
      },
    },
    state,
    el,
    D: { atmospheres: [{ id: "none", label: "배경 없음", color: "#5f8f63" }] },
    engine: { stop() {} },
    takes,
    StudioUtils,
    defaultAtmosphere: () => ({ id: "none", label: "배경 없음", color: "#5f8f63" }),
    renderThumbnail() {},
    usedInstrumentLabelsForRecipe: () => "바이올린",
    requireDrawn: () => true,
    commitHashtagInput: () => {
      calls.commit += 1
    },
    buildRecipe: () => recipe,
    loadRecipe: (value) => calls.loadRecipe.push(value),
    exportAudio() {},
    exportCover() {},
    setStep() {},
    play() {},
    pause() {},
    hasUnsavedWork: () => !!options.unsaved,
    markWorkSaved: () => {
      calls.marked = (calls.marked || 0) + 1
    },
  })

  return { calls, controller, el, recipe, state }
}

test("studio takes UI keeps the classic-script factory contract", () => {
  assert.equal(typeof createStudioTakesUI, "function")
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const takesUiAt = html.indexOf("./js/studio-takes-ui.js")
  const studioAt = html.indexOf("./js/studio.js")
  assert.notEqual(takesUiAt, -1)
  assert.notEqual(studioAt, -1)
  assert.ok(takesUiAt < studioAt)
})

test("saving an active take updates it without adding a duplicate", () => {
  const { calls, controller, el, recipe, state } = createHarness({ activeTakeId: "take-1" })

  const saved = controller.saveTake()

  assert.equal(saved.id, "take-1")
  assert.deepEqual(calls.update, [{ id: "take-1", recipe, name: "봄 노래" }])
  assert.equal(calls.add.length, 0)
  assert.equal(calls.commit, 1)
  assert.equal(state.sharedRecipeLoaded, false)
  assert.equal(el.statusText.textContent, "다시 저장했어요")
  assert.equal(el.exportStatus.textContent, "현재 작품을 다시 저장했어요.")
})

test("saving as a new take never overwrites the active take", () => {
  const { calls, controller, el, state } = createHarness({ activeTakeId: "take-1" })

  const saved = controller.saveNewTake()

  assert.equal(saved.id, "new-take")
  assert.equal(calls.update.length, 0)
  assert.equal(calls.add.length, 1)
  assert.equal(state.activeTakeId, "new-take")
  assert.equal(el.exportStatus.textContent, "새 작품으로 저장했어요.")
})

test("selecting a take restores its recipe and completion title", () => {
  const { calls, controller, el, state } = createHarness()
  const recipe = { title: "저장된 제목", atmosphere: "none", duration: 30 }

  controller.selectTake({ id: "take-2", name: "저장된 제목", recipe })

  assert.equal(state.activeTakeId, "take-2")
  assert.equal(state.sharedRecipeLoaded, false)
  assert.equal(state.title, "저장된 제목")
  assert.equal(el.titleInput.value, "저장된 제목")
  assert.deepEqual(calls.loadRecipe, [recipe])
  assert.equal(el.exportStatus.textContent, "‘저장된 제목’ 정보를 불러왔어요.")
})

test("my works list never shares a column with the sticky completion cover", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const twoColumn = css.slice(css.indexOf("@media (min-width: 1081px) {"))

  assert.match(css, /\.completion-preview-column \{[^}]*position: sticky;/)
  assert.match(twoColumn, /\.completion-gallery \{\s*grid-template-columns: minmax\(360px, 520px\) minmax\(520px, 860px\);/)
  assert.match(twoColumn, /\.completion-gallery > \.completion-work-list \{\s*grid-column: 2;/)
})

test("opening another work asks before throwing away unsaved changes", () => {
  const declined = createHarness({ activeTakeId: "take-1", unsaved: true, confirm: false })
  assert.equal(declined.controller.openTake({ id: "take-2", name: "다른 작품", recipe: { duration: 30 } }), false)
  assert.equal(declined.calls.loadRecipe.length, 0)
  assert.equal(declined.state.activeTakeId, "take-1")
  assert.match(declined.calls.confirm[0], /저장하지 않은 내용/)

  const accepted = createHarness({ activeTakeId: "take-1", unsaved: true, confirm: true })
  assert.equal(accepted.controller.openTake({ id: "take-2", name: "다른 작품", recipe: { duration: 30 } }), true)
  assert.equal(accepted.calls.loadRecipe.length, 1)
  assert.equal(accepted.state.activeTakeId, "take-2")
  assert.equal(accepted.calls.marked, 1, "불러온 작품이 새 기준이 된다")

  const clean = createHarness({ activeTakeId: "take-1", unsaved: false })
  assert.equal(clean.controller.openTake({ id: "take-2", name: "다른 작품", recipe: { duration: 30 } }), true)
  assert.equal(clean.calls.confirm, undefined, "바뀐 것이 없으면 묻지 않는다")
})

test("opening the work that is already open keeps edits and undo history", () => {
  const { calls, controller, state } = createHarness({ activeTakeId: "take-1", unsaved: true })
  assert.equal(controller.openTake({ id: "take-1", name: "봄 노래", recipe: { duration: 30 } }), true)
  assert.equal(calls.loadRecipe.length, 0)
  assert.equal(calls.confirm, undefined)
  assert.equal(state.activeTakeId, "take-1")
})

test("a save that does not fit explains why instead of saying it was saved", () => {
  const full = createHarness({ addFails: "full" })
  assert.equal(full.controller.saveTake(), null)
  assert.match(full.el.exportStatus.textContent, /24개까지/)
  assert.equal(full.state.activeTakeId, null)

  const quota = createHarness({ activeTakeId: "take-1", updateFails: true })
  assert.equal(quota.controller.saveTake(), null)
  assert.equal(quota.calls.add.length, 0, "덮어쓰기에 실패했다고 새 작품을 더하지 않는다")
  assert.match(quota.el.exportStatus.textContent, /저장 공간이 가득/)
  assert.equal(quota.state.activeTakeId, "take-1")

  const saved = createHarness({ activeTakeId: "take-1" })
  saved.controller.saveTake()
  assert.equal(saved.calls.marked, 1, "저장한 상태가 새 기준이 된다")
})

test("deleting a work asks first", () => {
  const declined = createHarness({ confirm: false })
  declined.controller.removeTake({ id: "take-3", name: "지울 작품", recipe: { duration: 30 } })
  assert.equal(declined.calls.remove, undefined)

  const accepted = createHarness({ activeTakeId: "take-3", confirm: true })
  accepted.controller.removeTake({ id: "take-3", name: "지울 작품", recipe: { duration: 30 } })
  assert.deepEqual(accepted.calls.remove, ["take-3"])
  assert.equal(accepted.state.activeTakeId, null)
})

test("pressing Enter on a button inside a work card does not open the card", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-takes-ui.js"), "utf8")
  const keydown = source.slice(source.indexOf('wrap.addEventListener("keydown"'))
  assert.match(keydown.slice(0, 260), /if \(event\.target !== wrap\) return/)
})
