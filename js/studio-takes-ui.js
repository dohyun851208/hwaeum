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
    const title = take.name || (take.recipe && take.recipe.title) || ""
    if (title) {
      state.title = title
      if (el.titleInput) el.titleInput.value = title
    }
    deps.loadRecipe(take.recipe)
    renderTakes()
    el.exportStatus.textContent = "‘" + (title || "작품") + "’ 정보를 불러왔어요."
  }

  function playTake(take) {
    if (!take) return
    if (engine.isPlaying || engine.isPaused || engine.ambience) engine.stop()
    selectTake(take)
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
    if (state.playingTakeId === take.id) {
      state.playingTakeId = null
      engine.stop()
    }
    takes.remove(take.id)
    if (state.activeTakeId === take.id) state.activeTakeId = null
    if (state.playingTakeId === take.id) state.playingTakeId = null
    renderTakes()
  }

  function exportTakeAudio(take) {
    selectTake(take)
    deps.exportAudio()
  }

  function exportTakeImage(take) {
    selectTake(take)
    deps.exportCover()
  }

  function editTake(take) {
    selectTake(take)
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
      const atmosphere = D.atmospheres.find(function (item) {
        return item.id === take.recipe.atmosphere
      }) || deps.defaultAtmosphere()
      const wrap = doc.createElement("div")
      wrap.className = "take" + (take.id === state.activeTakeId ? " active" : "")
      wrap.tabIndex = 0
      wrap.title = "이 작품 정보 보기"
      wrap.addEventListener("click", function () {
        selectTake(take)
      })
      wrap.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          selectTake(take)
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
    if (!forceNew && !state.sharedRecipeLoaded && state.activeTakeId && typeof takes.update === "function") {
      take = takes.update(state.activeTakeId, recipe, name)
    }
    const updated = !!take
    if (!take) take = takes.add(recipe, name)
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
    el.exportStatus.textContent = message
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
  }
})
