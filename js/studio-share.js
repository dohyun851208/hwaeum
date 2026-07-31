;(function (root, factory) {
  "use strict"

  if (typeof module === "object" && module.exports) module.exports = factory
  else root.HwaeumStudioShare = factory
})(typeof globalThis !== "undefined" ? globalThis : this, function createStudioShare(deps) {
  "use strict"

  deps = deps || {}
  const root = deps.root || (typeof globalThis !== "undefined" ? globalThis : this)
  const doc = deps.document || root.document
  const state = deps.state
  const el = deps.el
  const ShareStore = deps.ShareStore || null
  const StudioUtils = deps.StudioUtils
  const Core = deps.Core
  const engine = deps.engine
  const shareStep = Number.isFinite(deps.shareStep) ? deps.shareStep : 4
  const composerNameMax = Number.isFinite(deps.composerNameMax) ? deps.composerNameMax : 24
  const defaultCoverSrc = deps.defaultCoverSrc || "./assets/default-cover.webp"
  const shareAudioBitsPerSecond = Number.isFinite(deps.shareAudioBitsPerSecond)
    ? deps.shareAudioBitsPerSecond
    : 64000
  const cleanText = StudioUtils.cleanText
  const normalizeHashtags = StudioUtils.normalizeHashtags
  const keywordText = StudioUtils.keywordText

  function publishCurrentTake() {
    const saved = deps.saveTake()
    if (!saved) return
    publishTake(saved)
  }

  function publishTake(t) {
    deps.selectTake(t)
    const missing = []
    if (!el.titleInput?.value.trim()) missing.push({ field: el.titleInput, label: "제목" })
    if (!el.composerInput?.value.trim()) missing.push({ field: el.composerInput, label: "작곡가" })
    if (!el.bgReasonInput?.value.trim()) missing.push({ field: el.bgReasonInput, label: "배경음악을 고른 이유" })
    if (!el.melodyIntentInput?.value.trim()) missing.push({ field: el.melodyIntentInput, label: "선율을 표현한 의도" })
    if (!deps.hashtagList().length) missing.push({ field: el.hashtagsInput, label: "작품을 잘 나타내는 단어" })
    if (missing.length > 0) {
      missing.forEach(({ field }) => field.classList.add("field-invalid"))
      el.exportStatus.textContent = "공유 전에 모든 항목을 채워 주세요: " + missing.map((m) => m.label).join(", ")
      el.exportStatus.classList.add("error")
      missing[0].field.focus()
      missing[0].field.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    if (!ShareStore) {
      el.exportStatus.textContent = "공유 모듈을 불러오지 못했어요."
      el.exportStatus.classList.add("error")
      return
    }
    el.exportStatus.classList.remove("error")
    // 번호와 갤러리 코드를 한 모달에서 같이 받는다.
    openPublishModal()
  }

  function setPublishModalError(text) {
    if (!el.publishModalError) return
    el.publishModalError.textContent = text || ""
    el.publishModalError.hidden = !text
  }

  function openPublishModal() {
    if (!el.publishModal || !el.publishChannelInput || !el.publishPassInput) return
    const channel = state.sharedChannel || (ShareStore.loadChannel ? ShareStore.loadChannel() : "")
    el.publishChannelInput.value = channel || ""
    el.publishPassInput.value = channel && ShareStore.loadPass ? ShareStore.loadPass(channel) : ""
    setPublishModalError("")
    el.publishModal.hidden = false
    el.body.classList.add("publish-modal-open")
    const focusTarget = !channel
      ? el.publishChannelInput
      : !el.publishPassInput.value
        ? el.publishPassInput
        : el.publishModalSubmitBtn || el.publishPassInput
    focusTarget.focus({ preventScroll: true })
  }

  function closePublishModal() {
    if (!el.publishModal || el.publishModal.hidden) return
    el.publishModal.hidden = true
    el.body.classList.remove("publish-modal-open")
    if (el.publishShareBtn) el.publishShareBtn.focus({ preventScroll: true })
  }

  function submitPublishModal(event) {
    if (event) event.preventDefault()
    if (!ShareStore) return
    const channel = ShareStore.normalizeChannel(el.publishChannelInput ? el.publishChannelInput.value : "")
    if (!channel) {
      setPublishModalError("번호를 적어 주세요.")
      if (el.publishChannelInput) el.publishChannelInput.focus()
      return
    }
    const pass = ShareStore.cleanPin(el.publishPassInput ? el.publishPassInput.value : "")
    if (pass.length < (ShareStore.MIN_PIN_LENGTH || 4)) {
      setPublishModalError("갤러리 코드는 숫자 " + (ShareStore.MIN_PIN_LENGTH || 4) + "자리 이상이에요.")
      if (el.publishPassInput) el.publishPassInput.focus()
      return
    }
    if (ShareStore.rememberPass) ShareStore.rememberPass(channel, pass)
    closePublishModal()
    publishSharedWork(channel, pass)
  }

  function bindPublishModal() {
    if (!el.publishModal) return
    el.publishModal.addEventListener("click", (event) => {
      if (event.target === el.publishModal) closePublishModal()
    })
    if (el.publishModalForm) el.publishModalForm.addEventListener("submit", submitPublishModal)
    if (el.publishModalCloseBtn) el.publishModalCloseBtn.addEventListener("click", closePublishModal)
    if (el.publishModalCancelBtn) el.publishModalCancelBtn.addEventListener("click", closePublishModal)
    if (el.publishChannelInput) {
      el.publishChannelInput.addEventListener("input", () => {
        setPublishModalError("")
        // 이 갤러리에 기억해 둔 코드가 있으면 미리 채워 준다.
        const channel = ShareStore ? ShareStore.normalizeChannel(el.publishChannelInput.value) : ""
        if (channel && el.publishPassInput && ShareStore.loadPass) {
          const saved = ShareStore.loadPass(channel)
          if (saved) el.publishPassInput.value = saved
        }
      })
    }
    if (el.publishPassInput) {
      el.publishPassInput.addEventListener("input", () => setPublishModalError(""))
    }
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && el.publishModal && !el.publishModal.hidden) {
        event.preventDefault()
        closePublishModal()
      }
    })
  }

  function sharedChannelInputSource(value) {
    return value == null ? state.sharedChannel : value
  }

  function normalizeSharedChannel(value) {
    return ShareStore ? ShareStore.normalizeChannel(value || "") : String(value || "")
  }

  function syncShareInputs(channel) {
    const normalized = normalizeSharedChannel(sharedChannelInputSource(channel))
    state.sharedChannel = normalized
    if (el.channelBrowseInput && el.channelBrowseInput.value !== normalized) el.channelBrowseInput.value = normalized
  }

  function adminPinValue() {
    return el.shareAdminPinInput ? el.shareAdminPinInput.value.trim() : ""
  }

  function channelPageUrl(channel, workId) {
    try {
      const url = new root.URL("./channel.html", root.location.href)
      const normalized = normalizeSharedChannel(sharedChannelInputSource(channel))
      if (normalized) url.search = "?channel=" + encodeURIComponent(normalized)
      else url.search = ""
      url.hash = workId ? "work=" + encodeURIComponent(workId) : ""
      return url.href
    } catch (e) {
      const normalized = encodeURIComponent(String(sharedChannelInputSource(channel) || "").trim())
      return "./channel.html" + (normalized ? "?channel=" + normalized : "") + (workId ? "#work=" + encodeURIComponent(workId) : "")
    }
  }

  const CHANNEL_ENTRY_PASS_SESSION_KEY = "hwaeum.channelEntryPass"
  function rememberChannelEntryPass(channel, pass) {
    const normalized = normalizeSharedChannel(channel)
    const pin = ShareStore && ShareStore.cleanPin
      ? ShareStore.cleanPin(pass)
      : String(pass || "")
          .replace(/\D/g, "")
          .slice(0, 6)
    try {
      const storage = root.sessionStorage
      if (!storage || !normalized) return pin
      if (pin) storage.setItem(CHANNEL_ENTRY_PASS_SESSION_KEY, JSON.stringify({ channel: normalized, pass: pin }))
      else storage.removeItem(CHANNEL_ENTRY_PASS_SESSION_KEY)
    } catch (e) {}
    return pin
  }

  // 한 번 입장한 갤러리의 코드를 기억해 두었다가 들어가기 입력칸에 미리 채운다.
  function prefillBrowsePass() {
    if (!el.channelBrowsePassInput || !ShareStore || !ShareStore.loadPass) return
    if (el.channelBrowsePassInput.value) return
    const saved = ShareStore.loadPass(state.sharedChannel)
    if (saved) el.channelBrowsePassInput.value = saved
  }

  function openChannelPage(channelArg, workId, passArg) {
    if (!ShareStore) {
      setShareMessage("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const channel = ShareStore.normalizeChannel(sharedChannelInputSource(channelArg) || "")
    if (!channel) {
      setShareMessage("번호를 적어 주세요.", true)
      return
    }
    const pass = passArg != null
      ? ShareStore.cleanPin(passArg)
      : ShareStore.cleanPin(el.channelBrowsePassInput ? el.channelBrowsePassInput.value : "")
    if (!pass) {
      setShareMessage("갤러리 코드를 넣어 주세요.", true)
      return
    }
    syncShareInputs(channel)
    rememberChannelEntryPass(channel, pass)
    rememberAdminPin()
    root.location.href = channelPageUrl(channel, workId)
  }

  function hideOpenClaimedChannelButton() {
    if (!el.openClaimedChannelBtn) return
    el.openClaimedChannelBtn.hidden = true
    delete el.openClaimedChannelBtn.dataset.channel
  }

  function showOpenClaimedChannelButton(channel) {
    if (!el.openClaimedChannelBtn) return
    const normalized = normalizeSharedChannel(channel)
    if (!normalized) {
      hideOpenClaimedChannelButton()
      return
    }
    el.openClaimedChannelBtn.dataset.channel = normalized
    el.openClaimedChannelBtn.hidden = false
  }

  // 관리자 공통 코드(8624)로 화음 갤러리를 만들거나, 내가 점유한 갤러리 이름·코드를 고친다.
  async function claimChannelFromForm() {
    hideOpenClaimedChannelButton()
    if (!ShareStore || !ShareStore.claimChannel) {
      setShareMessage("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const adminPin = adminPinValue()
    const channel = ShareStore.normalizeChannel(el.claimChannelInput ? el.claimChannelInput.value : "")
    const displayName = el.shareDisplayNameInput ? el.shareDisplayNameInput.value.trim() : ""
    const pin = ShareStore.cleanPin(el.shareChannelPassInput ? el.shareChannelPassInput.value : "")
    if (!adminPin) {
      setShareMessage("화음 갤러리를 만들려면 관리자 공통 코드(8624)를 넣어 주세요.", true)
      return
    }
    if (!channel) {
      setShareMessage("만들 번호를 적어 주세요.", true)
      return
    }
    if (pin.length < (ShareStore.MIN_PIN_LENGTH || 4)) {
      setShareMessage("갤러리 코드는 숫자 " + (ShareStore.MIN_PIN_LENGTH || 4) + "자리 이상으로 정해 주세요.", true)
      return
    }
    if (el.claimChannelBtn) el.claimChannelBtn.disabled = true
    try {
      setShareMessage("#" + channel + " 갤러리를 만드는 중입니다.", false)
      const result = await ShareStore.claimChannel({
        channel: channel,
        pin: pin,
        displayName: displayName,
        adminPin: adminPin,
      })
      if (ShareStore.rememberPass) ShareStore.rememberPass(channel, pin)
      syncShareInputs(channel)
      showOpenClaimedChannelButton(channel)
      const name = (result.channel && result.channel.displayName) || displayName
      setShareMessage(
        (result.claimed === false
          ? "#" + channel + " 갤러리 설정을 저장했어요."
          : "#" + channel + " 갤러리를 만들었어요.") +
          (name ? " 갤러리 이름: " + name + "." : "") +
          (result.localOnly ? " (이 브라우저에만 저장됨)" : ""),
        false,
      )
    } catch (e) {
      if (root.console) root.console.error(e)
      setShareMessage(e.message || "화음 갤러리를 만들지 못했어요.", true)
    } finally {
      if (el.claimChannelBtn) el.claimChannelBtn.disabled = false
    }
  }

  // 관리자 공통 코드를 화음 갤러리 페이지로 이어 보낸다(URL 대신 sessionStorage — 기록·로그에 번호가 남지 않게).
  const ADMIN_PIN_SESSION_KEY = "hwaeum.adminPin"
  function rememberAdminPin() {
    try {
      const storage = root.sessionStorage
      if (!storage) return
      const pin = adminPinValue()
      if (pin) storage.setItem(ADMIN_PIN_SESSION_KEY, pin)
      else storage.removeItem(ADMIN_PIN_SESSION_KEY)
    } catch (e) {}
  }

  function setShareMessage(text, error) {
    const target = state.step === shareStep && el.shareStatus ? el.shareStatus : el.exportStatus
    if (!target) return
    target.textContent = text
    target.classList.toggle("error", !!error)
  }

  function sharedMetadata(recipe) {
    const atmos = state.atmosphere || deps.defaultAtmosphere()
    const instrumentLabel = recipe ? deps.usedInstrumentLabelsForRecipe(recipe) : deps.usedInstrumentLabels()
    return {
      title: state.title || "무제",
      composerName: cleanText(state.composerName, composerNameMax),
      pictureThought: cleanText(state.pictureThought, 180),
      backgroundReason: cleanText(state.backgroundReason, 180),
      melodyIntent: cleanText(state.melodyIntent, 180),
      hashtags: normalizeHashtags(state.hashtags),
      atmosphereLabel: atmos.label,
      instrumentLabel: instrumentLabel,
      duration: state.duration,
      actionCount: deps.normalizeActionCount(recipe && recipe.actionCount),
      coverHasEmbeddedPlay: false,
    }
  }

  function updateShareUrl(channel, workId) {
    try {
      const url = new root.URL(root.location.href)
      if (channel) url.searchParams.set("shareChannel", channel)
      if (workId) url.hash = "work=" + encodeURIComponent(workId)
      else if (url.hash.indexOf("#work=") === 0) url.hash = ""
      root.history.replaceState(null, "", url.href)
    } catch (e) {}
  }

  async function loadSharedChannel(channel, options) {
    options = options || {}
    if (!ShareStore) {
      setShareMessage("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const normalized = ShareStore.normalizeChannel(sharedChannelInputSource(channel) || "")
    if (!normalized) {
      setShareMessage("번호를 적어 주세요.", true)
      return
    }
    syncShareInputs(normalized)
    state.sharedLoading = true
    setShareMessage("#" + normalized + " 갤러리를 불러오는 중입니다.", false)
    try {
      const result = await ShareStore.listChannel(
        normalized,
        ShareStore.loadPass ? ShareStore.loadPass(normalized) : "",
      )
      state.sharedWorks = result.works || []
      setShareMessage(
        "#" +
          normalized +
          " 갤러리에 " +
          (result.localOnly ? "이 브라우저에 저장된 " : "공유된 ") +
          "음악 " +
          state.sharedWorks.length +
          "개를 불러왔어요.",
        false,
      )
      if (options.updateUrl !== false) updateShareUrl(normalized)
    } catch (e) {
      if (root.console) root.console.error(e)
      state.sharedWorks = []
      setShareMessage(e.message || "화음 갤러리를 불러오지 못했어요.", true)
    } finally {
      state.sharedLoading = false
    }
  }

  async function publishSharedWork(channelArg, passArg) {
    if (!deps.requireDrawn()) return
    if (!ShareStore) {
      el.exportStatus.textContent = "공유 모듈을 불러오지 못했어요."
      el.exportStatus.classList.add("error")
      return
    }
    const explicitChannel = typeof channelArg === "string" || typeof channelArg === "number" ? channelArg : null
    const channelSource = explicitChannel != null ? explicitChannel : state.sharedChannel
    const channel = ShareStore.normalizeChannel(channelSource)
    if (!channel) {
      el.exportStatus.textContent = "번호를 적어 주세요."
      el.exportStatus.classList.add("error")
      return
    }
    const pass = passArg != null
      ? ShareStore.cleanPin(passArg)
      : ShareStore.loadPass
        ? ShareStore.loadPass(channel)
        : ""
    syncShareInputs(channel)
    const recipe = deps.buildRecipe()
    const metadata = sharedMetadata(recipe)
    const publishButton = el.publishShareBtn
    if (publishButton) publishButton.disabled = true

    const progressEl = doc.getElementById("publishProgress")
    const progressFill = doc.getElementById("publishProgressFill")
    function setProgress(ratio) {
      if (!progressEl || !progressFill) return
      progressEl.hidden = false
      progressFill.style.width = Math.round(Math.min(1, ratio) * 100) + "%"
    }

    doc.body.classList.add("is-publishing")
    try {
      el.exportStatus.classList.remove("error")
      el.exportStatus.textContent = "표지 이미지를 작게 압축하는 중입니다."
      setProgress(0.05)
      const images = await ShareStore.createImageBlobs({
        pictureSrc: state.pic,
        defaultCoverSrc: defaultCoverSrc,
        title: metadata.title,
        composerName: metadata.composerName,
        hashtags: keywordText(metadata.hashtags),
        accent: state.atmosphere.color,
      })
      el.exportStatus.textContent = "드로잉 이미지를 작게 압축하는 중입니다."
      setProgress(0.08)
      const drawing = await deps.canvasToBlob(await deps.renderDrawingSnapshotCanvas(), "image/webp", 0.62)
      el.exportStatus.textContent = "음악을 압축하는 중입니다. 완료될 때까지 기다려 주세요."
      setProgress(0.1)
      if (!engine.renderCompressedAudioBlob) throw new Error("압축 음악을 만들 수 없는 브라우저입니다.")
      const music = await engine.renderCompressedAudioBlob(recipe, deps.notesFor(recipe), {
        audioBitsPerSecond: shareAudioBitsPerSecond,
        onProgress: function (ratio) {
          setProgress(0.1 + ratio * 0.8) // 10% → 90%
          if (ratio >= 0.2) el.exportStatus.textContent = "음악을 압축하는 중입니다… " + Math.round(ratio * 100) + "%"
        },
      })
      el.exportStatus.textContent =
        "공유 서버에 올리는 중입니다. 음악 " +
        ShareStore.formatBytes(music.size) +
        ", 표지 " +
        ShareStore.formatBytes(images.cover.size) +
        ", 드로잉 " +
        ShareStore.formatBytes(drawing.size) +
        "."
      setProgress(0.92)
      const result = await ShareStore.publishWork({
        channel: channel,
        pass: pass,
        title: metadata.title,
        recipe: recipe,
        metadata: metadata,
        coverBlob: images.cover,
        thumbBlob: images.thumb,
        drawingBlob: drawing,
        musicBlob: music,
      })
      const work = result.work
      setProgress(1.0)
      el.exportStatus.textContent = result.localOnly
        ? "#" + channel + " 갤러리에 이 브라우저용으로 저장했어요."
        : "#" + channel + " 갤러리에 공유했어요."
      state.sharedChannel = channel
      root.location.href = channelPageUrl(channel, work && work.id)
    } catch (e) {
      if (root.console) root.console.error(e)
      el.exportStatus.textContent = e.message || "공유 업로드에 실패했어요."
      el.exportStatus.classList.add("error")
      if (progressEl) progressEl.hidden = true
    } finally {
      doc.body.classList.remove("is-publishing")
      if (publishButton) publishButton.disabled = false
    }
  }

  function restoreSharedChannelFromUrl() {
    if (!ShareStore) return false
    let params
    try {
      params = new root.URL(root.location.href).searchParams
    } catch (e) {
      return false
    }
    const channel = ShareStore.normalizeChannel(params.get("shareChannel") || params.get("channel") || "")
    if (!channel) return false
    const focus = (root.location.hash || "").indexOf("#work=") === 0
      ? decodeURIComponent(root.location.hash.slice(6))
      : ""
    syncShareInputs(channel)
    root.location.replace(channelPageUrl(channel, focus))
    return true
  }

  function shareLink() {
    const code = Core.encodeRecipe(deps.buildSharedRecipe())
    const url = setShareHash(code)
    const copied = function () {
      el.exportStatus.textContent = "공유 링크를 복사했어요. 링크를 열면 드로잉 화면에서 시작합니다."
    }
    const fallback = function () {
      if (copyViaSelection(url)) {
        copied()
        return
      }
      if (typeof root.prompt === "function") root.prompt("공유 링크", url)
      el.exportStatus.textContent = "공유 링크를 주소창에 만들었어요. 주소창의 링크를 복사하세요."
    }
    const navigator = root.navigator || {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        const write = navigator.clipboard.writeText(url)
        if (write && typeof write.then === "function") write.then(copied, fallback)
        else copied()
      } catch (e) {
        fallback()
      }
    } else {
      fallback()
    }
  }

  function setShareHash(code) {
    const hash = "r=" + code
    try {
      const url = new root.URL(root.location.href)
      url.search = ""
      url.hash = hash
      root.history.replaceState(null, "", url.href)
      return url.href
    } catch (e) {
      root.location.hash = hash
      return root.location.href
    }
  }

  function copyViaSelection(text) {
    if (!doc.execCommand) return false
    const input = doc.createElement("textarea")
    input.value = text
    input.setAttribute("readonly", "")
    input.style.position = "fixed"
    input.style.left = "-9999px"
    input.style.top = "0"
    doc.body.appendChild(input)
    input.select()
    try {
      return doc.execCommand("copy")
    } catch (e) {
      return false
    } finally {
      doc.body.removeChild(input)
    }
  }

  function bindShareControls() {
    if (el.publishShareBtn) el.publishShareBtn.addEventListener("click", publishCurrentTake)
    if (el.channelBrowseInput) {
      el.channelBrowseInput.addEventListener("input", () => {
        syncShareInputs(el.channelBrowseInput.value)
        prefillBrowsePass()
      })
    }
    if (el.channelOpenForm) {
      el.channelOpenForm.addEventListener("submit", function (event) {
        event.preventDefault()
        openChannelPage(el.channelBrowseInput ? el.channelBrowseInput.value : state.sharedChannel)
      })
    } else if (el.loadChannelBtn) {
      el.loadChannelBtn.addEventListener("click", () =>
        openChannelPage(el.channelBrowseInput ? el.channelBrowseInput.value : state.sharedChannel),
      )
    }
    if (el.claimChannelBtn) el.claimChannelBtn.addEventListener("click", claimChannelFromForm)
    if (el.openClaimedChannelBtn) {
      el.openClaimedChannelBtn.addEventListener("click", () =>
        openChannelPage(
          el.openClaimedChannelBtn.dataset.channel || "",
          "",
          el.shareChannelPassInput ? el.shareChannelPassInput.value : "",
        ),
      )
    }
    const claimedChannelInputs = [
      el.shareAdminPinInput,
      el.claimChannelInput,
      el.shareDisplayNameInput,
      el.shareChannelPassInput,
    ]
    claimedChannelInputs.forEach(function (input) {
      if (input) input.addEventListener("input", hideOpenClaimedChannelButton)
    })
    bindPublishModal()
  }

  return {
    bindShareControls,
    claimChannelFromForm,
    closePublishModal,
    hideOpenClaimedChannelButton,
    loadSharedChannel,
    openChannelPage,
    openPublishModal,
    prefillBrowsePass,
    publishCurrentTake,
    publishSharedWork,
    publishTake,
    restoreSharedChannelFromUrl,
    shareLink,
    sharedMetadata,
    submitPublishModal,
    syncShareInputs,
  }
})
