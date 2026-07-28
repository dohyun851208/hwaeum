/*
 * channel.js — 화음 갤러리 전용 감상 화면.
 */
;(function (root) {
  "use strict"

  const ShareStore = root.HwaeumShareStore
  const DEFAULT_COVER_SRC = "./assets/default-cover.webp"
  const WORKS_PER_SHELF = 7
  const VIEW_MODE_SHELF = "shelf"
  const VIEW_MODE_FLOW = "flow"
  const VIEW_MODE_STORAGE_KEY = "hwaeum.channelViewMode"
  const WORK_ORDER_STORAGE_PREFIX = "hwaeum.channelWorkOrder."
  const STUDIO_COPY_STORAGE_PREFIX = "hwaeum.studioCopy."
  const STUDENT_UPLOAD_ATMOSPHERE_PREFIX = "custom-"
  const COVERFLOW_SPACING = 236
  // 확대해서 보기 프레임 계산용 — styles.css의 .channel-viewer-panel과 짝.
  const VIEWER_INFO_COLUMN = 340 // 정보 칸 너비(px)
  const VIEWER_PANEL_GAP = 16 // 무대·정보 칸 사이 간격(px)
  const VIEWER_PANEL_CHROME = 28 // 패널 안쪽 여백 14px × 2
  const VIEWER_SCREEN_MARGIN = 96 // 화면 가장자리 최소 여유(px)
  const VIEWER_STAGE_MIN = { width: 320, height: 340 }
  const VIEWER_STAGE_MAX = { width: 1100, height: 780 }
  // 학생 그림은 저화질이 많아 크게 늘리면 뭉개져 보인다 — 비율은 유지한 채 25% 줄여 연다.
  const VIEWER_STAGE_SCALE = 0.75

  const $ = (id) => document.getElementById(id)
  const el = {
    body: document.body,
    menuBtn: $("channelMenuBtn"),
    menu: $("channelMenu"),
    backBtn: $("channelBackBtn"),
    adminPin: $("channelAdminPin"),
    adminFlag: $("channelAdminFlag"),
    title: $("channelTitle"),
    count: $("channelCount"),
    form: $("channelOpenForm"),
    shareBtn: $("channelShareBtn"),
    input: $("channelInput"),
    codeInput: $("channelCodeInput"),
    library: $("channelLibrary"),
    status: $("channelStatus"),
    viewbar: $("channelViewbar"),
    nameInput: $("channelNameInput"),
    renameBtn: $("channelRenameBtn"),
    renameModal: $("renameModal"),
    renameModalForm: $("renameModalForm"),
    renameAdminPinInput: $("renameAdminPinInput"),
    renameNameInput: $("renameNameInput"),
    renameModalError: $("renameModalError"),
    renameModalCloseBtn: $("renameModalCloseBtn"),
    renameModalCancelBtn: $("renameModalCancelBtn"),
    renameModalSubmitBtn: $("renameModalSubmitBtn"),
    deleteChannelBtn: $("channelDeleteBtn"),
    shelfModeBtn: $("channelShelfModeBtn"),
    flowModeBtn: $("channelFlowModeBtn"),
    flowPrevBtn: $("channelFlowPrevBtn"),
    flowNextBtn: $("channelFlowNextBtn"),
    flowStage: null,
    flowCount: null,
    shelves: $("channelShelves"),
    empty: $("channelEmpty"),
    viewer: $("channelViewer"),
    viewerPanel: $("viewerPanel"),
    viewerClose: $("viewerCloseBtn"),
    viewerBackdrop: $("viewerBackdrop"),
    viewerCover: $("viewerCover"),
    viewerPlay: $("viewerPlayBtn"),
    viewerTitle: $("viewerTitle"),
    viewerComposerRow: $("viewerComposerRow"),
    viewerComposer: $("viewerComposer"),
    viewerAtmosphereRow: $("viewerAtmosphereRow"),
    viewerAtmosphere: $("viewerAtmosphere"),
    viewerInstrumentRow: $("viewerInstrumentRow"),
    viewerInstrument: $("viewerInstrument"),
    viewerActionCount: $("viewerActionCount"),
    viewerAudio: $("viewerAudio"),
    viewerBackgroundCard: $("viewerBackgroundCard"),
    viewerBackground: $("viewerBackground"),
    viewerMelodyCard: $("viewerMelodyCard"),
    viewerMelody: $("viewerMelody"),
    viewerTags: $("viewerTags"),
    viewerDrawing: $("viewerDrawingBtn"),
    viewerCopy: $("viewerCopyBtn"),
    viewerDelete: $("viewerDeleteBtn"),
  }

  const state = {
    channel: "",
    works: [],
    loading: false,
    activeWork: null,
    adminPin: "",
    channelMeta: null,
    locked: false,
    pass: "",
    openedFromHash: false,
    viewMode: loadViewMode(),
    flowIndex: 0,
    flowPosition: 0,
    flowCards: [],
    flowDragMoved: false,
    shelfDragWorkId: "",
    shelfDragMoved: false,
    shelfDropPosition: "",
    suppressAlbumClick: false,
  }
  const generatedDrawingUrls = new Map()

  function cleanText(value, max) {
    const text = String(value || "").replace(/\s+/g, " ").trim()
    return max ? text.slice(0, max) : text
  }

  function normalizeChannel(value) {
    if (!ShareStore || !ShareStore.normalizeChannel) return String(value || "").replace(/\D/g, "").slice(0, 4)
    return ShareStore.normalizeChannel(value)
  }

  function channelFromUrl() {
    try {
      const params = new URL(location.href).searchParams
      return normalizeChannel(params.get("channel") || params.get("shareChannel") || "")
    } catch (e) {
      return ""
    }
  }

  function workIdFromHash() {
    const hash = location.hash || ""
    if (hash.indexOf("#work=") === 0) return decodeURIComponent(hash.slice(6))
    return ""
  }

  function channelUrl(channel, workId) {
    try {
      const url = new URL("./channel.html", location.href)
      const normalized = normalizeChannel(channel || state.channel)
      url.search = normalized ? "?channel=" + encodeURIComponent(normalized) : ""
      url.hash = workId ? "work=" + encodeURIComponent(workId) : ""
      return url.href
    } catch (e) {
      const normalized = encodeURIComponent(String(channel || state.channel || "").trim())
      return "./channel.html" + (normalized ? "?channel=" + normalized : "") + (workId ? "#work=" + encodeURIComponent(workId) : "")
    }
  }

  function studioUrl() {
    try {
      return new URL("./studio.html", location.href).href
    } catch (e) {
      return "./studio.html"
    }
  }

  function studioCopyUrl(token) {
    try {
      const url = new URL("./studio.html", location.href)
      url.search = ""
      url.hash = "copy=" + encodeURIComponent(token)
      return url.href
    } catch (e) {
      return "./studio.html#copy=" + encodeURIComponent(token)
    }
  }

  function studioCopyToken() {
    try {
      const bytes = new Uint32Array(2)
      root.crypto.getRandomValues(bytes)
      return bytes[0].toString(36) + bytes[1].toString(36) + Date.now().toString(36)
    } catch (e) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36)
    }
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}))
  }

  function studioCopyRecipe(work) {
    const recipe = cloneJson(work && work.recipe)
    if (String(recipe.atmosphere || "").indexOf(STUDENT_UPLOAD_ATMOSPHERE_PREFIX) === 0) {
      recipe.atmosphere = "none"
      recipe.bgOffset = 0
      recipe.bgEndOffset = 0
    }
    recipe.copySource = "channel"
    return recipe
  }

  function storeStudioCopy(work) {
    if (!root.localStorage) throw new Error("브라우저 저장소를 사용할 수 없어요.")
    const token = studioCopyToken()
    root.localStorage.setItem(
      STUDIO_COPY_STORAGE_PREFIX + token,
      JSON.stringify({
        createdAt: Date.now(),
        recipe: studioCopyRecipe(work),
      }),
    )
    return token
  }

  function setStatus(text, error) {
    if (!el.status) return
    el.status.textContent = text || ""
    el.status.classList.toggle("error", !!error)
  }

  function loadViewMode() {
    try {
      const value = root.localStorage ? root.localStorage.getItem(VIEW_MODE_STORAGE_KEY) : ""
      return value === VIEW_MODE_FLOW ? VIEW_MODE_FLOW : VIEW_MODE_SHELF
    } catch (e) {
      return VIEW_MODE_SHELF
    }
  }

  function saveViewMode(mode) {
    try {
      if (root.localStorage) root.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch (e) {}
  }

  function workOrderStorageKey(channel) {
    const normalized = normalizeChannel(channel)
    return normalized ? WORK_ORDER_STORAGE_PREFIX + normalized : ""
  }

  function loadWorkOrder(channel) {
    const key = workOrderStorageKey(channel)
    if (!key) return []
    try {
      const value = root.localStorage ? root.localStorage.getItem(key) : ""
      const parsed = value ? JSON.parse(value) : []
      return Array.isArray(parsed)
        ? parsed
            .map(function (id) {
              return cleanText(id, 80)
            })
            .filter(Boolean)
        : []
    } catch (e) {
      return []
    }
  }

  function saveWorkOrder() {
    const key = workOrderStorageKey(state.channel)
    if (!key) return
    try {
      if (root.localStorage) {
        root.localStorage.setItem(
          key,
          JSON.stringify(
            state.works
              .map(function (work) {
                return work && work.id
              })
              .filter(Boolean),
          ),
        )
      }
    } catch (e) {}
  }

  function applyStoredWorkOrder(works, channel) {
    const list = Array.isArray(works) ? works.slice() : []
    const order = loadWorkOrder(channel)
    if (!order.length || list.length < 2) return list
    const byId = new Map()
    list.forEach(function (work) {
      if (work && work.id) byId.set(work.id, work)
    })
    const ordered = []
    order.forEach(function (id) {
      const work = byId.get(id)
      if (!work) return
      ordered.push(work)
      byId.delete(id)
    })
    list.forEach(function (work) {
      if (work && work.id && byId.has(work.id)) {
        ordered.push(work)
        byId.delete(work.id)
      }
    })
    return ordered
  }

  function clampFlowIndex(index) {
    const max = Math.max(0, state.works.length - 1)
    return Math.max(0, Math.min(max, Number(index) || 0))
  }

  function setViewMode(mode) {
    const next = mode === VIEW_MODE_FLOW ? VIEW_MODE_FLOW : VIEW_MODE_SHELF
    if (state.viewMode === next) {
      syncViewModeUI()
      return
    }
    state.viewMode = next
    saveViewMode(next)
    renderShelves()
  }

  function setFlowIndex(index) {
    const next = clampFlowIndex(index)
    state.flowIndex = next
    state.flowPosition = next
    // 카드를 이미 만들어 둔 경우엔 통째로 다시 그리지 않고 자리만 부드럽게 옮긴다.
    // (DOM을 새로 만들면 CSS transition이 끊겨서 뚝뚝 끊겨 보인다.)
    if (state.viewMode === VIEW_MODE_FLOW && state.flowCards.length) {
      setFlowDragging(false)
      layoutFlowCards(next)
      updateFlowCounter()
      syncViewModeUI()
      return
    }
    renderShelves()
  }

  function shiftFlowIndex(delta) {
    setFlowIndex(state.flowIndex + delta)
  }

  function setFlowDragging(on) {
    if (el.flowStage) el.flowStage.classList.toggle("is-dragging", !!on)
  }

  // position(소수 가능)에 맞춰 각 카드의 변형 변수만 갱신한다. 드래그 중에는
  // position이 2.37처럼 연속값이라 커버가 손가락을 1:1로 따라온다.
  function layoutFlowCards(position) {
    if (!state.flowCards.length) return
    const center = clampFlowIndex(Math.round(position))
    state.flowCards.forEach(function (card, index) {
      applyFlowCardStyle(card, index - position)
      card.classList.toggle("is-center", index === center)
    })
  }

  function updateFlowCounter() {
    if (!el.flowCount) return
    el.flowCount.textContent = state.flowIndex + 1 + " / " + state.works.length
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false
    const tag = target.tagName.toLowerCase()
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable
  }

  function setMenuOpen(open) {
    if (!el.menu || !el.menuBtn) return
    el.menu.hidden = !open
    el.menuBtn.setAttribute("aria-expanded", open ? "true" : "false")
  }

  function normalizeActionCount(value) {
    const n = Math.floor(Number(value) || 0)
    return Math.max(0, n)
  }

  function workActionCount(work) {
    const meta = (work && work.metadata) || {}
    const recipe = (work && work.recipe) || {}
    return normalizeActionCount(meta.actionCount != null ? meta.actionCount : recipe.actionCount)
  }

  function actionCountLine(work) {
    return "시도한 횟수 " + workActionCount(work) + "회"
  }

  function tagsText(tags) {
    if (!Array.isArray(tags) || !tags.length) return ""
    return tags
      .map((tag) => cleanText(tag, 24))
      .filter(Boolean)
      .map((tag) => "#" + tag)
      .join(" ")
  }

  function workTitle(work) {
    const meta = (work && work.metadata) || {}
    return cleanText((work && work.title) || meta.title || "무제", 80)
  }

  function workComposer(work) {
    const meta = (work && work.metadata) || {}
    return cleanText(meta.composerName, 24)
  }

  function workDisplayTitle(work) {
    const title = workTitle(work)
    const composer = workComposer(work)
    return composer ? title + " (" + composer + ")" : title
  }

  function workDescriptionLine(work) {
    const meta = (work && work.metadata) || {}
    return [
      cleanText(meta.atmosphereLabel, 32),
      cleanText(meta.instrumentLabel, 72),
    ]
      .filter(Boolean)
      .join(" · ")
  }

  function workViewerMeta(work) {
    const meta = (work && work.metadata) || {}
    return {
      composer: workComposer(work) || "작곡가 이름 없음",
      atmosphere: cleanText(meta.atmosphereLabel, 32),
      instrument: cleanText(meta.instrumentLabel, 72),
      actionCount: actionCountLine(work),
    }
  }

  function recipePictureUrl(work) {
    const picture = work && work.recipe && typeof work.recipe.picture === "string" ? work.recipe.picture.trim() : ""
    return /^data:image\//.test(picture) ? picture : ""
  }

  function coverUrl(work, large) {
    const files = (work && work.files) || {}
    return recipePictureUrl(work) || (large ? files.coverUrl || files.thumbUrl : files.thumbUrl || files.coverUrl) || DEFAULT_COVER_SRC
  }

  function shouldShowCoverPlayOverlay(work) {
    const meta = (work && work.metadata) || {}
    return meta.coverHasEmbeddedPlay === false
  }

  function musicUrl(work) {
    const files = (work && work.files) || {}
    return files.musicUrl || ""
  }

  function drawingUrl(work) {
    const files = (work && work.files) || {}
    return files.drawingUrl || files.drawingImageUrl || ""
  }

  function canDeleteActive() {
    return !!state.activeWork
  }

  function canCopyActive() {
    return !!(state.activeWork && ShareStore && ShareStore.copyWork)
  }

  const ADMIN_PIN_SESSION_KEY = "hwaeum.adminPin"
  const CHANNEL_ENTRY_PASS_SESSION_KEY = "hwaeum.channelEntryPass"
  function loadStashedAdminPin() {
    try {
      const s = root.sessionStorage
      return s ? (s.getItem(ADMIN_PIN_SESSION_KEY) || "").trim() : ""
    } catch (e) {
      return ""
    }
  }

  function loadStashedChannelPass(channel) {
    const normalized = normalizeChannel(channel)
    try {
      const s = root.sessionStorage
      if (!s || !normalized) return ""
      const raw = s.getItem(CHANNEL_ENTRY_PASS_SESSION_KEY)
      if (!raw) return ""
      s.removeItem(CHANNEL_ENTRY_PASS_SESSION_KEY)
      const parsed = JSON.parse(raw)
      if (!parsed || normalizeChannel(parsed.channel) !== normalized) return ""
      return ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(parsed.pass) : String(parsed.pass || "").replace(/\D/g, "").slice(0, 6)
    } catch (e) {
      return ""
    }
  }

  // 한 번 입장한 갤러리의 코드는 브라우저에 남는다 — 새로고침해도 다시 묻지 않게.
  function savedChannelPass(channel) {
    return ShareStore && ShareStore.loadPass ? ShareStore.loadPass(channel) : ""
  }

  function setAdminPin(pin) {
    state.adminPin = String(pin || "").trim()
    if (el.adminPin && el.adminPin.value !== state.adminPin) el.adminPin.value = state.adminPin
    try {
      const s = root.sessionStorage
      if (s) {
        if (state.adminPin) s.setItem(ADMIN_PIN_SESSION_KEY, state.adminPin)
        else s.removeItem(ADMIN_PIN_SESSION_KEY)
      }
    } catch (e) {}
    updateAdminIndicator()
    if (state.activeWork && el.viewerDelete) el.viewerDelete.hidden = !canDeleteActive()
  }

  function prefillAdminPin(pin) {
    if (el.adminPin) el.adminPin.value = String(pin || "").trim()
  }

  function currentGalleryPass() {
    return ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(state.pass) : String(state.pass || "").replace(/\D/g, "").slice(0, 6)
  }

  function promptTrimmed(message, fallback) {
    if (typeof root.prompt !== "function") return null
    const value = root.prompt(message, fallback || "")
    return value == null ? null : String(value).trim()
  }

  function updateAdminIndicator() {
    const on = !!state.adminPin
    if (el.adminFlag) el.adminFlag.hidden = !on
    el.body.classList.toggle("channel-admin-on", on)
  }

  function channelDisplayName() {
    const meta = state.channelMeta || {}
    return cleanText(meta.displayName || "", 40)
  }

  function updateHeader() {
    const channel = state.channel
    const name = channelDisplayName()
    if (el.title) {
      el.title.textContent = name || "화음 갤러리"
      // 제목 텍스트를 새로 쓰면 관리자 배지 span이 지워지므로 다시 붙여 준다.
      if (el.adminFlag) el.title.appendChild(el.adminFlag)
    }
    el.count.textContent = state.loading
      ? "화음 갤러리를 불러옵니다."
      : channel
        ? ""
        : "번호를 입력해 주세요."
    if (el.input && document.activeElement !== el.input) {
      el.input.value = channel || ""
      el.input.placeholder = channel ? "" : "번호"
    }
    // 기억해 둔 갤러리 코드는 입력칸에 미리 채워 둔다 — 열려 있으면 다시 칠 필요가 없다.
    if (el.codeInput && document.activeElement !== el.codeInput) {
      el.codeInput.value = state.locked ? "" : state.pass || ""
    }
    if (el.shareBtn) el.shareBtn.hidden = !channel || state.locked || state.loading
    if (el.nameInput && document.activeElement !== el.nameInput) el.nameInput.value = name
  }

  function syncViewModeUI() {
    const flow = state.viewMode === VIEW_MODE_FLOW
    const hasWorks = state.works.length > 0
    const canMove = flow && state.works.length > 1
    if (el.library) el.library.classList.toggle("channel-flow-mode", flow)
    if (el.shelfModeBtn) {
      el.shelfModeBtn.classList.toggle("active", !flow)
      el.shelfModeBtn.setAttribute("aria-pressed", flow ? "false" : "true")
    }
    if (el.flowModeBtn) {
      el.flowModeBtn.classList.toggle("active", flow)
      el.flowModeBtn.setAttribute("aria-pressed", flow ? "true" : "false")
    }
    if (el.flowPrevBtn) el.flowPrevBtn.disabled = !canMove || state.flowIndex <= 0
    if (el.flowNextBtn) el.flowNextBtn.disabled = !canMove || state.flowIndex >= state.works.length - 1
    if (el.body) el.body.dataset.galleryView = flow ? VIEW_MODE_FLOW : VIEW_MODE_SHELF
    if (el.shelves) el.shelves.classList.toggle("channel-shelves-flow", flow && hasWorks)
  }

  function playIconSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    svg.classList.add("channel-play-icon")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.98-6.86a1.04 1.04 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14z")
    svg.appendChild(path)
    return svg
  }

  function createAlbumCard(work, index, options) {
    options = options || {}
    const meta = work.metadata || {}
    const button = document.createElement("button")
    button.type = "button"
    button.className = "channel-album" + (options.className ? " " + options.className : "")
    button.id = "work-" + work.id
    button.dataset.workId = work.id
    button.style.setProperty("--lift", String((index % 4) * 10) + "px")
    button.setAttribute("aria-label", options.ariaLabel || workDisplayTitle(work) + " 크게 보기")

    const cover = document.createElement("span")
    cover.className = "channel-album-cover"
    const img = document.createElement("img")
    img.src = coverUrl(work, false)
    img.alt = workDisplayTitle(work) + " 표지"
    img.loading = "lazy"
    const overlay = document.createElement("span")
    overlay.className = "channel-album-overlay"
    const title = document.createElement("strong")
    title.textContent = workDisplayTitle(work)
    const tags = document.createElement("span")
    tags.textContent = tagsText(meta.hashtags) || [meta.atmosphereLabel, meta.instrumentLabel].filter(Boolean).join(" · ")

    overlay.appendChild(title)
    overlay.appendChild(tags)
    cover.appendChild(img)
    if (shouldShowCoverPlayOverlay(work)) {
      const play = document.createElement("span")
      play.className = "channel-album-play"
      play.appendChild(playIconSvg())
      cover.appendChild(play)
    }
    cover.appendChild(overlay)
    button.appendChild(cover)
    button.addEventListener("click", function () {
      if (state.suppressAlbumClick) return
      if (typeof options.onClick === "function") options.onClick(work, index)
      else openViewer(work, { updateHash: true })
    })
    if (options.draggable) bindShelfReorder(button, work)
    return button
  }

  function applyFlowCardStyle(card, offset) {
    const abs = Math.abs(offset)
    const sign = offset === 0 ? 0 : offset > 0 ? 1 : -1
    const visible = abs <= 4.6
    const clamped = Math.max(-4, Math.min(4, offset))
    const x = clamped * COVERFLOW_SPACING
    // 회전은 가운데(0)에서 옆칸(±1)까지 부드럽게 ±58도로 차오른 뒤 그대로 유지한다.
    const rotate = -sign * Math.min(abs, 1) * 58
    const z = -Math.min(abs, 4) * 112
    const scale = Math.max(0.62, 1 - Math.min(abs, 4) * 0.08)
    const opacity = visible ? Math.max(0.18, 1 - abs * 0.15) : 0
    card.style.setProperty("--flow-x", x.toFixed(1) + "px")
    card.style.setProperty("--flow-rotate", rotate.toFixed(1) + "deg")
    card.style.setProperty("--flow-z", z.toFixed(1) + "px")
    card.style.setProperty("--flow-scale", scale.toFixed(3))
    card.style.setProperty("--flow-opacity", opacity.toFixed(2))
    card.style.zIndex = String(Math.round(100 - Math.min(abs, 90)))
    card.tabIndex = visible ? 0 : -1
    card.style.pointerEvents = visible ? "" : "none"
    if (visible) card.removeAttribute("aria-hidden")
    else card.setAttribute("aria-hidden", "true")
  }

  function renderCoverFlow() {
    state.flowIndex = clampFlowIndex(state.flowIndex)
    state.flowPosition = state.flowIndex
    const section = document.createElement("section")
    section.className = "channel-coverflow"
    section.setAttribute("aria-label", "커버플로우 보기")

    const stage = document.createElement("div")
    stage.className = "channel-coverflow-stage"
    stage.setAttribute("role", "listbox")
    state.flowCards = state.works.map(function (work, index) {
      const card = createAlbumCard(work, index, {
        className: "channel-flow-album",
        ariaLabel: workDisplayTitle(work) + " 크게 보기",
        onClick: function () {
          // 어느 앨범을 눌러도 바로 뷰어를 연다.
          openViewer(work, { updateHash: true })
        },
      })
      stage.appendChild(card)
      return card
    })
    const counter = document.createElement("p")
    counter.className = "channel-coverflow-counter"
    counter.setAttribute("aria-live", "polite")
    stage.appendChild(counter)
    el.flowCount = counter
    el.flowStage = stage
    layoutFlowCards(state.flowIndex)
    updateFlowCounter()
    bindFlowInteractions(stage)
    section.appendChild(stage)

    el.shelves.appendChild(section)
  }

  // 마우스/터치 드래그·휠로 커버플로우를 굴린다.
  function bindFlowInteractions(stage) {
    let pointerId = null
    let startX = 0
    let startPos = 0
    let pointerCaptured = false

    function maxIndex() {
      return Math.max(0, state.works.length - 1)
    }

    stage.addEventListener("pointerdown", function (event) {
      if (state.works.length < 2) return
      if (event.button != null && event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      startPos = state.flowPosition
      state.flowDragMoved = false
      pointerCaptured = false
    })

    stage.addEventListener("pointermove", function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return
      const dx = event.clientX - startX
      if (!state.flowDragMoved) {
        if (Math.abs(dx) <= 4) return
        state.flowDragMoved = true
        setFlowDragging(true)
        try {
          stage.setPointerCapture(pointerId)
          pointerCaptured = true
        } catch (error) {}
      }
      const max = maxIndex()
      let pos = startPos - dx / COVERFLOW_SPACING
      // 양 끝에서는 고무줄처럼 살짝만 끌려 나가게 한다.
      if (pos < 0) pos *= 0.35
      else if (pos > max) pos = max + (pos - max) * 0.35
      state.flowPosition = pos
      layoutFlowCards(pos)
    })

    function endDrag(event) {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return
      if (pointerCaptured) {
        try {
          stage.releasePointerCapture(pointerId)
        } catch (error) {}
      }
      pointerId = null
      pointerCaptured = false
      setFlowDragging(false)
      if (state.flowDragMoved) setFlowIndex(Math.round(state.flowPosition))
    }

    stage.addEventListener("pointerup", endDrag)
    stage.addEventListener("pointercancel", endDrag)

    // 드래그로 자리를 옮긴 직후 발생하는 클릭(카드 열림)을 한 번 막는다.
    stage.addEventListener(
      "click",
      function (event) {
        if (state.flowDragMoved) {
          event.preventDefault()
          event.stopPropagation()
          state.flowDragMoved = false
        }
      },
      true,
    )

    let wheelLock = false
    stage.addEventListener(
      "wheel",
      function (event) {
        if (state.works.length < 2) return
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        if (!delta) return
        event.preventDefault()
        if (wheelLock) return
        wheelLock = true
        setTimeout(function () {
          wheelLock = false
        }, 200)
        shiftFlowIndex(delta > 0 ? 1 : -1)
      },
      { passive: false },
    )
  }

  function clearShelfDropMarks() {
    document.querySelectorAll(".channel-album.is-drop-before, .channel-album.is-drop-after").forEach(function (node) {
      node.classList.remove("is-drop-before", "is-drop-after")
    })
  }

  function albumDropPosition(button, event) {
    const rect = button.getBoundingClientRect()
    const after = event.clientX > rect.left + rect.width / 2
    button.classList.toggle("is-drop-before", !after)
    button.classList.toggle("is-drop-after", after)
    state.shelfDropPosition = after ? "after" : "before"
    return state.shelfDropPosition
  }

  function moveWorkBeforeOrAfter(dragId, targetId, position) {
    if (!dragId || !targetId || dragId === targetId) return false
    const from = state.works.findIndex((work) => work && work.id === dragId)
    const target = state.works.findIndex((work) => work && work.id === targetId)
    if (from < 0 || target < 0) return false
    const moving = state.works.splice(from, 1)[0]
    let insertAt = state.works.findIndex((work) => work && work.id === targetId)
    if (insertAt < 0) insertAt = state.works.length
    if (position === "after") insertAt += 1
    state.works.splice(insertAt, 0, moving)
    state.flowIndex = clampFlowIndex(insertAt)
    saveWorkOrder()
    renderShelves()
    setStatus("작품 순서를 바꿨어요.", false)
    return true
  }

  function finishShelfDrag() {
    clearShelfDropMarks()
    document.querySelectorAll(".channel-album.is-dragging").forEach(function (node) {
      node.classList.remove("is-dragging")
      node.setAttribute("aria-grabbed", "false")
    })
    state.shelfDragWorkId = ""
    state.shelfDropPosition = ""
    state.suppressAlbumClick = true
    setTimeout(function () {
      state.suppressAlbumClick = false
    }, 0)
  }

  function bindShelfReorder(button, work) {
    if (!work || !work.id) return
    button.draggable = state.works.length > 1
    button.classList.toggle("channel-album-reorderable", button.draggable)
    button.setAttribute("aria-grabbed", "false")

    button.addEventListener("dragstart", function (event) {
      if (state.viewMode !== VIEW_MODE_SHELF || state.works.length < 2) {
        event.preventDefault()
        return
      }
      state.shelfDragWorkId = work.id
      state.shelfDragMoved = false
      button.classList.add("is-dragging")
      button.setAttribute("aria-grabbed", "true")
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", work.id)
      }
    })

    button.addEventListener("dragover", function (event) {
      const dragId = state.shelfDragWorkId
      if (!dragId || dragId === work.id) return
      event.preventDefault()
      state.shelfDragMoved = true
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
      clearShelfDropMarks()
      albumDropPosition(button, event)
    })

    button.addEventListener("dragleave", function (event) {
      if (!button.contains(event.relatedTarget)) button.classList.remove("is-drop-before", "is-drop-after")
    })

    button.addEventListener("drop", function (event) {
      const dragId = state.shelfDragWorkId || (event.dataTransfer && event.dataTransfer.getData("text/plain"))
      if (!dragId || dragId === work.id) return
      event.preventDefault()
      const position = albumDropPosition(button, event)
      moveWorkBeforeOrAfter(dragId, work.id, position)
      finishShelfDrag()
    })

    button.addEventListener("dragend", finishShelfDrag)
  }

  function renderShelfView() {
    for (let start = 0; start < state.works.length; start += WORKS_PER_SHELF) {
      const shelf = document.createElement("section")
      shelf.className = "channel-shelf"
      shelf.setAttribute("aria-label", Math.floor(start / WORKS_PER_SHELF) + 1 + "번째 선반")
      state.works.slice(start, start + WORKS_PER_SHELF).forEach(function (work, offset) {
        shelf.appendChild(createAlbumCard(work, start + offset, { draggable: true }))
      })
      el.shelves.appendChild(shelf)
    }
  }

  function renderShelves() {
    el.shelves.innerHTML = ""
    // 카드를 새로 그리므로 옛 커버플로우 참조는 버린다.
    state.flowCards = []
    el.flowStage = null
    el.flowCount = null
    state.flowIndex = clampFlowIndex(state.flowIndex)
    updateHeader()
    syncViewModeUI()
    const gated = state.locked && !!state.channel
    if (el.viewbar) el.viewbar.hidden = gated
    el.empty.hidden = gated || state.loading || !!state.works.length || !state.channel
    if (gated) return
    if (state.loading || !state.works.length) return
    if (state.viewMode === VIEW_MODE_FLOW) renderCoverFlow()
    else renderShelfView()
    syncViewModeUI()
  }

  async function loadChannel(channel, options) {
    options = options || {}
    if (!ShareStore || !ShareStore.listChannel) {
      setStatus("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const normalized = normalizeChannel(channel || state.channel || "")
    if (!normalized) {
      state.channel = ""
      state.works = []
      state.flowIndex = 0
      renderShelves()
      setStatus("번호를 적어 주세요.", true)
      return
    }

    const channelChanged = normalized !== state.channel
    state.channel = normalized
    if (channelChanged) {
      state.flowIndex = 0
      state.pass = savedChannelPass(normalized)
    }
    if (options.pass != null) {
      state.pass = ShareStore.cleanPin ? ShareStore.cleanPin(options.pass) : String(options.pass || "").replace(/\D/g, "").slice(0, 6)
    }
    state.loading = true
    renderShelves()
    setStatus("", false)
    try {
      const result = await ShareStore.listChannel(normalized, state.pass)
      state.channelMeta = result.meta || null
      state.locked = !!result.locked
      state.works = state.locked ? [] : applyStoredWorkOrder(Array.isArray(result.works) ? result.works : [], normalized)
      const focusIndex = options.focusWork ? state.works.findIndex((item) => item && item.id === options.focusWork) : -1
      state.flowIndex = focusIndex >= 0 ? focusIndex : clampFlowIndex(state.flowIndex)
      state.loading = false
      renderShelves()
      if (state.locked) {
        // 기억해 둔 코드가 더는 맞지 않으면(코드 변경 등) 지워서 헛입장을 막는다.
        if (result.passError && ShareStore.rememberPass) ShareStore.rememberPass(normalized, "")
        setStatus(result.passError ? "갤러리 코드가 맞지 않아요." : "", !!result.passError)
      } else {
        if (state.pass && ShareStore.rememberPass) ShareStore.rememberPass(normalized, state.pass)
        setStatus("", false)
      }
      if (options.updateUrl !== false) history.replaceState(null, "", channelUrl(normalized, options.focusWork || ""))
      if (!state.locked) focusWork(options.focusWork || workIdFromHash())
    } catch (error) {
      console.error(error)
      state.works = []
      state.flowIndex = 0
      state.loading = false
      renderShelves()
      setStatus(error.message || "화음 갤러리를 불러오지 못했어요.", true)
    }
  }

  // === 이름 변경 모달: 관리자 공통 코드 + 새 이름을 한 화면에서 받는다 ===

  function setRenameModalError(text) {
    if (!el.renameModalError) return
    el.renameModalError.textContent = text || ""
    el.renameModalError.hidden = !text
  }

  function closeRenameModal() {
    if (!el.renameModal || el.renameModal.hidden) return
    el.renameModal.hidden = true
    el.body.classList.remove("publish-modal-open")
  }

  function openRenameModal() {
    if (!el.renameModal || !ShareStore || !ShareStore.claimChannel) return
    if (!state.channel) {
      setStatus("먼저 화음 갤러리에 들어가 주세요.", true)
      return
    }
    const pin = currentGalleryPass()
    if (state.locked || pin.length < (ShareStore.MIN_PIN_LENGTH || 4)) {
      setStatus("갤러리 코드로 갤러리를 연 뒤 이름을 바꿀 수 있어요.", true)
      return
    }
    setMenuOpen(false)
    if (el.renameAdminPinInput) el.renameAdminPinInput.value = loadStashedAdminPin()
    if (el.renameNameInput) el.renameNameInput.value = channelDisplayName()
    setRenameModalError("")
    el.renameModal.hidden = false
    el.body.classList.add("publish-modal-open")
    const focusAdmin = el.renameAdminPinInput && !el.renameAdminPinInput.value
    const focusTarget = focusAdmin ? el.renameAdminPinInput : el.renameNameInput
    if (focusTarget) focusTarget.focus({ preventScroll: true })
    if (!focusAdmin && el.renameNameInput) el.renameNameInput.select()
  }

  async function submitRenameModal(event) {
    if (event) event.preventDefault()
    if (!ShareStore || !ShareStore.claimChannel) return
    const channel = state.channel
    const adminPin = el.renameAdminPinInput ? el.renameAdminPinInput.value.trim() : ""
    const displayName = cleanText(el.renameNameInput ? el.renameNameInput.value : "", 40)
    if (!adminPin) {
      setRenameModalError("관리자 공통 코드를 넣어 주세요.")
      if (el.renameAdminPinInput) el.renameAdminPinInput.focus()
      return
    }
    if (!displayName) {
      setRenameModalError("바꿀 갤러리 이름을 넣어 주세요.")
      if (el.renameNameInput) el.renameNameInput.focus()
      return
    }
    const pin = currentGalleryPass()
    if (el.renameModalSubmitBtn) el.renameModalSubmitBtn.disabled = true
    try {
      setRenameModalError("")
      const result = await ShareStore.claimChannel({ channel: channel, pin: pin, displayName: displayName, adminPin: adminPin })
      state.channelMeta = result.channel || state.channelMeta
      if (ShareStore.rememberPass) ShareStore.rememberPass(channel, pin)
      setAdminPin(adminPin)
      updateHeader()
      closeRenameModal()
      setStatus("갤러리 이름을 저장했어요.", false)
    } catch (error) {
      console.error(error)
      setRenameModalError(error.message || "갤러리 이름을 저장하지 못했어요.")
    } finally {
      if (el.renameModalSubmitBtn) el.renameModalSubmitBtn.disabled = false
    }
  }

  async function deleteCurrentChannel() {
    if (!ShareStore || !ShareStore.deleteChannel) return
    const channel = state.channel
    if (!channel) {
      setStatus("먼저 화음 갤러리에 들어가 주세요.", true)
      return
    }
    const adminPin = promptTrimmed("관리자 공통 코드를 입력하세요.", loadStashedAdminPin())
    if (adminPin == null) return
    if (!adminPin) {
      setStatus("화음 갤러리를 삭제하려면 관리자 공통 코드를 넣어 주세요.", true)
      return
    }
    if (!confirm("#" + channel + " 갤러리와 안에 있는 음악을 모두 삭제할까요?")) return
    if (el.deleteChannelBtn) el.deleteChannelBtn.disabled = true
    try {
      setStatus("#" + channel + " 갤러리를 삭제하는 중입니다.", false)
      const result = await ShareStore.deleteChannel(channel, adminPin)
      if (el.viewer && !el.viewer.hidden) closeViewer()
      state.channel = ""
      state.works = []
      state.channelMeta = null
      state.locked = false
      state.pass = ""
      state.flowIndex = 0
      state.flowPosition = 0
      state.openedFromHash = false
      if (el.input) el.input.value = ""
      if (el.codeInput) el.codeInput.value = ""
      if (el.nameInput) el.nameInput.value = ""
      history.replaceState(null, "", channelUrl("", ""))
      setMenuOpen(false)
      renderShelves()
      setStatus("#" + channel + " 갤러리를 삭제했어요." + (result.localOnly ? " (이 브라우저에서만 삭제됨)" : ""), false)
    } catch (error) {
      console.error(error)
      setStatus(error.message || "화음 갤러리를 삭제하지 못했어요.", true)
    } finally {
      if (el.deleteChannelBtn) el.deleteChannelBtn.disabled = false
    }
  }

  function focusWork(workId) {
    if (!workId || state.openedFromHash) return
    const index = state.works.findIndex((item) => item && item.id === workId)
    const work = index >= 0 ? state.works[index] : null
    if (index >= 0) state.flowIndex = index
    if (index >= 0 && state.viewMode === VIEW_MODE_FLOW) renderShelves()
    const target = document.getElementById("work-" + workId)
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
    if (work) {
      state.openedFromHash = true
      openViewer(work, { updateHash: false })
    }
  }

  function setViewerMetaItem(row, node, value) {
    if (!row || !node) return
    const text = cleanText(value, 90)
    row.hidden = !text
    node.textContent = text
  }

  function renderViewerMeta(work) {
    const meta = workViewerMeta(work)
    setViewerMetaItem(el.viewerComposerRow, el.viewerComposer, meta.composer)
    setViewerMetaItem(el.viewerAtmosphereRow, el.viewerAtmosphere, meta.atmosphere)
    setViewerMetaItem(el.viewerInstrumentRow, el.viewerInstrument, meta.instrument)
    if (el.viewerActionCount) el.viewerActionCount.textContent = meta.actionCount
  }

  function setOptionalText(card, node, value) {
    const text = cleanText(value, 180)
    if (card) card.hidden = !text
    if (node) node.textContent = text
  }

  function renderViewerTags(tags) {
    if (!el.viewerTags) return
    const cleaned = Array.isArray(tags)
      ? tags.map((tag) => cleanText(tag, 24)).filter(Boolean)
      : []
    el.viewerTags.hidden = !cleaned.length
    el.viewerTags.textContent = ""
    cleaned.forEach((tag) => {
      const chip = document.createElement("span")
      chip.className = "channel-viewer-tag"
      chip.textContent = "#" + tag
      el.viewerTags.appendChild(chip)
    })
  }

  function updateViewerPlayState() {
    if (!el.viewerAudio || !el.viewerPlay) return
    const hasMusic = !!el.viewerAudio.getAttribute("src")
    el.viewerPlay.hidden = !hasMusic || !shouldShowCoverPlayOverlay(state.activeWork)
    el.viewerPlay.classList.toggle("is-playing", !el.viewerAudio.paused)
    el.viewerPlay.setAttribute("aria-label", el.viewerAudio.paused ? "재생" : "일시정지")
  }

  function clampUnit(value) {
    const n = Number(value)
    return Math.max(0, Math.min(1, isFinite(n) ? n : 0))
  }

  function recipeStrokes(recipe) {
    recipe = recipe || {}
    if (Array.isArray(recipe.strokes) && recipe.strokes.length) return recipe.strokes
    return Array.isArray(recipe.path) && recipe.path.length ? [recipe.path] : []
  }

  function canOpenStudioCopy(work) {
    return !!(work && work.recipe && recipeStrokes(work.recipe).length)
  }

  function strokeColor(index) {
    const palette = ["#00a6a6", "#c8a344", "#5b8def", "#d76f51", "#7f6fd6", "#6aa84f"]
    return palette[index % palette.length]
  }

  function renderGeneratedDrawingCanvas(work) {
    const canvas = document.createElement("canvas")
    const w = 1440
    const h = 540
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#fbf6ec"
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = "rgba(31,38,38,0.1)"
    ctx.lineWidth = 1
    for (let i = 0; i <= 12; i++) {
      const x = Math.round((w * i) / 12)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let i = 0; i <= 14; i++) {
      const y = Math.round((h * i) / 14)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    recipeStrokes(work && work.recipe).forEach(function (stroke, index) {
      if (!Array.isArray(stroke) || stroke.length < 2) return
      ctx.save()
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.lineWidth = 10
      ctx.strokeStyle = strokeColor(index)
      ctx.globalAlpha = 0.34
      ctx.beginPath()
      ctx.moveTo(clampUnit(stroke[0].x) * w, clampUnit(stroke[0].y) * h)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(clampUnit(stroke[i].x) * w, clampUnit(stroke[i].y) * h)
      ctx.stroke()
      ctx.globalAlpha = 0.94
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.restore()
    })

    const stamps = (work && work.recipe && Array.isArray(work.recipe.effectStamps) ? work.recipe.effectStamps : []) || []
    stamps.forEach(function (stamp) {
      const x = clampUnit(stamp && stamp.x) * w
      const y = clampUnit(stamp && stamp.y != null ? stamp.y : 0.5) * h
      ctx.save()
      ctx.fillStyle = "rgba(255,224,138,0.88)"
      ctx.strokeStyle = "rgba(31,38,38,0.18)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    })

    ctx.fillStyle = "rgba(20,24,22,0.82)"
    ctx.fillRect(0, h - 54, w, 54)
    ctx.fillStyle = "#fbf6ec"
    ctx.font = "800 26px 'Segoe UI', sans-serif"
    ctx.fillText(workTitle(work) + " 드로잉", 28, h - 20)
    return canvas
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob)
          else reject(new Error("드로잉 이미지를 만들지 못했어요."))
        },
        type,
        quality,
      )
    })
  }

  async function generatedDrawingUrl(work) {
    const key = ((work && work.id) || "drawing") + ":" + ((work && work.updatedAt) || (work && work.createdAt) || "")
    if (generatedDrawingUrls.has(key)) return generatedDrawingUrls.get(key)
    const blob = await canvasBlob(renderGeneratedDrawingCanvas(work), "image/webp", 0.72)
    const url = URL.createObjectURL(blob)
    generatedDrawingUrls.set(key, url)
    return url
  }

  async function drawingImageUrl(work) {
    return drawingUrl(work) || generatedDrawingUrl(work)
  }

  // 확대해서 보기 프레임을 그림 비율에 맞춘다 — CSS 변수로 무대 크기를 넘기면
  // 여백 없이 그림이 꽉 찬다. 극단적으로 길쭉한 그림만 최소 크기에 걸리고,
  // 그때 남는 자리는 블러 배경이 채운다.
  function fitViewerStage() {
    if (!el.viewerPanel || !el.viewerCover) return
    const w = el.viewerCover.naturalWidth
    const h = el.viewerCover.naturalHeight
    if (!w || !h) {
      resetViewerStageFit()
      return
    }
    const maxWidth = Math.min(VIEWER_STAGE_MAX.width, root.innerWidth - VIEWER_SCREEN_MARGIN - VIEWER_INFO_COLUMN - VIEWER_PANEL_GAP - VIEWER_PANEL_CHROME) * VIEWER_STAGE_SCALE
    const maxHeight = Math.min(VIEWER_STAGE_MAX.height, root.innerHeight - VIEWER_SCREEN_MARGIN - VIEWER_PANEL_CHROME) * VIEWER_STAGE_SCALE
    let stageWidth = maxWidth
    let stageHeight = (stageWidth * h) / w
    if (stageHeight > maxHeight) {
      stageHeight = maxHeight
      stageWidth = (stageHeight * w) / h
    }
    stageWidth = Math.max(VIEWER_STAGE_MIN.width, Math.round(stageWidth))
    stageHeight = Math.max(VIEWER_STAGE_MIN.height, Math.round(stageHeight))
    el.viewerPanel.style.setProperty("--viewer-stage-w", stageWidth + "px")
    el.viewerPanel.style.setProperty("--viewer-stage-h", stageHeight + "px")
    el.viewerPanel.classList.add("is-fitted")
  }

  function resetViewerStageFit() {
    if (el.viewerPanel) el.viewerPanel.classList.remove("is-fitted")
  }

  function openViewer(work, options) {
    options = options || {}
    if (!work) return
    const meta = work.metadata || {}
    const url = musicUrl(work)
    state.activeWork = work
    el.viewerCover.src = coverUrl(work, true)
    el.viewerCover.alt = workTitle(work) + " 표지"
    if (el.viewerBackdrop) el.viewerBackdrop.src = coverUrl(work, true)
    fitViewerStage()
    el.viewerTitle.textContent = workTitle(work)
    renderViewerMeta(work)
    setOptionalText(el.viewerBackgroundCard, el.viewerBackground, meta.backgroundReason)
    setOptionalText(el.viewerMelodyCard, el.viewerMelody, meta.melodyIntent)
    renderViewerTags(meta.hashtags)
    el.viewerAudio.src = url
    el.viewerAudio.hidden = !url
    el.viewerDelete.hidden = !canDeleteActive()
    if (el.viewerDrawing) el.viewerDrawing.disabled = !canOpenStudioCopy(work)
    if (el.viewerCopy) el.viewerCopy.disabled = !canCopyActive()
    el.viewer.hidden = false
    el.body.classList.add("channel-viewer-open")
    updateViewerPlayState()
    if (options.updateHash !== false) history.replaceState(null, "", channelUrl(work.channel || state.channel, work.id))
    el.viewerClose.focus({ preventScroll: true })
  }

  function closeViewer() {
    if (el.viewer.hidden) return
    el.viewerAudio.pause()
    el.viewerAudio.removeAttribute("src")
    el.viewerAudio.load()
    el.viewer.hidden = true
    el.body.classList.remove("channel-viewer-open")
    state.activeWork = null
    history.replaceState(null, "", channelUrl(state.channel, ""))
    updateViewerPlayState()
  }

  async function copyGalleryLink() {
    if (!state.channel || state.locked) {
      setStatus("먼저 화음 갤러리를 열어 주세요.", true)
      return
    }
    const text = channelUrl(state.channel, "")
    const done = function () {
      setStatus("갤러리 링크를 복사했어요.", false)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        done()
        return
      } catch (e) {}
    }
    if (typeof prompt === "function") prompt("갤러리 링크", text)
    done()
  }

  function openActiveStudioCopy() {
    if (!state.activeWork) return
    const win = typeof root.open === "function" ? root.open("about:blank", "_blank") : null
    try {
      if (!canOpenStudioCopy(state.activeWork)) throw new Error("스튜디오에서 볼 수 있는 드로잉 정보가 없어요.")
      const url = studioCopyUrl(storeStudioCopy(state.activeWork))
      if (win) {
        win.location.href = url
      } else if (typeof root.open === "function") {
        root.open(url, "_blank", "noopener")
      } else {
        location.href = url
      }
      setStatus("스튜디오에서 복사본을 열었어요.", false)
    } catch (error) {
      if (win && !win.closed) win.close()
      console.error(error)
      setStatus(error.message || "스튜디오에서 열지 못했어요.", true)
    }
  }

  async function copyActiveWork() {
    if (!state.activeWork || !ShareStore || !ShareStore.copyWork) return
    const sourceChannel = normalizeChannel(state.activeWork.channel || state.channel)
    const askedChannel = promptTrimmed("복사할 갤러리 번호를 입력하세요.", "")
    if (askedChannel == null) return
    const targetChannel = normalizeChannel(askedChannel)
    if (!targetChannel) {
      setStatus("복사할 갤러리 번호를 적어 주세요.", true)
      return
    }
    if (targetChannel === sourceChannel) {
      setStatus("다른 갤러리 번호를 적어 주세요.", true)
      return
    }
    const savedPass = ShareStore.loadPass ? ShareStore.loadPass(targetChannel) : ""
    const askedPass = promptTrimmed("복사할 갤러리 코드(숫자)를 입력하세요.", savedPass || "")
    if (askedPass == null) return
    const pass = ShareStore.cleanPin ? ShareStore.cleanPin(askedPass) : String(askedPass || "").replace(/\D/g, "").slice(0, 6)
    if (pass.length < (ShareStore.MIN_PIN_LENGTH || 4)) {
      setStatus("갤러리 코드는 숫자 " + (ShareStore.MIN_PIN_LENGTH || 4) + "자리 이상으로 적어 주세요.", true)
      return
    }
    if (el.viewerCopy) el.viewerCopy.disabled = true
    try {
      setStatus("#" + targetChannel + " 갤러리에 작품을 복사하는 중입니다.", false)
      const result = await ShareStore.copyWork(state.activeWork, {
        channel: targetChannel,
        pass: pass,
        sourcePass: currentGalleryPass(),
      })
      if (ShareStore.rememberPass) ShareStore.rememberPass(targetChannel, pass)
      const copied = result && result.work
      setStatus("#" + targetChannel + " 갤러리에 작품을 복사했어요." + (copied && copied.localOnly ? " (이 브라우저에만 저장됨)" : ""), false)
    } catch (error) {
      console.error(error)
      setStatus(error.message || "작품을 복사하지 못했어요.", true)
    } finally {
      if (el.viewerCopy) el.viewerCopy.disabled = !canCopyActive()
    }
  }

  async function deleteActiveWork() {
    if (!state.activeWork || !ShareStore || !ShareStore.deleteWork) return
    const adminPin = promptTrimmed("관리자 공통 코드를 입력하세요.", loadStashedAdminPin())
    if (adminPin == null) return
    if (!adminPin) {
      setStatus("이 작품을 지우려면 관리자 공통 코드가 필요합니다.", true)
      return
    }
    if (!confirm("이 공유 작품을 지울까요?")) return
    const work = state.activeWork
    if (el.viewerDelete) el.viewerDelete.disabled = true
    try {
      setStatus("공유 작품을 삭제하는 중입니다.", false)
      await ShareStore.deleteWork(work, adminPin)
      setAdminPin(adminPin)
      state.works = state.works.filter((item) => item.id !== work.id)
      saveWorkOrder()
      closeViewer()
      renderShelves()
      setStatus("공유 작품을 삭제했어요.", false)
    } catch (error) {
      console.error(error)
      setStatus(error.message || "공유 작품을 삭제하지 못했어요.", true)
    } finally {
      if (el.viewerDelete) el.viewerDelete.disabled = false
    }
  }

  function openInputChannel() {
    const channel = normalizeChannel(el.input.value)
    if (!channel) {
      setStatus("번호를 적어 주세요.", true)
      return
    }
    const codeValue = el.codeInput ? el.codeInput.value : ""
    const pin = ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(codeValue) : String(codeValue || "").replace(/\D/g, "").slice(0, 6)
    if (!pin) {
      setStatus("", false)
      if (el.codeInput) el.codeInput.focus()
      return
    }
    if (channel === normalizeChannel(state.channel)) {
      state.openedFromHash = false
      loadChannel(channel, { pass: pin })
      return
    }
    state.openedFromHash = false
    state.flowIndex = 0
    state.pass = pin
    history.pushState(null, "", channelUrl(channel, ""))
    loadChannel(channel, { updateUrl: false, pass: pin })
  }

  function bind() {
    el.menuBtn.addEventListener("click", function (event) {
      event.stopPropagation()
      setMenuOpen(el.menu.hidden)
    })
    el.menu.addEventListener("click", function (event) {
      event.stopPropagation()
    })
    document.addEventListener("click", function () {
      setMenuOpen(false)
    })
    el.backBtn.addEventListener("click", function () {
      if (history.length > 1) history.back()
      else location.href = studioUrl()
    })
    if (el.renameBtn) {
      el.renameBtn.addEventListener("click", openRenameModal)
    }
    if (el.renameModal) {
      el.renameModal.addEventListener("click", function (event) {
        if (event.target === el.renameModal) closeRenameModal()
      })
    }
    if (el.renameModalForm) el.renameModalForm.addEventListener("submit", submitRenameModal)
    if (el.renameModalCloseBtn) el.renameModalCloseBtn.addEventListener("click", closeRenameModal)
    if (el.renameModalCancelBtn) el.renameModalCancelBtn.addEventListener("click", closeRenameModal)
    ;[el.renameAdminPinInput, el.renameNameInput].forEach(function (input) {
      if (input) {
        input.addEventListener("input", function () {
          setRenameModalError("")
        })
      }
    })
    if (el.deleteChannelBtn) {
      el.deleteChannelBtn.addEventListener("click", deleteCurrentChannel)
    }
    el.form.addEventListener("submit", function (event) {
      event.preventDefault()
      openInputChannel()
    })
    if (el.shareBtn) {
      el.shareBtn.addEventListener("click", copyGalleryLink)
    }
    if (el.shelfModeBtn) {
      el.shelfModeBtn.addEventListener("click", function () {
        setViewMode(VIEW_MODE_SHELF)
      })
    }
    if (el.flowModeBtn) {
      el.flowModeBtn.addEventListener("click", function () {
        setViewMode(VIEW_MODE_FLOW)
      })
    }
    if (el.flowPrevBtn) {
      el.flowPrevBtn.addEventListener("click", function () {
        shiftFlowIndex(-1)
      })
    }
    if (el.flowNextBtn) {
      el.flowNextBtn.addEventListener("click", function () {
        shiftFlowIndex(1)
      })
    }
    el.viewer.addEventListener("click", function (event) {
      if (event.target === el.viewer) closeViewer()
    })
    el.viewerClose.addEventListener("click", closeViewer)
    el.viewerPlay.addEventListener("click", function () {
      if (!el.viewerAudio.src) return
      if (el.viewerAudio.paused) {
        const result = el.viewerAudio.play()
        if (result && typeof result.catch === "function") result.catch(function () {})
      } else {
        el.viewerAudio.pause()
      }
    })
    el.viewerAudio.addEventListener("play", updateViewerPlayState)
    el.viewerAudio.addEventListener("pause", updateViewerPlayState)
    el.viewerAudio.addEventListener("ended", updateViewerPlayState)
    // 그림이 늦게 로드되면 그때 프레임을 다시 맞추고, 실패하면 폴백 크기로 둔다.
    el.viewerCover.addEventListener("load", fitViewerStage)
    el.viewerCover.addEventListener("error", resetViewerStageFit)
    root.addEventListener("resize", function () {
      if (!el.viewer.hidden) fitViewerStage()
    })
    if (el.viewerDrawing) el.viewerDrawing.addEventListener("click", openActiveStudioCopy)
    if (el.viewerCopy) el.viewerCopy.addEventListener("click", copyActiveWork)
    if (el.viewerDelete) el.viewerDelete.addEventListener("click", deleteActiveWork)
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (el.renameModal && !el.renameModal.hidden) closeRenameModal()
        else if (!el.viewer.hidden) closeViewer()
        else setMenuOpen(false)
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (state.viewMode !== VIEW_MODE_FLOW || !el.viewer.hidden || isTypingTarget(event.target)) return
        event.preventDefault()
        shiftFlowIndex(event.key === "ArrowLeft" ? -1 : 1)
      }
    })
    window.addEventListener("popstate", function () {
      state.openedFromHash = false
      loadChannel(channelFromUrl(), { updateUrl: false, focusWork: workIdFromHash() })
    })
  }

  function init() {
    bind()
    prefillAdminPin(loadStashedAdminPin())
    const channel = channelFromUrl()
    state.channel = channel
    if (channel) {
      loadChannel(channel, { updateUrl: false, focusWork: workIdFromHash(), pass: loadStashedChannelPass(channel) || savedChannelPass(channel) })
    } else {
      renderShelves()
      setStatus("", false)
    }
  }

  init()
})(window)
