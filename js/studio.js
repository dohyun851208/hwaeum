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
  const DEFAULT_DURATION_SECONDS = 30
  const MIN_DURATION_SECONDS = 1
  const DEFAULT_COVER_SRC = "./assets/default-cover.png"
  const ADMIN_STORAGE_KEY = "sda.adminMode"
  const TAKE_NAME_MAX = 24
  const DRAWING_STEP = 2
  const COMPLETE_STEP = 3
  const DEFAULT_STYLE_ID = "bright" // 기본 음계 = C장조(서양 악기는 파(F)도 난다)
  const GUGAK_STYLE_ID = "gugak" // 국악기만 5음(펜타토닉)+시김새 — 파(F)·시(B) 없음
  const CUSTOM_BG_MAX_BYTES = 50 * 1024 * 1024
  const PIXABAY_MUSIC_URL = "https://pixabay.com/music/"
  const CUSTOM_BG_COPYRIGHT_NOTICE =
    "저작권 안내: 다른 사람이 만든 음악은 허락 없이 사용할 수 없어요. 직접 만든 음원이나 사용 허락을 받은 음원만 올려 주세요."

  function defaultStyle() {
    return D.styles.find((s) => s.id === DEFAULT_STYLE_ID) || D.styles[0]
  }

  // 악기 그룹별 기본 음계: 기본은 C장조, 국악기만 5음(펜타토닉)+시김새.
  function styleForInstrument(instrument) {
    const id = instrument && instrument.group === "국악" ? GUGAK_STYLE_ID : DEFAULT_STYLE_ID
    return D.styles.find((s) => s.id === id) || defaultStyle()
  }

  function defaultVersion() {
    return D.versions[0]
  }

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
    duration: DEFAULT_DURATION_SECONDS,
    atmosphere: D.atmospheres[0],
    instrument: D.instruments[0],
    style: styleForInstrument(D.instruments[0]),
    version: defaultVersion(),
    mode: "melody",
    pic: null,
    title: "무제",
    step: 0,
    group: "서양",
    effectIds: [], // 옛 레시피 호환용: 자동 배치 효과
    effectStamps: [], // 새 방식: 캔버스에 찍은 효과음 도장 [{ id, x, y }]
    effectStampId: null,
    bgPreviewId: null, // 현재 미리듣기 중인 배경 id
    examplePreviewId: null, // 현재 감상 재생 중인 악기 id
    bgOffset: 0, // 배경음악을 이 지점(초)부터 — 캔버스 가로축이 [bgOffset, bgOffset+길이]에 대응, 최종 곡에도 반영
    bgEndOffset: 0,
    backgroundReason: "",
    melodyIntent: "",
    hashtags: "",
    adminMode: loadAdminMode(),
  }

  // 배경 미리듣기 — Web Audio 합주 엔진과 독립된 단순 재생기
  const bgPreview = new Audio()
  bgPreview.preload = "none"
  let customBgSeq = 0

  // 드로잉(3단계) 배경음악 — 전용 <audio>로 재생/일시정지.
  // [bgOffset, bgEndOffset] 구간을 반복하고, 그 구간 길이가 최종 곡 길이가 된다.
  const bgPlayer = new Audio()
  bgPlayer.preload = "auto"
  bgPlayer.volume = 0.55
  let bgRAF = null

  // 악기 연주곡 감상 — 배경 미리듣기와 동일한 독립 재생기(한 번에 하나만)
  const examplePreview = new Audio()
  examplePreview.preload = "none"
  examplePreview.addEventListener("ended", () => {
    state.examplePreviewId = null
    renderInstruments()
    syncExamplePreviewStop()
  })

  const AUDIO_MODE_READY = "실제 음원을 우선 사용하고, 없으면 합성음으로 대체합니다. 국악 음원 출처: 국립국악원."

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
    instrumentPreviewStopBtn: $("instrumentPreviewStopBtn"),
    canvas: $("drawingCanvas"),
    effectStampLayer: $("effectStampLayer"),
    pitchLabels: $("pitchLabels"),
    paletteLabels: $("paletteLabels"),
    playhead: $("playhead"),
    bgPlayer: $("bgPlayer"),
    bgPlayBtn: $("bgPlayBtn"),
    bgSeek: $("bgSeek"),
    bgEndSeek: $("bgEndSeek"),
    bgStartInput: $("bgStartInput"),
    bgEndInput: $("bgEndInput"),
    bgTime: $("bgTime"),
    penBtn: $("penBtn"),
    clearBtn: $("clearBtn"),
    undoBtn: $("undoBtn"),
    resetComposeBtn: $("resetComposeBtn"),
    scaleReadout: $("scaleReadout"),
    rhythmReadout: $("rhythmReadout"),
    noteReadout: $("noteReadout"),
    durReadout: $("durReadout"),
    versionList: $("versionList"),
    composeInstrumentList: $("composeInstrumentList"),
    orchestraLegend: $("orchestraLegend"),
    effectList: $("effectList"),
    frame: $("frame"),
    frameImg: $("frameImg"),
    frameCanvas: $("frameCanvas"),
    titleInput: $("titleInput"),
    placardMeta: $("placardMeta"),
    bgReasonInput: $("bgReasonInput"),
    melodyIntentInput: $("melodyIntentInput"),
    hashtagsInput: $("hashtagsInput"),
    saveTakeBtn: $("saveTakeBtn"),
    adminModeBtn: $("adminModeBtn"),
    exportAudioBtn: $("exportAudioBtn"),
    completeStopBtn: $("completeStopBtn"),
    exportDrawingImageBtn: $("exportDrawingImageBtn"),
    exportDrawingVideoBtn: $("exportDrawingVideoBtn"),
    exportCoverBtn: $("exportCoverBtn"),
    shareBtn: $("shareBtn"),
    exportStatus: $("exportStatus"),
    takesList: $("takesList"),
    takesCount: $("takesCount"),
    takesEmpty: $("takesEmpty"),
    audioModeNote: $("audioModeNote"),
  }

  // 악기별 줄 색 — 오케스트라에서 어떤 줄이 어떤 악기인지 색으로 구분
  const INSTRUMENT_COLORS = {
    violin: "#c0504d", viola: "#d18a4e", cello: "#9b5a3c", doubleBass: "#5b4a3a",
    clarinet: "#4f6fae", oboe: "#5f8d4e", flute: "#4f9bb8", frenchHorn: "#c08a3c",
    daegeum: "#2f8f86", danso: "#6aa39a", sogeum: "#3f93ad", piri: "#b5614b",
    gayageum: "#9a6a3a", ajaeng: "#7a4a5a", haegeum: "#9c5b76",
  }
  function colorForInstrument(id) {
    return INSTRUMENT_COLORS[id] || (state.atmosphere && state.atmosphere.color) || "#5f8f63"
  }

  function applyInstrumentTone(node, id) {
    const color = colorForInstrument(id)
    node.style.setProperty("--instrument-color", color)
    node.style.setProperty("--instrument-soft", hexToRgba(color, 0.16))
    node.style.setProperty("--instrument-strong", hexToRgba(color, 0.36))
  }

  const draw = new window.DrawingCanvas(el.canvas, {
    activeInstrument: state.instrument.id,
    instrumentColor: colorForInstrument,
    maxInstruments: 4,
    onInstrumentLimit: (max) => {
      el.exportStatus.textContent = "악기는 한 곡에 최대 " + max + "개까지예요. 줄을 지우면 다른 악기를 더할 수 있어요."
    },
    getState: () => ({ duration: state.duration, style: state.style, mode: state.mode, melodyAsset: D.melodies[state.instrument.id] || null }),
    onChange: () => {
      updateReadouts()
      renderOrchestraLegend()
      syncUndoButton()
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
        el.statusText.textContent = "전체곡 대기"
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

  function normalizeDuration(value) {
    const n = Number(value)
    return round3(Math.max(MIN_DURATION_SECONDS, isFinite(n) ? n : DEFAULT_DURATION_SECONDS))
  }

  function secondsLabel(value) {
    const n = round3(Math.max(0, Number(value) || 0))
    const whole = Math.round(n)
    if (Math.abs(n - whole) < 0.001) return whole + "초"
    return n.toFixed(1).replace(/\.0$/, "") + "초"
  }

  function clampNumber(value, min, max) {
    const n = parseFloat(value)
    if (!isFinite(n)) return min
    return Math.max(min, Math.min(max, n))
  }

  function cleanText(value, max) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  }

  function normalizeHashtags(value) {
    const raw = Array.isArray(value) ? value.join(" ") : String(value || "")
    const seen = {}
    return raw
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#+/, "").replace(/[^\w가-힣-]/g, "").trim())
      .filter(Boolean)
      .filter((tag) => {
        const key = tag.toLowerCase()
        if (seen[key]) return false
        seen[key] = true
        return true
      })
      .slice(0, 3)
  }

  function hashtagText(value) {
    return normalizeHashtags(value)
      .map((tag) => "#" + tag)
      .join(" ")
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
    syncCanvasScrollState()
  }

  function syncCanvasScrollState() {
    const wrap = canvasWrap()
    if (!wrap) return
    wrap.style.setProperty("--canvas-scroll-left", Math.max(0, wrap.scrollLeft || 0) + "px")
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

  function simplifyEffectStamps(stamps) {
    return (stamps || [])
      .filter((stamp) => stamp && D.effects[stamp.id])
      .map((stamp) => ({
        id: stamp.id,
        x: round3(Math.max(0, Math.min(1, stamp.x || 0))),
        y: round3(Math.max(0, Math.min(1, stamp.y == null ? 0.5 : stamp.y))),
      }))
  }

  function stampedEffectIds() {
    const ids = state.effectIds.slice()
    state.effectStamps.forEach((stamp) => {
      if (D.effects[stamp.id] && ids.indexOf(stamp.id) === -1) ids.push(stamp.id)
    })
    return ids
  }

  function effectCount() {
    return state.effectIds.length + state.effectStamps.length
  }

  // 획과 그 악기를 같은 필터링으로 묶어 1:1 정렬 보장(빈 획 제거 시에도 어긋나지 않게)
  function buildStrokesAndInstruments() {
    const rawStrokes = draw.getStrokes()
    const rawInsts = draw.getStrokeInstruments()
    const strokes = []
    const instruments = []
    rawStrokes.forEach((s, i) => {
      const simplified = simplifyPoints(s, 70)
      if (simplified.length > 0) {
        strokes.push(simplified)
        instruments.push(rawInsts[i] != null ? rawInsts[i] : state.instrument.id)
      }
    })
    return { strokes: strokes, instruments: instruments }
  }

  function recipeBgOffset() {
    return canSelectBgRange() ? state.bgOffset : 0
  }

  function recipeBgEndOffset() {
    return canSelectBgRange() ? state.bgEndOffset : 0
  }

  function buildRecipe() {
    const built = buildStrokesAndInstruments()
    return {
      duration: state.duration,
      bgOffset: recipeBgOffset(),
      bgEndOffset: recipeBgEndOffset(),
      backgroundReason: cleanText(state.backgroundReason, 180),
      melodyIntent: cleanText(state.melodyIntent, 180),
      hashtags: normalizeHashtags(state.hashtags),
      atmosphere: state.atmosphere.id,
      instrument: state.instrument.id,
      style: state.style.id,
      version: state.version.id,
      mode: "melody",
      effectIds: stampedEffectIds(),
      effectStamps: simplifyEffectStamps(state.effectStamps),
      path: simplifyPath(draw.getPath()), // 썸네일/재생용 시간순 평탄 경로
      strokes: built.strokes, // 그린 그대로의 다중 획(시각 복원용)
      strokeInstruments: built.instruments, // 획별 악기(오케스트라) — voice 인덱스와 1:1
    }
  }

  function notesFor(recipe) {
    if (recipe.mode === "rhythm") return []
    const fallbackAsset = D.melodies[state.instrument.id] || null
    if (recipe.strokes && recipe.strokes.length) {
      const style = D.styles.find((s) => s.id === recipe.style) || defaultStyle()
      const melodyAssets = (recipe.strokeInstruments || []).map((id) => D.melodies[id] || fallbackAsset)
      return Core.autocompleteMelodyStrokes(recipe.strokes, {
        durationSec: recipe.duration,
        style: style,
        melodyAsset: fallbackAsset,
        melodyAssets: melodyAssets,
      })
    }
    if (!recipe.path || recipe.path.length < 1) return []
    const style = D.styles.find((s) => s.id === recipe.style) || defaultStyle()
    return Core.autocompleteMelody(recipe.path, { durationSec: recipe.duration, style: style, melodyAsset: fallbackAsset })
  }

  function warmSelectedInstrument() {
    const inst = state.instrument
    const asset = D.melodies[inst.id]
    engine
      .warmInstrument(buildRecipe())
      .then(function (buffer) {
        if (!asset || !asset.src) return
        if (buffer) {
          el.audioModeNote.textContent = AUDIO_MODE_READY
        } else {
          el.audioModeNote.textContent =
            "⚠ 실제 악기 음원을 불러오지 못해 합성음으로 들려요. 파일을 더블클릭(file://)하지 말고 서버(VS Code Live Server 또는 npm run serve)로 열면 실제 악기 소리가 납니다. 국악 음원 출처: 국립국악원."
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
    const bg = backgroundFor(atmosphere)
    return bg ? bg.src : null
  }

  function backgroundFor(atmosphere) {
    return atmosphere && atmosphere.backgroundId ? D.backgrounds[atmosphere.backgroundId] : null
  }

  function canSelectBgRange() {
    const bg = backgroundFor(state.atmosphere)
    return !!(bg && bg.src)
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
    stopExamplePreview() // 악기 감상과 겹치지 않도록
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

  // 악기 연주곡 감상 미리듣기 (국악기 카드의 ▶ 버튼)
  function syncExamplePreviewStop() {
    if (!el.instrumentPreviewStopBtn) return
    el.instrumentPreviewStopBtn.hidden = !state.examplePreviewId
  }

  function stopExamplePreview(announce) {
    const wasPlaying = !!state.examplePreviewId
    state.examplePreviewId = null
    try {
      examplePreview.pause()
      examplePreview.currentTime = 0
    } catch (e) {}
    syncExamplePreviewStop()
    if (announce && wasPlaying) el.exportStatus.textContent = "악기 소리를 멈췄습니다."
  }

  function toggleExamplePreview(instrument) {
    if (state.examplePreviewId === instrument.id) {
      stopExamplePreview(true)
      renderInstruments()
      return
    }
    const src = instrument.example
    if (!src) return
    stopBackgroundPreview()
    renderAtmospheres()
    engine.stop() // 전체 재생/배경 미리듣기와 겹치지 않도록
    try {
      if (examplePreview.src !== src) examplePreview.src = src
      examplePreview.currentTime = 0
      const p = examplePreview.play()
      if (p && p.catch) p.catch((e) => console.warn("연주곡 감상 실패", e))
      state.examplePreviewId = instrument.id
      el.exportStatus.textContent = instrument.label + " 소리를 듣는 중입니다. 정지하려면 ■ 또는 ‘악기 소리 정지’를 누르세요."
    } catch (e) {
      console.warn("연주곡 감상 실패", e)
      state.examplePreviewId = null
    }
    renderInstruments()
  }

  // 카드 그룹 표시 순서. manifest 의 atmosphere.group 과 맞춘다. 새 group 은 이 뒤에 자동으로 붙는다.
  const STUDENT_MUSIC_GROUP = "학생들이 찾은 음악"
  const ATMOSPHERE_GROUP_ORDER = ["분위기", "소리풍경", "리듬장단", STUDENT_MUSIC_GROUP]

  function balanceParentheticalMoodTitle(button, label) {
    const match = /^(.+?)(\(.+\))$/.exec(label || "")
    if (!match) return
    const title = button.querySelector(".card-copy strong")
    if (!title) return
    title.textContent = ""
    const main = document.createElement("span")
    main.textContent = match[1]
    const suffix = document.createElement("span")
    suffix.textContent = match[2]
    title.appendChild(main)
    title.appendChild(suffix)
  }

  function appendAtmosphereCard(a) {
    const b = card(a, a.id === state.atmosphere.id, a.detail)
    balanceParentheticalMoodTitle(b, a.label)
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
      state.bgOffset = 0 // 새 배경은 처음(0초)부터
      state.bgEndOffset = 0
      state.duration = DEFAULT_DURATION_SECONDS
      applyMoodTint()
      syncBgPlayerUI()
      toggleBackgroundPreview(a)
      renderAtmospheres()
      updateReadouts()
      engine.warmAmbience(buildRecipe()).catch(function () {}) // 고른 배경음 미리 로드
    })
    el.atmosphereGrid.appendChild(b)
  }

  function renderAtmospheres() {
    el.atmosphereGrid.innerHTML = ""
    // group 별로 묶고(미지정·업로드분은 "분위기"), 정해진 순서대로 소제목과 함께 그린다.
    const groups = {}
    D.atmospheres.forEach((a) => {
      const g = a.group || "분위기"
      ;(groups[g] || (groups[g] = [])).push(a)
    })
    const order = ATMOSPHERE_GROUP_ORDER.slice()
    Object.keys(groups).forEach((g) => {
      if (order.indexOf(g) === -1) order.push(g)
    })
    // 학생들이 찾은 음악 섹션은 비어 있어도 항상 보여 준다(여기에 올리도록 안내).
    const visibleGroups = order.filter((g) => g === STUDENT_MUSIC_GROUP || (groups[g] && groups[g].length))
    visibleGroups.forEach((g) => {
      if (visibleGroups.length > 1) {
        const label = document.createElement("p")
        label.className = "atmosphere-group-label"
        label.textContent = g
        el.atmosphereGrid.appendChild(label)
      }
      // "학생들이 찾은 음악"은 업로드 카드를 먼저 두고, 올린 음악이 그 오른쪽(뒤)으로 쌓이게 한다.
      if (g === STUDENT_MUSIC_GROUP) el.atmosphereGrid.appendChild(buildUploadCard())
      ;(groups[g] || []).forEach(appendAtmosphereCard)
    })
  }

  function buildUploadCard() {
    const card = document.createElement("div")
    card.className = "card upload-card"
    card.innerHTML =
      '<span class="upload-plus" aria-hidden="true">＋</span>' +
      "<strong>여기에 음악 올리기</strong>" +
      '<span class="upload-sub"><span>Pixabay에서 음악 찾기</span><span>mp3 · wav 올리기</span><span>50MB 이하</span></span>' +
      '<span class="upload-actions">' +
      '<a class="upload-action upload-action-secondary" href="' +
      PIXABAY_MUSIC_URL +
      '" target="_blank" rel="noopener noreferrer">여기서 찾아보기</a>' +
      '<button class="upload-action upload-action-primary" type="button">내 배경 음원 추가</button>' +
      "</span>"
    const uploadButton = card.querySelector("button")
    uploadButton.addEventListener("click", () => {
      window.alert(CUSTOM_BG_COPYRIGHT_NOTICE)
      el.bgUploadInput.click()
    })
    return card
  }

  function addCustomBackground(file) {
    if (!file) return
    if (!file.type || file.type.indexOf("audio/") !== 0) {
      el.bgUploadStatus.textContent = "오디오 파일(mp3, wav 등)만 올릴 수 있어요."
      el.bgUploadStatus.classList.add("error")
      return
    }
    if (file.size > CUSTOM_BG_MAX_BYTES) {
      el.bgUploadStatus.textContent = "무료 저장 한도에 맞춰 50MB 이하 오디오 파일만 올릴 수 있어요."
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
      group: STUDENT_MUSIC_GROUP, // "학생들이 찾은 음악" 섹션에 그 자리로 쌓인다
      padType: "ambient",
      detail: "내가 올린 배경 음원",
      color: "#6b8f9c",
      backgroundId: id,
      effectIds: [],
      custom: true,
    }
    D.atmospheres.push(atmosphere)
    state.atmosphere = atmosphere
    state.bgOffset = 0
    state.bgEndOffset = 0
    state.duration = DEFAULT_DURATION_SECONDS
    applyMoodTint()
    syncBgPlayerUI()
    startBackgroundPreview(atmosphere)
    renderAtmospheres()
    engine.warmAmbience(buildRecipe()).catch(function () {}) // 업로드한 배경음 미리 로드
    updateReadouts()
    el.bgUploadStatus.classList.remove("error")
    el.bgUploadStatus.textContent = "‘" + label + "’ 배경을 추가했어요. 카드를 눌러 들어보세요."
  }

  function renderInstrumentGroups() {
    const groups = ["서양", "국악"].filter((group) => D.instruments.some((instrument) => instrument.group === group))
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
    state.style = styleForInstrument(instrument) // 서양=C장조, 국악=5음+시김새
    setEraser(false)
    if (state.effectStampId) {
      state.effectStampId = null
      renderEffects()
      renderEffectStamps()
    }
    draw.setActiveInstrument(instrument.id) // 이제부터 그리는 줄의 악기(기존 줄은 그대로)
    engine.stop()
    renderInstrumentGroups()
    renderInstruments()
    renderComposeInstruments()
    renderOrchestraLegend()
    draw.compute()
    draw.render()
    renderPitchAxisLabels() // 악기에 따라 음계·라벨(들리는 음)이 바뀌므로 음높이 축을 다시 그린다
    updateReadouts()
    warmSelectedInstrument()
    if (announce) {
      el.exportStatus.textContent = "이제부터 그리는 줄은 " + instrument.label + "로 연주됩니다. (이미 그린 줄은 그대로)"
    }
  }

  function renderInstruments() {
    el.instrumentGrid.innerHTML = ""
    D.instruments
      .filter((i) => i.group === state.group)
      .forEach((i) => {
        const b = card(i, i.id === state.instrument.id, i.detail)
        b.classList.add("instrument-card")
        applyInstrumentTone(b, i.id)
        b.addEventListener("click", () => {
          selectInstrument(i, false)
        })
        if (i.example) {
          const playing = state.examplePreviewId === i.id
          if (playing) b.classList.add("playing")
          const ex = document.createElement("span")
          ex.className = "example-play"
          ex.setAttribute("role", "button")
          ex.setAttribute("tabindex", "0")
          ex.title = playing ? "연주곡 정지" : (i.exampleLabel ? i.exampleLabel + " — " : "") + "연주곡 감상"
          ex.setAttribute(
            "aria-label",
            playing ? i.label + " 연주곡 정지" : i.label + " 연주곡 감상" + (i.exampleLabel ? " (" + i.exampleLabel + ")" : ""),
          )
          ex.textContent = playing ? "■" : "▶"
          const onPreview = (ev) => {
            ev.stopPropagation()
            toggleExamplePreview(i)
          }
          ex.addEventListener("click", onPreview)
          ex.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault()
              onPreview(ev)
            }
          })
          b.appendChild(ex)
        }
        el.instrumentGrid.appendChild(b)
      })
    syncExamplePreviewStop()
  }

  function renderVersions() {
    if (!el.versionList) return
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
        el.exportStatus.textContent = v.label + " 믹스로 바꿨습니다."
      })
      el.versionList.appendChild(b)
    })
  }

  function renderComposeInstruments() {
    el.composeInstrumentList.innerHTML = ""
    ;["서양", "국악"].forEach((group) => {
      const groupItems = D.instruments.filter((instrument) => instrument.group === group)
      if (!groupItems.length) return

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
        applyInstrumentTone(b, i.id)
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

  // 오케스트라 범례 — 지금 곡에 쓰인 악기(색·줄 수)와 다음에 그릴 악기를 보여 준다
  function renderOrchestraLegend() {
    if (!el.orchestraLegend) return
    const insts = typeof draw.getStrokeInstruments === "function" ? draw.getStrokeInstruments() : []
    const order = []
    const counts = {}
    insts.forEach((id) => {
      if (id == null) return
      if (counts[id] == null) {
        counts[id] = 0
        order.push(id)
      }
      counts[id]++
    })
    el.orchestraLegend.innerHTML = ""
    const tag = document.createElement("span")
    tag.className = "orchestra-legend-label"
    tag.textContent = "악기 줄"
    el.orchestraLegend.appendChild(tag)
    if (!order.length) {
      const hint = document.createElement("span")
      hint.className = "orchestra-empty"
      hint.textContent = "줄을 그리면 여기에 쌓여요 (최대 4개)"
      el.orchestraLegend.appendChild(hint)
    } else {
      order.forEach((id) => {
        const inst = D.instruments.find((i) => i.id === id)
        const chip = document.createElement("span")
        chip.className = "orchestra-chip"
        applyInstrumentTone(chip, id)
        const dot = document.createElement("span")
        dot.className = "orchestra-dot"
        dot.style.background = colorForInstrument(id)
        chip.appendChild(dot)
        const text = document.createElement("span")
        text.textContent = (inst ? inst.label : id) + (counts[id] > 1 ? " ×" + counts[id] : "")
        chip.appendChild(text)
        el.orchestraLegend.appendChild(chip)
      })
    }
    const current = document.createElement("span")
    current.className = "orchestra-current"
    applyInstrumentTone(current, state.instrument.id)
    const cdot = document.createElement("span")
    cdot.className = "orchestra-dot"
    cdot.style.background = colorForInstrument(state.instrument.id)
    current.appendChild(cdot)
    const ctext = document.createElement("span")
    ctext.innerHTML = "그릴 악기 <strong>" + state.instrument.label + "</strong>"
    current.appendChild(ctext)
    el.orchestraLegend.appendChild(current)
  }

  function renderEffects() {
    el.effectList.innerHTML = ""
    Object.keys(D.effects).forEach((id) => {
      const effect = D.effects[id]
      const active = state.effectStampId === id
      const b = document.createElement("button")
      b.type = "button"
      b.className = "effect-btn" + (active ? " active" : "")
      b.setAttribute("aria-pressed", active ? "true" : "false")
      b.title = active ? effect.label + " 도장 선택됨" : effect.label + " 도장 선택"
      if (effect.image) {
        const img = document.createElement("img")
        img.src = effect.image
        img.alt = ""
        img.loading = "lazy"
        b.appendChild(img)
      }
      const label = document.createElement("span")
      label.className = "effect-btn-label"
      label.textContent = effect.label
      b.appendChild(label)
      b.addEventListener("click", () => {
        state.effectStampId = state.effectStampId === id ? null : id
        if (state.effectStampId) setEraser(false)
        if (state.effectStampId && engine.warmEffect) {
          engine.warmEffect(Object.assign({ id: id }, effect)).catch(function (err) {
            console.warn("효과음 도장 준비 실패", err)
          })
        }
        renderEffects()
        renderEffectStamps()
        updateReadouts()
        el.exportStatus.textContent = state.effectStampId
          ? effect.label + " 도장을 캔버스에 찍을 수 있습니다."
          : "효과음 도장 선택을 해제했습니다."
      })
      el.effectList.appendChild(b)
    })
  }

  function renderEffectStamps() {
    if (!el.effectStampLayer) return
    el.effectStampLayer.innerHTML = ""
    el.canvas.classList.toggle("stamp-mode", !!state.effectStampId)
    state.effectStamps.forEach((stamp) => {
      const effect = D.effects[stamp.id]
      if (!effect) return
      const mark = document.createElement("span")
      mark.className = "effect-stamp"
      mark.style.left = Math.max(0, Math.min(1, stamp.x || 0)) * 100 + "%"
      mark.style.top = Math.max(0.04, Math.min(0.96, stamp.y == null ? 0.5 : stamp.y)) * 100 + "%"
      mark.title = effect.label
      if (effect.image) {
        const img = document.createElement("img")
        img.src = effect.image
        img.alt = ""
        mark.appendChild(img)
      } else {
        mark.textContent = effect.label
      }
      el.effectStampLayer.appendChild(mark)
    })
  }

  function canvasPointFromEvent(e) {
    const r = el.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      rect: r,
    }
  }

  function stampEffectAtPointer(e) {
    const effect = D.effects[state.effectStampId]
    if (!state.effectStampId || !effect) return false
    const point = canvasPointFromEvent(e)
    if (!point) return false
    state.effectStamps.push({ id: state.effectStampId, x: round3(point.x), y: round3(point.y) })
    renderEffectStamps()
    updateReadouts()
    if (engine.previewEffect) {
      engine.previewEffect(Object.assign({ id: state.effectStampId }, effect)).catch(function (err) {
        console.warn("효과음 도장 미리듣기 실패", err)
      })
    }
    el.exportStatus.textContent = effect.label + " 도장을 찍었습니다."
    return true
  }

  function eraseEffectStampAtPointer(e) {
    if (!draw.eraseMode || !state.effectStamps.length) return false
    const point = canvasPointFromEvent(e)
    if (!point) return false
    const radiusPx = 42
    const radius2 = radiusPx * radiusPx
    let bestIndex = -1
    let bestDist = Infinity
    state.effectStamps.forEach((stamp, index) => {
      const dx = (Math.max(0, Math.min(1, stamp.x || 0)) - point.x) * point.rect.width
      const dy = (Math.max(0, Math.min(1, stamp.y == null ? 0.5 : stamp.y)) - point.y) * point.rect.height
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = index
      }
    })
    if (bestIndex < 0 || bestDist > radius2) return false
    const removed = state.effectStamps.splice(bestIndex, 1)[0]
    renderEffectStamps()
    updateReadouts()
    const effect = D.effects[removed.id]
    el.exportStatus.textContent = (effect ? effect.label : "효과음") + " 도장을 지웠습니다."
    return true
  }

  function bindEffectStamping() {
    let stampEraseActive = false
    el.canvas.addEventListener(
      "pointerdown",
      function (e) {
        if (eraseEffectStampAtPointer(e)) {
          stampEraseActive = true
          try {
            el.canvas.setPointerCapture(e.pointerId)
          } catch (err) {}
          e.preventDefault()
          e.stopImmediatePropagation()
          return
        }
        if (!stampEffectAtPointer(e)) return
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      true,
    )
    el.canvas.addEventListener(
      "pointermove",
      function (e) {
        if (!draw.eraseMode || (!draw.isDrawing && !stampEraseActive)) return
        if (!eraseEffectStampAtPointer(e)) return
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      true,
    )
    const stopStampErase = function () {
      stampEraseActive = false
    }
    el.canvas.addEventListener("pointerup", stopStampErase, true)
    el.canvas.addEventListener("pointercancel", stopStampErase, true)
    el.canvas.addEventListener("pointerleave", stopStampErase, true)
  }

  // --- 팔레트 라벨 ---

  function renderPaletteLabels() {
    const count = paletteCount()
    el.paletteLabels.innerHTML = ""
    for (let i = 1; i <= count; i++) {
      const d = document.createElement("div")
      d.className = "palette-label" + (i === count ? " palette-label-end" : "")
      d.style.left = (i / count) * 100 + "%"
      const time = Math.min(i * SEGMENT_SECONDS, state.duration)
      d.innerHTML = "<span>" + secondsLabel(time) + "</span>"
      el.paletteLabels.appendChild(d)
    }
  }

  function renderPitchAxisLabels() {
    if (!el.pitchLabels || !window.DrawingCanvas || typeof window.DrawingCanvas.pitchLabelsForStyle !== "function") return
    const axisAsset = D.melodies[state.instrument.id] || null
    const rows =
      typeof window.DrawingCanvas.pitchRowsForStyle === "function"
        ? window.DrawingCanvas.pitchRowsForStyle(state.style, axisAsset)
        : window.DrawingCanvas.pitchLabelsForStyle(state.style, axisAsset)
    el.pitchLabels.innerHTML = ""
    if (typeof draw.pitchLabelGutterCssPx === "function") {
      el.pitchLabels.style.setProperty("--pitch-label-width", Math.round(draw.pitchLabelGutterCssPx()) + "px")
    }
    rows.forEach((row) => {
      if (row.rowTop == null || row.rowHeight == null) return
      const d = document.createElement("span")
      d.className = "pitch-label-row" + (row.selected ? " selected" : "") + (!row.label ? " silent" : "")
      d.style.top = row.rowTop + "%"
      d.style.height = row.rowHeight + "%"
      el.pitchLabels.appendChild(d)
    })
    rows.forEach((label) => {
      if (!label.label) return
      const d = document.createElement("span")
      d.className =
        "pitch-label" +
        (label.selected ? " selected" : "") +
        (label.top <= 0 ? " edge-high" : "") +
        (label.top >= 100 ? " edge-low" : "")
      d.style.top = label.top + "%"
      d.textContent = label.label
      el.pitchLabels.appendChild(d)
    })
  }

  function refreshTimeline(resetScroll) {
    renderPaletteLabels()
    syncTimelineWidth(resetScroll)
    draw.compute()
    draw.render()
    renderPitchAxisLabels()
    renderEffectStamps()
    if (!engine.isPlaying && bgPlayer.paused) showSelectedPlayhead(false)
    updateReadouts()
  }

  // --- 읽기 표시 ---

  function updateReadouts() {
    el.scaleReadout.textContent = state.instrument.label
    el.rhythmReadout.textContent = draw.getStrokes().length ? draw.getStrokes().length + "개 선" : "그린 선"
    el.noteReadout.textContent = String(draw.notes.length)
    el.durReadout.textContent = secondsLabel(state.duration)
    const tags = hashtagText(state.hashtags)
    el.placardMeta.textContent = tags
    el.placardMeta.classList.toggle("is-empty", !tags)
  }

  function syncReflectionInputs() {
    if (el.bgReasonInput && el.bgReasonInput.value !== state.backgroundReason) {
      el.bgReasonInput.value = state.backgroundReason
    }
    if (el.melodyIntentInput && el.melodyIntentInput.value !== state.melodyIntent) {
      el.melodyIntentInput.value = state.melodyIntent
    }
    if (el.hashtagsInput && el.hashtagsInput.value !== state.hashtags) {
      el.hashtagsInput.value = state.hashtags
    }
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

  function fitCanvasLine(ctx, text, maxWidth) {
    let out = String(text || "")
    if (ctx.measureText(out).width <= maxWidth) return out
    while (out.length > 1 && ctx.measureText(out + "...").width > maxWidth) out = out.slice(0, -1)
    return out + "..."
  }

  // --- 재생 ---

  function setIcon(button, text) {
    if (!button) return
    const icon = button.querySelector("span")
    if (icon) icon.textContent = text
  }

  const controlFeedbackTimers = new WeakMap()
  function pulseControl(button) {
    if (!button) return
    const oldTimer = controlFeedbackTimers.get(button)
    if (oldTimer) clearTimeout(oldTimer)
    button.classList.add("pressing")
    const timer = setTimeout(function () {
      button.classList.remove("pressing")
      controlFeedbackTimers.delete(button)
    }, 220)
    controlFeedbackTimers.set(button, timer)
  }

  function syncTransportButtons(playing, paused) {
    const hasAmbience = !!engine.ambience
    const canPause = playing || paused || hasAmbience
    const activeAudio = (!!playing || hasAmbience) && !paused
    const playLabel = activeAudio ? "전체곡 일시정지" : paused ? "전체곡 이어 재생" : "전체곡 재생"
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
    if (el.completeStopBtn) el.completeStopBtn.disabled = !canPause
  }

  engine.onState = function (playing, paused) {
    paused = !!paused
    const wasPaused = el.body.dataset.playback === "paused"
    el.statusText.textContent = paused
      ? playing
        ? "일시정지"
        : "배경음 일시정지"
      : playing
        ? "재생 중 · " + (engine.lastMode === "synth" ? "합성음" : "실제 음원")
        : engine.ambience
          ? "배경음 재생 중"
        : "전체곡 대기"
    el.statusText.classList.toggle("playing", (playing || !!engine.ambience) && !paused)
    el.statusText.classList.toggle("paused", paused)
    el.frame.classList.toggle("playing", playing && !paused)
    el.body.dataset.playback = paused ? "paused" : playing ? "playing" : "idle"
    syncTransportButtons(playing, paused)
    if (paused) pausePlayhead()
    else if (playing) startPlayhead(wasPaused)
    else stopPlayhead()
  }

  // 드로잉(3단계) 화면에서만 배경음을 깐다. 완성곡 재생 중엔 engine 이 끈다.

  // --- 재생 헤드(재생바) ---

  let playheadRAF = null
  let playheadStartedAt = 0
  let playheadElapsedMs = 0
  let selectedPlayheadProgress = 0
  function nowMs() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now()
  }

  function clampPlayheadProgress(progress) {
    const dur = Math.max(0.05, state.duration || 30)
    const max = Math.max(0, (dur - 0.05) / dur)
    return Math.max(0, Math.min(max, Number(progress) || 0))
  }

  function playheadProgressFromEvent(e) {
    const r = el.canvas.getBoundingClientRect()
    return clampPlayheadProgress((e.clientX - r.left) / Math.max(1, r.width))
  }

  function syncPlayheadValue(progress) {
    if (!el.playhead) return
    const sec = Math.round(progress * (state.duration || 30))
    el.playhead.setAttribute("aria-valuemin", "0")
    el.playhead.setAttribute("aria-valuemax", String(state.duration || 30))
    el.playhead.setAttribute("aria-valuenow", String(sec))
    el.playhead.setAttribute("title", sec + "초부터 재생")
  }

  function positionPlayhead(progress, options) {
    const wrap = canvasWrap()
    if (!wrap || !el.playhead) return
    const prog = Math.max(0, Math.min(1, progress))
    const cw = el.canvas.clientWidth || el.canvas.getBoundingClientRect().width
    const left = el.canvas.offsetLeft + prog * cw
    el.playhead.style.left = left + "px"
    syncPlayheadValue(prog)
    const view = wrap.clientWidth
    const follow = !options || options.follow !== false
    if (follow && (left < wrap.scrollLeft + 48 || left > wrap.scrollLeft + view - 48)) {
      wrap.scrollLeft = Math.max(0, left - view / 2)
      syncCanvasScrollState()
    }
  }

  function showSelectedPlayhead(follow) {
    if (!el.playhead) return
    el.playhead.hidden = false
    positionPlayhead(selectedPlayheadProgress, { follow: !!follow })
  }

  function setSelectedPlayhead(progress, announce, follow) {
    selectedPlayheadProgress = clampPlayheadProgress(progress)
    playheadElapsedMs = selectedPlayheadProgress * Math.max(1, state.duration * 1000)
    showSelectedPlayhead(follow)
    if (announce) {
      el.exportStatus.textContent = Math.round(selectedPlayheadProgress * state.duration) + "초부터 재생하도록 위치를 옮겼어요."
    }
  }

  function selectedPlaybackStartSec() {
    return clampPlayheadProgress(selectedPlayheadProgress) * (state.duration || 30)
  }

  function stopPlayhead() {
    if (playheadRAF) cancelAnimationFrame(playheadRAF)
    playheadRAF = null
    playheadStartedAt = 0
    playheadElapsedMs = selectedPlaybackStartSec() * 1000
    if (el.playhead) {
      if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
      else el.playhead.hidden = true
    }
  }
  function pausePlayhead() {
    if (playheadRAF) cancelAnimationFrame(playheadRAF)
    playheadRAF = null
    const durMs = Math.max(1, state.duration * 1000)
    if (playheadStartedAt) playheadElapsedMs = Math.max(0, Math.min(durMs, nowMs() - playheadStartedAt))
    if (el.playhead) {
      el.playhead.hidden = false
      positionPlayhead(playheadElapsedMs / durMs)
    }
  }
  function startPlayhead(resume) {
    const wrap = canvasWrap()
    if (!wrap || !el.playhead || typeof requestAnimationFrame === "undefined") return
    const durMs = Math.max(1, state.duration * 1000)
    if (!resume) playheadElapsedMs = selectedPlaybackStartSec() * 1000
    playheadStartedAt = nowMs() - playheadElapsedMs
    el.playhead.hidden = false
    const tick = function () {
      const elapsed = nowMs() - playheadStartedAt
      const prog = Math.max(0, Math.min(1, elapsed / durMs))
      playheadElapsedMs = elapsed
      positionPlayhead(prog)
      if (prog < 1 && engine.isPlaying && !engine.isPaused) playheadRAF = requestAnimationFrame(tick)
      else stopPlayhead()
    }
    if (playheadRAF) cancelAnimationFrame(playheadRAF)
    playheadRAF = requestAnimationFrame(tick)
  }

  function stopPlaybackForPlayheadSeek() {
    if (!bgPlayer.paused) pauseBgPlayer()
    if (engine.isPlaying || engine.isPaused) engine.stop()
  }

  function bindPlayheadSeeking() {
    if (!el.playhead) return
    let seeking = false
    const seekToEvent = function (e, announce) {
      setSelectedPlayhead(playheadProgressFromEvent(e), !!announce, true)
    }
    el.playhead.addEventListener("pointerdown", function (e) {
      seeking = true
      stopPlaybackForPlayheadSeek()
      seekToEvent(e, false)
      try {
        el.playhead.setPointerCapture(e.pointerId)
      } catch (err) {}
      e.preventDefault()
      e.stopPropagation()
    })
    el.playhead.addEventListener("pointermove", function (e) {
      if (!seeking) return
      seekToEvent(e, false)
      e.preventDefault()
      e.stopPropagation()
    })
    const finish = function (e) {
      if (!seeking) return
      seeking = false
      seekToEvent(e, true)
      e.preventDefault()
      e.stopPropagation()
    }
    el.playhead.addEventListener("pointerup", finish)
    el.playhead.addEventListener("pointercancel", finish)
    el.playhead.addEventListener("keydown", function (e) {
      const dur = Math.max(1, state.duration || 30)
      const step = (e.shiftKey ? 5 : 1) / dur
      let next = selectedPlayheadProgress
      if (e.key === "ArrowLeft") next -= step
      else if (e.key === "ArrowRight") next += step
      else if (e.key === "Home") next = 0
      else if (e.key === "End") next = 1
      else return
      stopPlaybackForPlayheadSeek()
      setSelectedPlayhead(next, true, true)
      e.preventDefault()
    })
  }

  // --- 배경음악 미니 플레이어 (드로잉 화면) ---

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return m + ":" + (s < 10 ? "0" : "") + s
  }

  function fmtInputTime(sec) {
    return fmtTime(Math.round(Math.max(0, Number(sec) || 0)))
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
    const d = bgPlayer.duration
    if (!isFinite(d) || d <= 0) return 0
    return d
  }

  function bgMinGap(total) {
    if (!total) return 0
    return Math.min(MIN_DURATION_SECONDS, total)
  }

  function defaultBgEnd(total, start) {
    if (!total) return 0
    const from = start == null ? state.bgOffset : start
    return Math.min(total, Math.max(from + bgMinGap(total), from + state.duration))
  }

  function normalizeBgRange(keepEnd) {
    const total = bgDuration()
    if (!canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      return
    }
    if (!total) return
    const gap = bgMinGap(total)
    const maxStart = Math.max(0, total - gap)
    state.bgOffset = clampNumber(state.bgOffset, 0, maxStart)
    let end = parseFloat(state.bgEndOffset)
    if (!keepEnd || !isFinite(end) || end <= state.bgOffset + gap * 0.5) end = defaultBgEnd(total, state.bgOffset)
    state.bgEndOffset = clampNumber(end, Math.min(total, state.bgOffset + gap), total)
  }

  function syncDurationFromBgRange(resetScroll) {
    const total = bgDuration()
    if (!canSelectBgRange() || !total || !(state.bgEndOffset > state.bgOffset)) {
      if (!isFinite(state.duration) || state.duration <= 0) state.duration = DEFAULT_DURATION_SECONDS
      return false
    }
    const next = round3(Math.max(bgMinGap(total), state.bgEndOffset - state.bgOffset))
    if (Math.abs(next - state.duration) < 0.001) return false
    state.duration = next
    selectedPlayheadProgress = clampPlayheadProgress(selectedPlayheadProgress)
    playheadElapsedMs = selectedPlaybackStartSec() * 1000
    refreshTimeline(!!resetScroll)
    return true
  }

  function selectedBgEnd() {
    if (!canSelectBgRange()) {
      const total = bgDuration()
      return total ? defaultBgEnd(total, 0) : 0
    }
    normalizeBgRange(true)
    return state.bgEndOffset
  }

  function syncBgPlayerUI() {
    normalizeBgRange(true)
    const total = bgDuration()
    const gap = bgMinGap(total)
    const maxStart = Math.max(0, total - gap)
    const endMin = Math.min(total, state.bgOffset + gap)
    const hasSrc = !!bgPlayer.getAttribute("src")
    const canSelectRange = canSelectBgRange()
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
    const durationChanged = syncDurationFromBgRange(false)
    if (el.bgStartInput) {
      el.bgStartInput.disabled = !canSelectRange || !total
      if (document.activeElement !== el.bgStartInput) el.bgStartInput.value = fmtInputTime(state.bgOffset)
    }
    if (el.bgEndInput) {
      el.bgEndInput.disabled = !canSelectRange || !total
      if (document.activeElement !== el.bgEndInput) el.bgEndInput.value = fmtInputTime(state.bgEndOffset)
    }
    if (el.bgTime) {
      el.bgTime.textContent = canSelectRange
        ? fmtInputTime(state.bgOffset) + " ~ " + fmtInputTime(state.bgEndOffset) + " / " + fmtInputTime(total)
        : fmtTime(0) + " / " + fmtTime(total)
    }
    if (!durationChanged) updateReadouts()
    setIcon(el.bgPlayBtn, bgPlayer.paused ? "▶" : "❚❚")
    if (el.bgPlayBtn) {
      el.bgPlayBtn.setAttribute("aria-label", bgPlayer.paused ? "배경음악만 재생" : "배경음악 일시정지")
      el.bgPlayBtn.classList.toggle("active", !bgPlayer.paused)
      el.bgPlayBtn.setAttribute("aria-pressed", bgPlayer.paused ? "false" : "true")
    }
  }

  // 드로잉 진입/배경 변경 시: 현재 배경 mp3를 걸고 bgOffset 지점에서 정지 대기
  function setupBgPlayer(keepRange) {
    pauseBgPlayer()
    const src = bgSrcFor(state.atmosphere)
    if (!src) {
      bgPlayer.removeAttribute("src")
      syncBgPlayerUI()
      return
    }
    if (bgPlayer.getAttribute("src") !== src) bgPlayer.src = src
    const apply = function () {
      normalizeBgRange(!!keepRange)
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (e) {}
      syncBgPlayerUI()
    }
    if (isFinite(bgPlayer.duration) && bgPlayer.duration > 0) apply()
    else bgPlayer.addEventListener("loadedmetadata", apply, { once: true })
    syncBgPlayerUI()
  }

  function pauseBgPlayer() {
    try {
      bgPlayer.pause()
    } catch (e) {}
    if (bgRAF) cancelAnimationFrame(bgRAF)
    bgRAF = null
    if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
    else if (el.playhead) el.playhead.hidden = true
    syncBgPlayerUI()
  }

  function playBgPlayer() {
    if (!bgSrcFor(state.atmosphere)) return
    stopBackgroundPreview()
    stopExamplePreview()
    engine.stop() // 전체 재생과 겹치지 않게
    normalizeBgRange(true)
    try {
      bgPlayer.currentTime = state.bgOffset
    } catch (e) {}
    const p = bgPlayer.play()
    if (p && p.catch) p.catch((e) => console.warn("배경음악 재생 실패", e))
    if (el.playhead) el.playhead.hidden = false
    bgTick()
    syncBgPlayerUI()
  }

  function toggleBgPlay() {
    if (bgPlayer.paused) playBgPlayer()
    else pauseBgPlayer()
  }

  function bgTick() {
    if (bgPlayer.paused) {
      bgRAF = null
      return
    }
    const end = selectedBgEnd()
    const segment = Math.max(0.1, end - state.bgOffset)
    let rel = bgPlayer.currentTime - state.bgOffset
    if (bgPlayer.currentTime >= end || bgPlayer.currentTime + 0.001 < state.bgOffset) {
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (e) {}
      rel = 0
    }
    positionPlayhead(Math.max(0, Math.min(1, rel / segment)))
    if (typeof requestAnimationFrame === "function") bgRAF = requestAnimationFrame(bgTick)
  }

  function seekBg(value) {
    if (!canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      syncBgPlayerUI()
      return
    }
    const total = bgDuration()
    const gap = bgMinGap(total)
    const previousEnd = Number(state.bgEndOffset)
    state.bgOffset = clampNumber(value, 0, Math.max(0, total - gap))
    state.bgEndOffset =
      isFinite(previousEnd) && previousEnd > state.bgOffset + gap ? previousEnd : defaultBgEnd(total, state.bgOffset)
    normalizeBgRange(true)
    try {
      bgPlayer.currentTime = state.bgOffset
    } catch (e) {}
    if (el.playhead) {
      showSelectedPlayhead(false)
    }
    syncBgPlayerUI()
  }

  function seekBgEnd(value) {
    if (!canSelectBgRange()) {
      state.bgOffset = 0
      state.bgEndOffset = 0
      syncBgPlayerUI()
      return
    }
    const total = bgDuration()
    const gap = bgMinGap(total)
    state.bgEndOffset = clampNumber(value, Math.min(total, state.bgOffset + gap), total)
    normalizeBgRange(true)
    if (bgPlayer.currentTime >= state.bgEndOffset) {
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (e) {}
      showSelectedPlayhead(false)
    }
    syncBgPlayerUI()
  }

  function commitBgStartInput() {
    const parsed = parseTimeInput(el.bgStartInput && el.bgStartInput.value)
    if (parsed == null) {
      syncBgPlayerUI()
      return
    }
    seekBg(parsed)
  }

  function commitBgEndInput() {
    const parsed = parseTimeInput(el.bgEndInput && el.bgEndInput.value)
    if (parsed == null) {
      syncBgPlayerUI()
      return
    }
    seekBgEnd(parsed)
  }

  function requireDrawn() {
    if (draw.getPath().length >= 1) return true
    el.statusText.textContent = "먼저 선을 그려주세요"
    el.exportStatus.textContent = "먼저 캔버스에 점을 찍거나 선을 그려주세요."
    return false
  }

  function play() {
    if (engine.isPlaying && engine.isPaused) {
      engine.resume()
      return
    }
    if (engine.isPlaying) {
      engine.pause()
      return
    }
    stopBackgroundPreview()
    stopExamplePreview()
    pauseBgPlayer() // 전체 재생 중엔 배경음악 미니 플레이어를 멈춘다(중복 방지 — 패드는 bgOffset부터 깔림)
    renderAtmospheres()
    const recipe = buildRecipe()
    engine.play(recipe, notesFor(recipe), { startOffset: selectedPlaybackStartSec() }).catch(function (e) {
      el.statusText.textContent = "재생 오류"
      console.error(e)
    })
  }

  function toggleTransport() {
    if (engine.isPaused) {
      engine.resume()
      return
    }
    if (engine.isPlaying || engine.ambience) {
      engine.pause()
      return
    }
    play()
  }

  function pause() {
    if (!engine.isPlaying && !engine.ambience && !engine.isPaused) return
    stopBackgroundPreview()
    stopExamplePreview()
    renderAtmospheres()
    if (engine.isPaused) engine.resume()
    else engine.pause()
  }

  function stop() {
    stopBackgroundPreview()
    stopExamplePreview()
    renderAtmospheres()
    engine.stop()
  }

  function setEraser(on) {
    if (on && state.effectStampId) {
      state.effectStampId = null
      renderEffects()
    }
    draw.setEraseMode(on)
    renderEffectStamps()
    if (el.penBtn) {
      el.penBtn.classList.toggle("active", !on)
      el.penBtn.setAttribute("aria-pressed", on ? "false" : "true")
    }
    el.clearBtn.classList.toggle("active", on)
    el.clearBtn.setAttribute("aria-pressed", on ? "true" : "false")
    if (on) el.exportStatus.textContent = "지우개로 선과 효과음 도장을 지울 수 있습니다."
  }

  function syncUndoButton() {
    if (!el.undoBtn || typeof draw.canUndo !== "function") return
    el.undoBtn.disabled = !draw.canUndo()
  }

  function resetCompose() {
    engine.stop()
    setEraser(false)
    draw.clear(false)
    draw.clearUndoHistory()
    syncUndoButton()
    draw.setActiveInstrument(state.instrument.id)
    state.effectIds = []
    state.effectStamps = []
    state.effectStampId = null
    renderEffects()
    renderEffectStamps()
    renderOrchestraLegend()
    setupBgPlayer(true)
    setSelectedPlayhead(0, false, false)
    el.statusText.textContent = "전체곡 대기"
    el.exportStatus.textContent = "드로잉만 초기화했습니다. 배경음악 구간은 그대로 유지됩니다."
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
      const instObj = D.instruments.find((i) => i.id === t.recipe.instrument) || D.instruments[0]
      renderTakeName(meta, t, idx + 1)
      const detail = document.createElement("span")
      detail.className = "take-detail"
      detail.textContent = atmos.label + " · " + instObj.label + " · " + secondsLabel(t.recipe.duration)
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
    state.duration = normalizeDuration(recipe.duration || DEFAULT_DURATION_SECONDS)
    state.atmosphere = D.atmospheres.find((a) => a.id === recipe.atmosphere) || D.atmospheres[0]
    state.instrument = D.instruments.find((i) => i.id === recipe.instrument) || D.instruments[0]
    state.style = styleForInstrument(state.instrument) // 음계는 악기 그룹을 따른다(서양=C장조, 국악=5음)
    state.version = defaultVersion()
    state.mode = "melody"
    state.group = state.instrument.group
    state.effectStamps = simplifyEffectStamps(recipe.effectStamps || [])
    const stampIds = state.effectStamps.map((stamp) => stamp.id)
    state.effectIds = (recipe.effectIds || []).filter((id) => !!D.effects[id] && stampIds.indexOf(id) === -1)
    state.effectStampId = null
    if (canSelectBgRange()) {
      state.bgOffset = Math.max(0, Number(recipe.bgOffset) || 0)
      state.bgEndOffset = Math.max(0, Number(recipe.bgEndOffset) || 0)
    } else {
      state.bgOffset = 0
      state.bgEndOffset = 0
    }
    state.backgroundReason = recipe.backgroundReason || ""
    state.melodyIntent = recipe.melodyIntent || ""
    state.hashtags = Array.isArray(recipe.hashtags) ? hashtagText(recipe.hashtags) : recipe.hashtags || ""
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
    renderVersions()
    renderComposeInstruments()
    renderEffects()
    renderPaletteLabels()
    syncTimelineWidth(true)
    // 다중 획 우선 복원, 없으면(옛 레시피) 단일 path를 하나의 획으로
    draw.setActiveInstrument(state.instrument.id)
    if (recipe.strokes && recipe.strokes.length) draw.setStrokes(recipe.strokes, recipe.strokeInstruments)
    else draw.setPath(recipe.path || [], recipe.instrument)
    draw.clearUndoHistory()
    syncUndoButton()
    renderEffectStamps()
    renderOrchestraLegend()
    setupBgPlayer(true)
    setSelectedPlayhead(0, false, false)
    syncReflectionInputs()
    updateReadouts()
  }

  // --- 내보내기 ---

  async function exportAudio() {
    if (!requireDrawn()) return
    el.exportStatus.textContent = "압축 음악을 만드는 중… 노래 길이만큼 기다려 주세요."
    try {
      const recipe = buildRecipe()
      if (!engine.exportCompressedAudio) throw new Error("compressed audio export is not available")
      const result = await engine.exportCompressedAudio(recipe, notesFor(recipe), safeName() + "_music.webm")
      const size = result && typeof result === "object" ? result.size : result
      el.exportStatus.textContent = "음악 저장 완료 (" + Math.round(size / 1024) + " KB, WebM)"
    } catch (e) {
      console.error(e)
      el.exportStatus.textContent = "음악 저장 실패 — 크롬에서 다시 시도해 주세요."
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
      const tags = hashtagText(state.hashtags)
      const padH = tags ? 190 : 140
      ctx.fillStyle = "rgba(20,26,26,0.82)"
      ctx.fillRect(0, size - padH, size, padH)
      ctx.fillStyle = "#fbf6ec"
      ctx.font = "700 52px Georgia, serif"
      ctx.fillText(fitCanvasLine(ctx, state.title || "무제", size - 96), 48, size - padH + 64)
      if (tags) {
        ctx.font = "800 30px 'Segoe UI', sans-serif"
        ctx.fillStyle = "rgba(251,246,236,0.92)"
        ctx.fillText(fitCanvasLine(ctx, tags, size - 96), 48, size - padH + 118)
      }
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

  function roundCanvasRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function loadCanvasImage(src) {
    return new Promise(function (resolve) {
      if (!src) {
        resolve(null)
        return
      }
      const img = new Image()
      let done = false
      const finish = function (value) {
        if (done) return
        done = true
        resolve(value)
      }
      img.onload = function () {
        finish(img)
      }
      img.onerror = function () {
        finish(null)
      }
      img.src = src
      if (img.complete) finish(img)
    })
  }

  async function stampImageMap() {
    const ids = []
    state.effectStamps.forEach((stamp) => {
      if (ids.indexOf(stamp.id) === -1) ids.push(stamp.id)
    })
    const pairs = await Promise.all(
      ids.map(function (id) {
        const effect = D.effects[id]
        return loadCanvasImage(effect && effect.image).then((img) => [id, img])
      }),
    )
    const out = {}
    pairs.forEach((pair) => {
      out[pair[0]] = pair[1]
    })
    return out
  }

  function drawSnapshotTimeLabels(ctx, w, h) {
    const count = paletteCount()
    const fontSize = Math.max(18, Math.round(w * 0.013))
    ctx.save()
    ctx.font = "800 " + fontSize + "px 'Segoe UI', sans-serif"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    for (let i = 1; i <= count; i++) {
      const text = secondsLabel(Math.min(i * SEGMENT_SECONDS, state.duration))
      const metrics = ctx.measureText(text)
      const pillW = Math.max(48, metrics.width + 18)
      const pillH = fontSize + 14
      const x = Math.max(pillW / 2 + 8, Math.min(w - pillW / 2 - 8, (i / count) * w))
      const y = Math.max(pillH / 2 + 8, fontSize + 8)
      ctx.fillStyle = "rgba(251,246,236,0.92)"
      roundCanvasRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2)
      ctx.fill()
      ctx.strokeStyle = "rgba(31,38,38,0.12)"
      ctx.stroke()
      ctx.fillStyle = "rgba(31,38,38,0.72)"
      ctx.fillText(text, x, y)
    }
    ctx.restore()
  }

  function drawSnapshotStamps(ctx, w, h, images) {
    state.effectStamps.forEach((stamp) => {
      const effect = D.effects[stamp.id]
      if (!effect) return
      const size = Math.max(44, Math.min(76, Math.round(w * 0.04)))
      const x = Math.max(size / 2, Math.min(w - size / 2, (stamp.x || 0) * w))
      const y = Math.max(size / 2, Math.min(h - size / 2, (stamp.y == null ? 0.5 : stamp.y) * h))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((-4 * Math.PI) / 180)
      ctx.shadowColor = "rgba(31,38,38,0.16)"
      ctx.shadowBlur = Math.max(8, size * 0.22)
      ctx.shadowOffsetY = Math.max(4, size * 0.12)
      ctx.fillStyle = "rgba(251,246,236,0.88)"
      roundCanvasRect(ctx, -size / 2, -size / 2, size, size, Math.max(10, size * 0.24))
      ctx.fill()
      ctx.shadowColor = "transparent"
      ctx.strokeStyle = "rgba(31,38,38,0.18)"
      ctx.stroke()
      const img = images[stamp.id]
      if (img) {
        ctx.drawImage(img, -size * 0.38, -size * 0.38, size * 0.76, size * 0.76)
      } else {
        ctx.fillStyle = "rgba(31,38,38,0.78)"
        ctx.font = "800 " + Math.max(10, Math.round(size * 0.18)) + "px 'Segoe UI', sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(fitCanvasLine(ctx, effect.label, size * 0.78), 0, 0)
      }
      ctx.restore()
    })
  }

  function drawSnapshotPlayhead(ctx, w, h, progress) {
    if (progress == null) return
    const x = Math.max(0, Math.min(1, progress)) * w
    ctx.save()
    ctx.strokeStyle = "rgba(185,67,54,0.92)"
    ctx.lineWidth = Math.max(3, Math.round(w * 0.0025))
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillStyle = "rgba(185,67,54,0.94)"
    ctx.beginPath()
    ctx.arc(x, Math.max(18, h * 0.055), Math.max(8, Math.round(w * 0.007)), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  async function renderDrawingSnapshotCanvas(options) {
    options = options || {}
    draw.render()
    const w = el.canvas.width || 1440
    const h = el.canvas.height || 540
    const cv = document.createElement("canvas")
    cv.width = w
    cv.height = h
    const ctx = cv.getContext("2d")
    ctx.drawImage(el.canvas, 0, 0, w, h)
    drawSnapshotTimeLabels(ctx, w, h)
    drawSnapshotStamps(ctx, w, h, await stampImageMap())
    drawSnapshotPlayhead(ctx, w, h, options.playheadProgress)
    return cv
  }

  function canvasToBlob(canvas, type) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob)
        else reject(new Error("canvas toBlob failed"))
      }, type)
    })
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  async function exportDrawingImage() {
    if (!requireDrawn()) return
    el.exportStatus.textContent = "드로잉 이미지를 만드는 중…"
    try {
      const cv = await renderDrawingSnapshotCanvas()
      downloadBlob(await canvasToBlob(cv, "image/png"), safeName() + "_drawing.png")
      el.exportStatus.textContent = "드로잉 이미지를 저장했어요."
    } catch (e) {
      console.error(e)
      el.exportStatus.textContent = "드로잉 이미지 저장 실패 — 콘솔을 확인하세요."
    }
  }

  function supportedVideoMime() {
    if (!window.MediaRecorder) return ""
    const list = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    for (const type of list) {
      if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) return type
    }
    return ""
  }

  async function exportDrawingVideo() {
    if (!requireDrawn()) return
    const base = await renderDrawingSnapshotCanvas()
    if (!window.MediaRecorder || typeof base.captureStream !== "function") {
      el.exportStatus.textContent = "이 브라우저에서는 드로잉 영상 저장을 지원하지 않아요. 드로잉 이미지를 이용해 주세요."
      return
    }
    const mimeType = supportedVideoMime()
    if (!mimeType) {
      el.exportStatus.textContent = "이 브라우저에서는 WebM 영상 저장을 지원하지 않아요."
      return
    }
    const cv = document.createElement("canvas")
    cv.width = base.width
    cv.height = base.height
    const ctx = cv.getContext("2d")
    const drawFrame = function (progress) {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(base, 0, 0)
      drawSnapshotPlayhead(ctx, cv.width, cv.height, progress)
    }
    drawFrame(0)
    const stream = cv.captureStream(30)
    const chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: mimeType })
    const done = new Promise(function (resolve, reject) {
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size) chunks.push(event.data)
      }
      recorder.onstop = resolve
      recorder.onerror = function (event) {
        reject((event && event.error) || new Error("MediaRecorder error"))
      }
    })
    const durationMs = Math.max(1000, state.duration * 1000)
    let raf = 0
    let lastStatus = 0
    if (el.exportDrawingVideoBtn) el.exportDrawingVideoBtn.disabled = true
    el.exportStatus.textContent = "드로잉 영상을 녹화하는 중… " + Math.round(durationMs / 1000) + "초 정도 기다려 주세요."
    try {
      const start = performance.now()
      recorder.start()
      const tick = function (now) {
        const elapsed = now - start
        const progress = Math.min(1, elapsed / durationMs)
        drawFrame(progress)
        if (now - lastStatus > 1000) {
          lastStatus = now
          el.exportStatus.textContent =
            "드로잉 영상을 녹화하는 중… " + Math.min(state.duration, Math.floor(elapsed / 1000)) + "/" + state.duration + "초"
        }
        if (progress < 1 && recorder.state !== "inactive") {
          raf = requestAnimationFrame(tick)
        } else if (recorder.state !== "inactive") {
          recorder.stop()
        }
      }
      raf = requestAnimationFrame(tick)
      await done
      if (!chunks.length) throw new Error("recorded video is empty")
      downloadBlob(new Blob(chunks, { type: mimeType }), safeName() + "_drawing.webm")
      el.exportStatus.textContent = "드로잉 영상을 저장했어요. 소리는 음악 저장(WebM)으로 따로 저장할 수 있어요."
    } catch (e) {
      console.error(e)
      if (raf) cancelAnimationFrame(raf)
      el.exportStatus.textContent = "드로잉 영상 저장 실패 — 콘솔을 확인하세요."
    } finally {
      stream.getTracks().forEach((track) => track.stop())
      if (el.exportDrawingVideoBtn) el.exportDrawingVideoBtn.disabled = false
    }
  }

  function shareLink() {
    const code = Core.encodeRecipe(buildRecipe())
    const url = setShareHash(code)
    const copied = function () {
      el.exportStatus.textContent = "공유 링크를 복사했어요. 같은 사이트에서 열면 그대로 복원됩니다."
    }
    const fallback = function () {
      if (copyViaSelection(url)) {
        copied()
        return
      }
      if (typeof prompt === "function") prompt("공유 링크", url)
      el.exportStatus.textContent = "공유 링크를 주소창에 만들었어요. 주소창의 링크를 복사하세요."
    }
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
      const url = new URL(location.href)
      url.search = ""
      url.hash = hash
      history.replaceState(null, "", url.href)
      return url.href
    } catch (e) {
      location.hash = hash
      return location.href
    }
  }

  function copyViaSelection(text) {
    if (!document.execCommand) return false
    const input = document.createElement("textarea")
    input.value = text
    input.setAttribute("readonly", "")
    input.style.position = "fixed"
    input.style.left = "-9999px"
    input.style.top = "0"
    document.body.appendChild(input)
    input.select()
    try {
      return document.execCommand("copy")
    } catch (e) {
      return false
    } finally {
      document.body.removeChild(input)
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
    if (state.examplePreviewId) {
      stopExamplePreview()
      renderInstruments()
    }
    const nextStep = Math.max(0, Math.min(screens.length - 1, i))
    state.step = nextStep
    el.body.dataset.step = String(state.step)
    screens.forEach((s, idx) => {
      const on = idx === state.step
      s.classList.toggle("active", on)
      s.toggleAttribute("hidden", !on)
    })
    tabs.forEach((t, idx) => t.classList.toggle("active", idx === state.step))
    if (state.step === DRAWING_STEP) {
      refreshTimeline(true)
      renderComposeInstruments()
      renderEffects()
      warmSelectedInstrument()
      setupBgPlayer()
    } else {
      engine.stopAmbience(false)
      pauseBgPlayer()
      if (!engine.isPlaying && engine.isPaused) engine.stop()
      else syncTransportButtons(engine.isPlaying, engine.isPaused)
    }
    if (state.step === COMPLETE_STEP) {
      drawFrameFallback()
      renderTakes()
      updateReadouts()
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // --- 이벤트 ---

  function bind() {
    bindEffectStamping()
    bindPlayheadSeeking()
    const wrap = canvasWrap()
    if (wrap) wrap.addEventListener("scroll", syncCanvasScrollState, { passive: true })

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

    if (el.penBtn) {
      el.penBtn.addEventListener("click", () => {
        setEraser(false)
        el.exportStatus.textContent = "펜 모드 — 캔버스에 선을 그릴 수 있어요."
      })
    }
    el.clearBtn.addEventListener("click", () => {
      const on = !draw.eraseMode
      setEraser(on)
      if (on) engine.stop()
      el.exportStatus.textContent = on
        ? "지우개 모드 — 캔버스를 드래그하면 선의 일부를 지웁니다. 다시 누르면 그리기로 돌아갑니다."
        : "그리기 모드로 돌아왔어요."
    })
    if (el.undoBtn) {
      el.undoBtn.addEventListener("click", () => {
        if (!draw.undo()) return
        renderEffectStamps()
        el.exportStatus.textContent = "마지막 드로잉 작업을 되돌렸어요."
      })
    }
    el.resetComposeBtn.addEventListener("click", resetCompose)

    // 배경음악 미니 플레이어 — 재생/일시정지 + 시작 지점(bgOffset) 스크럽
    if (el.bgPlayBtn) {
      el.bgPlayBtn.addEventListener("click", function () {
        pulseControl(el.bgPlayBtn)
        toggleBgPlay()
      })
    }
    if (el.bgSeek) el.bgSeek.addEventListener("input", (e) => seekBg(e.target.value))
    if (el.bgEndSeek) el.bgEndSeek.addEventListener("input", (e) => seekBgEnd(e.target.value))
    if (el.bgStartInput) {
      el.bgStartInput.addEventListener("change", commitBgStartInput)
      el.bgStartInput.addEventListener("blur", commitBgStartInput)
      el.bgStartInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          commitBgStartInput()
          el.bgStartInput.blur()
        }
      })
    }
    if (el.bgEndInput) {
      el.bgEndInput.addEventListener("change", commitBgEndInput)
      el.bgEndInput.addEventListener("blur", commitBgEndInput)
      el.bgEndInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          commitBgEndInput()
          el.bgEndInput.blur()
        }
      })
    }
    if (el.instrumentPreviewStopBtn) {
      el.instrumentPreviewStopBtn.addEventListener("click", function () {
        stopExamplePreview(true)
        renderInstruments()
      })
    }

    el.playBtn.addEventListener("click", function () {
      pulseControl(el.playBtn)
      toggleTransport()
    })
    el.stopBtn.addEventListener("click", function () {
      pulseControl(el.stopBtn)
      stop()
    })
    if (el.completeStopBtn) {
      el.completeStopBtn.addEventListener("click", function () {
        pulseControl(el.completeStopBtn)
        stop()
      })
    }

    el.saveTakeBtn.addEventListener("click", saveTake)
    el.adminModeBtn.addEventListener("click", function () {
      setAdminMode(!state.adminMode)
    })
    if (el.exportAudioBtn) el.exportAudioBtn.addEventListener("click", exportAudio)
    if (el.exportDrawingImageBtn) el.exportDrawingImageBtn.addEventListener("click", exportDrawingImage)
    if (el.exportDrawingVideoBtn) el.exportDrawingVideoBtn.addEventListener("click", exportDrawingVideo)
    el.exportCoverBtn.addEventListener("click", exportCover)
    el.shareBtn.addEventListener("click", shareLink)

    el.titleInput.addEventListener("input", () => {
      state.title = el.titleInput.value || "무제"
    })
    if (el.bgReasonInput) {
      el.bgReasonInput.addEventListener("input", () => {
        state.backgroundReason = el.bgReasonInput.value
      })
    }
    if (el.melodyIntentInput) {
      el.melodyIntentInput.addEventListener("input", () => {
        state.melodyIntent = el.melodyIntentInput.value
      })
    }
    if (el.hashtagsInput) {
      el.hashtagsInput.addEventListener("input", () => {
        state.hashtags = el.hashtagsInput.value
        updateReadouts()
      })
      el.hashtagsInput.addEventListener("blur", () => {
        state.hashtags = hashtagText(state.hashtags)
        syncReflectionInputs()
        updateReadouts()
      })
    }
    window.addEventListener("resize", () => {
      if (state.step !== DRAWING_STEP) return
      refreshTimeline(false)
    })
  }

  // --- 초기화 ---

  function ensureFramePlayButton() {
    if (!el.frame || el.framePlayBtn) return
    const button = document.createElement("button")
    button.className = "frame-play"
    button.id = "framePlayBtn"
    button.type = "button"
    button.setAttribute("aria-label", "음악 재생")
    const icon = document.createElement("span")
    icon.setAttribute("aria-hidden", "true")
    icon.textContent = "▶"
    button.appendChild(icon)
    button.addEventListener("click", function () {
      pulseControl(button)
      toggleTransport()
    })
    el.frame.appendChild(button)
    el.framePlayBtn = button
  }

  function init() {
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
    renderVersions()
    renderComposeInstruments()
    renderOrchestraLegend()
    renderEffects()
    syncBgPlayerUI()
    refreshTimeline(true)
    ensureFramePlayButton()
    bind()
    syncAdminModeUI()
    syncTransportButtons(false, false)
    syncReflectionInputs()
    updateReadouts()
    syncUndoButton()
    restoreFromHash()
    setStep(0)
    warmSelectedInstrument() // 기본 악기 미리 준비 + 음원 로드 상태(실제/합성)를 하단에 표시
    engine.warmAmbience(buildRecipe()).catch(function () {}) // 기본 배경음 미리 로드(드로잉 진입 시 즉시)
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
        bgOffset: state.bgOffset,
        bgEndOffset: state.bgEndOffset,
        backgroundReason: state.backgroundReason,
        melodyIntent: state.melodyIntent,
        hashtags: normalizeHashtags(state.hashtags),
        step: state.step,
        noteCount: state.mode === "rhythm" ? draw.hits.length : draw.notes.length,
        hasPicture: !!state.pic,
        takes: takes.list().length,
        adminMode: state.adminMode,
        effectIds: state.effectIds.slice(),
        effectStamps: state.effectStamps.map((stamp) => ({ id: stamp.id, x: stamp.x, y: stamp.y })),
        effectStampId: state.effectStampId,
        isPlaying: engine.isPlaying,
        isPaused: engine.isPaused,
        lastMode: engine.lastMode,
      }
    },
    play: play,
    pause: pause,
    resume: function () {
      return engine.resume()
    },
    stop: stop,
    exportAudio: exportAudio,
    exportDrawingImage: exportDrawingImage,
    exportDrawingVideo: exportDrawingVideo,
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
