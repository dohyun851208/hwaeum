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
    list() {
      return []
    },
    update(id, recipe, name) {
      calls.update.push({ id, recipe, name })
      return options.updateMiss ? null : { id, recipe, name }
    },
    add(recipe, name) {
      const take = { id: "new-take", recipe, name }
      calls.add.push(take)
      return take
    },
    remove() {},
  }
  const recipe = { title: state.title, atmosphere: "none", duration: 30 }
  const controller = createStudioTakesUI({
    root: {},
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
