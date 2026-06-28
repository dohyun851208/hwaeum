/*
 * channel.js — 학급 채널을 책장처럼 보여 주는 전용 감상 화면.
 */
;(function (root) {
  "use strict"

  const ShareStore = root.HwaeumShareStore
  const DEFAULT_COVER_SRC = "./assets/default-cover.png"
  const WORKS_PER_SHELF = 8

  const $ = (id) => document.getElementById(id)
  const el = {
    body: document.body,
    menuBtn: $("channelMenuBtn"),
    menu: $("channelMenu"),
    backBtn: $("channelBackBtn"),
    adminPin: $("channelAdminPin"),
    title: $("channelTitle"),
    count: $("channelCount"),
    form: $("channelOpenForm"),
    input: $("channelInput"),
    refreshBtn: $("channelRefreshBtn"),
    status: $("channelStatus"),
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

  function createAlbumCard(work, index) {
    const meta = work.metadata || {}
    const button = document.createElement("button")
    button.type = "button"
    button.className = "channel-album"
    button.id = "work-" + work.id
    button.style.setProperty("--lift", String((index % 4) * 10) + "px")
    button.setAttribute("aria-label", workTitle(work) + " 크게 보기")

    const cover = document.createElement("span")
    cover.className = "channel-album-cover"
    const img = document.createElement("img")
    img.src = coverUrl(work, false)
    img.alt = workTitle(work) + " 표지"
    img.loading = "lazy"
    const play = document.createElement("span")
    play.className = "channel-album-play"
    play.textContent = "▶"
    const overlay = document.createElement("span")
    overlay.className = "channel-album-overlay"
    const title = document.createElement("strong")
    title.textContent = workTitle(work)
    const tags = document.createElement("span")
    tags.textContent = tagsText(meta.hashtags) || [meta.atmosphereLabel, meta.instrumentLabel].filter(Boolean).join(" · ")

    overlay.appendChild(title)
    overlay.appendChild(tags)
    cover.appendChild(img)
    cover.appendChild(play)
    cover.appendChild(overlay)
    button.appendChild(cover)
    button.addEventListener("click", function () {
      openViewer(work, { updateHash: true, play: true })
    })
    return button
  }

  function renderShelves() {
    el.shelves.innerHTML = ""
    updateHeader()
    el.empty.hidden = state.loading || !!state.works.length || !state.channel
    if (state.loading || !state.works.length) return

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
      renderShelves()
      setStatus("채널 번호를 적어 주세요.", true)
      return
    }

    state.channel = normalized
    state.loading = true
    renderShelves()
    setStatus(normalized + " 채널을 불러오는 중입니다.", false)
    try {
      const result = await ShareStore.listChannel(normalized)
      state.works = Array.isArray(result.works) ? result.works : []
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
      state.loading = false
      renderShelves()
      setStatus(error.message || "공유 채널을 불러오지 못했어요.", true)
    }
  }

  function focusWork(workId) {
    if (!workId || state.openedFromHash) return
    const work = state.works.find((item) => item && item.id === workId)
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
    el.viewerPlay.hidden = !hasMusic
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
      state.adminPin = el.adminPin.value.trim()
      if (state.activeWork) el.viewerDelete.hidden = !canDeleteActive()
    })
    el.form.addEventListener("submit", function (event) {
      event.preventDefault()
      openInputChannel()
    })
    el.refreshBtn.addEventListener("click", function () {
      state.openedFromHash = false
      loadChannel(state.channel)
    })
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
    })
    window.addEventListener("popstate", function () {
      state.openedFromHash = false
      loadChannel(channelFromUrl(), { updateUrl: false, focusWork: workIdFromHash() })
    })
  }

  function init() {
    bind()
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
