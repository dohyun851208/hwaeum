;(function (root) {
  "use strict"

  // 공유 갤러리 뷰어·카드 렌더 팩토리.
  // studio.js에서 window.HwaeumStudioShareUI(deps)로 호출하여 반환된 함수들을 destructure.
  root.HwaeumStudioShareUI = function createStudioShareUI(deps) {
    const {
      state,
      el,
      ShareStore,
      sharedViewer,
      secondsLabel,
      DEFAULT_COVER_SRC,
      openSharedViewer,
      sharedWorkUrl,
      copyText,
      deleteSharedWork,
    } = deps

    function adminPinValue() {
      return el.shareAdminPinInput ? el.shareAdminPinInput.value.trim() : ""
    }

    function formatSharedDate(value) {
      const d = new Date(value || "")
      if (!isFinite(d.getTime())) return ""
      return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    }

    function pauseSharedAudioExcept(except) {
      document.querySelectorAll(".shared-work-tools audio, .shared-viewer audio").forEach(function (audio) {
        if (audio !== except && !audio.paused) audio.pause()
      })
    }

    function closeSharedViewer() {
      if (!sharedViewer.root || sharedViewer.root.hidden) return
      if (sharedViewer.audio) {
        sharedViewer.audio.pause()
        sharedViewer.audio.removeAttribute("src")
        sharedViewer.audio.load()
      }
      sharedViewer.root.hidden = true
      el.body.classList.remove("shared-viewer-open")
      const focusTarget = sharedViewer.lastFocus
      sharedViewer.lastFocus = null
      if (focusTarget && document.contains(focusTarget) && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true })
      }
    }

    function handleSharedViewerKeydown(event) {
      if (event.key === "Escape" && sharedViewer.root && !sharedViewer.root.hidden) {
        event.preventDefault()
        closeSharedViewer()
      }
    }

    function ensureSharedViewer() {
      if (sharedViewer.root) return sharedViewer

      const root = document.createElement("div")
      root.className = "shared-viewer"
      root.hidden = true
      root.setAttribute("role", "dialog")
      root.setAttribute("aria-modal", "true")
      root.setAttribute("aria-labelledby", "sharedViewerTitle")
      root.addEventListener("click", function (event) {
        if (event.target === root) closeSharedViewer()
      })

      const panel = document.createElement("div")
      panel.className = "shared-viewer-panel"
      panel.addEventListener("click", function (event) {
        event.stopPropagation()
      })

      const closeBtn = document.createElement("button")
      closeBtn.type = "button"
      closeBtn.className = "shared-viewer-close"
      closeBtn.setAttribute("aria-label", "크게 보기 닫기")
      closeBtn.textContent = "×"
      closeBtn.addEventListener("click", closeSharedViewer)

      const stage = document.createElement("figure")
      stage.className = "shared-viewer-stage"
      const cover = document.createElement("img")
      cover.className = "shared-viewer-cover"
      cover.alt = "공유 음악 표지"
      stage.appendChild(cover)

      const info = document.createElement("div")
      info.className = "shared-viewer-info"
      const eyebrow = document.createElement("p")
      eyebrow.className = "eyebrow"
      eyebrow.textContent = "화음 갤러리 감상"
      const title = document.createElement("h3")
      title.id = "sharedViewerTitle"
      title.className = "shared-viewer-title"
      const meta = document.createElement("p")
      meta.className = "shared-viewer-meta"
      const audio = document.createElement("audio")
      audio.className = "shared-viewer-audio"
      audio.controls = true
      audio.preload = "auto"
      audio.addEventListener("play", function () {
        pauseSharedAudioExcept(audio)
      })
      const background = document.createElement("p")
      background.className = "shared-viewer-text"
      const melody = document.createElement("p")
      melody.className = "shared-viewer-text"
      const tags = document.createElement("p")
      tags.className = "shared-viewer-tags"

      info.appendChild(eyebrow)
      info.appendChild(title)
      info.appendChild(meta)
      info.appendChild(audio)
      info.appendChild(background)
      info.appendChild(melody)
      info.appendChild(tags)
      panel.appendChild(closeBtn)
      panel.appendChild(stage)
      panel.appendChild(info)
      root.appendChild(panel)
      document.body.appendChild(root)
      document.addEventListener("keydown", handleSharedViewerKeydown)

      sharedViewer.root = root
      sharedViewer.cover = cover
      sharedViewer.title = title
      sharedViewer.meta = meta
      sharedViewer.background = background
      sharedViewer.melody = melody
      sharedViewer.tags = tags
      sharedViewer.audio = audio
      sharedViewer.closeBtn = closeBtn
      return sharedViewer
    }

    function renderSharedWorks() {
      if (!el.sharedWorksList || !el.sharedEmpty) return
      el.sharedWorksList.textContent = ""
      const works = state.sharedWorks || []
      if (state.sharedLoading) {
        el.sharedEmpty.style.display = "block"
        el.sharedEmpty.textContent = "화음 갤러리를 불러오는 중입니다."
        return
      }
      el.sharedEmpty.style.display = works.length ? "none" : "block"
      el.sharedEmpty.textContent = state.sharedChannel ? "아직 이 화음 갤러리에 공유된 음악이 없습니다." : "번호를 입력하고 들어가기를 누르면 공유된 음악이 여기에 모입니다."
      const adminReady = !!adminPinValue()
      works.forEach(function (work) {
        const meta = work.metadata || {}
        const files = work.files || {}
        const card = document.createElement("article")
        card.className = "shared-work"
        card.id = "work-" + work.id

        const coverButton = document.createElement("button")
        coverButton.type = "button"
        coverButton.className = "shared-work-cover-button"
        coverButton.title = "크게 보며 듣기"
        coverButton.setAttribute("aria-label", (work.title || meta.title || "공유 음악") + " 크게 보며 듣기")
        const img = document.createElement("img")
        img.className = "shared-work-cover"
        img.src = files.thumbUrl || files.coverUrl || DEFAULT_COVER_SRC
        img.alt = (work.title || meta.title || "공유 음악") + " 표지"
        coverButton.appendChild(img)
        coverButton.addEventListener("click", function () {
          openSharedViewer(work)
        })
        card.appendChild(coverButton)

        const main = document.createElement("div")
        main.className = "shared-work-main"
        const title = document.createElement("h3")
        title.className = "shared-work-title"
        title.textContent = work.title || meta.title || "무제"
        main.appendChild(title)
        const detail = document.createElement("p")
        detail.className = "shared-work-meta"
        detail.textContent = [meta.composerName ? "작곡가 " + meta.composerName : "", meta.atmosphereLabel, meta.instrumentLabel, secondsLabel(meta.duration || 30)]
          .filter(Boolean)
          .join(" · ")
        main.appendChild(detail)
        if (meta.backgroundReason) {
          const p = document.createElement("p")
          p.className = "shared-work-text"
          p.textContent = "배경: " + meta.backgroundReason
          main.appendChild(p)
        }
        if (meta.melodyIntent) {
          const p = document.createElement("p")
          p.className = "shared-work-text"
          p.textContent = "선율: " + meta.melodyIntent
          main.appendChild(p)
        }
        if (meta.hashtags && meta.hashtags.length) {
          const tags = document.createElement("p")
          tags.className = "shared-work-tags"
          tags.textContent = meta.hashtags.map((tag) => (tag.charAt(0) === "#" ? tag : "#" + tag)).join(" ")
          main.appendChild(tags)
        }
        const date = document.createElement("p")
        date.className = "shared-work-date"
        date.textContent = formatSharedDate(work.createdAt)
        main.appendChild(date)
        card.appendChild(main)

        const tools = document.createElement("div")
        tools.className = "shared-work-tools"
        const audio = document.createElement("audio")
        audio.controls = true
        audio.preload = "none"
        audio.src = files.musicUrl || ""
        audio.addEventListener("play", function () {
          pauseSharedAudioExcept(audio)
        })
        tools.appendChild(audio)
        const actions = document.createElement("div")
        actions.className = "shared-work-actions"
        const viewB = document.createElement("button")
        viewB.type = "button"
        viewB.className = "btn tiny primary"
        viewB.textContent = "크게 보기"
        viewB.addEventListener("click", function () {
          openSharedViewer(work)
        })
        actions.appendChild(viewB)
        const copyB = document.createElement("button")
        copyB.type = "button"
        copyB.className = "btn tiny"
        copyB.textContent = "링크 복사"
        copyB.addEventListener("click", function () {
          copyText(sharedWorkUrl(work), "작품 링크를 복사했어요.")
        })
        actions.appendChild(copyB)
        if (adminReady) {
          const delB = document.createElement("button")
          delB.type = "button"
          delB.className = "btn tiny"
          delB.textContent = "관리자 삭제"
          delB.addEventListener("click", function () {
            deleteSharedWork(work)
          })
          actions.appendChild(delB)
        }
        tools.appendChild(actions)
        card.appendChild(tools)
        el.sharedWorksList.appendChild(card)
      })
    }

    return {
      adminPinValue,
      formatSharedDate,
      pauseSharedAudioExcept,
      closeSharedViewer,
      handleSharedViewerKeydown,
      ensureSharedViewer,
      renderSharedWorks,
    }
  }
})(window)
