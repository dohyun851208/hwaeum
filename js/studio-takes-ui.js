;(function (root, factory) {
  "use strict"

  if (typeof module === "object" && module.exports) module.exports = factory
  else root.HwaeumStudioTakesUI = factory
})(typeof globalThis !== "undefined" ? globalThis : this, function createStudioTakesUI(deps) {
  "use strict"

  deps = deps || {}
  const root = deps.root || (typeof globalThis !== "undefined" ? globalThis : this)
  const doc = deps.document || root.document
  const state = deps.state
  const el = deps.el
  const D = deps.D
  const engine = deps.engine
  const takes = deps.takes
  const StudioUtils = deps.StudioUtils
  const defaultCoverSrc = deps.defaultCoverSrc || "./assets/default-cover.webp"
  const composerNameMax = Number.isFinite(deps.composerNameMax) ? deps.composerNameMax : 24
  const drawingStep = Number.isFinite(deps.drawingStep) ? deps.drawingStep : 2
  // 안내 문구는 지금 보이는 단계의 안내 줄로 보낸다(3단계 저장도 3단계에 보이게).
  const say = typeof deps.say === "function" ? deps.say : (message) => { if (el && el.exportStatus) el.exportStatus.textContent = message }
  const DISCARD_CONFIRM_MESSAGE = "지금 작업에 저장하지 않은 내용이 있어요.\n다른 작품을 열면 지금 작업은 사라져요. 열까요?"
  const SAVE_FAILED_MESSAGES = {
    full: "내 작품은 " + ((takes && takes.maxTakes) || 24) + "개까지 저장할 수 있어요. 필요 없는 작품을 ✕로 지운 뒤 다시 저장해 주세요.",
    quota: "저장 공간이 가득 차서 저장하지 못했어요. 필요 없는 작품을 ✕로 지운 뒤 다시 저장해 주세요.",
    storage: "이 브라우저에서는 작품을 저장하지 못했어요. 음악 저장으로 파일을 따로 남겨 주세요.",
  }

  function confirmWith(message) {
    return typeof root.confirm !== "function" || root.confirm(message)
  }

  function hasUnsavedWork() {
    return typeof deps.hasUnsavedWork === "function" && deps.hasUnsavedWork()
  }

  function markWorkSaved() {
    if (typeof deps.markWorkSaved === "function") deps.markWorkSaved()
  }

  function renderTakeName(meta, take, number) {
    const row = doc.createElement("div")
    row.className = "take-name-line"
    const num = doc.createElement("span")
    num.className = "take-number"
    num.textContent = number + "번"
    row.appendChild(num)

    // 제목은 읽기 전용 텍스트로만 표시한다(시도별 제목 편집·저장 기능 제거).
    // 기본값 "무제"는 화면에서 "제목"으로 보여 준다.
    const rawTitle = take.name || (take.recipe && take.recipe.title) || ""
    const titleText = doc.createElement("span")
    titleText.className = "take-name-text"
    titleText.textContent = rawTitle && rawTitle !== "무제" ? rawTitle : "제목"
    row.appendChild(titleText)

    meta.appendChild(row)
  }

  function takeDisplayTitle(take) {
    const rawTitle = (take && (take.name || (take.recipe && take.recipe.title))) || ""
    return rawTitle && rawTitle !== "무제" ? rawTitle : "제목"
  }

  // 카드에 보일 배경 이름. '내가 찾은 음악' 파일이 이 컴퓨터에 없으면 이름에 다시 올려야 한다고 덧붙인다.
  function atmosphereForTake(take) {
    const recipe = (take && take.recipe) || {}
    const found = D.atmospheres.find(function (item) {
      return item.id === recipe.atmosphere
    })
    if (found && !found.missing) return found
    const fallback = deps.defaultAtmosphere()
    const isCustom = typeof recipe.atmosphere === "string" && recipe.atmosphere.indexOf("custom-") === 0
    if (!isCustom) return found || fallback
    const label = (found && found.label) || recipe.atmosphereLabel || "내가 찾은 음악"
    return Object.assign({}, found || fallback, { label: label + " (파일 다시 올리기)" })
  }

  function takePictureSrc(take) {
    const recipe = (take && take.recipe) || {}
    return StudioUtils.normalizePictureData(recipe.picture) || defaultCoverSrc
  }

  function makeTakeActionButton(label, title, handler) {
    const button = doc.createElement("button")
    button.type = "button"
    button.className = "btn tiny take-action"
    button.textContent = label
    button.title = title
    button.addEventListener("click", function (event) {
      event.stopPropagation()
      handler()
    })
    return button
  }

  function selectTake(take) {
    if (!take) return
    state.sharedRecipeLoaded = false
    state.activeTakeId = take.id
    const rawTitle = take.name || (take.recipe && take.recipe.title) || ""
    const title = rawTitle === "무제" ? "" : rawTitle
    state.title = title
    if (el.titleInput) el.titleInput.value = title
    const loaded = deps.loadRecipe(take.recipe)
    markWorkSaved()
    renderTakes()
    const notice = loaded && loaded.notice ? " " + loaded.notice : ""
    say("‘" + (title || "작품") + "’ 정보를 불러왔어요." + notice, notice ? { duration: 9000 } : undefined)
  }

  // 카드의 단추·카드 누르기로 작품을 연다. 이미 열려 있는 작품이면 다시 불러오지 않고 지금 모습 그대로 쓴다
  // (불러오면 고친 내용과 되돌리기 기록이 사라진다). 다른 작품을 열 때 저장하지 않은 작업이 있으면 먼저 묻는다.
  function openTake(take) {
    if (!take) return false
    if (take.id === state.activeTakeId && !state.sharedRecipeLoaded) return true
    if (hasUnsavedWork() && !confirmWith(DISCARD_CONFIRM_MESSAGE)) return false
    selectTake(take)
    return true
  }

  function playTake(take) {
    if (!take) return
    if (!openTake(take)) return
    if (engine.isPlaying || engine.isPaused || engine.ambience) engine.stop()
    state.playingTakeId = take.id
    deps.play()
    renderTakes()
  }

  function toggleTakePause(take) {
    if (!take || state.playingTakeId !== take.id) return
    deps.pause()
    renderTakes()
  }

  function removeTake(take) {
    if (!confirmWith("‘" + takeDisplayTitle(take) + "’ 작품을 지울까요?\n지운 작품은 다시 살릴 수 없어요.")) return
    if (state.playingTakeId === take.id) {
      state.playingTakeId = null
      engine.stop()
    }
    if (takes.remove(take.id) === false) {
      say(SAVE_FAILED_MESSAGES[takes.lastError] || SAVE_FAILED_MESSAGES.storage, { error: true })
      return
    }
    if (state.activeTakeId === take.id) state.activeTakeId = null
    if (state.playingTakeId === take.id) state.playingTakeId = null
    renderTakes()
  }

  function exportTakeAudio(take) {
    if (!openTake(take)) return
    deps.exportAudio()
  }

  function exportTakeImage(take) {
    if (!openTake(take)) return
    deps.exportCover()
  }

  function editTake(take) {
    if (!openTake(take)) return
    deps.setStep(drawingStep)
    if (el.statusText) el.statusText.textContent = "작품 수정"
  }

  function renderTakes() {
    const items = state.sharedRecipeLoaded ? [] : takes.list()
    el.takesList.innerHTML = ""
    el.takesEmpty.style.display = items.length ? "none" : "block"
    el.takesEmpty.textContent = state.sharedRecipeLoaded
      ? "공유 링크로 불러온 곡입니다. 저장하면 내 작품에 추가됩니다."
      : "드로잉 후 저장하면 여기에 모입니다. 같은 작품은 저장할 때마다 다시 덮어씁니다."
    el.takesCount.textContent = items.length ? items.length + "개" : ""

    items.forEach(function (take, index) {
      const atmosphere = atmosphereForTake(take)
      const wrap = doc.createElement("div")
      wrap.className = "take" + (take.id === state.activeTakeId ? " active" : "")
      wrap.tabIndex = 0
      wrap.title = "이 작품 정보 보기"
      wrap.addEventListener("click", function () {
        openTake(take)
      })
      wrap.addEventListener("keydown", function (event) {
        // 카드 안 단추에서 누른 Enter·스페이스는 그 단추가 처리한다.
        if (event.target !== wrap) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openTake(take)
        }
      })

      const cover = doc.createElement("div")
      cover.className = "take-cover"
      const coverImg = doc.createElement("img")
      coverImg.className = "take-cover-img"
      coverImg.alt = takeDisplayTitle(take) + " 그림"
      coverImg.src = takePictureSrc(take)
      coverImg.addEventListener("error", function () {
        if (coverImg.src !== defaultCoverSrc) coverImg.src = defaultCoverSrc
      })
      cover.appendChild(coverImg)

      const thumbnail = doc.createElement("canvas")
      thumbnail.width = 160
      thumbnail.height = 100
      thumbnail.className = "take-thumb"
      deps.renderThumbnail(thumbnail, take.recipe, atmosphere.color)
      cover.appendChild(thumbnail)

      const meta = doc.createElement("div")
      meta.className = "take-meta"
      renderTakeName(meta, take, index + 1)
      const detail = doc.createElement("span")
      detail.className = "take-detail"
      detail.textContent =
        atmosphere.label +
        " · " +
        deps.usedInstrumentLabelsForRecipe(take.recipe) +
        " · " +
        StudioUtils.secondsLabel(take.recipe.duration)
      meta.appendChild(detail)
      if (take.recipe && take.recipe.composerName) {
        const composer = doc.createElement("span")
        composer.className = "take-composer"
        composer.textContent = "작곡가 " + StudioUtils.cleanText(take.recipe.composerName, composerNameMax)
        meta.appendChild(composer)
      }
      const tags = StudioUtils.normalizeHashtags(take.recipe && take.recipe.hashtags)
      if (tags.length) {
        const tagLine = doc.createElement("span")
        tagLine.className = "take-tags"
        tagLine.textContent = StudioUtils.hashtagText(tags)
        meta.appendChild(tagLine)
      }

      const tools = doc.createElement("div")
      tools.className = "take-tools"
      const isPlayingTake =
        state.playingTakeId === take.id && (engine.isPlaying || engine.isPaused || !!engine.ambience)
      const isPausedTake = isPlayingTake && engine.isPaused
      const playButton = doc.createElement("button")
      playButton.type = "button"
      playButton.className = "btn tiny primary take-play"
      playButton.textContent = "▶"
      playButton.title = "이 작품 처음부터 듣기"
      playButton.setAttribute("aria-label", (take.name || "작품") + " 처음부터 듣기")
      playButton.addEventListener("click", function (event) {
        event.stopPropagation()
        playTake(take)
      })
      const pauseButton = doc.createElement("button")
      pauseButton.type = "button"
      pauseButton.className = "btn tiny take-pause"
      pauseButton.textContent = isPausedTake ? "▶" : "❚❚"
      pauseButton.title = isPausedTake ? "이어 듣기" : "일시정지"
      pauseButton.disabled = !isPlayingTake
      pauseButton.setAttribute(
        "aria-label",
        (take.name || "작품") + " " + (isPausedTake ? "이어 듣기" : "일시정지"),
      )
      pauseButton.addEventListener("click", function (event) {
        event.stopPropagation()
        if (isPlayingTake) toggleTakePause(take)
      })
      const deleteButton = doc.createElement("button")
      deleteButton.type = "button"
      deleteButton.className = "btn tiny"
      deleteButton.textContent = "✕"
      deleteButton.title = "삭제"
      deleteButton.addEventListener("click", function (event) {
        event.stopPropagation()
        removeTake(take)
      })
      tools.appendChild(playButton)
      tools.appendChild(pauseButton)
      tools.appendChild(deleteButton)

      const actions = doc.createElement("div")
      actions.className = "take-actions"
      actions.appendChild(
        makeTakeActionButton("음악 저장", "이 작품의 음악을 WebM으로 저장", function () {
          exportTakeAudio(take)
        }),
      )
      actions.appendChild(
        makeTakeActionButton("이미지 저장", "이 작품의 커버 이미지를 PNG로 저장", function () {
          exportTakeImage(take)
        }),
      )
      actions.appendChild(
        makeTakeActionButton("수정", "이 작품을 3단계에서 수정", function () {
          editTake(take)
        }),
      )

      wrap.appendChild(cover)
      wrap.appendChild(meta)
      wrap.appendChild(tools)
      wrap.appendChild(actions)
      el.takesList.appendChild(wrap)
    })
  }

  function saveTakeWithMode(forceNew) {
    if (!deps.requireDrawn()) return
    deps.commitHashtagInput() // 아직 칩이 안 된 단어도 잃지 않게
    const recipe = deps.buildRecipe()
    const name = state.title
    let take = null
    let updateFailed = false
    if (!forceNew && !state.sharedRecipeLoaded && state.activeTakeId && typeof takes.update === "function") {
      take = takes.update(state.activeTakeId, recipe, name)
      // 지워진 작품이면(lastError 없음) 새로 더하고, 저장 공간 때문에 실패했으면 더하지 않는다.
      updateFailed = !take && !!takes.lastError
    }
    const updated = !!take
    if (!take && !updateFailed) take = takes.add(recipe, name)
    if (!take) {
      renderTakes()
      say(SAVE_FAILED_MESSAGES[takes.lastError] || SAVE_FAILED_MESSAGES.storage, { error: true, duration: 9000 })
      return null
    }
    markWorkSaved()
    state.activeTakeId = take.id
    state.sharedRecipeLoaded = false
    renderTakes()
    const message = updated
      ? "현재 작품을 다시 저장했어요."
      : forceNew
        ? "새 작품으로 저장했어요."
        : "내 작품에 저장했어요."
    if (state.step === drawingStep && el.statusText) {
      el.statusText.textContent = updated ? "다시 저장했어요" : "저장했어요"
    }
    say(message)
    return take
  }

  function saveTake() {
    return saveTakeWithMode(false)
  }

  function saveNewTake() {
    return saveTakeWithMode(true)
  }

  return {
    renderTakes,
    saveTake,
    saveNewTake,
    selectTake,
    openTake,
    removeTake,
  }
})
