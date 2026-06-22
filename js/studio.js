/*
 * studio.js — 위저드 오케스트레이션
 * 상태 관리, 카드 렌더, 단계 이동, 그림 업로드, 무드 틴팅, 재생, 시도 저장, 내보내기, 공유 링크.
 */
;(function () {
  "use strict"
  const Core = window.MusicCore
  const D = window.SDStudioData

  const engine = new window.AudioEngine()
  const takes = new window.TakesStore("sda.takes")
  const SEGMENT_SECONDS = 10
  const DEFAULT_COVER_SRC = "./assets/default-cover.png"
  const ADMIN_STORAGE_KEY = "sda.adminMode"
  const TAKE_NAME_MAX = 24

  function loadAdminMode() {
    try {
      return window.localStorage ? window.localStorage.getItem(ADMIN_STORAGE_KEY) === "1" : false
    } catch (e) {
      return false
    }
  }

  function saveAdminMode(on) {
    try {
      if (window.localStorage) window.localStorage.setItem(ADMIN_STORAGE_KEY, on ? "1" : "0")
    } catch (e) {}
  }

  const state = {
    duration: 30,
    atmosphere: D.atmospheres[0],
    instrument: D.instruments[0],
    style: D.styles[0],
    version: D.versions[0],
    mode: "melody",
    pic: null,
    title: "무제",
    step: 0,
    group: "서양",
    bgPreviewId: null, // 현재 미리듣기 중인 분위기 id
    adminMode: loadAdminMode(),
  }

  // 분위기(배경) 미리듣기 — Web Audio 합주 엔진과 독립된 단순 재생기
  const bgPreview = new Audio()
  bgPreview.preload = "none"
  let customBgSeq = 0

  const $ = (id) => document.getElementById(id)
  const el = {
    body: document.body,
    statusText: $("statusText"),
    playBtn: $("playBtn"),
    stopBtn: $("stopBtn"),
    picInput: $("picInput"),
    dropPreview: $("dropPreview"),
    dropEmpty: $("dropEmpty"),
    picChip: $("picChip"),
    picThumb: $("picThumb"),
    picStatus: $("picStatus"),
    atmosphereGrid: $("atmosphereGrid"),
    bgUploadInput: $("bgUploadInput"),
    bgUploadStatus: $("bgUploadStatus"),
    instrumentGroups: $("instrumentGroups"),
    instrumentGrid: $("instrumentGrid"),
    styleGrid: $("styleGrid"),
    modeHint: $("modeHint"),
    canvas: $("drawingCanvas"),
    paletteLabels: $("paletteLabels"),
    playhead: $("playhead"),
    clearBtn: $("clearBtn"),
    resetComposeBtn: $("resetComposeBtn"),
    scaleReadout: $("scaleReadout"),
    rhythmReadout: $("rhythmReadout"),
    noteReadout: $("noteReadout"),
    durReadout: $("durReadout"),
    versionList: $("versionList"),
    composeInstrumentList: $("composeInstrumentList"),
    frame: $("frame"),
    frameImg: $("frameImg"),
    frameCanvas: $("frameCanvas"),
    framePlay: $("framePlay"),
    titleInput: $("titleInput"),
    placardMeta: $("placardMeta"),
    saveTakeBtn: $("saveTakeBtn"),
    adminModeBtn: $("adminModeBtn"),
    exportWavBtn: $("exportWavBtn"),
    exportCoverBtn: $("exportCoverBtn"),
    shareBtn: $("shareBtn"),
    exportStatus: $("exportStatus"),
    takesList: $("takesList"),
    takesCount: $("takesCount"),
    takesEmpty: $("takesEmpty"),
    composePlay: $("composePlay"),
    audioModeNote: $("audioModeNote"),
  }

  const draw = new window.DrawingCanvas(el.canvas, {
    getState: () => ({ duration: state.duration, style: state.style, mode: state.mode }),
    onChange: () => {
      updateReadouts()
    },
    onPreviewStart: (point) => {
      el.statusText.textContent = state.instrument.label + " 드로잉 중"
      el.statusText.classList.add("playing")
      el.body.dataset.livePreview = "drawing"
      engine.liveDrawingStart(buildRecipe(), point.y).catch(function (e) {
        console.warn("드로잉 라이브 시작 실패", e)
      })
    },
    onPreview: (point) => {
      engine.liveDrawingMove(buildRecipe(), point.y).catch(function (e) {
        console.warn("드로잉 라이브 이동 실패", e)
      })
    },
    onPreviewEnd: () => {
      engine.liveDrawingEnd()
      if (!engine.isPlaying) {
        el.statusText.textContent = "대기 중"
        el.statusText.classList.remove("playing")
        el.body.dataset.livePreview = "idle"
      }
    },
    accent: state.atmosphere.color,
  })

  // --- 유틸 ---

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")"
  }

  function applyMoodTint() {
    const c = state.atmosphere.color
    document.documentElement.style.setProperty("--accent", c)
    document.documentElement.style.setProperty("--accent-soft", hexToRgba(c, 0.14))
    document.documentElement.style.setProperty("--accent-line", hexToRgba(c, 0.4))
    draw.setAccent(c)
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000
  }

  function paletteCount() {
    return Math.max(1, Math.ceil(state.duration / SEGMENT_SECONDS))
  }

  function canvasWrap() {
    return el.canvas.parentElement
  }

  function availableTimelineWidth() {
    const wrap = canvasWrap()
    if (!wrap) return 960
    return Math.max(320, Math.floor(wrap.clientWidth))
  }

  function syncTimelineWidth(resetScroll) {
    const wrap = canvasWrap()
    if (!wrap) return
    const segmentWidth = Math.max(availableTimelineWidth(), window.matchMedia("(max-width: 720px)").matches ? 520 : 960)
    const width = segmentWidth * paletteCount()
    wrap.style.setProperty("--timeline-width", width + "px")
    wrap.dataset.segmentWidth = String(segmentWidth)
    wrap.dataset.segments = String(paletteCount())
    if (resetScroll) wrap.scrollLeft = 0
  }

  // 저장/공유용 다운샘플 — 절대 x(시간 위치)를 보존하도록 균등 인덱스로 솎는다.
  // (resampleByTime은 x를 0..1로 정규화해 부분 드로잉을 늘려버리므로 여기선 쓰지 않음)
  function simplifyPoints(points, maxPoints) {
    if (!points || points.length <= maxPoints) {
      return (points || []).map((p) => ({ x: round3(p.x), y: round3(p.y) }))
    }
    const out = []
    const step = points.length / maxPoints
    for (let i = 0; i < maxPoints; i++) {
      const p = points[Math.floor(i * step)]
      out.push({ x: round3(p.x), y: round3(p.y) })
    }
    const last = points[points.length - 1]
    out.push({ x: round3(last.x), y: round3(last.y) })
    return out
  }

  function simplifyPath(path) {
    if (!path || path.length < 2) return path ? path.slice() : []
    return simplifyPoints(path, 120)
  }

  function simplifyStrokes(strokes) {
    return (strokes || []).map((s) => simplifyPoints(s, 70)).filter((s) => s.length > 0)
  }

  function buildRecipe() {
    return {
      duration: state.duration,
      atmosphere: state.atmosphere.id,
      instrument: state.instrument.id,
      style: state.style.id,
      version: state.version.id,
      mode: state.mode,
      path: simplifyPath(draw.getPath()), // 선율/썸네일용(시간순 평탄 경로)
      strokes: simplifyStrokes(draw.getStrokes()), // 그린 그대로의 다중 획(시각 복원용)
    }
  }

  function notesFor(recipe) {
    if (recipe.mode === "rhythm") return []
    if (!recipe.path || recipe.path.length < 2) return []
    const style = D.styles.find((s) => s.id === recipe.style) || D.styles[0]
    return Core.autocompleteMelody(recipe.path, { durationSec: recipe.duration, style: style })
  }

  function warmSelectedInstrument() {
    const inst = state.instrument
    const asset = D.melodies[inst.id]
    engine
      .warmInstrument(buildRecipe())
      .then(function (buffer) {
        if (!asset || !asset.src) return // 원래 합성 전용 악기(예: 신디)
        if (buffer) {
          el.audioModeNote.textContent = "실제 음원을 우선 사용하고, 없으면 합성음으로 대체합니다."
        } else {
          el.audioModeNote.textContent =
            "⚠ 실제 악기 음원을 불러오지 못해 합성음으로 들려요. 파일을 더블클릭(file://)하지 말고 서버(VS Code Live Server 또는 npm run serve)로 열면 실제 악기 소리가 납니다."
        }
      })
      .catch(function (e) {
        console.warn("악기 샘플 준비 실패", e)
      })
  }

  function instrumentParticle(label) {
    const code = label.charCodeAt(label.length - 1)
    if (code < 0xac00 || code > 0xd7a3) return label + "로"
    return label + ((code - 0xac00) % 28 === 0 ? "로" : "으로")
  }

  // --- 카드 렌더 ---

  function card(item, active, sub) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "card" + (active ? " active" : "")
    if (item.image) {
      b.classList.add("with-image")
      const art = document.createElement("span")
      art.className = "card-art"
      const img = document.createElement("img")
      img.src = item.image
      img.alt = ""
      img.loading = "lazy"
      art.appendChild(img)
      b.appendChild(art)
    }
    const copy = document.createElement("span")
    copy.className = "card-copy"
    const title = document.createElement("strong")
    title.textContent = item.label
    const detail = document.createElement("span")
    detail.textContent = sub
    copy.appendChild(title)
    copy.appendChild(detail)
    b.appendChild(copy)
    return b
  }

  function bgSrcFor(atmosphere) {
    const bg = D.backgrounds[atmosphere.backgroundId]
    return bg ? bg.src : null
  }

  function stopBackgroundPreview() {
    state.bgPreviewId = null
    try {
      bgPreview.pause()
      bgPreview.currentTime = 0
    } catch (e) {}
  }

  function startBackgroundPreview(atmosphere) {
    const src = bgSrcFor(atmosphere)
    if (!src) {
      stopBackgroundPreview()
      return
    }
    engine.stop() // 전체 재생과 미리듣기가 겹치지 않도록
    try {
      if (bgPreview.src !== src) bgPreview.src = src
      bgPreview.currentTime = 0
      const p = bgPreview.play()
      if (p && p.catch) p.catch((e) => console.warn("배경 미리듣기 실패", e))
      state.bgPreviewId = atmosphere.id
    } catch (e) {
      console.warn("배경 미리듣기 실패", e)
      state.bgPreviewId = null
    }
  }

  function toggleBackgroundPreview(atmosphere) {
    if (state.bgPreviewId === atmosphere.id) stopBackgroundPreview()
    else startBackgroundPreview(atmosphere)
  }

  function renderAtmospheres() {
    el.atmosphereGrid.innerHTML = ""
    D.atmospheres.forEach((a) => {
      const b = card(a, a.id === state.atmosphere.id, a.detail)
      b.style.setProperty("--swatch", a.color)
      b.classList.add("with-swatch", "mood-card")
      if (state.bgPreviewId === a.id) b.classList.add("playing")
      const play = document.createElement("span")
      play.className = "mood-play"
      play.setAttribute("aria-hidden", "true")
      play.textContent = state.bgPreviewId === a.id ? "❚❚" : "▶"
      b.appendChild(play)
      b.title = a.label + " 배경 미리듣기"
      b.addEventListener("click", () => {
        state.atmosphere = a
        applyMoodTint()
        toggleBackgroundPreview(a)
        renderAtmospheres()
        updateReadouts()
        engine.warmAmbience(buildRecipe()).catch(function () {}) // 고른 분위기 배경음 미리 로드
      })
      el.atmosphereGrid.appendChild(b)
    })
    el.atmosphereGrid.appendChild(buildUploadCard())
  }

  function buildUploadCard() {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "card upload-card"
    b.innerHTML =
      '<span class="upload-plus" aria-hidden="true">＋</span>' +
      "<strong>내 배경 음원 추가</strong>" +
      '<span class="upload-sub">mp3 · wav 파일을 올려서 분위기로 쓸 수 있어요</span>'
    b.addEventListener("click", () => el.bgUploadInput.click())
    return b
  }

  function addCustomBackground(file) {
    if (!file) return
    if (!file.type || file.type.indexOf("audio/") !== 0) {
      el.bgUploadStatus.textContent = "오디오 파일(mp3, wav 등)만 올릴 수 있어요."
      el.bgUploadStatus.classList.add("error")
      return
    }
    const url = URL.createObjectURL(file)
    const id = "custom-" + ++customBgSeq
    const label = (file.name || "내 배경").replace(/\.[^.]+$/, "") || "내 배경"
    D.backgrounds[id] = { label: label, src: url, duration: 0, custom: true, file: file }
    const atmosphere = {
      id: id,
      label: label,
      padType: "ambient",
      detail: "내가 올린 배경 음원",
      color: "#6b8f9c",
      backgroundId: id,
      effectIds: [],
      custom: true,
    }
    D.atmospheres.push(atmosphere)
    state.atmosphere = atmosphere
    applyMoodTint()
    startBackgroundPreview(atmosphere)
    renderAtmospheres()
    engine.warmAmbience(buildRecipe()).catch(function () {}) // 업로드한 배경음 미리 로드
    updateReadouts()
    el.bgUploadStatus.classList.remove("error")
    el.bgUploadStatus.textContent = "‘" + label + "’ 배경을 추가했어요. 카드를 눌러 들어보세요."
  }

  function renderInstrumentGroups() {
    const groups = ["서양", "국악", "전자"]
    el.instrumentGroups.innerHTML = ""
    groups.forEach((g) => {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "group-tab" + (g === state.group ? " active" : "")
      b.textContent = g
      b.addEventListener("click", () => {
        state.group = g
        renderInstrumentGroups()
        renderInstruments()
      })
      el.instrumentGroups.appendChild(b)
    })
  }

  function selectInstrument(instrument, announce) {
    state.instrument = instrument
    state.group = instrument.group
    engine.stop()
    renderInstrumentGroups()
    renderInstruments()
    renderComposeInstruments()
    draw.compute()
    draw.render()
    updateReadouts()
    warmSelectedInstrument()
    if (announce) {
      el.exportStatus.textContent = instrumentParticle(instrument.label) + " 바꿨습니다. 선율은 그대로 유지됩니다."
    }
  }

  function renderInstruments() {
    el.instrumentGrid.innerHTML = ""
    D.instruments
      .filter((i) => i.group === state.group)
      .forEach((i) => {
        const b = card(i, i.id === state.instrument.id, i.detail)
        b.addEventListener("click", () => {
          selectInstrument(i, false)
        })
        el.instrumentGrid.appendChild(b)
      })
  }

  function renderStyles() {
    el.styleGrid.innerHTML = ""
    D.styles.forEach((s) => {
      const b = card(s, s.id === state.style.id, s.scaleName + " · " + s.detail)
      b.addEventListener("click", () => {
        state.style = s
        renderStyles()
        draw.compute()
        draw.render()
        updateReadouts()
      })
      el.styleGrid.appendChild(b)
    })
  }

  function renderVersions() {
    el.versionList.innerHTML = ""
    D.versions.forEach((v) => {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "version" + (v.id === state.version.id ? " active" : "")
      b.setAttribute("aria-pressed", v.id === state.version.id ? "true" : "false")
      b.innerHTML = "<strong>" + v.label + "</strong>"
      b.title = v.detail
      b.addEventListener("click", () => {
        state.version = v
        engine.stop()
        renderVersions()
        startDrawingAmbience() // 믹스(볼륨)가 바뀌면 깔려 있는 배경음도 갱신
        el.exportStatus.textContent = v.label + " 믹스로 바꿨습니다."
      })
      el.versionList.appendChild(b)
    })
  }

  function renderComposeInstruments() {
    el.composeInstrumentList.innerHTML = ""
    ;["서양", "국악", "전자"].forEach((group) => {
      const groupItems = D.instruments
        .filter((instrument) => instrument.group === group)
        .map((instrument, index) => ({ instrument: instrument, index: index }))
        .sort((a, b) => {
          if (a.instrument.id === state.instrument.id) return -1
          if (b.instrument.id === state.instrument.id) return 1
          return a.index - b.index
        })
        .map((item) => item.instrument)

      const section = document.createElement("section")
      section.className = "compose-instrument-group" + (group === state.group ? " active" : "")
      section.setAttribute("aria-label", group + " 악기")
      section.dataset.group = group
      section.dataset.count = String(groupItems.length)
      if (groupItems.length <= 2) section.classList.add("compact")

      const head = document.createElement("div")
      head.className = "compose-instrument-group-head"
      head.innerHTML = "<strong>" + group + "</strong><small>" + groupItems.length + "개</small>"
      section.appendChild(head)

      const list = document.createElement("div")
      list.className = "compose-instrument-group-list"
      groupItems.forEach((i) => {
        const b = document.createElement("button")
        b.type = "button"
        b.className = "compose-instrument" + (i.id === state.instrument.id ? " active" : "")
        b.setAttribute("aria-pressed", i.id === state.instrument.id ? "true" : "false")
        b.title = i.group + " · " + i.detail
        if (i.image) {
          const img = document.createElement("img")
          img.src = i.image
          img.alt = ""
          img.loading = "lazy"
          b.appendChild(img)
        }
        const label = document.createElement("span")
        label.className = "compose-instrument-text"
        label.innerHTML = "<strong>" + i.label + "</strong><small>" + i.detail + "</small>"
        b.appendChild(label)
        b.addEventListener("click", () => selectInstrument(i, true))
        list.appendChild(b)
      })

      section.appendChild(list)
      el.composeInstrumentList.appendChild(section)
    })
  }

  // --- 팔레트 라벨 ---

  function renderPaletteLabels() {
    const count = paletteCount()
    el.paletteLabels.innerHTML = ""
    for (let i = 0; i < count; i++) {
      const d = document.createElement("div")
      d.className = "palette-label"
      d.style.left = (i / count) * 100 + "%"
      d.style.width = 100 / count + "%"
      const from = i * SEGMENT_SECONDS
      const to = Math.min((i + 1) * SEGMENT_SECONDS, state.duration)
      d.innerHTML = "<span>" + from + "-" + to + "초</span>"
      el.paletteLabels.appendChild(d)
    }
  }

  function refreshTimeline(resetScroll) {
    renderPaletteLabels()
    syncTimelineWidth(resetScroll)
    draw.compute()
    draw.render()
    updateReadouts()
  }

  // --- 읽기 표시 ---

  function updateReadouts() {
    el.scaleReadout.textContent = state.style.scaleName
    el.rhythmReadout.textContent = (state.mode === "rhythm" ? "리듬형" : "선율형") + " · 4/4"
    el.noteReadout.textContent = String(state.mode === "rhythm" ? draw.hits.length : draw.notes.length)
    el.durReadout.textContent = state.duration + "초"
    el.placardMeta.textContent = state.atmosphere.label + " · " + state.style.label + " · " + state.instrument.label
  }

  // --- 그림 업로드 / 표지 ---

  function setPicture(dataUrl, name) {
    state.pic = dataUrl
    el.dropPreview.src = dataUrl
    el.dropPreview.hidden = false
    el.dropEmpty.style.display = "none"
    el.picThumb.src = dataUrl
    el.picChip.hidden = false
    el.frameImg.src = dataUrl
    el.frameImg.style.display = "block"
    el.frameCanvas.style.display = "none"
    el.picStatus.textContent = (name || "그림") + " 적용됨"
    el.picStatus.classList.remove("error")
  }

  function drawFrameFallback() {
    if (state.pic) return
    el.frameImg.src = DEFAULT_COVER_SRC
    el.frameImg.style.display = "block"
    el.frameCanvas.style.display = "none"
  }

  function drawProceduralFrameFallback() {
    el.frameImg.style.display = "none"
    el.frameCanvas.style.display = "block"
    const ctx = el.frameCanvas.getContext("2d")
    const w = el.frameCanvas.width
    const h = el.frameCanvas.height
    ctx.fillStyle = "#1f2a2a"
    ctx.fillRect(0, 0, w, h)
    const accent = state.atmosphere.color
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = i % 3 === 0 ? "#fbf6ec" : accent
      ctx.globalAlpha = 0.18 + (i % 5) * 0.04
      ctx.lineWidth = 2 + (i % 6)
      ctx.beginPath()
      const y = 70 + i * 12
      ctx.moveTo(30, y)
      for (let x = 30; x < w - 30; x += 26) {
        ctx.lineTo(x, y + Math.sin((x + i * 33) / 48) * (24 + (i % 5) * 4))
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = "rgba(251,246,236,0.92)"
    ctx.font = "700 40px Georgia, serif"
    ctx.fillText("Sound", 44, 76)
    ctx.fillText("Drawing", 44, 120)
  }

  function drawCoverFit(ctx, img, size) {
    const r = Math.max(size / img.width, size / img.height)
    const dw = img.width * r
    const dh = img.height * r
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
  }

  // --- 재생 ---

  engine.onState = function (playing) {
    el.statusText.textContent = playing
      ? state.version.label + " 재생 중 · " + (engine.lastMode === "synth" ? "합성음" : "실제 음원")
      : "대기 중"
    el.statusText.classList.toggle("playing", playing)
    el.frame.classList.toggle("playing", playing)
    el.body.dataset.playback = playing ? "playing" : "idle"
    if (playing) startPlayhead()
    else stopPlayhead()
    // 완성곡 재생이 끝나면 드로잉 화면에선 배경음을 다시 깐다
    if (!playing) startDrawingAmbience()
  }

  // 드로잉(5단계) 화면에서만 분위기 배경음을 깐다. 완성곡 재생 중엔 engine 이 끈다.
  function startDrawingAmbience() {
    if (state.step !== 4) return
    engine.startAmbience(buildRecipe()).catch(function (e) {
      console.warn("드로잉 배경음 시작 실패", e)
    })
  }

  // --- 재생 헤드(재생바) ---

  let playheadRAF = null
  function nowMs() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now()
  }
  function stopPlayhead() {
    if (playheadRAF) cancelAnimationFrame(playheadRAF)
    playheadRAF = null
    if (el.playhead) el.playhead.hidden = true
  }
  function startPlayhead() {
    const wrap = canvasWrap()
    if (!wrap || !el.playhead || typeof requestAnimationFrame === "undefined") return
    const startT = nowMs()
    const durMs = Math.max(1, state.duration * 1000)
    el.playhead.hidden = false
    const tick = function () {
      const elapsed = nowMs() - startT
      const prog = Math.max(0, Math.min(1, elapsed / durMs))
      const cw = el.canvas.clientWidth || el.canvas.getBoundingClientRect().width
      const left = el.canvas.offsetLeft + prog * cw
      el.playhead.style.left = left + "px"
      // 재생 위치가 화면 밖이면 가로 스크롤로 따라가기
      const view = wrap.clientWidth
      if (left < wrap.scrollLeft + 48 || left > wrap.scrollLeft + view - 48) {
        wrap.scrollLeft = Math.max(0, left - view / 2)
      }
      if (prog < 1 && engine.isPlaying) playheadRAF = requestAnimationFrame(tick)
      else stopPlayhead()
    }
    if (playheadRAF) cancelAnimationFrame(playheadRAF)
    playheadRAF = requestAnimationFrame(tick)
  }

  function requireDrawn() {
    if (draw.getPath().length >= 2) return true
    el.statusText.textContent = "먼저 선을 그려주세요"
    el.exportStatus.textContent = "먼저 캔버스에 선을 그리거나 자동완성을 직접 눌러주세요."
    return false
  }

  function play() {
    if (!requireDrawn()) return
    stopBackgroundPreview()
    renderAtmospheres()
    const recipe = buildRecipe()
    engine.play(recipe, notesFor(recipe)).catch(function (e) {
      el.statusText.textContent = "재생 오류"
      console.error(e)
    })
  }

  function stop() {
    stopBackgroundPreview()
    renderAtmospheres()
    engine.stop()
  }

  function setEraser(on) {
    draw.setEraseMode(on)
    el.clearBtn.classList.toggle("active", on)
    el.clearBtn.setAttribute("aria-pressed", on ? "true" : "false")
  }

  function resetCompose() {
    engine.stop()
    setEraser(false)
    draw.clear()
    el.statusText.textContent = "대기 중"
    el.exportStatus.textContent = "초기화했습니다. 새 선을 그리면 선택한 악기로 바로 들립니다."
  }

  // --- 시도(테이크) ---

  function syncAdminModeUI() {
    el.body.dataset.adminMode = state.adminMode ? "on" : "off"
    el.adminModeBtn.classList.toggle("active", state.adminMode)
    el.adminModeBtn.setAttribute("aria-pressed", state.adminMode ? "true" : "false")
    el.adminModeBtn.textContent = state.adminMode ? "관리자 모드 켜짐" : "관리자 모드"
  }

  function setAdminMode(on) {
    state.adminMode = !!on
    saveAdminMode(state.adminMode)
    syncAdminModeUI()
    renderTakes()
  }

  function renderTakeName(meta, take, index) {
    const row = document.createElement("div")
    row.className = "take-name-line"
    const num = document.createElement("span")
    num.className = "take-number"
    num.textContent = index + "번"
    row.appendChild(num)

    if (state.adminMode) {
      const input = document.createElement("input")
      input.type = "text"
      input.className = "take-name-input"
      input.value = take.name || ""
      input.maxLength = TAKE_NAME_MAX
      input.placeholder = "이름 입력"
      input.setAttribute("aria-label", index + "번 이름")
      const saveB = document.createElement("button")
      saveB.type = "button"
      saveB.className = "btn tiny take-name-save"
      saveB.textContent = "저장"
      saveB.title = "이름 저장"
      const saveName = function () {
        takes.rename(take.id, input.value)
        renderTakes()
        el.exportStatus.textContent = index + "번 이름을 저장했어요."
      }
      saveB.addEventListener("click", saveName)
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") saveName()
      })
      row.appendChild(input)
      row.appendChild(saveB)
    } else {
      const name = document.createElement("strong")
      name.className = "take-name"
      name.textContent = take.name || "이름 없음"
      row.appendChild(name)
    }
    meta.appendChild(row)
  }

  function renderTakes() {
    const items = takes.list()
    el.takesList.innerHTML = ""
    el.takesEmpty.style.display = items.length ? "none" : "block"
    el.takesCount.textContent = items.length ? items.length + "개" : ""
    items.forEach((t, idx) => {
      const atmos = D.atmospheres.find((a) => a.id === t.recipe.atmosphere) || D.atmospheres[0]
      const wrap = document.createElement("div")
      wrap.className = "take"
      const cv = document.createElement("canvas")
      cv.width = 160
      cv.height = 100
      cv.className = "take-thumb"
      window.TakesStore.renderThumbnail(cv, t.recipe, atmos.color)
      const meta = document.createElement("div")
      meta.className = "take-meta"
      const styleObj = D.styles.find((s) => s.id === t.recipe.style) || D.styles[0]
      const instObj = D.instruments.find((i) => i.id === t.recipe.instrument) || D.instruments[0]
      renderTakeName(meta, t, idx + 1)
      const detail = document.createElement("span")
      detail.className = "take-detail"
      detail.textContent = atmos.label + " · " + styleObj.label + " · " + instObj.label + " · " + t.recipe.duration + "초"
      meta.appendChild(detail)
      const tools = document.createElement("div")
      tools.className = "take-tools"
      const playB = document.createElement("button")
      playB.type = "button"
      playB.className = "btn tiny primary"
      playB.textContent = "▶"
      playB.title = "이 시도 듣기"
      playB.addEventListener("click", function () {
        loadRecipe(t.recipe)
        play()
      })
      const delB = document.createElement("button")
      delB.type = "button"
      delB.className = "btn tiny"
      delB.textContent = "✕"
      delB.title = "삭제"
      delB.addEventListener("click", function () {
        takes.remove(t.id)
        renderTakes()
      })
      tools.appendChild(playB)
      tools.appendChild(delB)
      wrap.appendChild(cv)
      wrap.appendChild(meta)
      wrap.appendChild(tools)
      el.takesList.appendChild(wrap)
    })
  }

  function saveTake() {
    if (!requireDrawn()) return
    takes.add(buildRecipe(), state.title)
    renderTakes()
    el.exportStatus.textContent = "시도를 저장했어요. 아래에서 골라 비교해 들어보세요."
  }

  // --- 레시피 불러오기 ---

  function loadRecipe(recipe) {
    state.duration = 30 // 길이는 30초로 고정(옛 레시피도 정규화)
    state.atmosphere = D.atmospheres.find((a) => a.id === recipe.atmosphere) || D.atmospheres[0]
    state.instrument = D.instruments.find((i) => i.id === recipe.instrument) || D.instruments[0]
    state.style = D.styles.find((s) => s.id === recipe.style) || D.styles[0]
    state.version = D.versions.find((v) => v.id === recipe.version) || D.versions[0]
    state.mode = recipe.mode || "melody"
    state.group = state.instrument.group
    document.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === state.mode)
    })
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
    renderStyles()
    renderVersions()
    renderComposeInstruments()
    renderPaletteLabels()
    syncTimelineWidth(true)
    // 다중 획 우선 복원, 없으면(옛 레시피) 단일 path를 하나의 획으로
    if (recipe.strokes && recipe.strokes.length) draw.setStrokes(recipe.strokes)
    else draw.setPath(recipe.path || [])
    updateReadouts()
  }

  // --- 내보내기 ---

  async function exportWav() {
    if (!requireDrawn()) return
    el.exportStatus.textContent = "오디오를 만드는 중…"
    try {
      const recipe = buildRecipe()
      const size = await engine.exportWav(recipe, notesFor(recipe), safeName() + ".wav")
      el.exportStatus.textContent = "오디오 내보내기 완료 (" + Math.round(size / 1024) + " KB)"
    } catch (e) {
      console.error(e)
      el.exportStatus.textContent = "오디오 내보내기 실패 — 콘솔을 확인하세요."
    }
  }

  function safeName() {
    const t = (state.title || "무제").replace(/[^\w가-힣 _-]/g, "").trim() || "무제"
    return t + "_" + state.atmosphere.label
  }

  function exportCover() {
    const size = 1024
    const cv = document.createElement("canvas")
    cv.width = size
    cv.height = size
    const ctx = cv.getContext("2d")

    function finish() {
      // 명패
      const padH = 150
      ctx.fillStyle = "rgba(20,26,26,0.82)"
      ctx.fillRect(0, size - padH, size, padH)
      ctx.fillStyle = "#fbf6ec"
      ctx.font = "700 52px Georgia, serif"
      ctx.fillText(state.title || "무제", 48, size - padH + 64)
      ctx.font = "500 30px 'Segoe UI', sans-serif"
      ctx.fillStyle = "rgba(251,246,236,0.78)"
      ctx.fillText(
        state.atmosphere.label + " · " + state.style.label + " · " + state.instrument.label,
        48,
        size - padH + 110
      )
      // 재생 글리프
      ctx.fillStyle = "rgba(251,246,236,0.92)"
      ctx.beginPath()
      const cx = size / 2
      const cy = (size - padH) / 2
      ctx.arc(cx, cy, 72, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(20,26,26,0.55)"
      ctx.fill()
      ctx.fillStyle = "#fbf6ec"
      ctx.beginPath()
      ctx.moveTo(cx - 22, cy - 30)
      ctx.lineTo(cx - 22, cy + 30)
      ctx.lineTo(cx + 34, cy)
      ctx.closePath()
      ctx.fill()

      cv.toBlob(function (blob) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = safeName() + "_cover.png"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        el.exportStatus.textContent = "커버 이미지를 내보냈어요."
      }, "image/png")
    }

    if (state.pic) {
      const img = new Image()
      img.onload = function () {
        drawCoverFit(ctx, img, size)
        finish()
      }
      img.onerror = function () {
        drawProceduralFrameFallback()
        ctx.drawImage(el.frameCanvas, 0, 0, size, size)
        finish()
      }
      img.src = state.pic
    } else {
      const img = new Image()
      img.onload = function () {
        drawCoverFit(ctx, img, size)
        finish()
      }
      img.onerror = function () {
        drawProceduralFrameFallback()
        ctx.drawImage(el.frameCanvas, 0, 0, size, size)
        finish()
      }
      img.src = DEFAULT_COVER_SRC
    }
  }

  function shareLink() {
    const code = Core.encodeRecipe(buildRecipe())
    const url = location.origin + location.pathname + "#r=" + code
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          el.exportStatus.textContent = "공유 링크를 복사했어요. 같은 사이트에서 열면 그대로 복원됩니다."
        },
        function () {
          prompt("공유 링크", url)
        }
      )
    } else {
      prompt("공유 링크", url)
    }
  }

  function restoreFromHash() {
    const h = location.hash || ""
    if (h.indexOf("#r=") === 0) {
      try {
        const recipe = Core.decodeRecipe(h.slice(3))
        loadRecipe(recipe)
        el.exportStatus.textContent = "공유 링크에서 불러왔습니다."
      } catch (e) {
        console.warn("공유 링크 복원 실패", e)
      }
    }
  }

  // --- 단계 이동 ---

  function setStep(i) {
    const screens = document.querySelectorAll("[data-screen]")
    const tabs = document.querySelectorAll("[data-step-jump]")
    if (state.bgPreviewId) {
      stopBackgroundPreview()
      renderAtmospheres()
    }
    state.step = Math.max(0, Math.min(screens.length - 1, i))
    el.body.dataset.step = String(state.step)
    screens.forEach((s, idx) => {
      const on = idx === state.step
      s.classList.toggle("active", on)
      s.toggleAttribute("hidden", !on)
    })
    tabs.forEach((t, idx) => t.classList.toggle("active", idx === state.step))
    if (state.step === 4) {
      drawFrameFallback()
      refreshTimeline(true)
      renderComposeInstruments()
      renderTakes()
      warmSelectedInstrument()
      startDrawingAmbience()
    } else {
      engine.stopAmbience(false)
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // --- 이벤트 ---

  function bind() {
    document.querySelectorAll("[data-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode
        document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === b))
        el.modeHint.textContent =
          state.mode === "rhythm" ? "리듬형: 그린 봉우리가 4/4 타격이 됩니다." : "선율형: 그린 선이 음높이가 됩니다."
        draw.compute()
        draw.render()
        updateReadouts()
      })
    })

    el.picInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0]
      if (!f) return
      if (!f.type || f.type.indexOf("image/") !== 0) {
        el.picStatus.textContent = "이미지 파일만 올릴 수 있어요."
        el.picStatus.classList.add("error")
        el.picInput.value = ""
        return
      }
      const reader = new FileReader()
      reader.onload = () => setPicture(String(reader.result), f.name)
      reader.readAsDataURL(f)
    })

    el.bgUploadInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0]
      addCustomBackground(f)
      el.bgUploadInput.value = ""
    })

    bgPreview.addEventListener("ended", () => {
      state.bgPreviewId = null
      renderAtmospheres()
    })

    document.querySelectorAll("[data-step-jump]").forEach((b) => {
      b.addEventListener("click", () => setStep(Number(b.dataset.stepJump)))
    })
    document.querySelectorAll("[data-step-next]").forEach((b) => {
      b.addEventListener("click", () => setStep(state.step + 1))
    })
    document.querySelectorAll("[data-step-prev]").forEach((b) => {
      b.addEventListener("click", () => setStep(state.step - 1))
    })

    el.clearBtn.addEventListener("click", () => {
      const on = !draw.eraseMode
      setEraser(on)
      if (on) engine.stop()
      el.exportStatus.textContent = on
        ? "지우개 모드 — 캔버스를 드래그하면 선의 일부를 지웁니다. 다시 누르면 그리기로 돌아갑니다."
        : "그리기 모드로 돌아왔어요."
    })
    el.resetComposeBtn.addEventListener("click", resetCompose)

    el.playBtn.addEventListener("click", play)
    el.framePlay.addEventListener("click", play)
    el.composePlay.addEventListener("click", play)
    el.stopBtn.addEventListener("click", stop)

    el.saveTakeBtn.addEventListener("click", saveTake)
    el.adminModeBtn.addEventListener("click", function () {
      setAdminMode(!state.adminMode)
    })
    el.exportWavBtn.addEventListener("click", exportWav)
    el.exportCoverBtn.addEventListener("click", exportCover)
    el.shareBtn.addEventListener("click", shareLink)

    el.titleInput.addEventListener("input", () => {
      state.title = el.titleInput.value || "무제"
    })
    window.addEventListener("resize", () => {
      if (state.step !== 4) return
      refreshTimeline(false)
    })
  }

  // --- 초기화 ---

  function init() {
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
    renderStyles()
    renderVersions()
    renderComposeInstruments()
    refreshTimeline(true)
    bind()
    syncAdminModeUI()
    updateReadouts()
    restoreFromHash()
    setStep(0)
    warmSelectedInstrument() // 기본 악기 미리 준비 + 음원 로드 상태(실제/합성)를 하단에 표시
    engine.warmAmbience(buildRecipe()).catch(function () {}) // 기본 분위기 배경음 미리 로드(드로잉 진입 시 즉시)
  }

  // 테스트/QA용 API
  window.SoundDrawing = {
    getStateSummary: function () {
      return {
        duration: state.duration,
        atmosphere: state.atmosphere.id,
        instrument: state.instrument.id,
        style: state.style.scaleName,
        version: state.version.id,
        mode: state.mode,
        step: state.step,
        noteCount: state.mode === "rhythm" ? draw.hits.length : draw.notes.length,
        hasPicture: !!state.pic,
        takes: takes.list().length,
        adminMode: state.adminMode,
        isPlaying: engine.isPlaying,
        lastMode: engine.lastMode,
      }
    },
    play: play,
    stop: stop,
    exportWav: exportWav,
    loadRecipe: loadRecipe,
    buildRecipe: buildRecipe,
    setStep: setStep,
    setAdminMode: setAdminMode,
    engine: engine,
    draw: draw,
    takes: takes,
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
