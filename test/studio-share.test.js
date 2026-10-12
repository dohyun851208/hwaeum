const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const createStudioShare = require("../js/studio-share.js")
const StudioUtils = require("../js/studio-utils.js")

const projectDir = path.resolve(__dirname, "..")

function classList() {
  const values = new Set()
  return {
    add(value) {
      values.add(value)
    },
    remove(value) {
      values.delete(value)
    },
    toggle(value, on) {
      if (on) values.add(value)
      else values.delete(value)
    },
    contains(value) {
      return values.has(value)
    },
  }
}

function field(value) {
  return {
    value: value || "",
    classList: classList(),
    focusCalls: 0,
    scrollCalls: 0,
    focus() {
      this.focusCalls += 1
    },
    scrollIntoView() {
      this.scrollCalls += 1
    },
  }
}

function createHarness(options) {
  options = options || {}
  const calls = { selected: [], remembered: [] }
  const state = {
    title: "봄 노래",
    composerName: "김하음",
    pictureThought: "따뜻한 봄날",
    backgroundReason: "포근한 느낌이 어울려서",
    melodyIntent: "꽃잎이 날리는 모습을 표현해서",
    hashtags: "봄, 포근함",
    atmosphere: { label: "포근함", color: "#5f8f63" },
    duration: 30,
    step: 3,
    sharedChannel: "107",
    sharedWorks: [],
  }
  const el = {
    body: { classList: classList() },
    titleInput: field("봄 노래"),
    composerInput: field("김하음"),
    bgReasonInput: field("포근한 느낌이 어울려서"),
    melodyIntentInput: field("꽃잎이 날리는 모습을 표현해서"),
    hashtagsInput: field("봄, 포근함"),
    exportStatus: { textContent: "", classList: classList() },
    shareStatus: { textContent: "", classList: classList() },
    publishModal: { hidden: true },
    publishChannelInput: field(),
    publishPassInput: field(),
    publishModalError: { textContent: "", hidden: true },
    publishModalSubmitBtn: field(),
    publishShareBtn: field(),
    channelBrowseInput: field("107"),
  }
  const ShareStore = {
    MIN_PIN_LENGTH: 4,
    normalizeChannel(value) {
      return String(value || "").replace(/\D/g, "").slice(0, 4)
    },
    cleanPin(value) {
      return String(value || "").replace(/\D/g, "").slice(0, 6)
    },
    loadChannel() {
      return "107"
    },
    loadPass() {
      return "2468"
    },
    rememberPass(channel, pass) {
      calls.remembered.push({ channel, pass })
    },
  }
  if (options.listChannel) ShareStore.listChannel = options.listChannel
  const root = {
    URL,
    location: { href: "http://localhost/studio.html", hash: "", replace() {} },
    history: { replaceState() {} },
    navigator: {},
    sessionStorage: { setItem() {}, removeItem() {} },
  }
  const controller = createStudioShare({
    root,
    document: { body: el.body, getElementById: () => null },
    state,
    el,
    ShareStore,
    StudioUtils,
    Core: { encodeRecipe: () => "recipe" },
    engine: {},
    saveTake: () => ({ id: "take-1" }),
    selectTake: (take) => calls.selected.push(take),
    hashtagList: () => (el.hashtagsInput.value ? ["봄"] : []),
    defaultAtmosphere: () => ({ label: "배경 없음", color: "#5f8f63" }),
    usedInstrumentLabelsForRecipe: () => "바이올린 · 플루트",
    usedInstrumentLabels: () => "바이올린",
    normalizeActionCount: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    requireDrawn: () => false,
    buildRecipe: () => ({ actionCount: 7.8 }),
    buildSharedRecipe: () => ({}),
    notesFor: () => [],
    canvasToBlob: () => Promise.resolve({ size: 0 }),
    renderDrawingSnapshotCanvas: () => Promise.resolve({}),
  })

  if (options.emptyRequiredFields) {
    el.titleInput.value = ""
    el.composerInput.value = ""
    el.bgReasonInput.value = ""
    el.melodyIntentInput.value = ""
    el.hashtagsInput.value = ""
  }

  return { calls, controller, el, state }
}

test("studio share keeps the classic-script factory contract", () => {
  assert.equal(typeof createStudioShare, "function")
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const shareAt = html.indexOf("./js/studio-share.js")
  const studioAt = html.indexOf("./js/studio.js")
  assert.notEqual(shareAt, -1)
  assert.notEqual(studioAt, -1)
  assert.ok(shareAt < studioAt)
})

test("clearing a gallery number does not restore the previous value", () => {
  const { controller, el, state } = createHarness()

  controller.syncShareInputs("")

  assert.equal(state.sharedChannel, "")
  assert.equal(el.channelBrowseInput.value, "")
})

test("publishing reports the same five required completion fields", () => {
  const { calls, controller, el } = createHarness({ emptyRequiredFields: true })
  const take = { id: "take-1" }

  controller.publishTake(take)

  assert.deepEqual(calls.selected, [take])
  assert.match(el.exportStatus.textContent, /제목, 작곡가, 배경음악을 고른 이유, 선율을 표현한 의도, 작품을 잘 나타내는 단어/)
  assert.equal(el.exportStatus.classList.contains("error"), true)
  assert.equal(el.titleInput.focusCalls, 1)
  assert.equal(el.titleInput.scrollCalls, 1)
})

test("a complete work opens the publish modal with its remembered gallery code", () => {
  const { controller, el } = createHarness()

  controller.publishTake({ id: "take-1" })

  assert.equal(el.publishModal.hidden, false)
  assert.equal(el.publishChannelInput.value, "107")
  assert.equal(el.publishPassInput.value, "2468")
  assert.equal(el.body.classList.contains("publish-modal-open"), true)
})

test("shared metadata keeps sanitized reflection and all used instruments", () => {
  const { controller } = createHarness()

  const metadata = controller.sharedMetadata({ actionCount: 7.8 })

  assert.equal(metadata.composerName, "김하음")
  assert.deepEqual(metadata.hashtags, ["봄", "포근함"])
  assert.equal(metadata.instrumentLabel, "바이올린 · 플루트")
  assert.equal(metadata.actionCount, 7)
  assert.equal(metadata.coverHasEmbeddedPlay, false)
})

test("publish modal checks the gallery code before the long music compression and does not remember a wrong one", async () => {
  const wrong = createHarness({ listChannel: async () => ({ locked: true, passError: true, works: [] }) })
  wrong.el.publishModal.hidden = false
  wrong.el.publishChannelInput.value = "107번"
  wrong.el.publishPassInput.value = "9999"
  await wrong.controller.submitPublishModal({ preventDefault() {} })
  assert.equal(wrong.el.publishModal.hidden, false, "틀리면 창을 닫지 않는다")
  assert.match(wrong.el.publishModalError.textContent, /갤러리 코드가 맞지 않아요/)
  assert.deepEqual(wrong.calls.remembered, [], "틀린 코드는 기억하지 않는다")

  const missing = createHarness({ listChannel: async () => ({ locked: false, meta: null, works: [] }) })
  missing.el.publishChannelInput.value = "999"
  missing.el.publishPassInput.value = "2468"
  missing.el.publishModal.hidden = false
  await missing.controller.submitPublishModal({ preventDefault() {} })
  assert.match(missing.el.publishModalError.textContent, /찾지 못했어요/)

  const ok = createHarness({ listChannel: async () => ({ locked: false, meta: { channel: "107" }, works: [] }) })
  ok.el.publishModal.hidden = false
  ok.el.publishChannelInput.value = "107번"
  ok.el.publishPassInput.value = "24-68"
  await ok.controller.submitPublishModal({ preventDefault() {} })
  assert.equal(ok.el.publishModal.hidden, true)
  assert.deepEqual(ok.calls.remembered, [], "코드는 공유에 성공한 뒤에만 기억한다")
})
