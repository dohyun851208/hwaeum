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
    input: $("channelInput"),
    codeInput: $("channelCodeInput"),
    library: $("channelLibrary"),
    status: $("channelStatus"),
    viewbar: $("channelViewbar"),
    gate: $("channelGate"),
    gateForm: $("channelGateForm"),
    gateInput: $("channelGateInput"),
    gateTitle: $("channelGateTitle"),
    nameInput: $("channelNameInput"),
    renameBtn: $("channelRenameBtn"),
    deleteChannelBtn: $("channelDeleteBtn"),
    shelfModeBtn: $("channelShelfModeBtn"),
    flowModeBtn: $("channelFlowModeBtn"),
    flowPrevBtn: $("channelFlowPrevBtn"),
    flowNextBtn: $("channelFlowNextBtn"),
    flowStage: null,
    flowCaption: null,
    flowCount: null,
    flowTitle: null,
    flowMeta: null,
    flowTags: null,
    shelves: $("channelShelves"),
    empty: $("channelEmpty"),
    viewer: $("channelViewer"),
    viewerClose: $("viewerCloseBtn"),
    viewerCover: $("viewerCover"),
    viewerPlay: $("viewerPlayBtn"),
    viewerTitle: $("viewerTitle"),
    viewerMeta: $("viewerMeta"),
    viewerAudio: $("viewerAudio"),
    viewerBackground: $("viewerBackground"),
    viewerMelody: $("viewerMelody"),
    viewerTags: $("viewerTags"),
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
  }

  function cleanText(value, max) {
    const text = String(value || "").replace(/\s+/g, " ").trim()
    return max ? text.slice(0, max) : text
  }

  function normalizeChannel(value) {
    if (!ShareStore || !ShareStore.normalizeChannel) return String(value || "").replace(/\D/g, "").slice(0, 6)
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
      updateFlowCaption()
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

  function updateFlowCaption() {
    const active = state.works[state.flowIndex]
    if (!active || !el.flowCaption) return
    const meta = active.metadata || {}
    el.flowCount.textContent = state.flowIndex + 1 + " / " + state.works.length
    el.flowTitle.textContent = workTitle(active)
    el.flowMeta.textContent = workMetaLine(active)
    const tags = tagsText(meta.hashtags)
    el.flowTags.hidden = !tags
    el.flowTags.textContent = tags
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

  function formatDate(value) {
    const d = new Date(value || "")
    if (!isFinite(d.getTime())) return ""
    return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  function secondsLabel(seconds) {
    const s = Math.max(1, Math.round(Number(seconds) || 30))
    return s + "초"
  }

  function tagsText(tags) {
    if (!Array.isArray(tags) || !tags.length) return ""
    return tags
      .map((tag) => cleanText(tag, 24))
      .filter(Boolean)
      .map((tag) => (tag.charAt(0) === "#" ? tag : "#" + tag))
      .join(" ")
  }

  function workTitle(work) {
    const meta = (work && work.metadata) || {}
    return cleanText((work && work.title) || meta.title || "무제", 80)
  }

  function workDescriptionLine(work) {
    const meta = (work && work.metadata) || {}
    return [
      cleanText(meta.atmosphereLabel, 32),
      cleanText(meta.instrumentLabel, 72),
      secondsLabel(meta.duration || 30),
    ]
      .filter(Boolean)
      .join(" · ")
  }

  function workMetaLine(work) {
    const meta = (work && work.metadata) || {}
    return [
      meta.composerName ? "작곡가 " + cleanText(meta.composerName, 24) : "",
      workDescriptionLine(work),
      formatDate(work && work.createdAt),
    ]
      .filter(Boolean)
      .join(" · ")
  }

  function workViewerMetaText(work) {
    const meta = (work && work.metadata) || {}
    const uploadedAt = formatDate(work && work.createdAt)
    return [
      meta.composerName ? "작곡가 " + cleanText(meta.composerName, 24) : "작곡가 이름 없음",
      workDescriptionLine(work),
      uploadedAt ? "업로드 " + uploadedAt : "업로드 시간 없음",
    ]
      .filter(Boolean)
      .join("\n")
  }

  function coverUrl(work, large) {
    const files = (work && work.files) || {}
    return (large ? files.coverUrl || files.thumbUrl : files.thumbUrl || files.coverUrl) || DEFAULT_COVER_SRC
  }

  function shouldShowCoverPlayOverlay(work) {
    const meta = (work && work.metadata) || {}
    return meta.coverHasEmbeddedPlay === false
  }

  function musicUrl(work) {
    const files = (work && work.files) || {}
    return files.musicUrl || ""
  }

  function sharedWorkUrl(work) {
    return (work && work.shareUrl) || channelUrl((work && work.channel) || state.channel, work && work.id)
  }

  function canDeleteActive() {
    return !!state.activeWork && !!state.adminPin
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
      return ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(parsed.pass) : String(parsed.pass || "").replace(/\D/g, "").slice(0, 12)
    } catch (e) {
      return ""
    }
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
    return ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(state.pass) : String(state.pass || "").replace(/\D/g, "").slice(0, 12)
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
        ? state.locked
          ? "갤러리 코드가 필요해요"
          : ""
        : "번호를 입력해 주세요."
    if (el.input && document.activeElement !== el.input) {
      el.input.value = channel || ""
      el.input.placeholder = channel ? "" : "번호 (예 #107)"
    }
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

  function createAlbumCard(work, index, options) {
    options = options || {}
    const meta = work.metadata || {}
    const button = document.createElement("button")
    button.type = "button"
    button.className = "channel-album" + (options.className ? " " + options.className : "")
    button.id = "work-" + work.id
    button.style.setProperty("--lift", String((index % 4) * 10) + "px")
    button.setAttribute("aria-label", options.ariaLabel || workTitle(work) + " 크게 보기")

    const cover = document.createElement("span")
    cover.className = "channel-album-cover"
    const img = document.createElement("img")
    img.src = coverUrl(work, false)
    img.alt = workTitle(work) + " 표지"
    img.loading = "lazy"
    const overlay = document.createElement("span")
    overlay.className = "channel-album-overlay"
    const title = document.createElement("strong")
    title.textContent = workTitle(work)
    const tags = document.createElement("span")
    tags.textContent = tagsText(meta.hashtags) || [meta.atmosphereLabel, meta.instrumentLabel].filter(Boolean).join(" · ")

    overlay.appendChild(title)
    overlay.appendChild(tags)
    cover.appendChild(img)
    if (shouldShowCoverPlayOverlay(work)) {
      const play = document.createElement("span")
      play.className = "channel-album-play"
      play.textContent = "▶"
      cover.appendChild(play)
    }
    cover.appendChild(overlay)
    button.appendChild(cover)
    button.addEventListener("click", function () {
      if (typeof options.onClick === "function") options.onClick(work, index)
      else openViewer(work, { updateHash: true })
    })
    return button
  }

  function applyFlowCardStyle(card, offset) {
    const abs = Math.abs(offset)
    const sign = offset === 0 ? 0 : offset > 0 ? 1 : -1
    const visible = abs <= 4.6
    const clamped = Math.max(-4, Math.min(4, offset))
    const x = clamped * 184
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
    const active = state.works[state.flowIndex]
    const section = document.createElement("section")
    section.className = "channel-coverflow"
    section.setAttribute("aria-label", "커버플로우 보기")

    const stage = document.createElement("div")
    stage.className = "channel-coverflow-stage"
    stage.setAttribute("role", "listbox")
    state.flowCards = state.works.map(function (work, index) {
      const card = createAlbumCard(work, index, {
        className: "channel-flow-album",
        ariaLabel: workTitle(work) + " 크게 보기",
        onClick: function () {
          // 어느 앨범을 눌러도 바로 뷰어를 연다.
          openViewer(work, { updateHash: true })
        },
      })
      stage.appendChild(card)
      return card
    })
    el.flowStage = stage
    layoutFlowCards(state.flowIndex)
    bindFlowInteractions(stage)
    section.appendChild(stage)

    if (active) {
      const caption = document.createElement("section")
      caption.className = "channel-coverflow-caption"
      const count = document.createElement("p")
      count.className = "channel-coverflow-count"
      const title = document.createElement("h2")
      const detail = document.createElement("p")
      detail.className = "channel-coverflow-meta"
      const tagLine = document.createElement("p")
      tagLine.className = "channel-coverflow-tags"
      const open = document.createElement("button")
      open.type = "button"
      open.className = "channel-action-button primary"
      open.textContent = "크게 보기"
      open.addEventListener("click", function () {
        const current = state.works[state.flowIndex]
        if (current) openViewer(current, { updateHash: true })
      })
      caption.appendChild(count)
      caption.appendChild(title)
      caption.appendChild(detail)
      caption.appendChild(tagLine)
      caption.appendChild(open)
      section.appendChild(caption)
      el.flowCaption = caption
      el.flowCount = count
      el.flowTitle = title
      el.flowMeta = detail
      el.flowTags = tagLine
      updateFlowCaption()
    }

    el.shelves.appendChild(section)
  }

  // 마우스/터치 드래그·휠로 커버플로우를 굴린다.
  function bindFlowInteractions(stage) {
    const SPACING = 184
    let pointerId = null
    let startX = 0
    let startPos = 0

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
      setFlowDragging(true)
      try {
        stage.setPointerCapture(pointerId)
      } catch (error) {}
    })

    stage.addEventListener("pointermove", function (event) {
      if (pointerId === null || event.pointerId !== pointerId) return
      const dx = event.clientX - startX
      if (Math.abs(dx) > 4) state.flowDragMoved = true
      const max = maxIndex()
      let pos = startPos - dx / SPACING
      // 양 끝에서는 고무줄처럼 살짝만 끌려 나가게 한다.
      if (pos < 0) pos *= 0.35
      else if (pos > max) pos = max + (pos - max) * 0.35
      state.flowPosition = pos
      layoutFlowCards(pos)
    })

    function endDrag(event) {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return
      try {
        stage.releasePointerCapture(pointerId)
      } catch (error) {}
      pointerId = null
      setFlowIndex(Math.round(state.flowPosition))
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

  function renderShelfView() {
    for (let start = 0; start < state.works.length; start += WORKS_PER_SHELF) {
      const shelf = document.createElement("section")
      shelf.className = "channel-shelf"
      shelf.setAttribute("aria-label", Math.floor(start / WORKS_PER_SHELF) + 1 + "번째 선반")
      state.works.slice(start, start + WORKS_PER_SHELF).forEach(function (work, offset) {
        shelf.appendChild(createAlbumCard(work, start + offset))
      })
      el.shelves.appendChild(shelf)
    }
  }

  function renderShelves() {
    el.shelves.innerHTML = ""
    // 카드를 새로 그리므로 옛 커버플로우 참조는 버린다.
    state.flowCards = []
    el.flowStage = null
    el.flowCaption = null
    state.flowIndex = clampFlowIndex(state.flowIndex)
    updateHeader()
    syncViewModeUI()
    const gated = state.locked && !!state.channel
    if (el.gate) el.gate.hidden = !gated
    if (el.viewbar) el.viewbar.hidden = gated
    el.empty.hidden = gated || state.loading || !!state.works.length || !state.channel
    if (gated) {
      const name = channelDisplayName()
      if (el.gateTitle) el.gateTitle.textContent = (name || "#" + state.channel) + " — 갤러리 코드가 필요해요"
      return
    }
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
      state.pass = ""
    }
    if (options.pass != null) {
      state.pass = ShareStore.cleanPin ? ShareStore.cleanPin(options.pass) : String(options.pass || "").replace(/\D/g, "").slice(0, 12)
    }
    state.loading = true
    renderShelves()
    setStatus("", false)
    try {
      const result = await ShareStore.listChannel(normalized, state.pass)
      state.channelMeta = result.meta || null
      state.locked = !!result.locked
      state.works = state.locked ? [] : Array.isArray(result.works) ? result.works : []
      const focusIndex = options.focusWork ? state.works.findIndex((item) => item && item.id === options.focusWork) : -1
      state.flowIndex = focusIndex >= 0 ? focusIndex : clampFlowIndex(state.flowIndex)
      state.loading = false
      renderShelves()
      if (state.locked) {
        setStatus(result.passError ? "갤러리 코드가 맞지 않아요." : "갤러리 코드를 입력하세요.", !!result.passError)
      } else {
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

  function submitGatePass() {
    const pin = ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(el.gateInput ? el.gateInput.value : "") : ""
    if (!pin) {
      setStatus("갤러리 코드를 입력하세요.", true)
      return
    }
    state.openedFromHash = false
    loadChannel(state.channel, { pass: pin })
  }

  async function renameChannel() {
    if (!ShareStore || !ShareStore.claimChannel) return
    const channel = state.channel
    if (!channel) {
      setStatus("먼저 화음 갤러리에 들어가 주세요.", true)
      return
    }
    const adminPin = promptTrimmed("관리자 번호를 입력하세요.", loadStashedAdminPin())
    if (adminPin == null) return
    if (!adminPin) {
      setStatus("이름을 바꾸려면 관리자 번호를 넣어 주세요.", true)
      return
    }
    const displayName = promptTrimmed("바꿀 갤러리 이름을 입력하세요.", channelDisplayName())
    if (displayName == null) return
    if (!displayName) {
      setStatus("바꿀 갤러리 이름을 넣어 주세요.", true)
      return
    }
    const pin = currentGalleryPass()
    if (pin.length < (ShareStore.MIN_PIN_LENGTH || 4)) {
      setStatus("갤러리를 다시 들어간 뒤 이름을 바꿔 주세요.", true)
      return
    }
    try {
      setStatus("갤러리 이름을 저장하는 중입니다.", false)
      const result = await ShareStore.claimChannel({ channel: channel, pin: pin, displayName: displayName, adminPin: adminPin })
      state.channelMeta = result.channel || state.channelMeta
      if (ShareStore.rememberPass) ShareStore.rememberPass(channel, pin)
      updateHeader()
      setMenuOpen(false)
      setStatus("갤러리 이름을 저장했어요.", false)
    } catch (error) {
      console.error(error)
      setStatus(error.message || "갤러리 이름을 저장하지 못했어요.", true)
    }
  }

  async function deleteCurrentChannel() {
    if (!ShareStore || !ShareStore.deleteChannel) return
    const channel = state.channel
    if (!channel) {
      setStatus("먼저 화음 갤러리에 들어가 주세요.", true)
      return
    }
    const adminPin = promptTrimmed("관리자 번호를 입력하세요.", loadStashedAdminPin())
    if (adminPin == null) return
    if (!adminPin) {
      setStatus("화음 갤러리를 삭제하려면 관리자 번호를 넣어 주세요.", true)
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

  function setOptionalText(node, label, value) {
    const text = cleanText(value, 180)
    node.hidden = !text
    node.textContent = text ? label + ": " + text : ""
  }

  function updateViewerPlayState() {
    if (!el.viewerAudio || !el.viewerPlay) return
    const hasMusic = !!el.viewerAudio.getAttribute("src")
    el.viewerPlay.hidden = !hasMusic || !shouldShowCoverPlayOverlay(state.activeWork)
    el.viewerPlay.textContent = el.viewerAudio.paused ? "▶" : "Ⅱ"
    el.viewerPlay.setAttribute("aria-label", el.viewerAudio.paused ? "재생" : "일시정지")
  }

  function openViewer(work, options) {
    options = options || {}
    if (!work) return
    const meta = work.metadata || {}
    const url = musicUrl(work)
    state.activeWork = work
    el.viewerCover.src = coverUrl(work, true)
    el.viewerCover.alt = workTitle(work) + " 표지"
    el.viewerTitle.textContent = workTitle(work)
    el.viewerMeta.textContent = workViewerMetaText(work)
    setOptionalText(el.viewerBackground, "배경", meta.backgroundReason)
    setOptionalText(el.viewerMelody, "선율", meta.melodyIntent)
    const tags = tagsText(meta.hashtags)
    el.viewerTags.hidden = !tags
    el.viewerTags.textContent = tags
    el.viewerAudio.src = url
    el.viewerAudio.hidden = !url
    el.viewerDelete.hidden = !canDeleteActive()
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

  async function copyActiveLink() {
    if (!state.activeWork) return
    const text = sharedWorkUrl(state.activeWork)
    const done = function () {
      setStatus("작품 링크를 복사했어요.", false)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        done()
        return
      } catch (e) {}
    }
    if (typeof prompt === "function") prompt("공유 링크", text)
    done()
  }

  async function deleteActiveWork() {
    if (!state.activeWork || !ShareStore || !ShareStore.deleteWork) return
    if (!canDeleteActive()) {
      setStatus("이 작품을 지우려면 관리자 번호가 필요합니다.", true)
      return
    }
    if (!confirm("이 공유 작품을 지울까요?")) return
    const work = state.activeWork
    try {
      setStatus("공유 작품을 삭제하는 중입니다.", false)
      await ShareStore.deleteWork(work, state.adminPin)
      state.works = state.works.filter((item) => item.id !== work.id)
      closeViewer()
      renderShelves()
      setStatus("공유 작품을 삭제했어요.", false)
    } catch (error) {
      console.error(error)
      setStatus(error.message || "공유 작품을 삭제하지 못했어요.", true)
    }
  }

  function openInputChannel() {
    const channel = normalizeChannel(el.input.value)
    if (!channel) {
      setStatus("번호를 적어 주세요.", true)
      return
    }
    const codeValue = el.codeInput ? el.codeInput.value : ""
    const pin = ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(codeValue) : String(codeValue || "").replace(/\D/g, "").slice(0, 12)
    if (!pin) {
      setStatus("갤러리 코드를 넣어 주세요.", true)
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
    if (el.gateForm) {
      el.gateForm.addEventListener("submit", function (event) {
        event.preventDefault()
        submitGatePass()
      })
    }
    if (el.renameBtn) {
      el.renameBtn.addEventListener("click", renameChannel)
    }
    if (el.deleteChannelBtn) {
      el.deleteChannelBtn.addEventListener("click", deleteCurrentChannel)
    }
    el.form.addEventListener("submit", function (event) {
      event.preventDefault()
      openInputChannel()
    })
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
    el.viewerCopy.addEventListener("click", copyActiveLink)
    el.viewerDelete.addEventListener("click", deleteActiveWork)
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!el.viewer.hidden) closeViewer()
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
      loadChannel(channel, { updateUrl: false, focusWork: workIdFromHash(), pass: loadStashedChannelPass(channel) })
    } else {
      renderShelves()
      setStatus("", false)
    }
  }

  init()
})(window)
