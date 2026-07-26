const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function createElement(tagName) {
  let text = ""
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    listeners: {},
    className: "",
    hidden: false,
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value
      },
    },
    appendChild(child) {
      this.children.push(child)
      return child
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener
    },
  }
  node.classList = {
    add(...names) {
      const current = node.className.split(/\s+/).filter(Boolean)
      for (const name of names) if (!current.includes(name)) current.push(name)
      node.className = current.join(" ")
    },
  }
  Object.defineProperty(node, "textContent", {
    get() {
      return text
    },
    set(value) {
      text = String(value == null ? "" : value)
      node.children = []
    },
  })
  return node
}

function descendants(node) {
  return [node].concat(node.children.flatMap(descendants))
}

function createSetupHarness() {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-setup-render.js"), "utf8")
  const sandbox = {
    window: {},
    document: { createElement },
    console,
    URL,
  }
  vm.runInNewContext(source, sandbox, { filename: "studio-setup-render.js" })

  const violin = { id: "violin", label: "바이올린", group: "서양", family: "현악기", detail: "선명하고 화려한 소리" }
  const cello = { id: "cello", label: "첼로", group: "서양", family: "현악기", detail: "깊고 풍부한 소리" }
  const state = {
    instrument: violin,
    group: violin.group,
    style: { id: "bright" },
    effectStampId: null,
    bgPreviewId: null,
    examplePreviewId: null,
    instrumentNotes: {},
    instrumentAnswerShown: {},
  }
  const el = {
    composeInstrumentList: createElement("div"),
    instrumentGroups: createElement("div"),
    instrumentGrid: createElement("div"),
    exportStatus: createElement("p"),
  }
  const draw = {
    setActiveInstrument() {},
    compute() {},
    render() {},
  }
  const engine = {
    stop() {},
    previewNote() {
      return Promise.resolve()
    },
  }
  const api = sandbox.window.HwaeumStudioSetupRender({
    state,
    el,
    D: { instruments: [violin, cello], atmospheres: [], backgrounds: {}, versions: [] },
    engine,
    draw,
    bgPreview: {},
    examplePreview: {},
    DEFAULT_DURATION_SECONDS: 30,
    DEFAULT_INSTRUMENT_FAMILY: "그 밖의 악기",
    INSTRUMENT_GROUPS: ["서양", "국악"],
    STUDENT_MUSIC_GROUP: "내가 찾은 음악",
    ATMOSPHERE_GROUP_ORDER: [],
    PIXABAY_MUSIC_URL: "https://example.test/music",
    CUSTOM_BG_COPYRIGHT_NOTICE: "notice",
    CUSTOM_BG_MAX_BYTES: 50,
    styleForInstrument() {
      return { id: "bright" }
    },
    setEraser() {},
    renderEffects() {},
    renderEffectStamps() {},
    recordUserAction() {},
    renderOrchestraLegend() {},
    renderPitchAxisLabels() {},
    updateReadouts() {},
    warmSelectedInstrument() {},
    applyMoodTint() {},
    syncBgPlayerUI() {},
    buildRecipe() {
      return { instrument: state.instrument.id }
    },
    defaultAtmosphere() {
      return { id: "none" }
    },
    applyInstrumentTone() {},
    getNextCustomBgId() {
      return "custom-1"
    },
  })

  return { api, el, state, violin, cello }
}

function noteFieldFor(el, id) {
  return descendants(el.instrumentGrid).find((node) => node.dataset.noteInstrument === id)
}

function answerFor(el, id) {
  return descendants(el.instrumentGrid).find((node) => node.className === "instrument-answer" && node.id === "instrumentAnswer-" + id)
}

function revealButtonFor(el, id) {
  return descendants(el.instrumentGrid).find(
    (node) => node.className === "instrument-answer-btn" && node.attributes["aria-controls"] === "instrumentAnswer-" + id,
  )
}

test("2단계 악기 카드는 설명(예시 답안)을 먼저 보여주지 않는다", () => {
  const { api, el } = createSetupHarness()

  api.renderInstruments()

  const cardCopy = descendants(el.instrumentGrid).filter((node) => node.className === "card-copy")
  assert.equal(cardCopy.length, 2)
  for (const copy of cardCopy) {
    assert.equal(copy.children.length, 1, "카드에는 악기 이름만 남는다")
    assert.equal(copy.children[0].tagName, "STRONG")
  }
  assert.deepEqual(
    cardCopy.map((copy) => copy.children[0].textContent),
    ["바이올린", "첼로"],
  )
})

test("악기 카드마다 감상 입력칸과 잠긴 예시 답안이 붙는다", () => {
  const { api, el } = createSetupHarness()

  api.renderInstruments()

  const slots = descendants(el.instrumentGrid).filter((node) => node.className.split(" ").includes("instrument-card-slot"))
  assert.equal(slots.length, 2)

  for (const id of ["violin", "cello"]) {
    const field = noteFieldFor(el, id)
    const answer = answerFor(el, id)
    const reveal = revealButtonFor(el, id)

    assert.ok(field, id + " 입력칸")
    assert.equal(field.tagName, "TEXTAREA")
    assert.equal(field.maxLength, 60)
    assert.equal(field.value, "")
    assert.ok(answer, id + " 예시 답안")
    assert.equal(answer.hidden, true, "예시 답안은 처음에 감춰져 있다")
    assert.ok(reveal, id + " 예시 답안 보기 버튼")
    assert.equal(reveal.textContent, "예시 답안 보기")
    assert.equal(reveal.attributes["aria-expanded"], "false")
    assert.equal(reveal.hidden, false)
  }

  assert.equal(answerFor(el, "violin").textContent, "선명하고 화려한 소리")
  assert.equal(answerFor(el, "cello").textContent, "깊고 풍부한 소리")
})

test("적은 느낌은 state에 남아 다시 그려도 살아 있다", () => {
  const { api, el, state } = createSetupHarness()

  api.renderInstruments()
  const field = noteFieldFor(el, "cello")
  field.value = "낮고 슬픈 느낌이야"
  field.listeners.input()

  assert.equal(state.instrumentNotes.cello, "낮고 슬픈 느낌이야")

  api.renderInstruments() // 연주곡이 끝나거나 악기를 고를 때마다 일어나는 재렌더
  assert.equal(noteFieldFor(el, "cello").value, "낮고 슬픈 느낌이야")
  assert.equal(noteFieldFor(el, "violin").value, "")
})

test("예시 답안 보기를 눌러야 답안이 열리고 재렌더 후에도 열린 채 남는다", () => {
  const { api, el, state } = createSetupHarness()

  api.renderInstruments()
  revealButtonFor(el, "violin").listeners.click()

  assert.equal(state.instrumentAnswerShown.violin, true)
  assert.equal(answerFor(el, "violin").hidden, false)
  assert.equal(revealButtonFor(el, "violin").hidden, true)
  assert.equal(revealButtonFor(el, "violin").attributes["aria-expanded"], "true")
  assert.equal(answerFor(el, "cello").hidden, true, "다른 악기 답안은 그대로 잠겨 있다")

  api.renderInstruments()
  assert.equal(answerFor(el, "violin").hidden, false)
  assert.equal(answerFor(el, "cello").hidden, true)
})

test("3단계 악기 버튼 설명은 그대로 둔다", () => {
  const { api, el } = createSetupHarness()

  api.renderComposeInstruments()

  const button = descendants(el.composeInstrumentList).find((node) => node.tagName === "BUTTON" && node.title)
  assert.ok(button)
  assert.match(button.title, /선명하고 화려한 소리/)
  assert.equal(descendants(el.composeInstrumentList).filter((node) => node.className === "instrument-note").length, 0)
})
