;(function (root, factory) {
  "use strict"

  if (typeof module === "object" && module.exports) module.exports = factory
  else root.HwaeumStudioSoundLayers = factory
})(typeof globalThis !== "undefined" ? globalThis : this, function createStudioSoundLayers(deps) {
  "use strict"

  deps = deps || {}
  const root = deps.root || (typeof globalThis !== "undefined" ? globalThis : this)
  const doc = deps.document || root.document
  const state = deps.state
  const el = deps.el
  const engine = deps.engine
  const maxLayers = Math.max(1, Number(deps.maxLayers) || 3)
  const maxBytes = Math.max(1, Number(deps.maxBytes) || 50 * 1024 * 1024)
  const createAudio = deps.createAudio || function () { return new root.Audio() }
  const createObjectURL = deps.createObjectURL || function (file) { return root.URL.createObjectURL(file) }
  const revokeObjectURL = deps.revokeObjectURL || function (url) { root.URL.revokeObjectURL(url) }
  const ownedUrls = new Set()
  const assetRegistry = new Map()
  const previewAudio = createAudio()
  let previewLayerId = null
  let previewTimer = 0
  let layerSequence = 0
  // 저장된 작품을 불러왔는데 원본 파일이 이 페이지에 없는 소리 — 오디오는 저장하지 않으므로 설정만 기억해 두고
  // (다시 저장해도 지워지지 않게) 같은 이름의 파일을 다시 올리면 그 설정으로 이어 붙인다.
  let missingLayers = []
  // 아주 긴 파일은 풀어 놓으면 메모리를 많이 차지해(45분 → 약 1 GB) 교실 노트북에서 탭이 멈출 수 있다.
  const MAX_LAYER_SECONDS = 10 * 60

  if (!Array.isArray(state.soundLayers)) state.soundLayers = []
  previewAudio.preload = "metadata"

  function clamp(value, min, max) {
    const number = Number(value)
    return Math.max(min, Math.min(max, isFinite(number) ? number : min))
  }

  function round3(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000
  }

  function projectDuration() {
    return Math.max(0.05, Number(deps.getProjectDuration && deps.getProjectDuration()) || 30)
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.round((Number(value) || 0) * 10) / 10)
    const minutes = Math.floor(seconds / 60)
    const rest = seconds - minutes * 60
    const whole = Math.floor(rest + 0.0001)
    const decimal = Math.round((rest - whole) * 10)
    return minutes + ":" + (whole < 10 ? "0" : "") + whole + (decimal ? "." + decimal : "")
  }

  function safeFileName(value) {
    const name = String(value || "소리 파일").trim()
    return name.slice(0, 100) || "소리 파일"
  }

  function isAudioFile(file) {
    if (!file) return false
    if (/^audio\//i.test(file.type || "")) return true
    return /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i.test(file.name || "")
  }

  function setStatus(message, error) {
    if (!el.soundLayerStatus) return
    el.soundLayerStatus.textContent = message || ""
    el.soundLayerStatus.classList.toggle("error", !!error)
  }

  function clearPreviewTimer() {
    if (!previewTimer) return
    root.clearTimeout(previewTimer)
    previewTimer = 0
  }

  function stopPreview(options) {
    options = options || {}
    clearPreviewTimer()
    try { previewAudio.pause() } catch (error) {}
    const wasPlaying = previewLayerId != null
    previewLayerId = null
    if (wasPlaying && el.soundLayerStatus && /미리 듣는 중/.test(el.soundLayerStatus.textContent || "")) setStatus("미리듣기를 멈췄어요.", false)
    if (wasPlaying && options.render !== false) render()
  }

  function finishPreview() {
    if (previewLayerId == null) return
    stopPreview({ render: true })
    setStatus("선택한 부분의 미리듣기가 끝났어요.", false)
  }

  if (previewAudio.addEventListener) {
    previewAudio.addEventListener("timeupdate", function () {
      const layer = state.soundLayers.find(function (item) { return item.id === previewLayerId })
      if (layer && previewAudio.currentTime >= layer.trimEnd - 0.03) finishPreview()
    })
    previewAudio.addEventListener("ended", finishPreview)
  }

  // 미리듣기는 완성곡 속에서 들리는 크기와 같게 낸다(그대로 내면 약 7 dB 크게 들렸다).
  function previewVolume(layer) {
    const scale = engine && Number(engine.soundLayerPreviewScale) > 0 ? Number(engine.soundLayerPreviewScale) : 1
    return clamp(layer.volume * scale, 0, 1)
  }

  function selectedDuration(layer) {
    return Math.max(0.05, Number(layer.trimEnd) - Number(layer.trimStart))
  }

  function actualEnd(layer) {
    return Math.min(projectDuration(), Number(layer.startTime) + selectedDuration(layer))
  }

  function valueLine(label, value) {
    const head = doc.createElement("div")
    head.className = "sound-layer-control-head"
    const title = doc.createElement("span")
    title.textContent = label
    const output = doc.createElement("span")
    output.className = "sound-layer-value"
    output.textContent = value
    head.appendChild(title)
    head.appendChild(output)
    return { head: head, output: output }
  }

  function rangeInput(className, label, min, max, value) {
    const input = doc.createElement("input")
    input.className = "sound-layer-range " + className
    input.type = "range"
    input.min = String(min)
    input.max = String(max)
    input.step = "0.1"
    input.value = String(value)
    input.setAttribute("aria-label", label)
    return input
  }

  function rangeRow(label, input) {
    const row = doc.createElement("label")
    row.className = "sound-layer-range-row"
    const text = doc.createElement("span")
    text.textContent = label
    row.appendChild(text)
    row.appendChild(input)
    return row
  }

  function notifyEdit(message) {
    stopPreview({ render: false })
    if (typeof deps.beforeEdit === "function") deps.beforeEdit()
    if (typeof deps.onChange === "function") deps.onChange()
    setStatus(message, false)
  }

  function renderLoadingCard(layer) {
    const card = doc.createElement("article")
    card.className = "sound-layer-card is-loading"
    const head = doc.createElement("div")
    head.className = "sound-layer-card-head"
    const file = doc.createElement("div")
    file.className = "sound-layer-file"
    const name = doc.createElement("strong")
    name.textContent = layer.name
    const detail = doc.createElement("span")
    detail.textContent = "소리를 확인하는 중…"
    file.appendChild(name)
    file.appendChild(detail)
    head.appendChild(file)
    head.appendChild(removeButton(layer))
    card.appendChild(head)
    return card
  }

  function removeButton(layer) {
    const button = doc.createElement("button")
    button.type = "button"
    button.className = "sound-layer-remove"
    button.textContent = "삭제"
    button.setAttribute("aria-label", layer.name + " 삭제")
    button.addEventListener("click", function () { removeLayer(layer.id) })
    return button
  }

  function renderMissingCard(saved) {
    const card = doc.createElement("article")
    card.className = "sound-layer-card is-missing"
    const head = doc.createElement("div")
    head.className = "sound-layer-card-head"
    const file = doc.createElement("div")
    file.className = "sound-layer-file"
    const name = doc.createElement("strong")
    name.textContent = saved.name
    const detail = doc.createElement("span")
    detail.textContent = "같은 파일을 다시 올리면 이어서 들을 수 있어요"
    file.appendChild(name)
    file.appendChild(detail)
    head.appendChild(file)
    head.appendChild(removeButton(saved))
    card.appendChild(head)
    return card
  }

  function usedSlots() {
    return state.soundLayers.length + missingLayers.length
  }

  function renderReadyCard(layer) {
    const card = doc.createElement("article")
    card.className = "sound-layer-card"
    card.dataset.layerId = layer.id

    const head = doc.createElement("div")
    head.className = "sound-layer-card-head"
    const file = doc.createElement("div")
    file.className = "sound-layer-file"
    const name = doc.createElement("strong")
    name.textContent = layer.name
    name.title = layer.name
    const duration = doc.createElement("span")
    duration.textContent = "전체 " + formatTime(layer.sourceDuration)
    file.appendChild(name)
    file.appendChild(duration)
    head.appendChild(file)

    const preview = doc.createElement("button")
    preview.type = "button"
    preview.className = "sound-layer-preview" + (previewLayerId === layer.id ? " active" : "")
    preview.textContent = previewLayerId === layer.id ? "미리듣기 멈추기" : "선택한 부분 듣기"
    preview.addEventListener("click", function () { togglePreview(layer.id) })
    head.appendChild(preview)
    head.appendChild(removeButton(layer))
    card.appendChild(head)

    const controls = doc.createElement("div")
    controls.className = "sound-layer-controls"

    const trim = doc.createElement("div")
    trim.className = "sound-layer-control"
    const trimLine = valueLine("사용할 부분", formatTime(layer.trimStart) + " ~ " + formatTime(layer.trimEnd))
    trim.appendChild(trimLine.head)
    const trimRanges = doc.createElement("div")
    trimRanges.className = "sound-layer-ranges"
    const trimStart = rangeInput("range-start", layer.name + " 사용할 부분 시작", 0, Math.max(0, layer.sourceDuration - 0.1), layer.trimStart)
    const trimEnd = rangeInput("range-end", layer.name + " 사용할 부분 끝", 0.1, layer.sourceDuration, layer.trimEnd)
    trimStart.addEventListener("input", function () {
      layer.trimStart = round3(Math.min(Number(trimStart.value), layer.trimEnd - 0.1))
      trimStart.value = String(layer.trimStart)
      trimLine.output.textContent = formatTime(layer.trimStart) + " ~ " + formatTime(layer.trimEnd)
      positionLine.output.textContent = positionText(layer)
      stopPreview({ render: false })
    })
    trimEnd.addEventListener("input", function () {
      layer.trimEnd = round3(Math.max(Number(trimEnd.value), layer.trimStart + 0.1))
      trimEnd.value = String(layer.trimEnd)
      trimLine.output.textContent = formatTime(layer.trimStart) + " ~ " + formatTime(layer.trimEnd)
      positionLine.output.textContent = positionText(layer)
      stopPreview({ render: false })
    })
    trimStart.addEventListener("change", function () { notifyEdit("사용할 소리의 시작 부분을 바꿨어요.") })
    trimEnd.addEventListener("change", function () { notifyEdit("사용할 소리의 끝 부분을 바꿨어요.") })
    trimRanges.appendChild(rangeRow("시작", trimStart))
    trimRanges.appendChild(rangeRow("끝", trimEnd))
    trim.appendChild(trimRanges)
    controls.appendChild(trim)

    const position = doc.createElement("label")
    position.className = "sound-layer-control"
    const positionLine = valueLine("작품에서 나오는 때", positionText(layer))
    position.appendChild(positionLine.head)
    const positionMax = Math.max(projectDuration(), Number(layer.startTime) || 0, 0.1)
    const startTime = rangeInput("range-position", layer.name + " 작품에서 나오는 때", 0, positionMax, layer.startTime)
    startTime.addEventListener("input", function () {
      layer.startTime = round3(Number(startTime.value))
      positionLine.output.textContent = positionText(layer)
      stopPreview({ render: false })
    })
    startTime.addEventListener("change", function () { notifyEdit("소리가 나오는 때를 바꿨어요.") })
    position.appendChild(startTime)
    controls.appendChild(position)

    const volume = doc.createElement("label")
    volume.className = "sound-layer-control"
    const volumeLine = valueLine("음량", Math.round(layer.volume * 100) + "%")
    volume.appendChild(volumeLine.head)
    const volumeRange = rangeInput("range-volume", layer.name + " 음량", 0, 100, Math.round(layer.volume * 100))
    volumeRange.step = "1"
    volumeRange.addEventListener("input", function () {
      layer.volume = clamp(Number(volumeRange.value) / 100, 0, 1)
      volumeLine.output.textContent = Math.round(layer.volume * 100) + "%"
      if (previewLayerId === layer.id) previewAudio.volume = previewVolume(layer)
    })
    volumeRange.addEventListener("change", function () { notifyEdit("추가한 소리의 음량을 바꿨어요.") })
    volume.appendChild(volumeRange)
    controls.appendChild(volume)

    card.appendChild(controls)
    return card
  }

  function positionText(layer) {
    const start = Number(layer.startTime) || 0
    if (start >= projectDuration() - 0.001) return formatTime(start) + " · 현재 작품 길이 밖"
    return formatTime(start) + " ~ " + formatTime(actualEnd(layer))
  }

  function render() {
    if (el.soundLayerCount) el.soundLayerCount.textContent = usedSlots() + "/" + maxLayers + "개"
    // 자리가 다 찼어도 다시 올려야 할 소리가 있으면 그 파일을 올릴 수 있게 둔다.
    if (el.soundLayerAddBtn) el.soundLayerAddBtn.disabled = usedSlots() >= maxLayers && !missingLayers.length
    if (!el.soundLayerList) return
    el.soundLayerList.innerHTML = ""
    if (!state.soundLayers.length && !missingLayers.length) {
      const empty = doc.createElement("p")
      empty.className = "sound-layer-empty"
      empty.textContent = "아직 추가한 소리가 없어요."
      el.soundLayerList.appendChild(empty)
      return
    }
    state.soundLayers.forEach(function (layer) {
      el.soundLayerList.appendChild(layer.status === "ready" ? renderReadyCard(layer) : renderLoadingCard(layer))
    })
    missingLayers.forEach(function (saved) {
      el.soundLayerList.appendChild(renderMissingCard(saved))
    })
  }

  function togglePreview(id) {
    const layer = state.soundLayers.find(function (item) { return item.id === id && item.status === "ready" })
    if (!layer) return
    if (previewLayerId === id) {
      stopPreview()
      setStatus("미리듣기를 멈췄어요.", false)
      return
    }
    stopPreview({ render: false })
    if (typeof deps.beforePreview === "function") deps.beforePreview()
    previewLayerId = id
    previewAudio.src = layer.src
    previewAudio.volume = previewVolume(layer)
    try { previewAudio.currentTime = layer.trimStart } catch (error) {}
    render()
    const result = previewAudio.play()
    const started = function () {
      clearPreviewTimer()
      previewTimer = root.setTimeout(finishPreview, Math.ceil(selectedDuration(layer) * 1000) + 80)
      setStatus("선택한 부분을 미리 듣는 중이에요.", false)
    }
    const failed = function () {
      stopPreview()
      setStatus("이 소리는 미리 들을 수 없어요. 다른 파일을 골라 주세요.", true)
    }
    if (result && typeof result.then === "function") result.then(started, failed)
    else started()
  }

  function releaseDecoded(src) {
    if (src && engine && typeof engine.releaseAsset === "function") engine.releaseAsset(src)
  }

  function removeLayer(id) {
    const missingIndex = missingLayers.findIndex(function (item) { return item.id === id })
    if (missingIndex >= 0) {
      const gone = missingLayers.splice(missingIndex, 1)[0]
      render()
      if (typeof deps.onChange === "function") deps.onChange()
      setStatus("‘" + gone.name + "’ 소리를 뺐어요.", false)
      return
    }
    const index = state.soundLayers.findIndex(function (item) { return item.id === id })
    if (index < 0) return
    const removed = state.soundLayers[index]
    if (previewLayerId === id) stopPreview({ render: false })
    if (typeof deps.beforeEdit === "function") deps.beforeEdit()
    state.soundLayers.splice(index, 1)
    releaseDecoded(removed.src) // 풀어 둔 소리를 메모리에서 비운다(파일 주소는 되돌리기용으로 남긴다)
    render()
    if (typeof deps.onChange === "function") deps.onChange()
    setStatus("‘" + removed.name + "’ 소리를 뺐어요.", false)
  }

  function removeFailedLayer(id, message) {
    const index = state.soundLayers.findIndex(function (item) { return item.id === id })
    if (index >= 0) state.soundLayers.splice(index, 1)
    const stored = assetRegistry.get(id)
    if (stored && ownedUrls.has(stored.src)) {
      revokeObjectURL(stored.src)
      ownedUrls.delete(stored.src)
    }
    assetRegistry.delete(id)
    render()
    setStatus(message, true)
  }

  function addFile(file, saved) {
    const id = saved && saved.id ? saved.id : "sound-layer-" + Date.now().toString(36) + "-" + (++layerSequence).toString(36)
    const src = createObjectURL(file)
    ownedUrls.add(src)
    const layer = {
      id: id,
      name: safeFileName(file.name),
      src: src,
      file: file,
      sourceDuration: 0,
      trimStart: 0,
      trimEnd: 0,
      startTime: 0,
      volume: 0.65,
      status: "loading",
    }
    state.soundLayers.push(layer)
    assetRegistry.set(id, layer)
    render()
    setStatus("‘" + layer.name + "’ 소리를 확인하는 중이에요.", false)
    const warm = engine && typeof engine.warmSoundLayer === "function"
      ? engine.warmSoundLayer(layer)
      : Promise.resolve({ duration: Number(file.duration) || projectDuration() })
    Promise.resolve(warm).then(function (buffer) {
      const active = state.soundLayers.find(function (item) { return item.id === id })
      if (!active) return
      const duration = buffer && Number(buffer.duration)
      if (!(duration > 0)) {
        removeFailedLayer(id, "‘" + layer.name + "’ 파일의 소리를 읽지 못했어요. MP3나 WAV 파일을 사용해 주세요.")
        return
      }
      if (!(duration > 0.1)) {
        removeFailedLayer(id, "‘" + layer.name + "’은 너무 짧아요. 0.1초보다 긴 소리를 올려 주세요.")
        return
      }
      if (duration > MAX_LAYER_SECONDS) {
        releaseDecoded(src)
        removeFailedLayer(id, "‘" + layer.name + "’은 너무 길어요. 10분보다 짧은 소리 파일을 올려 주세요.")
        return
      }
      active.sourceDuration = round3(duration)
      if (saved) {
        // 저장된 작품의 소리를 다시 올렸다 — 그때 고른 부분·나오는 때·음량을 되살린다.
        active.trimStart = round3(clamp(saved.trimStart, 0, Math.max(0, duration - 0.1)))
        active.trimEnd = round3(clamp(saved.trimEnd, active.trimStart + 0.1, duration))
        active.startTime = round3(Math.max(0, Number(saved.startTime) || 0))
        active.volume = clamp(saved.volume == null ? 0.65 : saved.volume, 0, 1)
      } else {
        active.trimStart = 0
        active.trimEnd = round3(Math.min(duration, projectDuration()))
        active.startTime = 0
      }
      active.status = "ready"
      assetRegistry.set(id, active)
      render()
      if (typeof deps.onChange === "function") deps.onChange()
      setStatus(
        saved
          ? "‘" + active.name + "’ 소리를 작품에 다시 이어 붙였어요."
          : "‘" + active.name + "’ 소리를 추가했어요. 사용할 부분과 나오는 때를 정해 보세요.",
        false,
      )
    }, function () {
      removeFailedLayer(id, "‘" + layer.name + "’ 파일의 소리를 읽지 못했어요. 다른 파일을 골라 주세요.")
    })
  }

  function addFiles(files) {
    const incoming = Array.from(files || [])
    let remaining = Math.max(0, maxLayers - usedSlots())
    let accepted = 0
    let tooMany = false
    let rejectedMessage = ""
    incoming.forEach(function (file) {
      if (!isAudioFile(file)) {
        rejectedMessage = "소리 파일만 추가할 수 있어요."
        return
      }
      if (Number(file.size) > maxBytes) {
        rejectedMessage = "파일 하나는 " + Math.round(maxBytes / 1024 / 1024) + "MB보다 작아야 해요."
        return
      }
      // 저장된 작품에서 다시 올려야 하는 소리와 이름이 같으면 그 자리에 이어 붙인다(새 자리를 쓰지 않는다).
      const name = safeFileName(file.name)
      const savedIndex = missingLayers.findIndex(function (item) { return item.name === name })
      if (savedIndex >= 0) {
        const saved = missingLayers.splice(savedIndex, 1)[0]
        accepted += 1
        addFile(file, saved)
        return
      }
      if (remaining <= 0) {
        tooMany = true
        return
      }
      remaining -= 1
      accepted += 1
      addFile(file)
    })
    // 넘친 파일 안내는 마지막에 오류로 남긴다 — 앞 파일의 "확인하는 중이에요"에 덮이지 않게.
    if (tooMany) rejectedMessage = "소리 파일은 최대 " + maxLayers + "개까지 추가할 수 있어요. 앞의 " + accepted + "개만 넣었어요."
    if (rejectedMessage) setStatus(rejectedMessage, true)
  }

  function recipeLayers() {
    // 파일이 없는 소리는 소리 없이 설정만 남긴다(재생 계획은 src가 없는 소리를 건너뛴다).
    const kept = missingLayers.map(function (saved) {
      return {
        id: saved.id,
        name: saved.name,
        missing: true,
        sourceDuration: round3(saved.sourceDuration),
        trimStart: round3(saved.trimStart),
        trimEnd: round3(saved.trimEnd),
        startTime: round3(saved.startTime),
        volume: round3(clamp(saved.volume, 0, 1)),
      }
    })
    return state.soundLayers
      .filter(function (layer) { return layer && layer.status === "ready" && layer.src })
      .slice(0, maxLayers)
      .map(function (layer) {
        return {
          id: layer.id,
          name: layer.name,
          src: layer.src,
          file: layer.file,
          sourceDuration: round3(layer.sourceDuration),
          trimStart: round3(layer.trimStart),
          trimEnd: round3(layer.trimEnd),
          startTime: round3(layer.startTime),
          volume: round3(clamp(layer.volume, 0, 1)),
        }
      })
      .concat(kept)
      .slice(0, maxLayers)
  }

  function restoreRecipe(layers) {
    stopPreview({ render: false })
    let missing = 0
    const restored = []
    missingLayers = []
    ;(Array.isArray(layers) ? layers : []).slice(0, maxLayers).forEach(function (saved) {
      const registered = saved && assetRegistry.get(saved.id)
      if (!registered || !registered.src) {
        missing += 1
        if (saved && saved.name) {
          missingLayers.push({
            id: String(saved.id || "sound-layer-saved-" + missing),
            name: safeFileName(saved.name),
            sourceDuration: Number(saved.sourceDuration) || 0,
            trimStart: Number(saved.trimStart) || 0,
            trimEnd: Number(saved.trimEnd) || 0,
            startTime: Number(saved.startTime) || 0,
            volume: saved.volume == null ? 0.65 : Number(saved.volume),
          })
        }
        return
      }
      registered.trimStart = clamp(saved.trimStart, 0, Math.max(0, registered.sourceDuration - 0.1))
      registered.trimEnd = clamp(saved.trimEnd, registered.trimStart + 0.1, registered.sourceDuration)
      registered.startTime = Math.max(0, Number(saved.startTime) || 0)
      registered.volume = clamp(saved.volume, 0, 1)
      registered.status = "ready"
      restored.push(registered)
    })
    state.soundLayers = restored
    render()
    if (missing) setStatus("저장된 추가 소리는 원본 파일을 다시 올려야 사용할 수 있어요.", true)
    return missing
  }

  function clear(options) {
    options = options || {}
    stopPreview({ render: false })
    state.soundLayers.forEach(function (layer) { releaseDecoded(layer.src) })
    state.soundLayers = []
    missingLayers = []
    render()
    if (!options.silent) setStatus("추가한 소리를 모두 뺐어요.", false)
  }

  function handleDurationChange() {
    render()
    if (state.soundLayers.some(function (layer) { return layer.status === "ready" && layer.startTime >= projectDuration() })) {
      setStatus("작품 길이 밖에 있는 소리는 길이를 다시 늘리면 같은 초에 나타나요.", false)
    }
  }

  let copyrightAccepted = false // 저작권 안내는 처음 한 번 확인하면 된다
  if (el.soundLayerAddBtn && el.soundLayerInput) {
    el.soundLayerAddBtn.addEventListener("click", function () {
      if (usedSlots() >= maxLayers && !missingLayers.length) {
        setStatus("소리 파일은 최대 " + maxLayers + "개까지 추가할 수 있어요.", true)
        return
      }
      if (deps.copyrightNotice && !copyrightAccepted) {
        if (typeof root.confirm === "function" && !root.confirm(deps.copyrightNotice)) return
        copyrightAccepted = true
        // 안내창을 오래 읽으면 '누른 순간'이 지나 파일 고르기 창이 열리지 않는다 — 그때는 한 번 더 누르게 알린다.
        const activation = root.navigator && root.navigator.userActivation
        if (activation && !activation.isActive) {
          setStatus("저작권 안내를 확인했어요. '+ 소리 파일 추가'를 한 번 더 누르면 파일을 고를 수 있어요.", false)
          return
        }
      }
      el.soundLayerInput.click()
    })
    el.soundLayerInput.addEventListener("change", function () {
      addFiles(el.soundLayerInput.files)
      el.soundLayerInput.value = ""
    })
  }

  if (root.addEventListener) {
    root.addEventListener("beforeunload", function () {
      stopPreview({ render: false })
      ownedUrls.forEach(function (url) {
        try { revokeObjectURL(url) } catch (error) {}
      })
      ownedUrls.clear()
    })
  }

  render()

  return {
    addFiles: addFiles,
    clear: clear,
    handleDurationChange: handleDurationChange,
    recipeLayers: recipeLayers,
    removeLayer: removeLayer,
    render: render,
    restoreRecipe: restoreRecipe,
    stopPreview: stopPreview,
    getPreviewLayerId: function () { return previewLayerId },
  }
})
