/*
 * studio-reflection.js — 감상 메모 인계·성찰 입력·해시태그 UI.
 * state와 DOM을 주입받고 위저드 흐름은 studio.js에 맡긴다.
 */
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory
  else root.HwaeumStudioReflection = factory
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict"

  const { state, el, document, updateReadouts } = deps
  const { cleanText, normalizeHashtags, keywordText } = deps.utils
  const COMPOSER_NAME_MAX = deps.composerNameMax

  // 2단계에서 적은 감상을 4단계 성찰 칸으로 옮긴다. 여러 배경·악기를 들어보며 적어도
  // 실제로 고른 것 하나만 넘어간다. 학생이 4단계에서 그 칸을 손댄 뒤에는 덮어쓰지 않는다
  // — 공들여 고친 글이 2단계로 돌아가 메모를 만졌다는 이유로 사라지면 안 된다.
  function syncReflectionFromNotes() {
    const carry = [
      { key: "backgroundReason", note: state.backgroundNotes[state.atmosphere && state.atmosphere.id] },
      { key: "melodyIntent", note: state.instrumentNotes[state.instrument && state.instrument.id] },
    ]
    carry.forEach(function (item) {
      if (state.reflectionEdited[item.key]) return
      const next = cleanText(item.note || "", 180)
      if (state[item.key] === next) return
      state[item.key] = next
    })
    syncReflectionInputs()
  }

  function syncReflectionInputs() {
    if (el.composerInput && el.composerInput.value !== state.composerName) {
      el.composerInput.value = state.composerName
    }
    // 1단계 칸과 4단계 칸은 같은 값을 보여 준다(그림 하나에 생각 하나).
    ;[el.pictureThoughtInput, el.pictureThoughtCompletionInput].forEach(function (field) {
      if (field && field.value !== state.pictureThought) field.value = state.pictureThought
    })
    if (el.bgReasonInput && el.bgReasonInput.value !== state.backgroundReason) {
      el.bgReasonInput.value = state.backgroundReason
    }
    if (el.melodyIntentInput && el.melodyIntentInput.value !== state.melodyIntent) {
      el.melodyIntentInput.value = state.melodyIntent
    }
    if (el.hashtagsInput) {
      el.hashtagsInput.value = ""
      renderHashtagChips()
    }
  }

  // === § 15.5  설명 단어(해시태그 칩) ===
  // state.hashtags는 "따뜻함, 감정적인 노래"처럼 쉼표로 구분된 문자열.
  // 입력칸에 쉼표·엔터를 누르면 그 자리에서 #단어 칩이 된다.

  const HASHTAG_MAX = 3
  const HASHTAG_HELP_DEFAULT = "단어를 입력하고 엔터를 누르면 #태그로 분리됩니다. (최대 3개)"
  const HASHTAG_HELP_FULL = "태그는 3개까지예요. 지우려면 태그를 눌러 주세요."

  function hashtagList() {
    return normalizeHashtags(state.hashtags)
  }

  function setHashtags(tags) {
    state.hashtags = normalizeHashtags(tags).join(", ")
    renderHashtagChips()
    updateReadouts()
  }

  function renderHashtagChips() {
    if (!el.hashtagChipBox || !el.hashtagsInput) return
    el.hashtagChipBox.querySelectorAll(".hashtag-chip").forEach((chip) => chip.remove())
    const tags = hashtagList()
    tags.forEach((tag) => {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "hashtag-chip"
      chip.title = "누르면 지워요"
      chip.setAttribute("aria-label", "#" + tag + " 지우기")
      const text = document.createElement("span")
      text.textContent = "#" + tag
      const x = document.createElement("span")
      x.className = "hashtag-chip-x"
      x.setAttribute("aria-hidden", "true")
      x.textContent = "×"
      chip.appendChild(text)
      chip.appendChild(x)
      chip.addEventListener("click", () => {
        setHashtags(hashtagList().filter((item) => item !== tag))
        if (el.hashtagHelp) el.hashtagHelp.textContent = HASHTAG_HELP_DEFAULT
        el.hashtagsInput.focus()
      })
      el.hashtagChipBox.insertBefore(chip, el.hashtagsInput)
    })
    el.hashtagsInput.placeholder = tags.length ? "" : "따뜻함, 감정적인 노래"
    if (el.hashtagHelp && tags.length < HASHTAG_MAX) el.hashtagHelp.textContent = HASHTAG_HELP_DEFAULT
  }

  // 입력 중인 단어를 칩으로 확정한다. 저장·공유 직전에도 호출해 잃어버리지 않게.
  function commitHashtagInput() {
    if (!el.hashtagsInput) return
    const raw = el.hashtagsInput.value
    if (!raw.trim()) {
      el.hashtagsInput.value = ""
      return
    }
    const current = hashtagList()
    if (current.length >= HASHTAG_MAX) {
      if (el.hashtagHelp) el.hashtagHelp.textContent = HASHTAG_HELP_FULL
      return
    }
    el.hashtagsInput.value = ""
    setHashtags(current.join(",") + "," + raw)
  }

  function bind() {
    el.titleInput.addEventListener("input", () => {
      el.titleInput.classList.remove("field-invalid")
      state.title = el.titleInput.value || "무제"
    })
    if (el.composerInput) {
      el.composerInput.addEventListener("input", () => {
        el.composerInput.classList.remove("field-invalid")
        state.composerName = cleanText(el.composerInput.value, COMPOSER_NAME_MAX)
      })
    }
    // 1단계 칸과 4단계 칸은 같은 생각 하나를 나눠 쓴다 — 어느 쪽에 적어도 반대쪽에 그대로 보인다.
    ;[el.pictureThoughtInput, el.pictureThoughtCompletionInput].forEach(function (field) {
      if (!field) return
      field.addEventListener("input", () => {
        state.pictureThought = field.value
        const other = field === el.pictureThoughtInput ? el.pictureThoughtCompletionInput : el.pictureThoughtInput
        if (other && other.value !== field.value) other.value = field.value
      })
    })
    if (el.bgReasonInput) {
      el.bgReasonInput.addEventListener("input", () => {
        el.bgReasonInput.classList.remove("field-invalid")
        state.backgroundReason = el.bgReasonInput.value
        state.reflectionEdited.backgroundReason = true // 이후 2단계 메모가 덮지 않는다
      })
    }
    if (el.melodyIntentInput) {
      el.melodyIntentInput.addEventListener("input", () => {
        el.melodyIntentInput.classList.remove("field-invalid")
        state.melodyIntent = el.melodyIntentInput.value
        state.reflectionEdited.melodyIntent = true
      })
    }
    if (el.hashtagsInput) {
      el.hashtagsInput.addEventListener("keydown", (event) => {
        if (event.isComposing) return
        if (event.key === "," || event.key === "Enter") {
          event.preventDefault()
          commitHashtagInput()
        } else if (event.key === "Backspace" && !el.hashtagsInput.value) {
          const tags = hashtagList()
          if (tags.length) {
            event.preventDefault()
            setHashtags(tags.slice(0, -1))
          }
        }
      })
      el.hashtagsInput.addEventListener("input", () => {
        el.hashtagsInput.classList.remove("field-invalid")
        if (el.hashtagsInput.value.indexOf(",") !== -1) commitHashtagInput()
      })
      el.hashtagsInput.addEventListener("blur", commitHashtagInput)
    }
    if (el.hashtagChipBox && el.hashtagsInput) {
      el.hashtagChipBox.addEventListener("click", (event) => {
        if (event.target === el.hashtagChipBox) el.hashtagsInput.focus()
      })
    }
  }

  function restore(recipe) {
    state.pictureThought = recipe.pictureThought || ""
    state.backgroundReason = recipe.backgroundReason || ""
    state.melodyIntent = recipe.melodyIntent || ""
    state.hashtags = Array.isArray(recipe.hashtags) ? keywordText(recipe.hashtags) : recipe.hashtags || ""
    // 저장 작품의 성찰은 확정된 값이다. 다른 작품에서 적던 감상 메모로 덮지 않는다.
    state.reflectionEdited = { backgroundReason: true, melodyIntent: true }
  }

  return { syncReflectionFromNotes, syncReflectionInputs, commitHashtagInput, renderHashtagChips, hashtagList, bind, restore }
})
