/*
 * channel.js — 학급 채널을 갤러리처럼 보여 주는 전용 감상 화면.
 */
;(function (root) {
  "use strict"

  const ShareStore = root.HwaeumShareStore
  const DEFAULT_COVER_SRC = "./assets/default-cover.png"
  const WORKS_PER_SHELF = 8
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
    refreshBtn: $("channelRefreshBtn"),
    library: $("channelLibrary"),
    status: $("channelStatus"),
    shelfModeBtn: $("channelShelfModeBtn"),
    flowModeBtn: $("channelFlowModeBtn"),
    flowPrevBtn: $("channelFlowPrevBtn"),
    flowNextBtn: $("channelFlowNextBtn"),
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
    openedFromHash: false,
    viewMode: loadViewMode(),
    flowIndex: 0,
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
    if (state.flowIndex === next) {
      syncViewModeUI()
      return
    }
    state.flowIndex = next
    renderShelves()
  }

  function shiftFlowIndex(delta) {
    setFlowIndex(state.flowIndex + delta)
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

  function workMetaLine(work) {
    const meta = (work && work.metadata) || {}
    return [
      meta.composerName ? "작곡가 " + cleanText(meta.composerName, 24) : "",
      cleanText(meta.atmosphereLabel, 32),
      cleanText(meta.instrumentLabel, 32),
      secondsLabel(meta.duration || 30),
      formatDate(work && work.createdAt),
    ]
      .filter(Boolean)
      .join(" · ")
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

  function workIsMine(work) {
    if (!ShareStore || !ShareStore.getOwner || !work) return false
    const owner = ShareStore.getOwner()
    return !!owner && !!owner.id && owner.id === work.ownerId
  }

  function canDeleteActive() {
    return !!state.activeWork && (workIsMine(state.activeWork) || !!state.adminPin)
  }

  const ADMIN_PIN_SESSION_KEY = "hwaeum.adminPin"
  function loadStashedAdminPin() {
    try {
      const s = root.sessionStorage
      return s ? (s.getItem(ADMIN_PIN_SESSION_KEY) || "").trim() : ""
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

  function updateAdminIndicator() {
    const on = !!state.adminPin
    if (el.adminFlag) el.adminFlag.hidden = !on
    el.body.classList.toggle("channel-admin-on", on)
  }

  function updateHeader() {
    const channel = state.channel
    el.title.textContent = channel ? channel + " 채널" : "학급 채널"
    el.count.textContent = state.loading
      ? "채널을 불러옵니다."
      : channel
        ? "공유된 음악 " + state.works.length + "개"
        : "채널 번호를 입력해 주세요."
    if (el.input && el.input.value !== channel) el.input.value = channel
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
      else openViewer(work, { updateHash: true, play: true })
    })
    return button
  }

  function applyFlowCardStyle(card, offset) {
    const abs = Math.abs(offset)
    const visible = abs <= 4
    const clamped = Math.max(-4, Math.min(4, offset))
    const x = clamped * 148
    const rotate = offset === 0 ? 0 : offset > 0 ? -58 : 58
    const z = -Math.min(abs, 4) * 92
    const scale = Math.max(0.66, 1 - Math.min(abs, 4) * 0.075)
    const opacity = visible ? Math.max(0.22, 1 - abs * 0.15) : 0
    card.style.setProperty("--flow-x", x + "px")
    card.style.setProperty("--flow-rotate", rotate + "deg")
    card.style.setProperty("--flow-z", z + "px")
    card.style.setProperty("--flow-scale", String(scale.toFixed(3)))
    card.style.setProperty("--flow-opacity", String(opacity.toFixed(2)))
    card.style.zIndex = String(100 - Math.min(abs, 90))
    card.tabIndex = visible ? 0 : -1
    if (!visible) card.setAttribute("aria-hidden", "true")
  }

  function renderCoverFlow() {
    state.flowIndex = clampFlowIndex(state.flowIndex)
    const active = state.works[state.flowIndex]
    const section = document.createElement("section")
    section.className = "channel-coverflow"
    section.setAttribute("aria-label", "커버플로우 보기")

    const stage = document.createElement("div")
    stage.className = "channel-coverflow-stage"
    state.works.forEach(function (work, index) {
      const offset = index - state.flowIndex
      const isCenter = offset === 0
      const card = createAlbumCard(work, index, {
        className: "channel-flow-album" + (isCenter ? " is-center" : ""),
        ariaLabel: workTitle(work) + (isCenter ? " 크게 보기" : " 선택"),
        onClick: function () {
          if (index === state.flowIndex) openViewer(work, { updateHash: true, play: true })
          else setFlowIndex(index)
        },
      })
      applyFlowCardStyle(card, offset)
      stage.appendChild(card)
    })
    section.appendChild(stage)

    if (active) {
      const meta = active.metadata || {}
      const caption = document.createElement("section")
      caption.className = "channel-coverflow-caption"
      const count = document.createElement("p")
      count.className = "channel-coverflow-count"
      count.textContent = state.flowIndex + 1 + " / " + state.works.length
      const title = document.createElement("h2")
      title.textContent = workTitle(active)
      const detail = document.createElement("p")
      detail.className = "channel-coverflow-meta"
      detail.textContent = workMetaLine(active)
      const tags = tagsText(meta.hashtags)
      const tagLine = document.createElement("p")
      tagLine.className = "channel-coverflow-tags"
      tagLine.hidden = !tags
      tagLine.textContent = tags
      const open = document.createElement("button")
      open.type = "button"
      open.className = "channel-action-button primary"
      open.textContent = "크게 듣기"
      open.addEventListener("click", function () {
        openViewer(active, { updateHash: true, play: true })
      })
      caption.appendChild(count)
      caption.appendChild(title)
      caption.appendChild(detail)
      caption.appendChild(tagLine)
      caption.appendChild(open)
      section.appendChild(caption)
    }

    el.shelves.appendChild(section)
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
    state.flowIndex = clampFlowIndex(state.flowIndex)
    updateHeader()
    syncViewModeUI()
    el.empty.hidden = state.loading || !!state.works.length || !state.channel
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
      setStatus("채널 번호를 적어 주세요.", true)
      return
    }

    const channelChanged = normalized !== state.channel
    state.channel = normalized
    if (channelChanged) state.flowIndex = 0
    state.loading = true
    renderShelves()
    setStatus(normalized + " 채널을 불러오는 중입니다.", false)
    try {
      const result = await ShareStore.listChannel(normalized)
      state.works = Array.isArray(result.works) ? result.works : []
      const focusIndex = options.focusWork ? state.works.findIndex((item) => item && item.id === options.focusWork) : -1
      state.flowIndex = focusIndex >= 0 ? focusIndex : clampFlowIndex(state.flowIndex)
      state.loading = false
      renderShelves()
      setStatus(
        normalized + " 채널에 " + (result.localOnly ? "이 브라우저에 저장된 " : "공유된 ") + "음악 " + state.works.length + "개를 불러왔어요.",
        false,
      )
      if (options.updateUrl !== false) history.replaceState(null, "", channelUrl(normalized, options.focusWork || ""))
      focusWork(options.focusWork || workIdFromHash())
    } catch (error) {
      console.error(error)
      state.works = []
      state.flowIndex = 0
      state.loading = false
      renderShelves()
      setStatus(error.message || "공유 채널을 불러오지 못했어요.", true)
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
      openViewer(work, { updateHash: false, play: false })
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
    el.viewerMeta.textContent = workMetaLine(work)
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
    if (options.play && url) {
      const result = el.viewerAudio.play()
      if (result && typeof result.catch === "function") result.catch(function () {})
    }
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
      setStatus("이 작품을 지우려면 관리자 PIN이 필요합니다.", true)
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
      setStatus("채널 번호를 적어 주세요.", true)
      return
    }
    state.openedFromHash = false
    state.flowIndex = 0
    history.pushState(null, "", channelUrl(channel, ""))
    loadChannel(channel, { updateUrl: false })
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
    el.adminPin.addEventListener("input", function () {
      setAdminPin(el.adminPin.value)
    })
    el.form.addEventListener("submit", function (event) {
      event.preventDefault()
      openInputChannel()
    })
    el.refreshBtn.addEventListener("click", function () {
      state.openedFromHash = false
      loadChannel(state.channel)
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
    setAdminPin(loadStashedAdminPin())
    const channel = channelFromUrl()
    state.channel = channel
    if (channel) {
      loadChannel(channel, { updateUrl: false, focusWork: workIdFromHash() })
    } else {
      renderShelves()
      setStatus("채널 번호를 입력하고 열기를 눌러 주세요.", false)
    }
  }

  init()
})(window)
