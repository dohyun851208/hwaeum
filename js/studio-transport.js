;(function (root, factory) {
  "use strict"

  if (typeof module === "object" && module.exports) module.exports = factory
  else root.HwaeumStudioTransport = factory
})(typeof globalThis !== "undefined" ? globalThis : this, function createStudioTransport(deps) {
  "use strict"

  deps = deps || {}
  const root = deps.root || (typeof globalThis !== "undefined" ? globalThis : this)
  const doc = deps.document || root.document || null
  const state = deps.state
  const el = deps.el
  const engine = deps.engine
  const draw = deps.draw
  const DRAW_MODE_SOUND = deps.DRAW_MODE_SOUND || "sound"
  const DRAWING_STEP = Number.isFinite(deps.DRAWING_STEP) ? deps.DRAWING_STEP : 2
  const MIN_DURATION_SECONDS = Number.isFinite(deps.MIN_DURATION_SECONDS) ? deps.MIN_DURATION_SECONDS : 1
  const DEFAULT_DURATION_SECONDS = Number.isFinite(deps.DEFAULT_DURATION_SECONDS) ? deps.DEFAULT_DURATION_SECONDS : 30
  const SEGMENT_SECONDS = Number.isFinite(deps.SEGMENT_SECONDS) ? deps.SEGMENT_SECONDS : 2.5
  const snapDurationToSegments =
    typeof deps.snapDurationToSegments === "function"
      ? deps.snapDurationToSegments
      : function (value) {
          return value
        }
  const clock = deps.clock || {}
  const nowMs =
    typeof clock.now === "function"
      ? clock.now
      : function () {
          return root.performance && typeof root.performance.now === "function" ? root.performance.now() : Date.now()
        }
  const requestFrame =
    typeof clock.requestAnimationFrame === "function"
      ? clock.requestAnimationFrame
      : typeof root.requestAnimationFrame === "function"
        ? root.requestAnimationFrame.bind(root)
        : null
  const cancelFrame =
    typeof clock.cancelAnimationFrame === "function"
      ? clock.cancelAnimationFrame
      : typeof root.cancelAnimationFrame === "function"
        ? root.cancelAnimationFrame.bind(root)
        : function () {}
  const setTimer = deps.setTimeout || root.setTimeout || setTimeout
  const clearTimer = deps.clearTimeout || root.clearTimeout || clearTimeout
  const logger = deps.console || root.console || console

  const bgPlayer = deps.backgroundAudio || (deps.createAudio ? deps.createAudio() : new root.Audio())
  bgPlayer.preload = "auto"
  bgPlayer.volume = 0.825

  let bgRAF = null
  let bgPausedAt = null
  let bgSetupGeneration = 0
  let playheadRAF = null
  let playheadStartedAt = 0
  let playheadElapsedMs = 0
  let selectedPlayheadProgress = 0
  let silentFlowRAF = null
  let silentFlowStartedAt = 0

  function setIcon(button, text) {
    if (!button) return
    const icon = button.querySelector("span")
    if (icon) icon.textContent = text
  }

  const controlFeedbackTimers = new WeakMap()
  function pulseControl(button) {
    if (!button) return
    const oldTimer = controlFeedbackTimers.get(button)
    if (oldTimer) clearTimer(oldTimer)
    button.classList.add("pressing")
    const timer = setTimer(function () {
      button.classList.remove("pressing")
      controlFeedbackTimers.delete(button)
    }, 220)
    controlFeedbackTimers.set(button, timer)
  }

  function syncTransportButtons(playing, paused) {
    const activeAudio = !!playing && !paused
    const playLabel = activeAudio ? "전체 일시정지" : paused ? "전체 이어 듣기" : "전체 듣기"
    el.playBtn.setAttribute("aria-label", playLabel)
    el.playBtn.title = playLabel
    el.playBtn.classList.toggle("active", activeAudio)
    el.playBtn.classList.toggle("paused", !!paused)
    el.playBtn.setAttribute("aria-pressed", activeAudio ? "true" : "false")
    setIcon(el.playBtn, activeAudio ? "❚❚" : "▶")
    if (el.framePlayBtn) {
      const frameLabel = activeAudio ? "음악 일시정지" : paused ? "음악 이어 재생" : "음악 재생"
      el.framePlayBtn.setAttribute("aria-label", frameLabel)
      el.framePlayBtn.title = frameLabel
      el.framePlayBtn.classList.toggle("active", activeAudio)
      el.framePlayBtn.classList.toggle("paused", !!paused)
      el.framePlayBtn.setAttribute("aria-pressed", activeAudio ? "true" : "false")
      setIcon(el.framePlayBtn, activeAudio ? "❚❚" : "▶")
    }
    el.stopBtn.setAttribute("aria-pressed", "false")
  }

  function handleEngineState(playing, paused) {
    paused = !!paused
    const wasPaused = el.body.dataset.playback === "paused"
    if (!playing && !paused && !engine.ambience) state.playingTakeId = null
    el.statusText.textContent = paused
      ? playing
        ? "일시정지"
        : "배경음 일시정지"
      : playing
        ? "재생 중 · " + (engine.lastMode === "synth" ? "합성음" : "실제 음원")
        : engine.ambience
          ? "배경음 재생 중"
          : "전체 듣기"
    el.statusText.classList.toggle("playing", (playing || !!engine.ambience) && !paused)
    el.statusText.classList.toggle("paused", paused)
    el.frame.classList.toggle("playing", playing && !paused)
    el.body.dataset.playback = paused ? "paused" : playing ? "playing" : "idle"
    syncTransportButtons(playing, paused)
    deps.renderTakes()
    if (paused) pausePlayhead()
    else if (playing) startPlayhead(wasPaused)
    else stopPlayhead(engine.lastStopReason === "ended")
  }

  engine.onState = handleEngineState

  function durationMs() {
    return Math.max(1, state.duration * 1000)
  }

  function clampPlayheadProgress(progress) {
    const dur = Math.max(0.05, state.duration || DEFAULT_DURATION_SECONDS)
    const max = Math.max(0, (dur - 0.05) / dur)
    return Math.max(0, Math.min(max, Number(progress) || 0))
  }

  function rememberPlayheadProgress(progress) {
    selectedPlayheadProgress = clampPlayheadProgress(progress)
    playheadElapsedMs = selectedPlayheadProgress * durationMs()
  }

  function playheadProgressFromEvent(event) {
    return clampPlayheadProgress(deps.timelineProgressFromClientX(event.clientX))
  }

  function syncPlayheadValue(progress) {
    if (!el.playhead) return
    const sec = Math.round(progress * (state.duration || DEFAULT_DURATION_SECONDS))
    el.playhead.setAttribute("aria-valuemin", "0")
    el.playhead.setAttribute("aria-valuemax", String(state.duration || DEFAULT_DURATION_SECONDS))
    el.playhead.setAttribute("aria-valuenow", String(sec))
    el.playhead.setAttribute("title", sec + "초부터 재생")
  }

  function positionPlayhead(progress, options) {
    const wrap = deps.canvasWrap()
    if (!wrap || !el.playhead) return
    const value = Math.max(0, Math.min(1, progress))
    const left = el.canvas.offsetLeft + deps.timelineCssX(value)
    el.playhead.style.left = left + "px"
    syncPlayheadValue(value)
    const view = wrap.clientWidth
    const follow = !options || options.follow !== false
    if (follow && (left < wrap.scrollLeft + 48 || left > wrap.scrollLeft + view - 48)) {
      wrap.scrollLeft = Math.max(0, left - view / 2)
      deps.syncCanvasScrollState()
    }
  }

  function showSelectedPlayhead(follow) {
    if (!el.playhead) return
    el.playhead.hidden = false
    positionPlayhead(selectedPlayheadProgress, { follow: !!follow })
  }

  function setSelectedPlayhead(progress, announce, follow) {
    rememberPlayheadProgress(progress)
    showSelectedPlayhead(follow)
    if (announce) {
      el.exportStatus.textContent = Math.round(selectedPlayheadProgress * state.duration) + "초부터 재생하도록 위치를 옮겼어요."
    }
  }

  function selectedPlaybackStartSec() {
    return clampPlayheadProgress(selectedPlayheadProgress) * (state.duration || DEFAULT_DURATION_SECONDS)
  }

  function livePlayheadProgress() {
    if (engine.isPlaying && !engine.isPaused && playheadStartedAt) {
      return Math.max(0, Math.min(1, (nowMs() - playheadStartedAt) / durationMs()))
    }
    return selectedPlayheadProgress
  }

  function bgTimeFromProgress(progress) {
    const end = selectedBgEnd()
    const segment = Math.max(0.1, end - state.bgOffset)
    return state.bgOffset + clampPlayheadProgress(progress) * segment
  }

  function soundDrawingProgress() {
    if (state.drawingInputMode !== DRAW_MODE_SOUND) return selectedPlayheadProgress
    if ((engine.isPlaying || engine.isStarting) && !engine.isPaused) return livePlayheadProgress()
    if (!deps.bgSrcFor(state.atmosphere)) {
      startSilentFlowClock()
      return clampPlayheadProgress(livePlayheadProgress())
    }
    if (bgPlayer.paused) {
      const resumeTime = bgTimeFromProgress(livePlayheadProgress())
      if (bgTimeInSelectedRange(resumeTime)) bgPausedAt = resumeTime
      playBgPlayer()
    }
    if (bgPlayer.paused) return selectedPlayheadProgress
    return bgPlayheadProgress(bgPlayer.currentTime)
  }

  function finishSoundFlowAtCurrentPoint() {
    if (state.drawingInputMode !== DRAW_MODE_SOUND || !draw.flowActive) return
    draw.flowRecord(livePlayheadProgress())
    draw.finishFlowStroke(true)
  }

  function silentFlowProgress() {
    return Math.max(0, Math.min(1, (nowMs() - silentFlowStartedAt) / durationMs()))
  }

  function startSilentFlowClock() {
    if (silentFlowRAF || !requestFrame) return
    silentFlowStartedAt = nowMs() - clampPlayheadProgress(livePlayheadProgress()) * durationMs()
    if (el.playhead) el.playhead.hidden = false
    const tick = function () {
      if (
        state.drawingInputMode !== DRAW_MODE_SOUND ||
        !draw.flowActive ||
        (engine.isPlaying && !engine.isPaused) ||
        deps.bgSrcFor(state.atmosphere)
      ) {
        stopSilentFlowClock()
        return
      }
      const progress = silentFlowProgress()
      positionPlayhead(progress)
      if (progress >= 1) {
        draw.flowRecord(1)
        draw.finishFlowStroke(true)
        rememberPlayheadProgress(0)
        stopSilentFlowClock()
        return
      }
      draw.flowRecord(progress)
      silentFlowRAF = requestFrame(tick)
    }
    silentFlowRAF = requestFrame(tick)
  }

  function stopSilentFlowClock() {
    if (silentFlowRAF) cancelFrame(silentFlowRAF)
    silentFlowRAF = null
  }

  function stopPlayhead(finished) {
    if (playheadRAF) cancelFrame(playheadRAF)
    playheadRAF = null
    playheadStartedAt = 0
    if (finished) {
      playheadElapsedMs = durationMs()
      if (el.playhead) {
        if (state.step === DRAWING_STEP) {
          el.playhead.hidden = false
          positionPlayhead(1, { follow: false })
        } else {
          el.playhead.hidden = true
        }
      }
      return
    }
    playheadElapsedMs = selectedPlaybackStartSec() * 1000
    if (el.playhead) {
      if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
      else el.playhead.hidden = true
    }
  }

  function pausePlayhead() {
    if (playheadRAF) cancelFrame(playheadRAF)
    playheadRAF = null
    if (playheadStartedAt) playheadElapsedMs = Math.max(0, Math.min(durationMs(), nowMs() - playheadStartedAt))
    const pausedProgress = Math.max(0, Math.min(1, playheadElapsedMs / durationMs()))
    rememberPlayheadProgress(pausedProgress)
    if (el.playhead) {
      el.playhead.hidden = false
      positionPlayhead(pausedProgress)
    }
  }

  function freezePlayheadAtLivePosition() {
    if (!engine.isPlaying || engine.isPaused) return
    if (playheadStartedAt) playheadElapsedMs = Math.max(0, Math.min(durationMs(), nowMs() - playheadStartedAt))
    rememberPlayheadProgress(playheadElapsedMs / durationMs())
  }

  // 소리는 예약 리드 + 하드웨어 출력 지연만큼 늦게 들리기 시작한다.
  // 플레이헤드 시계의 0점을 그만큼 뒤로 밀어야 그림과 소리가 맞는다.
  function audioLeadMs() {
    const lead = Number(engine.playbackLeadMs)
    if (!isFinite(lead) || lead <= 0) return 0
    return Math.min(lead, durationMs())
  }

  function startPlayhead(resume) {
    const wrap = deps.canvasWrap()
    if (!wrap || !el.playhead || !requestFrame) return
    const durMs = durationMs()
    if (!resume) playheadElapsedMs = selectedPlaybackStartSec() * 1000
    playheadStartedAt = nowMs() - playheadElapsedMs + audioLeadMs()
    el.playhead.hidden = false
    const tick = function () {
      const elapsed = nowMs() - playheadStartedAt
      const progress = Math.max(0, Math.min(1, elapsed / durMs))
      playheadElapsedMs = elapsed
      positionPlayhead(progress)
      const soundFlow = state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive
      if (progress < 1 && engine.isPlaying && !engine.isPaused) {
        if (soundFlow) draw.flowRecord(progress)
        playheadRAF = requestFrame(tick)
      } else {
        if (soundFlow) {
          draw.flowRecord(1)
          draw.finishFlowStroke(true)
        }
        stopPlayhead(progress >= 1)
      }
    }
    if (playheadRAF) cancelFrame(playheadRAF)
    playheadRAF = requestFrame(tick)
  }

  function stopPlaybackForPlayheadSeek() {
    if (typeof deps.stopSoundLayerPreview === "function") deps.stopSoundLayerPreview()
    if (!bgPlayer.paused) pauseBgPlayer()
    if (engine.isPlaying || engine.isPaused) engine.stop()
  }

  function bindPlayheadSeeking() {
    if (!el.playhead) return
    let seeking = false
    const seekToEvent = function (event, announce) {
      setSelectedPlayhead(playheadProgressFromEvent(event), !!announce, true)
    }
    el.playhead.addEventListener("pointerdown", function (event) {
      seeking = true
      stopPlaybackForPlayheadSeek()
      seekToEvent(event, false)
      try {
        el.playhead.setPointerCapture(event.pointerId)
      } catch (error) {}
      event.preventDefault()
      event.stopPropagation()
    })
    el.playhead.addEventListener("pointermove", function (event) {
      if (!seeking) return
      seekToEvent(event, false)
      event.preventDefault()
      event.stopPropagation()
    })
    const finish = function (event) {
      if (!seeking) return
      seeking = false
      seekToEvent(event, true)
      event.preventDefault()
      event.stopPropagation()
    }
    el.playhead.addEventListener("pointerup", finish)
    el.playhead.addEventListener("pointercancel", finish)
    el.playhead.addEventListener("keydown", function (event) {
      const dur = Math.max(1, state.duration || DEFAULT_DURATION_SECONDS)
      const step = (event.shiftKey ? 5 : 1) / dur
      let next = selectedPlayheadProgress
      if (event.key === "ArrowLeft") next -= step
      else if (event.key === "ArrowRight") next += step
      else if (event.key === "Home") next = 0
      else if (event.key === "End") next = 1
      else return
      stopPlaybackForPlayheadSeek()
      setSelectedPlayhead(next, true, true)
      event.preventDefault()
    })
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0
    const minutes = Math.floor(sec / 60)
    const seconds = Math.floor(sec % 60)
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds
  }

  // 구간은 마디(2.5초) 단위로 붙으므로 0.5초 자리가 남을 수 있다. 반올림해 버리면
  // 12.5초가 "0:12"로 보여서 "맞춘 값과 눈금이 다르다"는 오해가 생긴다 — 있는 그대로 보여 준다.
  function fmtInputTime(sec) {
    const value = Math.round(Math.max(0, Number(sec) || 0) * 10) / 10
    const minutes = Math.floor(value / 60)
    const seconds = value - minutes * 60
    const whole = Math.floor(seconds + 1e-6)
    const frac = Math.round((seconds - whole) * 10)
    return minutes + ":" + (whole < 10 ? "0" : "") + whole + (frac ? "." + frac : "")
  }

  function parseTimeInput(value) {
    const raw = String(value || "").trim()
    if (!raw) return null
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
    const parts = raw.split(":")
    if (parts.length < 2 || parts.length > 3) return null
    let total = 0
    for (const part of parts) {
      if (!/^\d+(?:\.\d+)?$/.test(part)) return null
      total = total * 60 + Number(part)
    }
    return total
  }

  function bgDuration() {
    const duration = bgPlayer.duration
    return isFinite(duration) && duration > 0 ? duration : 0
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000
  }

  // 배경 구간은 최소 한 마디. 한 마디보다 짧은 배경이면 그 배경 전체를 쓴다.
  function bgMinGap(total) {
    return total ? Math.min(SEGMENT_SECONDS, total) : 0
  }

  function defaultBgEnd(total, start) {
    if (!total) return 0
    const from = start == null ? state.bgOffset : start
    return Math.min(total, Math.max(from + bgMinGap(total), from + state.duration))
  }

  function normalizeBgRange(keepEnd) {
    const total = bgDuration()
    if (!deps.canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      return
    }
    if (!total) return
    const gap = bgMinGap(total)
    const maxStart = Math.max(0, total - gap)
    state.bgOffset = deps.clampNumber(state.bgOffset, 0, maxStart)
    let end = parseFloat(state.bgEndOffset)
    if (!keepEnd || !isFinite(end) || end <= state.bgOffset + gap * 0.5) end = defaultBgEnd(total, state.bgOffset)
    end = deps.clampNumber(end, Math.min(total, state.bgOffset + gap), total)
    // 끝 지점을 마디 경계로 붙인다 — 길이가 2.5초 배수가 아니면 도화지 마지막 마디가
    // 토막 나고 마지막 시간 라벨이 앞 라벨과 겹친다.
    const snapped = snapDurationToSegments(end - state.bgOffset, total - state.bgOffset)
    state.bgEndOffset = Math.min(total, round3(state.bgOffset + snapped))
  }

  function ensureTimelineDuration(resetScroll) {
    let next = null
    const total = bgDuration()
    if (deps.canSelectBgRange() && total) {
      const segment = Number(state.bgEndOffset) - Number(state.bgOffset)
      if (isFinite(segment) && segment > 0) next = deps.normalizeDuration(segment)
    }
    if (next == null) next = deps.normalizeDuration(state.duration || DEFAULT_DURATION_SECONDS)
    const previous = Number(state.duration) || DEFAULT_DURATION_SECONDS
    if (Math.abs(previous - next) < 0.001) return false
    const selectedPlayheadSeconds = selectedPlayheadProgress * previous
    state.duration = next
    if (draw && typeof draw.retimeDuration === "function") draw.retimeDuration(previous, next)
    if (typeof deps.onDurationChange === "function") deps.onDurationChange(previous, next)
    // 재생 시작 위치도 비율이 아니라 원래 선택한 초를 유지한다.
    rememberPlayheadProgress(selectedPlayheadSeconds / next)
    deps.refreshTimeline(!!resetScroll)
    return true
  }

  function selectedBgEnd() {
    if (!deps.canSelectBgRange()) {
      const total = bgDuration()
      return total ? defaultBgEnd(total, 0) : 0
    }
    normalizeBgRange(true)
    return state.bgEndOffset
  }

  function bgTimeInSelectedRange(time) {
    const value = Number(time)
    if (!isFinite(value)) return false
    const end = selectedBgEnd()
    return value >= state.bgOffset && value < end - 0.02
  }

  function bgPlayheadProgress(time) {
    const end = selectedBgEnd()
    const segment = Math.max(0.1, end - state.bgOffset)
    return Math.max(0, Math.min(1, (Number(time) - state.bgOffset) / segment))
  }

  function positionBgPlayhead(time, follow) {
    if (!el.playhead) return
    el.playhead.hidden = false
    const progress = bgPlayheadProgress(time)
    rememberPlayheadProgress(progress)
    positionPlayhead(progress, { follow: !!follow })
  }

  function syncBgPlayerUI() {
    normalizeBgRange(true)
    const total = bgDuration()
    const gap = bgMinGap(total)
    const maxStart = Math.max(0, total - gap)
    const endMin = Math.min(total, state.bgOffset + gap)
    const hasSrc = !!bgPlayer.getAttribute("src")
    const canSelectRange = deps.canSelectBgRange()
    if (el.bgPlayer) el.bgPlayer.classList.toggle("disabled", !hasSrc)
    const bgRange = el.bgSeek ? el.bgSeek.closest(".bg-range") : null
    if (bgRange) bgRange.hidden = !canSelectRange
    const bgTimeInputs = el.bgStartInput ? el.bgStartInput.closest(".bg-time-inputs") : null
    if (bgTimeInputs) bgTimeInputs.hidden = !canSelectRange
    if (el.bgSeek) {
      el.bgSeek.max = String(maxStart)
      el.bgSeek.value = String(state.bgOffset)
      el.bgSeek.disabled = !canSelectRange || !(maxStart > 0)
    }
    if (el.bgEndSeek) {
      el.bgEndSeek.min = String(endMin)
      el.bgEndSeek.max = String(total)
      el.bgEndSeek.value = String(state.bgEndOffset)
      el.bgEndSeek.disabled = !canSelectRange || !(total > gap)
    }
    const durationChanged = ensureTimelineDuration(false)
    if (el.bgStartInput) {
      el.bgStartInput.disabled = !canSelectRange || !total
      if (!doc || doc.activeElement !== el.bgStartInput) el.bgStartInput.value = fmtInputTime(state.bgOffset)
    }
    if (el.bgEndInput) {
      el.bgEndInput.disabled = !canSelectRange || !total
      if (!doc || doc.activeElement !== el.bgEndInput) el.bgEndInput.value = fmtInputTime(state.bgEndOffset)
    }
    if (el.bgTime) {
      el.bgTime.textContent = canSelectRange
        ? fmtInputTime(state.bgOffset) + " ~ " + fmtInputTime(state.bgEndOffset) + " / " + fmtInputTime(total)
        : fmtTime(0) + " / " + fmtTime(total)
    }
    if (!durationChanged) deps.updateReadouts()
    setIcon(el.bgPlayBtn, bgPlayer.paused ? "▶" : "❚❚")
    if (el.bgPlayBtn) {
      const label = bgPlayer.paused ? "배경 구간 선택" : "배경 구간 일시정지"
      el.bgPlayBtn.setAttribute("aria-label", label)
      el.bgPlayBtn.setAttribute("title", label)
      el.bgPlayBtn.classList.toggle("active", !bgPlayer.paused)
      el.bgPlayBtn.setAttribute("aria-pressed", bgPlayer.paused ? "false" : "true")
    }
  }

  function setupBgPlayer(keepRange) {
    const setupGeneration = ++bgSetupGeneration
    pauseBgPlayer()
    bgPausedAt = null
    const src = deps.bgSrcFor(state.atmosphere)
    if (!src) {
      bgPlayer.removeAttribute("src")
      syncBgPlayerUI()
      return
    }
    if (bgPlayer.getAttribute("src") !== src) bgPlayer.src = src
    const apply = function () {
      if (setupGeneration !== bgSetupGeneration) return
      if (deps.bgSrcFor(state.atmosphere) !== src || bgPlayer.getAttribute("src") !== src) return
      normalizeBgRange(!!keepRange)
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (error) {}
      syncBgPlayerUI()
    }
    if (isFinite(bgPlayer.duration) && bgPlayer.duration > 0) apply()
    else bgPlayer.addEventListener("loadedmetadata", apply, { once: true })
    syncBgPlayerUI()
  }

  function pauseBgPlayer(keepPosition) {
    const pausedAt = bgPlayer.currentTime
    try {
      bgPlayer.pause()
    } catch (error) {}
    if (bgRAF) cancelFrame(bgRAF)
    bgRAF = null
    if (keepPosition && bgTimeInSelectedRange(pausedAt)) {
      bgPausedAt = pausedAt
      rememberPlayheadProgress(bgPlayheadProgress(bgPausedAt))
      if (state.step === DRAWING_STEP) positionBgPlayhead(bgPausedAt, false)
    } else {
      bgPausedAt = null
      if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
      else if (el.playhead) el.playhead.hidden = true
    }
    syncBgPlayerUI()
  }

  function playBgPlayer() {
    if (!deps.bgSrcFor(state.atmosphere)) return
    if (typeof deps.stopSoundLayerPreview === "function") deps.stopSoundLayerPreview()
    deps.stopBackgroundPreview()
    deps.stopExamplePreview()
    engine.stop()
    normalizeBgRange(true)
    const startAt = bgTimeInSelectedRange(bgPausedAt) ? bgPausedAt : state.bgOffset
    try {
      bgPlayer.currentTime = startAt
    } catch (error) {}
    bgPausedAt = null
    const result = bgPlayer.play()
    if (result && result.catch) result.catch((error) => logger.warn("배경음악 재생 실패", error))
    if (el.playhead) el.playhead.hidden = false
    bgTick()
    syncBgPlayerUI()
  }

  function toggleBgPlay() {
    if (bgPlayer.paused) playBgPlayer()
    else pauseBgPlayer(true)
  }

  function bgTick() {
    if (bgPlayer.paused) {
      bgRAF = null
      return
    }
    const end = selectedBgEnd()
    const segment = Math.max(0.1, end - state.bgOffset)
    let relative = bgPlayer.currentTime - state.bgOffset
    if (bgPlayer.currentTime >= end || bgPlayer.currentTime + 0.001 < state.bgOffset) {
      if (state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive) {
        draw.flowRecord(1)
        draw.finishFlowStroke(true)
      }
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (error) {}
      relative = 0
    }
    const progress = Math.max(0, Math.min(1, relative / segment))
    positionPlayhead(progress)
    if (state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive) draw.flowRecord(progress)
    if (requestFrame) bgRAF = requestFrame(bgTick)
  }

  function seekBg(value) {
    if (!deps.canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      syncBgPlayerUI()
      return
    }
    const total = bgDuration()
    const gap = bgMinGap(total)
    const previousEnd = Number(state.bgEndOffset)
    state.bgOffset = deps.clampNumber(value, 0, Math.max(0, total - gap))
    state.bgEndOffset =
      isFinite(previousEnd) && previousEnd > state.bgOffset + gap ? previousEnd : defaultBgEnd(total, state.bgOffset)
    bgPausedAt = null
    normalizeBgRange(true)
    try {
      bgPlayer.currentTime = state.bgOffset
    } catch (error) {}
    if (el.playhead) showSelectedPlayhead(false)
    syncBgPlayerUI()
  }

  function seekBgEnd(value) {
    if (!deps.canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      syncBgPlayerUI()
      return
    }
    const total = bgDuration()
    const gap = bgMinGap(total)
    state.bgEndOffset = deps.clampNumber(value, Math.min(total, state.bgOffset + gap), total)
    normalizeBgRange(true)
    if (bgPlayer.currentTime >= state.bgEndOffset) {
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (error) {}
      bgPausedAt = null
      showSelectedPlayhead(false)
    }
    syncBgPlayerUI()
  }

  function commitBgStartInput() {
    const parsed = parseTimeInput(el.bgStartInput && el.bgStartInput.value)
    if (parsed == null) syncBgPlayerUI()
    else seekBg(parsed)
  }

  function commitBgEndInput() {
    const parsed = parseTimeInput(el.bgEndInput && el.bgEndInput.value)
    if (parsed == null) syncBgPlayerUI()
    else seekBgEnd(parsed)
  }

  function play() {
    if (typeof deps.stopSoundLayerPreview === "function") deps.stopSoundLayerPreview()
    if (engine.isPlaying && engine.isPaused) {
      engine.resume()
      return
    }
    if (engine.isPlaying) {
      finishSoundFlowAtCurrentPoint()
      engine.pause()
      return
    }
    deps.stopBackgroundPreview()
    deps.stopExamplePreview()
    pauseBgPlayer()
    deps.renderAtmospheres()
    const recipe = deps.buildRecipe()
    engine.play(recipe, deps.notesFor(recipe), { startOffset: selectedPlaybackStartSec() }).catch(function (error) {
      state.playingTakeId = null
      deps.renderTakes()
      const message =
        error && (error.name || error.message)
          ? [error.name, error.message].filter(Boolean).join(": ")
          : String(error)
      el.statusText.textContent = "재생 오류"
      el.exportStatus.textContent = "재생 오류: " + message
      logger.error("전체곡 재생 실패", error, { recipe: recipe, state: deps.getStateSummary ? deps.getStateSummary() : null })
    })
  }

  function toggleTransport() {
    if (engine.isPaused && engine.isPlaying) {
      engine.resume()
      return
    }
    if (engine.isPaused) engine.stop({ emitState: false })
    if (engine.isPlaying) {
      finishSoundFlowAtCurrentPoint()
      engine.pause()
      return
    }
    play()
  }

  function pause() {
    if (!engine.isPlaying && !engine.ambience && !engine.isPaused) return
    deps.stopBackgroundPreview()
    deps.stopExamplePreview()
    deps.renderAtmospheres()
    if (engine.isPaused) engine.resume()
    else {
      finishSoundFlowAtCurrentPoint()
      engine.pause()
    }
  }

  function resume() {
    return engine.resume()
  }

  function resetPlayheadToStart() {
    if (!bgPlayer.paused) pauseBgPlayer()
    bgPausedAt = null
    try {
      bgPlayer.currentTime = state.bgOffset
    } catch (error) {}
    selectedPlayheadProgress = 0
    playheadElapsedMs = 0
    if (!el.playhead) return
    if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
    else el.playhead.hidden = true
  }

  function movePlayheadToStart(announce) {
    finishSoundFlowAtCurrentPoint()
    stopPlaybackForPlayheadSeek()
    resetPlayheadToStart()
    const wrap = deps.canvasWrap()
    if (wrap) {
      wrap.scrollLeft = 0
      deps.syncCanvasScrollState()
    }
    if (announce && el.exportStatus) el.exportStatus.textContent = "재생 위치를 처음으로 옮겼어요."
  }

  function stop() {
    if (typeof deps.stopSoundLayerPreview === "function") deps.stopSoundLayerPreview()
    deps.stopBackgroundPreview()
    deps.stopExamplePreview()
    deps.renderAtmospheres()
    state.playingTakeId = null
    engine.stop()
    resetPlayheadToStart()
    deps.renderTakes()
  }

  function isBackgroundPaused() {
    return !!bgPlayer.paused
  }

  function getTimeState() {
    return {
      selectedPlayheadProgress,
      playheadElapsedMs,
      playheadStartedAt,
      bgPausedAt,
      silentFlowActive: !!silentFlowRAF,
      backgroundPlaying: !bgPlayer.paused,
    }
  }

  return {
    pulseControl,
    syncTransportButtons,
    handleEngineState,
    soundDrawingProgress,
    finishSoundFlowAtCurrentPoint,
    startSilentFlowClock,
    stopSilentFlowClock,
    stopPlayhead,
    pausePlayhead,
    freezePlayheadAtLivePosition,
    startPlayhead,
    bindPlayheadSeeking,
    showSelectedPlayhead,
    setSelectedPlayhead,
    selectedPlaybackStartSec,
    livePlayheadProgress,
    ensureTimelineDuration,
    syncBgPlayerUI,
    setupBgPlayer,
    pauseBgPlayer,
    playBgPlayer,
    toggleBgPlay,
    seekBg,
    seekBgEnd,
    commitBgStartInput,
    commitBgEndInput,
    isBackgroundPaused,
    play,
    toggleTransport,
    pause,
    resume,
    stop,
    resetPlayheadToStart,
    movePlayheadToStart,
    getTimeState,
  }
})
