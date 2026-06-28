/*
 * studio.js — 위저드 오케스트레이션
 * 상태 관리, 카드 렌더, 단계 이동, 그림 업로드, 무드 틴팅, 재생, 시도 저장, 내보내기, 공유 링크.
 */
;(function () {
  "use strict"
  const Core = window.MusicCore
  const D = window.SDStudioData
  const ShareStore = window.HwaeumShareStore || null

  const engine = new window.AudioEngine()
  const takes = new window.TakesStore("sda.takes")
  const SEGMENT_SECONDS = 2.5
  const TIMELINE_PIXELS_PER_SECOND = 96
  const TIMELINE_LABEL_GUTTER_PX = 56
  const DEFAULT_DURATION_SECONDS = 30
  const MIN_DURATION_SECONDS = 1
  const DEFAULT_COVER_SRC = "./assets/default-cover.png"
  const ADMIN_STORAGE_KEY = "sda.adminMode"
  const TAKE_NAME_MAX = 24
  const COMPOSER_NAME_MAX = 24
  const PICTURE_NAME_MAX = 80
  const RECIPE_PICTURE_MAX_EDGE = 960
  const RECIPE_PICTURE_JPEG_QUALITY = 0.82
  const DRAWING_STEP = 2
  const COMPLETE_STEP = 3
  const SHARE_STEP = 4
  const SHARE_AUDIO_BITS_PER_SECOND = 64000
  const DEFAULT_STYLE_ID = "bright" // 기본 음계 = C장조(서양 악기는 파(F)도 난다)
  const GUGAK_STYLE_ID = "gugak" // 국악기만 5음(펜타토닉)+시김새 — 파(F)·시(B) 없음
  const CUSTOM_BG_MAX_BYTES = 50 * 1024 * 1024
  const PIXABAY_MUSIC_URL = "https://pixabay.com/music/"
  const INSTRUMENT_GROUPS = ["서양", "국악"]
  const DEFAULT_INSTRUMENT_FAMILY = "그 밖의 악기"
  const PEN_TOOL_STATUS = "펜(키보드1)"
  const ERASER_TOOL_STATUS = "지우개(키보드2)"
  const DRAW_MODE_PICTURE = "picture"
  const DRAW_MODE_SOUND = "sound"
  const APP_UNDO_MAX = 30
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

  function instrumentFamilies(items) {
    const order = []
    const byFamily = {}
    ;(items || []).forEach(function (instrument) {
      const family = instrument.family || DEFAULT_INSTRUMENT_FAMILY
      if (!byFamily[family]) {
        byFamily[family] = []
        order.push(family)
      }
      byFamily[family].push(instrument)
    })
    return order.map((family) => ({ family: family, items: byFamily[family] }))
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
    picName: "",
    recipePicture: "",
    title: "무제",
    composerName: "",
    step: 0,
    group: "서양",
    effectIds: [], // 옛 레시피 호환용: 자동 배치 효과
    effectStamps: [], // 새 방식: 캔버스에 찍은 효과음 도장 [{ id, x, y }]
    effectStampId: null,
    drawingInputMode: DRAW_MODE_PICTURE,
    bgPreviewId: null, // 현재 미리듣기 중인 배경 id
    examplePreviewId: null, // 현재 감상 재생 중인 악기 id
    bgOffset: 0, // 배경음악을 이 지점(초)부터 — 캔버스 가로축이 [bgOffset, bgOffset+길이]에 대응, 최종 곡에도 반영
    bgEndOffset: 0,
    backgroundReason: "",
    melodyIntent: "",
    hashtags: "",
    activeTakeId: null, // 완성 화면에서 지금 보고 있는 시도(테이크)
    playingTakeId: null, // 완성 화면 시도 목록에서 지금 재생/일시정지 중인 시도
    sharedRecipeLoaded: false, // 레시피 링크로 불러온 곡은 로컬 시도 목록을 섞어 보이지 않는다.
    adminMode: loadAdminMode(),
    sharedChannel: ShareStore ? ShareStore.loadChannel() : "",
    sharedWorks: [],
    sharedLoading: false,
    drawingReferenceCollapsed: false,
  }

  // 배경 미리듣기 — Web Audio 합주 엔진과 독립된 단순 재생기
  const bgPreview = new Audio()
  bgPreview.preload = "none"
  let customBgSeq = 0

  // 드로잉(3단계) 배경음악 — 전용 <audio>로 재생/일시정지.
  // [bgOffset, bgEndOffset] 구간을 반복하고, 그 구간 길이가 최종 곡 길이가 된다.
  const bgPlayer = new Audio()
  bgPlayer.preload = "auto"
  bgPlayer.volume = 0.825
  let bgRAF = null
  let bgPausedAt = null

  // 악기 연주곡 감상 — 배경 미리듣기와 동일한 독립 재생기(한 번에 하나만)
  const examplePreview = new Audio()
  examplePreview.preload = "none"
  examplePreview.addEventListener("ended", () => {
    state.examplePreviewId = null
    renderInstruments()
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
    drawingWorkspace: $("drawingWorkspace"),
    drawingReference: $("drawingReference"),
    drawingReferenceToggle: $("drawingReferenceToggle"),
    drawingReferenceImg: $("drawingReferenceImg"),
    atmosphereGrid: $("atmosphereGrid"),
    bgUploadInput: $("bgUploadInput"),
    bgUploadStatus: $("bgUploadStatus"),
    instrumentGroups: $("instrumentGroups"),
    instrumentGrid: $("instrumentGrid"),
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
    drawModePictureBtn: $("drawModePictureBtn"),
    drawModeSoundBtn: $("drawModeSoundBtn"),
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
    composerInput: $("composerInput"),
    placardMeta: $("placardMeta"),
    placardDetail: $("placardDetail"),
    bgReasonInput: $("bgReasonInput"),
    melodyIntentInput: $("melodyIntentInput"),
    hashtagsInput: $("hashtagsInput"),
    saveTakeBtn: $("saveTakeBtn"),
    exportAudioBtn: $("exportAudioBtn"),
    completeStopBtn: $("completeStopBtn"),
    exportDrawingImageBtn: $("exportDrawingImageBtn"),
    exportDrawingVideoBtn: $("exportDrawingVideoBtn"),
    exportCoverBtn: $("exportCoverBtn"),
    shareBtn: $("shareBtn"),
    shareChannelInput: $("shareChannelInput"),
    publishShareBtn: $("publishShareBtn"),
    openShareStepBtn: $("openShareStepBtn"),
    channelOpenForm: $("channelOpenForm"),
    channelBrowseInput: $("channelBrowseInput"),
    loadChannelBtn: $("loadChannelBtn"),
    shareAdminPinInput: $("shareAdminPinInput"),
    shareStatus: $("shareStatus"),
    sharedWorksList: $("sharedWorksList"),
    sharedEmpty: $("sharedEmpty"),
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
    gayageum: "#9a6a3a", haegeum: "#9c5b76",
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

  const appUndoStack = []
  let trackedDrawUndoDepth = 0
  let trackedDrawUndoTop = null
  let suppressDrawUndoTracking = false

  const draw = new window.DrawingCanvas(el.canvas, {
    activeInstrument: state.instrument.id,
    instrumentColor: colorForInstrument,
    maxInstruments: 4,
    onInstrumentLimit: (max) => {
      el.exportStatus.textContent = "악기는 한 곡에 최대 " + max + "개까지예요. 줄을 지우면 다른 악기를 더할 수 있어요."
    },
    getState: () => ({ duration: state.duration, style: state.style, mode: state.mode, melodyAsset: D.melodies[state.instrument.id] || null }),
    getFlowProgress: () => soundDrawingProgress(),
    onChange: () => {
      recordDrawUndoAction()
      updateReadouts()
      renderOrchestraLegend()
      syncUndoButton()
    },
    onPreviewStart: (point) => {
      // 전체곡 재생 중에도 펜 소리는 들린다(미리듣기는 본 재생과 독립 믹스). 다만 "재생 중" 표시는 그대로 둔다.
      if (!(engine.isPlaying && !engine.isPaused)) {
        el.statusText.textContent = state.instrument.label + " 드로잉 중"
        el.statusText.classList.add("playing")
        el.body.dataset.livePreview = "drawing"
      }
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
    onFlowStart: () => {
      if (state.drawingInputMode !== DRAW_MODE_SOUND) return
      el.exportStatus.textContent = "소리모드 녹음 중입니다. 손을 떼면 들은 타이밍대로 악보에 남아요."
    },
    onFlowEnd: () => {
      if (state.drawingInputMode !== DRAW_MODE_SOUND) return
      el.exportStatus.textContent = "소리모드 선율을 악보에 남겼어요."
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

  function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value) || 0))
  }

  function cleanText(value, max) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  }

  function normalizePictureData(value) {
    const data = String(value || "")
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(data) ? data : ""
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

  function timelineLabelTimes() {
    const duration = Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS)
    const times = []
    for (let t = SEGMENT_SECONDS; t < duration - 0.0001; t += SEGMENT_SECONDS) times.push(round3(t))
    times.push(round3(duration))
    return times
  }

  function canvasWrap() {
    return el.canvas.parentElement
  }

  function syncTimelineWidth(resetScroll) {
    const wrap = canvasWrap()
    if (!wrap) return
    const segmentWidth = Math.round(TIMELINE_PIXELS_PER_SECOND * SEGMENT_SECONDS)
    const duration = Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS)
    const width = Math.ceil(TIMELINE_LABEL_GUTTER_PX + duration * TIMELINE_PIXELS_PER_SECOND)
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

  function syncDrawingReferenceToggle() {
    const collapsed = !!state.drawingReferenceCollapsed
    if (el.drawingWorkspace) el.drawingWorkspace.classList.toggle("reference-collapsed", collapsed)
    if (el.drawingReference) el.drawingReference.setAttribute("aria-hidden", collapsed ? "true" : "false")
    if (!el.drawingReferenceToggle) return
    const label = collapsed ? "그림 펼치기" : "그림 접기"
    const icon = el.drawingReferenceToggle.querySelector("span")
    if (icon) icon.textContent = collapsed ? "▶" : "◀"
    el.drawingReferenceToggle.setAttribute("aria-expanded", String(!collapsed))
    el.drawingReferenceToggle.setAttribute("aria-label", label)
    el.drawingReferenceToggle.title = label
  }

  function setDrawingReferenceCollapsed(collapsed, skipRefresh) {
    state.drawingReferenceCollapsed = !!collapsed
    syncDrawingReferenceToggle()
    if (skipRefresh || state.step !== DRAWING_STEP) return
    window.requestAnimationFrame(function () {
      refreshTimeline(false)
    })
  }

  function canvasTimelineGeometry() {
    const r = el.canvas.getBoundingClientRect()
    const width = el.canvas.clientWidth || r.width || 1
    const labelWidth =
      draw && typeof draw.pitchLabelGutterCssPx === "function"
        ? Math.min(Math.max(0, draw.pitchLabelGutterCssPx()), Math.max(0, width - 1))
        : 0
    return { rect: r, labelWidth: labelWidth, width: Math.max(1, width - labelWidth) }
  }

  function timelineCssX(progress) {
    const g = canvasTimelineGeometry()
    return g.labelWidth + clampUnit(progress) * g.width
  }

  function timelineProgressFromClientX(clientX) {
    const g = canvasTimelineGeometry()
    return clampUnit((clientX - g.rect.left - g.labelWidth) / g.width)
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
      title: cleanText(state.title || "무제", 24) || "무제",
      composerName: cleanText(state.composerName, COMPOSER_NAME_MAX),
      picture: normalizePictureData(state.recipePicture || state.pic),
      pictureName: cleanText(state.picName || "그림", PICTURE_NAME_MAX),
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
  function stopExamplePreview(announce) {
    const wasPlaying = !!state.examplePreviewId
    state.examplePreviewId = null
    try {
      examplePreview.pause()
      examplePreview.currentTime = 0
    } catch (e) {}
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
      el.exportStatus.textContent = instrument.label + " 소리를 듣는 중입니다. 정지하려면 같은 악기의 ■ 버튼을 누르세요."
    } catch (e) {
      console.warn("연주곡 감상 실패", e)
      state.examplePreviewId = null
    }
    renderInstruments()
  }

  // 카드 그룹 표시 순서. manifest 의 atmosphere.group 과 맞춘다. 새 group 은 이 뒤에 자동으로 붙는다.
  const STUDENT_MUSIC_GROUP = "내가 찾은 음악"
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
    if (a.custom) {
      const del = document.createElement("button")
      del.type = "button"
      del.className = "mood-delete"
      del.textContent = "✕"
      del.title = a.label + " 삭제"
      del.setAttribute("aria-label", a.label + " 삭제")
      del.addEventListener("click", (e) => {
        e.stopPropagation()
        removeCustomBackground(a)
      })
      b.appendChild(del)
    }
    el.atmosphereGrid.appendChild(b)
  }

  // 업로드한 "내가 찾은 음악" 삭제 — 목록·배경에서 빼고 Blob URL 도 해제한다.
  function removeCustomBackground(a) {
    const bg = D.backgrounds[a.id]
    if (bg && typeof bg.src === "string" && bg.src.indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(bg.src)
      } catch (e) {}
    }
    delete D.backgrounds[a.id]
    const idx = D.atmospheres.indexOf(a)
    if (idx !== -1) D.atmospheres.splice(idx, 1)
    if (state.bgPreviewId === a.id) stopBackgroundPreview()
    if (state.atmosphere && state.atmosphere.id === a.id) {
      state.atmosphere = D.atmospheres[0]
      state.bgOffset = 0
      state.bgEndOffset = 0
      applyMoodTint()
      syncBgPlayerUI()
    }
    renderAtmospheres()
    updateReadouts()
    if (el.bgUploadStatus) {
      el.bgUploadStatus.classList.remove("error")
      el.bgUploadStatus.textContent = "‘" + a.label + "’ 음악을 지웠어요."
    }
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
    const groups = INSTRUMENT_GROUPS.filter((group) => D.instruments.some((instrument) => instrument.group === group))
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
    const groupItems = D.instruments.filter((i) => i.group === state.group)
    instrumentFamilies(groupItems).forEach((familyGroup) => {
      const section = document.createElement("section")
      section.className = "instrument-family"
      section.setAttribute("aria-label", state.group + " " + familyGroup.family)

      const head = document.createElement("div")
      head.className = "instrument-family-head"
      const title = document.createElement("strong")
      title.textContent = familyGroup.family
      const count = document.createElement("small")
      count.textContent = familyGroup.items.length + "개"
      head.appendChild(title)
      head.appendChild(count)
      section.appendChild(head)

      const list = document.createElement("div")
      list.className = "instrument-family-grid"
      familyGroup.items.forEach((i) => {
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
        list.appendChild(b)
      })
      section.appendChild(list)
      el.instrumentGrid.appendChild(section)
    })
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
    INSTRUMENT_GROUPS.forEach((group) => {
      const groupItems = D.instruments.filter((instrument) => instrument.group === group)
      if (!groupItems.length) return

      const section = document.createElement("section")
      section.className = "compose-instrument-group" + (group === state.group ? " active" : "")
      section.setAttribute("aria-label", group + " 악기")
      section.dataset.group = group

      const head = document.createElement("div")
      head.className = "compose-instrument-group-head"
      const groupTitle = document.createElement("strong")
      groupTitle.textContent = group
      head.appendChild(groupTitle)
      section.appendChild(head)

      const list = document.createElement("div")
      list.className = "compose-instrument-group-list"
      instrumentFamilies(groupItems).forEach((familyGroup) => {
        const familySection = document.createElement("section")
        familySection.className = "compose-instrument-family"
        familySection.setAttribute("aria-label", group + " " + familyGroup.family)

        const familyHead = document.createElement("div")
        familyHead.className = "compose-instrument-family-head"
        familyHead.textContent = familyGroup.family
        familySection.appendChild(familyHead)

        const familyList = document.createElement("div")
        familyList.className = "compose-instrument-family-list"
        familyGroup.items.forEach((i) => {
          const b = document.createElement("button")
          b.type = "button"
          b.className = "compose-instrument" + (i.id === state.instrument.id ? " active" : "")
          applyInstrumentTone(b, i.id)
          b.setAttribute("aria-pressed", i.id === state.instrument.id ? "true" : "false")
          b.title = i.group + " · " + i.family + " · " + i.detail
          if (i.image) {
            const img = document.createElement("img")
            img.src = i.image
            img.alt = ""
            img.loading = "lazy"
            b.appendChild(img)
          }
          const label = document.createElement("span")
          label.className = "compose-instrument-text"
          const name = document.createElement("strong")
          name.textContent = i.label
          label.appendChild(name)
          b.appendChild(label)
          b.addEventListener("click", () => selectInstrument(i, true))
          familyList.appendChild(b)
        })

        familySection.appendChild(familyList)
        list.appendChild(familySection)
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
    tag.textContent = "악기 줄 · 선택 악기(최대 4개)"
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
      mark.style.left = Math.round(timelineCssX(stamp.x || 0)) + "px"
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
    const g = canvasTimelineGeometry()
    return {
      x: timelineProgressFromClientX(e.clientX),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      rect: r,
      timelineWidth: g.width,
    }
  }

  function buildSharedRecipe() {
    const recipe = buildRecipe()
    return Object.assign({}, recipe, {
      title: "무제",
      backgroundReason: "",
      melodyIntent: "",
      hashtags: [],
      composerName: cleanText(state.composerName, COMPOSER_NAME_MAX),
      shareMode: "drawing",
    })
  }

  function stampEffectAtPointer(e) {
    const effect = D.effects[state.effectStampId]
    if (!state.effectStampId || !effect) return false
    const point = canvasPointFromEvent(e)
    if (!point) return false
    pushEffectStampUndo()
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
      const dx = (Math.max(0, Math.min(1, stamp.x || 0)) - point.x) * point.timelineWidth
      const dy = (Math.max(0, Math.min(1, stamp.y == null ? 0.5 : stamp.y)) - point.y) * point.rect.height
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = index
      }
    })
    if (bestIndex < 0 || bestDist > radius2) return false
    pushEffectStampUndo()
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
    const duration = Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS)
    const times = timelineLabelTimes()
    el.paletteLabels.innerHTML = ""
    times.forEach((time, index) => {
      const d = document.createElement("div")
      d.className = "palette-label" + (index === times.length - 1 ? " palette-label-end" : "")
      d.style.left = Math.round(timelineCssX(time / duration)) + "px"
      d.innerHTML = "<span>" + secondsLabel(time) + "</span>"
      el.paletteLabels.appendChild(d)
    })
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
    if (el.placardDetail) {
      // 제목과 해시태그 사이: 고른 분위기 + 사용한 악기 이름
      const parts = []
      if (state.atmosphere && state.atmosphere.label) parts.push(state.atmosphere.label)
      const instruments = usedInstrumentLabels()
      if (instruments) parts.push(instruments)
      const detail = parts.join(" · ")
      el.placardDetail.textContent = detail
      el.placardDetail.classList.toggle("is-empty", !detail)
    }
  }

  // 곡에 실제로 쓰인 악기 이름(중복 제거). 그린 줄이 없으면 현재 선택 악기.
  function usedInstrumentLabels() {
    const ids = []
    const strokeInsts = typeof draw.getStrokeInstruments === "function" ? draw.getStrokeInstruments() : []
    strokeInsts.forEach((id) => {
      const realId = id || state.instrument.id
      if (ids.indexOf(realId) === -1) ids.push(realId)
    })
    if (!ids.length) ids.push(state.instrument.id)
    return ids
      .map((id) => {
        const inst = D.instruments.find((i) => i.id === id)
        return inst ? inst.label : id
      })
      .join(", ")
  }

  function syncReflectionInputs() {
    if (el.composerInput && el.composerInput.value !== state.composerName) {
      el.composerInput.value = state.composerName
    }
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

  let pictureCompressSeq = 0

  function compactPictureForRecipe(dataUrl) {
    const normalized = normalizePictureData(dataUrl)
    if (!normalized) return Promise.resolve("")
    return new Promise(function (resolve) {
      const done = function (value) {
        resolve(normalizePictureData(value) || normalized)
      }
      const img = new Image()
      let settled = false
      const finish = function (value) {
        if (settled) return
        settled = true
        done(value)
      }
      const timer = setTimeout(function () {
        finish(normalized)
      }, 3000)
      img.onload = function () {
        clearTimeout(timer)
        try {
          const srcW = img.naturalWidth || img.width || RECIPE_PICTURE_MAX_EDGE
          const srcH = img.naturalHeight || img.height || RECIPE_PICTURE_MAX_EDGE
          const scale = Math.min(1, RECIPE_PICTURE_MAX_EDGE / Math.max(srcW, srcH))
          if (scale >= 1 && normalized.length < 280000) {
            finish(normalized)
            return
          }
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(srcW * scale))
          canvas.height = Math.max(1, Math.round(srcH * scale))
          const ctx = canvas.getContext("2d")
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          finish(canvas.toDataURL("image/jpeg", RECIPE_PICTURE_JPEG_QUALITY))
        } catch (e) {
          finish(normalized)
        }
      }
      img.onerror = function () {
        clearTimeout(timer)
        finish(normalized)
      }
      img.src = normalized
    })
  }

  function rememberRecipePicture(dataUrl) {
    const normalized = normalizePictureData(dataUrl)
    state.recipePicture = normalized
    const seq = ++pictureCompressSeq
    compactPictureForRecipe(normalized).then(function (compacted) {
      if (seq === pictureCompressSeq && compacted) state.recipePicture = compacted
    })
  }

  function setPicture(dataUrl, name) {
    const normalized = normalizePictureData(dataUrl)
    if (!normalized) return
    state.pic = normalized
    state.picName = cleanText(name || "그림", PICTURE_NAME_MAX)
    rememberRecipePicture(normalized)
    el.dropPreview.src = normalized
    el.dropPreview.hidden = false
    el.dropEmpty.style.display = "none"
    el.picThumb.src = normalized
    el.picChip.hidden = false
    if (el.drawingReferenceImg) el.drawingReferenceImg.src = normalized
    el.frameImg.src = normalized
    el.frameImg.style.display = "block"
    el.frameCanvas.style.display = "none"
    el.picStatus.textContent = state.picName + " 적용됨"
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
    const activeAudio = !!playing && !paused
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
    if (!playing && !paused && !engine.ambience) state.playingTakeId = null
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
    renderTakes()
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

  // 재생바 위치는 전체곡·배경음악이 공유하는 하나의 값이어야 한다(이 값이 '재생 시작 위치'다).
  // 배경음악 재생/일시정지로 재생바가 움직이면 여기에도 기록해, 화면 새로고침·복원 시 처음으로 튀지 않게 한다.
  function rememberPlayheadProgress(progress) {
    selectedPlayheadProgress = clampPlayheadProgress(progress)
    playheadElapsedMs = selectedPlayheadProgress * Math.max(1, state.duration * 1000)
  }

  function playheadProgressFromEvent(e) {
    return clampPlayheadProgress(timelineProgressFromClientX(e.clientX))
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
    const left = el.canvas.offsetLeft + timelineCssX(prog)
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

  // 지금 화면 재생바가 가리키는 위치(0..1). 전체곡(엔진) 재생 중이면 그 진행을, 아니면 멈춘 위치를 쓴다.
  function livePlayheadProgress() {
    if (engine.isPlaying && !engine.isPaused && playheadStartedAt) {
      const durMs = Math.max(1, state.duration * 1000)
      return Math.max(0, Math.min(1, (nowMs() - playheadStartedAt) / durMs))
    }
    return selectedPlayheadProgress
  }

  // 재생바 진행(0..1) → 배경음악 타임라인 시간(초). bgTick/bgPlayheadProgress와 같은 구간 환산을 쓴다.
  function bgTimeFromProgress(progress) {
    const end = selectedBgEnd()
    const segment = Math.max(0.1, end - state.bgOffset)
    return state.bgOffset + clampPlayheadProgress(progress) * segment
  }

  function soundDrawingProgress() {
    if (state.drawingInputMode !== DRAW_MODE_SOUND) return selectedPlayheadProgress
    // 전체곡 재생이 켜져 있으면 그 재생을 멈추지 않고(=이미 그려둔 선율을 계속 들으며) 엔진 플레이헤드를
    // 드로잉 시계로 쓴다. 펜 미리듣기는 본 재생과 독립 믹스라 새 음이 그 위에 얹혀 함께 들린다.
    // (예전엔 여기서 playBgPlayer()→engine.stop()이 불려, 펜을 대는 순간 기존 선율이 끊겼다.)
    if (engine.isPlaying && !engine.isPaused) return livePlayheadProgress()
    if (bgPlayer.paused) {
      // 배경음악(시계)이 멈춰 있으면 지금 재생바 위치를 이어받아 그 시점부터 띄운다.
      // (예전엔 무조건 bgOffset=0부터 시작해, 전체곡을 듣다가 그리면 첫 터치가 0초로 튀었다.)
      const resumeTime = bgTimeFromProgress(livePlayheadProgress())
      if (bgTimeInSelectedRange(resumeTime)) bgPausedAt = resumeTime
      playBgPlayer()
    }
    if (bgPlayer.paused) return selectedPlayheadProgress
    return bgPlayheadProgress(bgPlayer.currentTime)
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
    const pausedProgress = Math.max(0, Math.min(1, playheadElapsedMs / durMs))
    selectedPlayheadProgress = clampPlayheadProgress(pausedProgress)
    if (el.playhead) {
      el.playhead.hidden = false
      positionPlayhead(pausedProgress)
    }
  }
  // 재생 중 라이브 위치를 '재생 시작 위치'로 굳힌다. 이 뒤에 engine.stop()을 부르면
  // stopPlayhead()가 시작점(0초)이 아니라 이 위치를 읽어, 재생바가 제자리에 남는다.
  function freezePlayheadAtLivePosition() {
    if (!engine.isPlaying || engine.isPaused) return
    const durMs = Math.max(1, state.duration * 1000)
    if (playheadStartedAt) playheadElapsedMs = Math.max(0, Math.min(durMs, nowMs() - playheadStartedAt))
    rememberPlayheadProgress(playheadElapsedMs / durMs)
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
      // 소리모드에서 전체곡 재생 중 펜을 대면, 엔진 플레이헤드가 드로잉 시계가 된다(bgTick 대신).
      // 매 프레임 진행도를 기록해 새 획의 시간(x)을 전진시키고, 곡 끝에서 획을 마무리한다(루프 없음).
      const soundFlow = state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive
      if (prog < 1 && engine.isPlaying && !engine.isPaused) {
        if (soundFlow) draw.flowRecord(prog)
        playheadRAF = requestAnimationFrame(tick)
      } else {
        if (soundFlow) {
          draw.flowRecord(1)
          draw.finishFlowStroke(true)
        }
        stopPlayhead()
      }
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

  function ensureTimelineDuration(resetScroll) {
    if (isFinite(state.duration) && state.duration > 0) return false
    state.duration = DEFAULT_DURATION_SECONDS
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

  function bgTimeInSelectedRange(time) {
    const t = Number(time)
    if (!isFinite(t)) return false
    const end = selectedBgEnd()
    return t >= state.bgOffset && t < end - 0.02
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
    const durationChanged = ensureTimelineDuration(false)
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
    bgPausedAt = null
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

  function pauseBgPlayer(keepPosition) {
    const pausedAt = bgPlayer.currentTime
    try {
      bgPlayer.pause()
    } catch (e) {}
    if (bgRAF) cancelAnimationFrame(bgRAF)
    bgRAF = null
    if (keepPosition && bgTimeInSelectedRange(pausedAt)) {
      bgPausedAt = pausedAt
      rememberPlayheadProgress(bgPlayheadProgress(bgPausedAt)) // 멈춘 위치를 공유 값에 저장(화면 갱신·복원 대비)
      if (state.step === DRAWING_STEP) positionBgPlayhead(bgPausedAt, false)
    } else {
      bgPausedAt = null
      if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
      else if (el.playhead) el.playhead.hidden = true
    }
    syncBgPlayerUI()
  }

  function playBgPlayer() {
    if (!bgSrcFor(state.atmosphere)) return
    stopBackgroundPreview()
    stopExamplePreview()
    engine.stop() // 전체 재생과 겹치지 않게
    normalizeBgRange(true)
    const startAt = bgTimeInSelectedRange(bgPausedAt) ? bgPausedAt : state.bgOffset
    try {
      bgPlayer.currentTime = startAt
    } catch (e) {}
    bgPausedAt = null
    const p = bgPlayer.play()
    if (p && p.catch) p.catch((e) => console.warn("배경음악 재생 실패", e))
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
    let rel = bgPlayer.currentTime - state.bgOffset
    if (bgPlayer.currentTime >= end || bgPlayer.currentTime + 0.001 < state.bgOffset) {
      if (state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive) {
        draw.flowRecord(1)
        draw.finishFlowStroke(true)
      }
      try {
        bgPlayer.currentTime = state.bgOffset
      } catch (e) {}
      rel = 0
    }
    const progress = Math.max(0, Math.min(1, rel / segment))
    // 재생 중에는 공유 시작 위치를 갱신하지 않는다. (갱신하면 소리모드에서 시작 위치가 곡 끝으로 밀려
    //  전체곡 재생이 끝부터 시작 → 선율이 안 들림. 멈춘 위치 보존은 pauseBgPlayer가 담당.)
    positionPlayhead(progress)
    if (state.drawingInputMode === DRAW_MODE_SOUND && draw.flowActive) draw.flowRecord(progress)
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
    bgPausedAt = null
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
      bgPausedAt = null
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
      state.playingTakeId = null
      renderTakes()

      const message =
        e && (e.name || e.message)
          ? [e.name, e.message].filter(Boolean).join(": ")
          : String(e)

      el.statusText.textContent = "재생 오류"
      el.exportStatus.textContent = "재생 오류: " + message
      console.error("전체곡 재생 실패", e, {
        recipe: recipe,
        state: window.SoundDrawing && window.SoundDrawing.getStateSummary
          ? window.SoundDrawing.getStateSummary()
          : null,
      })
    })
  }

  function toggleTransport() {
    if (engine.isPaused && engine.isPlaying) {
      engine.resume()
      return
    }
    if (engine.isPaused) {
      engine.stop({ emitState: false })
    }
    if (engine.isPlaying) {
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

  // 정지(■)는 일시정지(❚❚)와 달리 재생바를 맨 앞(0초)으로 되돌린다.
  function resetPlayheadToStart() {
    if (!bgPlayer.paused) pauseBgPlayer() // 배경음악(시계)도 멈춰 바가 다시 흘러가지 않게
    bgPausedAt = null
    try {
      bgPlayer.currentTime = state.bgOffset
    } catch (e) {}
    selectedPlayheadProgress = 0
    playheadElapsedMs = 0
    if (!el.playhead) return
    if (state.step === DRAWING_STEP) showSelectedPlayhead(false)
    else el.playhead.hidden = true
  }

  function stop() {
    stopBackgroundPreview()
    stopExamplePreview()
    renderAtmospheres()
    state.playingTakeId = null
    engine.stop()
    resetPlayheadToStart() // 정지 버튼은 재생바를 맨 앞으로 되돌린다(이어듣기용 위치는 버린다)
    renderTakes()
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
    if (on) el.exportStatus.textContent = ERASER_TOOL_STATUS
  }

  function syncDrawingInputModeUI() {
    const soundMode = state.drawingInputMode === DRAW_MODE_SOUND
    el.body.dataset.drawInputMode = soundMode ? DRAW_MODE_SOUND : DRAW_MODE_PICTURE
    if (el.drawModePictureBtn) {
      el.drawModePictureBtn.classList.toggle("active", !soundMode)
      el.drawModePictureBtn.setAttribute("aria-pressed", soundMode ? "false" : "true")
    }
    if (el.drawModeSoundBtn) {
      el.drawModeSoundBtn.classList.toggle("active", soundMode)
      el.drawModeSoundBtn.setAttribute("aria-pressed", soundMode ? "true" : "false")
    }
  }

  function setDrawingInputMode(mode, announce) {
    const next = mode === DRAW_MODE_SOUND ? DRAW_MODE_SOUND : DRAW_MODE_PICTURE
    state.drawingInputMode = next
    draw.setFlowMode(next === DRAW_MODE_SOUND)
    if (next === DRAW_MODE_SOUND) {
      clearEffectStampSelection()
      setEraser(false)
      if (bgPlayer.paused) showSelectedPlayhead(false)
      if (announce) el.exportStatus.textContent = "소리모드: 배경 재생 버튼을 누른 뒤, 원하는 순간에 그리면 그 타이밍에 선율이 남아요."
    } else if (announce) {
      el.exportStatus.textContent = "그림모드: 캔버스의 가로 위치와 선 길이대로 선율이 만들어집니다."
    }
    syncDrawingInputModeUI()
  }

  function clearEffectStampSelection() {
    if (!state.effectStampId) return
    state.effectStampId = null
    renderEffects()
    renderEffectStamps()
  }

  function activatePenTool(announce) {
    clearEffectStampSelection()
    setEraser(false)
    if (announce) el.exportStatus.textContent = PEN_TOOL_STATUS
  }

  function activateEraserTool(announce) {
    setEraser(true)
    // 지우개로 바꿀 땐 재생은 멈추되 재생바는 제자리에 둔다(정지 버튼처럼 맨 앞으로 되돌리지 않음).
    freezePlayheadAtLivePosition()
    engine.stop()
    if (announce) el.exportStatus.textContent = ERASER_TOOL_STATUS
  }

  function isTypingTarget(target) {
    if (!target) return false
    const tag = (target.tagName || "").toLowerCase()
    return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable
  }

  function handleKeyboardShortcut(event) {
    if (!event || event.defaultPrevented || event.repeat) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (event.key === " " || event.code === "Space" || event.key === "Spacebar") {
      event.preventDefault()
      pulseControl(el.playBtn)
      toggleTransport()
      return
    }
    if (state.step !== DRAWING_STEP) return
    if (event.key === "1") {
      event.preventDefault()
      activatePenTool(true)
    } else if (event.key === "2") {
      event.preventDefault()
      activateEraserTool(true)
    }
  }

  function drawUndoDepth() {
    return draw && draw.undoStack ? draw.undoStack.length : 0
  }

  function drawUndoTop() {
    const stack = draw && draw.undoStack ? draw.undoStack : []
    return stack.length ? stack[stack.length - 1] : null
  }

  function syncTrackedDrawUndoDepth() {
    trackedDrawUndoDepth = drawUndoDepth()
    trackedDrawUndoTop = drawUndoTop()
  }

  function pushAppUndoAction(action) {
    if (!action) return
    appUndoStack.push(action)
    while (appUndoStack.length > APP_UNDO_MAX) appUndoStack.shift()
    syncUndoButton()
  }

  function recordDrawUndoAction() {
    const depth = drawUndoDepth()
    const top = drawUndoTop()
    if (suppressDrawUndoTracking) {
      trackedDrawUndoDepth = depth
      trackedDrawUndoTop = top
      return
    }
    if (depth > trackedDrawUndoDepth) {
      for (let i = trackedDrawUndoDepth; i < depth; i++) pushAppUndoAction({ type: "draw" })
    } else if (depth > 0 && depth === trackedDrawUndoDepth && top && top !== trackedDrawUndoTop) {
      pushAppUndoAction({ type: "draw" })
    }
    trackedDrawUndoDepth = depth
    trackedDrawUndoTop = top
  }

  function effectStampSnapshot() {
    return simplifyEffectStamps(state.effectStamps || [])
  }

  function pushEffectStampUndo() {
    pushAppUndoAction({ type: "effects", effectStamps: effectStampSnapshot() })
  }

  function restoreEffectStamps(snapshot) {
    state.effectStamps = simplifyEffectStamps(snapshot || [])
    renderEffectStamps()
    updateReadouts()
  }

  function refreshTimelineAfterLayout() {
    const run = function () {
      if (state.step !== DRAWING_STEP) return
      refreshTimeline(false)
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        requestAnimationFrame(run)
      })
    } else {
      setTimeout(run, 0)
    }
  }

  function clearAppUndoHistory() {
    appUndoStack.length = 0
    syncTrackedDrawUndoDepth()
    syncUndoButton()
  }

  function undoLastAction() {
    while (appUndoStack.length) {
      const action = appUndoStack.pop()
      if (action.type === "effects") {
        restoreEffectStamps(action.effectStamps)
        syncUndoButton()
        return "효과음"
      }
      if (action.type === "draw") {
        suppressDrawUndoTracking = true
        const restored = draw.undo()
        suppressDrawUndoTracking = false
        syncTrackedDrawUndoDepth()
        if (restored) {
          renderEffectStamps()
          syncUndoButton()
          return "드로잉"
        }
      }
    }
    if (draw.canUndo && draw.canUndo()) {
      suppressDrawUndoTracking = true
      const restored = draw.undo()
      suppressDrawUndoTracking = false
      syncTrackedDrawUndoDepth()
      if (restored) {
        renderEffectStamps()
        syncUndoButton()
        return "드로잉"
      }
    }
    syncUndoButton()
    return ""
  }

  function syncUndoButton() {
    if (!el.undoBtn || typeof draw.canUndo !== "function") return
    el.undoBtn.disabled = !(appUndoStack.length || draw.canUndo())
  }

  function resetCompose() {
    engine.stop()
    draw.finishFlowStroke(false)
    setEraser(false)
    draw.clear(false)
    draw.clearUndoHistory()
    draw.setActiveInstrument(state.instrument.id)
    state.effectIds = []
    state.effectStamps = []
    state.effectStampId = null
    clearAppUndoHistory()
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
    // 관리자 모드 버튼은 제거됨 — 상태만 body 데이터셋에 반영(공유 삭제 로직/디버그 API용).
    el.body.dataset.adminMode = state.adminMode ? "on" : "off"
  }

  function setAdminMode(on) {
    state.adminMode = !!on
    saveAdminMode(state.adminMode)
    syncAdminModeUI()
    renderTakes()
  }

  function playTake(t) {
    if (!t) return
    if (engine.isPlaying || engine.isPaused || engine.ambience) engine.stop()
    selectTake(t)
    state.playingTakeId = t.id
    play()
    renderTakes()
  }

  function toggleTakePause(t) {
    if (!t || state.playingTakeId !== t.id) return
    pause()
    renderTakes()
  }

  function renderTakeName(meta, take, index) {
    const row = document.createElement("div")
    row.className = "take-name-line"
    const num = document.createElement("span")
    num.className = "take-number"
    num.textContent = index + "번"
    row.appendChild(num)

    // 제목은 읽기 전용 텍스트로만 표시한다(시도별 제목 편집·저장 기능 제거).
    // 기본값 "무제"는 화면에서 "제목"으로 보여 준다.
    const rawTitle = take.name || (take.recipe && take.recipe.title) || ""
    const titleText = document.createElement("span")
    titleText.className = "take-name-text"
    titleText.textContent = rawTitle && rawTitle !== "무제" ? rawTitle : "제목"
    row.appendChild(titleText)

    meta.appendChild(row)
  }

  function renderTakes() {
    const items = state.sharedRecipeLoaded ? [] : takes.list()
    el.takesList.innerHTML = ""
    el.takesEmpty.style.display = items.length ? "none" : "block"
    el.takesEmpty.textContent = state.sharedRecipeLoaded
      ? "공유 링크로 불러온 곡입니다. 저장하면 내 시도에 추가됩니다."
      : "드로잉 후 “이 시도 저장”을 누르면 여기에 모입니다. 골라서 비교해 들어보세요."
    el.takesCount.textContent = items.length ? items.length + "개" : ""
    items.forEach((t, idx) => {
      const atmos = D.atmospheres.find((a) => a.id === t.recipe.atmosphere) || D.atmospheres[0]
      const wrap = document.createElement("div")
      wrap.className = "take" + (t.id === state.activeTakeId ? " active" : "")
      wrap.tabIndex = 0
      wrap.title = "이 시도 결과 보기"
      wrap.addEventListener("click", function () {
        selectTake(t)
      })
      wrap.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          selectTake(t)
        }
      })
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
      const isPlayingTake = state.playingTakeId === t.id && (engine.isPlaying || engine.isPaused || !!engine.ambience)
      const isPausedTake = isPlayingTake && engine.isPaused
      const playB = document.createElement("button")
      playB.type = "button"
      playB.className = "btn tiny primary take-play"
      playB.textContent = "▶"
      playB.title = "이 시도 처음부터 듣기"
      playB.setAttribute("aria-label", (t.name || "시도") + " 처음부터 듣기")
      playB.addEventListener("click", function (event) {
        event.stopPropagation()
        playTake(t)
      })
      const pauseB = document.createElement("button")
      pauseB.type = "button"
      pauseB.className = "btn tiny take-pause"
      pauseB.textContent = isPausedTake ? "▶" : "❚❚"
      pauseB.title = isPausedTake ? "이어 듣기" : "일시정지"
      pauseB.disabled = !isPlayingTake
      pauseB.setAttribute("aria-label", (t.name || "시도") + " " + (isPausedTake ? "이어 듣기" : "일시정지"))
      pauseB.addEventListener("click", function (event) {
        event.stopPropagation()
        if (!isPlayingTake) return
        toggleTakePause(t)
      })
      const delB = document.createElement("button")
      delB.type = "button"
      delB.className = "btn tiny"
      delB.textContent = "✕"
      delB.title = "삭제"
      delB.addEventListener("click", function (event) {
        event.stopPropagation()
        if (state.playingTakeId === t.id) {
          state.playingTakeId = null
          engine.stop()
        }
        takes.remove(t.id)
        if (state.activeTakeId === t.id) state.activeTakeId = null
        if (state.playingTakeId === t.id) state.playingTakeId = null
        renderTakes()
      })
      tools.appendChild(playB)
      tools.appendChild(pauseB)
      tools.appendChild(delB)

      // 시도별 저장·공유 버튼: 음악 저장 · 이미지 저장 · 레시피 링크 복사 · 채널에 공유하기
      const actions = document.createElement("div")
      actions.className = "take-actions"
      actions.appendChild(makeTakeActionButton("음악 저장", "이 시도의 음악을 WebM으로 저장", () => exportTakeAudio(t)))
      actions.appendChild(makeTakeActionButton("이미지 저장", "이 시도의 커버 이미지를 PNG로 저장", () => exportTakeImage(t)))
      actions.appendChild(makeTakeActionButton("레시피 링크 복사", "드로잉 화면에서 열리는 레시피 링크 복사", () => copyTakeRecipeLink(t)))
      actions.appendChild(makeTakeActionButton("채널에 공유하기", "채널 번호를 입력해 학급 채널에 공유", () => publishTake(t)))

      wrap.appendChild(cv)
      wrap.appendChild(meta)
      wrap.appendChild(tools)
      wrap.appendChild(actions)
      el.takesList.appendChild(wrap)
    })
  }

  function makeTakeActionButton(label, title, handler) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "btn tiny take-action"
    btn.textContent = label
    btn.title = title
    btn.addEventListener("click", function (event) {
      event.stopPropagation()
      handler()
    })
    return btn
  }

  // 시도별 액션: 먼저 그 시도의 레시피를 현재 상태로 불러온 뒤(selectTake) 기존 내보내기/공유 로직을 재사용한다.
  function exportTakeAudio(t) {
    selectTake(t)
    exportAudio()
  }

  function exportTakeImage(t) {
    selectTake(t)
    exportCover()
  }

  function copyTakeRecipeLink(t) {
    selectTake(t)
    shareLink()
  }

  function publishTake(t) {
    selectTake(t)
    if (!ShareStore) {
      el.exportStatus.textContent = "공유 모듈을 불러오지 못했어요."
      el.exportStatus.classList.add("error")
      return
    }
    const asked = typeof prompt === "function" ? prompt("공유할 채널 번호를 입력하세요. (예: 3021)", state.sharedChannel || "") : null
    if (asked === null) return // 취소
    const channel = ShareStore.normalizeChannel(asked)
    if (!channel) {
      el.exportStatus.textContent = "채널 번호를 다시 확인해 주세요."
      el.exportStatus.classList.add("error")
      return
    }
    el.exportStatus.classList.remove("error")
    publishSharedWork(channel)
  }

  function saveTake() {
    if (!requireDrawn()) return
    const take = takes.add(buildRecipe(), state.title)
    state.activeTakeId = take.id
    state.sharedRecipeLoaded = false
    renderTakes()
    el.exportStatus.textContent = "시도를 저장했어요. 아래에서 골라 비교해 들어보세요."
  }

  // 시도 카드 클릭 → 그 시도의 결과(제목·분위기·악기·해시태그·그린 음)를 완성 화면에 불러온다.
  function selectTake(t) {
    state.sharedRecipeLoaded = false
    state.activeTakeId = t.id
    const title = t.name || (t.recipe && t.recipe.title) || ""
    if (title) {
      state.title = title
      if (el.titleInput) el.titleInput.value = title
    }
    loadRecipe(t.recipe)
    renderTakes()
    el.exportStatus.textContent = "‘" + (title || "시도") + "’ 결과를 불러왔어요."
  }

  // --- 레시피 불러오기 ---

  function loadRecipe(recipe) {
    recipe = recipe || {}
    const loadedTitle = cleanText((recipe && recipe.title) || "", 24)
    if (loadedTitle) {
      state.title = loadedTitle
      if (el.titleInput) el.titleInput.value = loadedTitle
    }
    state.composerName = cleanText(recipe.composerName || recipe.composer || "", COMPOSER_NAME_MAX)
    const loadedPicture = normalizePictureData(recipe && recipe.picture)
    if (loadedPicture) setPicture(loadedPicture, recipe.pictureName || "불러온 그림")
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
    clearAppUndoHistory()
    renderEffectStamps()
    renderOrchestraLegend()
    setupBgPlayer(true)
    setSelectedPlayhead(0, false, false)
    syncReflectionInputs()
    updateReadouts()
  }

  // --- 학급 채널 공유 ---

  function sharedChannelInputSource(value) {
    return value == null ? state.sharedChannel : value
  }

  function normalizeSharedChannel(value) {
    return ShareStore ? ShareStore.normalizeChannel(value || "") : String(value || "")
  }

  function syncShareInputs(channel) {
    const normalized = normalizeSharedChannel(sharedChannelInputSource(channel))
    state.sharedChannel = normalized
    if (el.shareChannelInput && el.shareChannelInput.value !== normalized) el.shareChannelInput.value = normalized
    if (el.channelBrowseInput && el.channelBrowseInput.value !== normalized) el.channelBrowseInput.value = normalized
  }

  function channelPageUrl(channel, workId) {
    try {
      const url = new URL("./channel.html", location.href)
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

  function openChannelPage(channelArg, workId) {
    if (!ShareStore) {
      setShareMessage("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const channel = ShareStore.normalizeChannel(sharedChannelInputSource(channelArg) || "")
    if (!channel) {
      setShareMessage("공유 채널 번호를 적어 주세요.", true)
      return
    }
    syncShareInputs(channel)
    rememberAdminPin()
    window.location.href = channelPageUrl(channel, workId)
  }

  // 관리자 PIN을 채널 페이지로 이어 보낸다(URL 대신 sessionStorage — 기록·로그에 PIN이 남지 않게).
  const ADMIN_PIN_SESSION_KEY = "hwaeum.adminPin"
  function rememberAdminPin() {
    try {
      const s = window.sessionStorage
      if (!s) return
      const pin = adminPinValue()
      if (pin) s.setItem(ADMIN_PIN_SESSION_KEY, pin)
      else s.removeItem(ADMIN_PIN_SESSION_KEY)
    } catch (e) {}
  }

  function setShareMessage(text, error) {
    const target = state.step === SHARE_STEP && el.shareStatus ? el.shareStatus : el.exportStatus
    if (!target) return
    target.textContent = text
    target.classList.toggle("error", !!error)
  }

  function sharedMetadata() {
    const atmos = state.atmosphere || D.atmospheres[0]
    const inst = state.instrument || D.instruments[0]
    return {
      title: state.title || "무제",
      composerName: cleanText(state.composerName, COMPOSER_NAME_MAX),
      backgroundReason: cleanText(state.backgroundReason, 180),
      melodyIntent: cleanText(state.melodyIntent, 180),
      hashtags: normalizeHashtags(state.hashtags),
      atmosphereLabel: atmos.label,
      instrumentLabel: inst.label,
      duration: state.duration,
      coverHasEmbeddedPlay: false,
    }
  }

  function sharedWorkUrl(work) {
    if (work && work.shareUrl) return work.shareUrl
    return channelPageUrl((work && work.channel) || state.sharedChannel || "", work && work.id)
  }

  function updateShareUrl(channel, workId) {
    try {
      const url = new URL(location.href)
      if (channel) url.searchParams.set("shareChannel", channel)
      if (workId) url.hash = "work=" + encodeURIComponent(workId)
      else if (url.hash.indexOf("#work=") === 0) url.hash = ""
      history.replaceState(null, "", url.href)
    } catch (e) {}
  }

  async function copyText(text, doneMessage) {
    const copied = function () {
      setShareMessage(doneMessage || "링크를 복사했어요.", false)
    }
    const fallback = function () {
      if (copyViaSelection(text)) copied()
      else if (typeof prompt === "function") prompt("공유 링크", text)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        copied()
      } catch (e) {
        fallback()
      }
    } else {
      fallback()
    }
  }

  function workIsMine(work) {
    if (!ShareStore || !work) return false
    const owner = ShareStore.getOwner()
    return !!owner && !!owner.id && owner.id === work.ownerId
  }

  function adminPinValue() {
    return el.shareAdminPinInput ? el.shareAdminPinInput.value.trim() : ""
  }

  function formatSharedDate(value) {
    const d = new Date(value || "")
    if (!isFinite(d.getTime())) return ""
    return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  const sharedViewer = {
    root: null,
    cover: null,
    title: null,
    meta: null,
    background: null,
    melody: null,
    tags: null,
    audio: null,
    closeBtn: null,
    lastFocus: null,
  }

  function optionalViewerText(node, label, value) {
    if (!node) return
    const text = cleanText(value || "", 180)
    node.hidden = !text
    node.textContent = text ? label + ": " + text : ""
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
    eyebrow.textContent = "학급 채널 감상"
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

  function openSharedViewer(work) {
    if (!work) return
    const viewer = ensureSharedViewer()
    const meta = work.metadata || {}
    const files = work.files || {}
    const title = work.title || meta.title || "무제"
    const coverUrl = files.coverUrl || files.thumbUrl || DEFAULT_COVER_SRC
    viewer.lastFocus = document.activeElement
    viewer.cover.src = coverUrl
    viewer.cover.alt = title + " 표지"
    viewer.title.textContent = title
    viewer.meta.textContent = [
      meta.composerName ? "작곡가 " + meta.composerName : "",
      meta.atmosphereLabel,
      meta.instrumentLabel,
      secondsLabel(meta.duration || 30),
      formatSharedDate(work.createdAt),
    ]
      .filter(Boolean)
      .join(" · ")
    optionalViewerText(viewer.background, "배경", meta.backgroundReason)
    optionalViewerText(viewer.melody, "선율", meta.melodyIntent)
    if (meta.hashtags && meta.hashtags.length) {
      viewer.tags.hidden = false
      viewer.tags.textContent = meta.hashtags.map((tag) => (tag.charAt(0) === "#" ? tag : "#" + tag)).join(" ")
    } else {
      viewer.tags.hidden = true
      viewer.tags.textContent = ""
    }
    viewer.audio.src = files.musicUrl || ""
    viewer.audio.hidden = !files.musicUrl
    pauseSharedAudioExcept(viewer.audio)
    if (engine.isPlaying || engine.isPaused || engine.ambience) stop()
    viewer.root.hidden = false
    el.body.classList.add("shared-viewer-open")
    viewer.closeBtn.focus({ preventScroll: true })
    if (files.musicUrl) {
      const playResult = viewer.audio.play()
      if (playResult && typeof playResult.catch === "function") playResult.catch(function () {})
    }
  }

  function renderSharedWorks() {
    if (!el.sharedWorksList || !el.sharedEmpty) return
    el.sharedWorksList.innerHTML = ""
    const works = state.sharedWorks || []
    if (state.sharedLoading) {
      el.sharedEmpty.style.display = "block"
      el.sharedEmpty.textContent = "채널을 불러오는 중입니다."
      return
    }
    el.sharedEmpty.style.display = works.length ? "none" : "block"
    el.sharedEmpty.textContent = state.sharedChannel ? "아직 이 채널에 공유된 음악이 없습니다." : "채널 번호를 입력하고 열기를 누르면 공유된 음악이 여기에 모입니다."
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
      if (workIsMine(work) || adminReady) {
        const delB = document.createElement("button")
        delB.type = "button"
        delB.className = "btn tiny"
        delB.textContent = workIsMine(work) ? "삭제" : "관리자 삭제"
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

  async function loadSharedChannel(channel, options) {
    options = options || {}
    if (!ShareStore) {
      setShareMessage("공유 모듈을 불러오지 못했어요.", true)
      return
    }
    const normalized = ShareStore.normalizeChannel(sharedChannelInputSource(channel) || "")
    if (!normalized) {
      setShareMessage("공유 채널 번호를 적어 주세요.", true)
      return
    }
    syncShareInputs(normalized)
    state.sharedLoading = true
    renderSharedWorks()
    setShareMessage(normalized + " 채널을 불러오는 중입니다.", false)
    try {
      const result = await ShareStore.listChannel(normalized)
      state.sharedWorks = result.works || []
      setShareMessage(
        normalized + " 채널에 " + (result.localOnly ? "이 브라우저에 저장된 " : "공유된 ") + "음악 " + state.sharedWorks.length + "개를 불러왔어요.",
        false,
      )
      if (options.updateUrl !== false) updateShareUrl(normalized)
    } catch (e) {
      console.error(e)
      state.sharedWorks = []
      setShareMessage(e.message || "공유 채널을 불러오지 못했어요.", true)
    } finally {
      state.sharedLoading = false
      renderSharedWorks()
      if (options.focusWork) {
        const target = document.getElementById("work-" + options.focusWork)
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }

  async function publishSharedWork(channelArg) {
    if (!requireDrawn()) return
    if (!ShareStore) {
      el.exportStatus.textContent = "공유 모듈을 불러오지 못했어요."
      el.exportStatus.classList.add("error")
      return
    }
    const explicitChannel = typeof channelArg === "string" || typeof channelArg === "number" ? channelArg : null
    const channelSource = explicitChannel != null ? explicitChannel : el.shareChannelInput ? el.shareChannelInput.value : state.sharedChannel
    const channel = ShareStore.normalizeChannel(channelSource)
    if (!channel) {
      el.exportStatus.textContent = "공유 채널 번호를 적어 주세요."
      el.exportStatus.classList.add("error")
      return
    }
    syncShareInputs(channel)
    const recipe = buildRecipe()
    const metadata = sharedMetadata()
    const publishButton = el.publishShareBtn
    if (publishButton) publishButton.disabled = true
    try {
      el.exportStatus.classList.remove("error")
      el.exportStatus.textContent = "표지 이미지를 작게 압축하는 중입니다."
      const images = await ShareStore.createImageBlobs({
        pictureSrc: state.pic,
        defaultCoverSrc: DEFAULT_COVER_SRC,
        title: metadata.title,
        hashtags: hashtagText(metadata.hashtags),
        accent: state.atmosphere.color,
      })
      el.exportStatus.textContent = "최종 음악을 압축하는 중입니다. 노래 길이만큼 기다려 주세요."
      if (!engine.renderCompressedAudioBlob) throw new Error("압축 음악을 만들 수 없는 브라우저입니다.")
      const music = await engine.renderCompressedAudioBlob(recipe, notesFor(recipe), { audioBitsPerSecond: SHARE_AUDIO_BITS_PER_SECOND })
      el.exportStatus.textContent =
        "공유 서버에 올리는 중입니다. 음악 " + ShareStore.formatBytes(music.size) + ", 표지 " + ShareStore.formatBytes(images.cover.size) + "."
      const result = await ShareStore.publishWork({
        channel: channel,
        title: metadata.title,
        recipe: recipe,
        metadata: metadata,
        coverBlob: images.cover,
        thumbBlob: images.thumb,
        musicBlob: music,
      })
      const work = result.work
      el.exportStatus.textContent = result.localOnly ? channel + " 채널에 이 브라우저용으로 저장했어요." : channel + " 채널에 공유했어요."
      state.sharedChannel = channel
      window.location.href = channelPageUrl(channel, work && work.id)
    } catch (e) {
      console.error(e)
      el.exportStatus.textContent = e.message || "공유 업로드에 실패했어요."
      el.exportStatus.classList.add("error")
    } finally {
      if (publishButton) publishButton.disabled = false
    }
  }

  async function deleteSharedWork(work) {
    if (!ShareStore || !work) return
    const pin = adminPinValue()
    if (!workIsMine(work) && !pin) {
      setShareMessage("다른 사람의 작품은 관리자 PIN이 있어야 지울 수 있어요.", true)
      return
    }
    if (!window.confirm("이 공유 작품을 지울까요?")) return
    try {
      setShareMessage("공유 작품을 삭제하는 중입니다.", false)
      await ShareStore.deleteWork(work, pin)
      state.sharedWorks = state.sharedWorks.filter((item) => item.id !== work.id)
      renderSharedWorks()
      setShareMessage("공유 작품을 삭제했어요.", false)
    } catch (e) {
      console.error(e)
      setShareMessage(e.message || "공유 작품을 삭제하지 못했어요.", true)
    }
  }

  function restoreSharedChannelFromUrl() {
    if (!ShareStore) return false
    let params
    try {
      params = new URL(location.href).searchParams
    } catch (e) {
      return false
    }
    const channel = ShareStore.normalizeChannel(params.get("shareChannel") || params.get("channel") || "")
    if (!channel) return false
    const focus = (location.hash || "").indexOf("#work=") === 0 ? decodeURIComponent(location.hash.slice(6)) : ""
    syncShareInputs(channel)
    window.location.replace(channelPageUrl(channel, focus))
    return true
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
    const duration = Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS)
    const times = timelineLabelTimes()
    const fontSize = Math.max(18, Math.round(w * 0.013))
    ctx.save()
    ctx.font = "800 " + fontSize + "px 'Segoe UI', sans-serif"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    times.forEach((time) => {
      const text = secondsLabel(time)
      const metrics = ctx.measureText(text)
      const pillW = Math.max(48, metrics.width + 18)
      const pillH = fontSize + 14
      const x = Math.max(pillW / 2 + 8, Math.min(w - pillW / 2 - 8, snapshotTimelineX(w, time / duration)))
      const y = Math.max(pillH / 2 + 8, fontSize + 8)
      ctx.fillStyle = "rgba(251,246,236,0.92)"
      roundCanvasRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2)
      ctx.fill()
      ctx.strokeStyle = "rgba(31,38,38,0.12)"
      ctx.stroke()
      ctx.fillStyle = "rgba(31,38,38,0.72)"
      ctx.fillText(text, x, y)
    })
    ctx.restore()
  }

  function drawSnapshotStamps(ctx, w, h, images) {
    state.effectStamps.forEach((stamp) => {
      const effect = D.effects[stamp.id]
      if (!effect) return
      const size = Math.max(44, Math.min(76, Math.round(w * 0.04)))
      const x = Math.max(size / 2, Math.min(w - size / 2, snapshotTimelineX(w, stamp.x || 0)))
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
    const x = snapshotTimelineX(w, progress)
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

  function snapshotTimelineX(width, progress) {
    const labelWidth =
      draw && typeof draw._timelineLeft === "function" ? Math.min(Math.max(0, draw._timelineLeft()), Math.max(0, width - 1)) : 0
    return labelWidth + clampUnit(progress) * Math.max(1, width - labelWidth)
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
    const code = Core.encodeRecipe(buildSharedRecipe())
    const url = setShareHash(code)
    const copied = function () {
      el.exportStatus.textContent = "공유 링크를 복사했어요. 링크를 열면 드로잉 화면에서 시작합니다."
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
        state.sharedRecipeLoaded = true
        state.activeTakeId = null
        state.playingTakeId = null
        el.exportStatus.textContent = "공유 링크에서 불러왔습니다. 드로잉을 이어서 볼 수 있어요."
        return true
      } catch (e) {
        console.warn("공유 링크 복원 실패", e)
      }
    }
    return false
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
      draw.setFlowMode(state.drawingInputMode === DRAW_MODE_SOUND)
      syncDrawingInputModeUI()
      refreshTimeline(true)
      renderComposeInstruments()
      renderEffects()
      warmSelectedInstrument()
      setupBgPlayer()
      refreshTimelineAfterLayout()
    } else {
      draw.setFlowMode(false)
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
    if (state.step === SHARE_STEP) {
      syncShareInputs()
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

    if (el.drawingReferenceToggle) {
      el.drawingReferenceToggle.addEventListener("click", () => {
        setDrawingReferenceCollapsed(!state.drawingReferenceCollapsed)
      })
    }

    if (el.drawModePictureBtn) {
      el.drawModePictureBtn.addEventListener("click", () => {
        setDrawingInputMode(DRAW_MODE_PICTURE, true)
      })
    }
    if (el.drawModeSoundBtn) {
      el.drawModeSoundBtn.addEventListener("click", () => {
        setDrawingInputMode(DRAW_MODE_SOUND, true)
      })
    }

    if (el.penBtn) {
      el.penBtn.addEventListener("click", () => {
        activatePenTool(true)
      })
    }
    el.clearBtn.addEventListener("click", () => {
      if (draw.eraseMode) activatePenTool(true)
      else activateEraserTool(true)
    })
    document.addEventListener("keydown", handleKeyboardShortcut)
    if (el.undoBtn) {
      el.undoBtn.addEventListener("click", () => {
        const undone = undoLastAction()
        if (!undone) return
        el.exportStatus.textContent =
          undone === "효과음" ? "마지막 효과음 작업을 되돌렸어요." : "마지막 드로잉 작업을 되돌렸어요."
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

    if (el.saveTakeBtn) el.saveTakeBtn.addEventListener("click", saveTake)
    // 완성 탭의 일괄 내보내기/공유 버튼은 제거됨 — 이제 각 시도(테이크)별 버튼이 담당.
    // 아래 버튼들은 더 이상 마크업에 없을 수 있으므로 모두 존재 여부를 확인하고 바인딩한다.
    if (el.exportAudioBtn) el.exportAudioBtn.addEventListener("click", exportAudio)
    if (el.exportDrawingImageBtn) el.exportDrawingImageBtn.addEventListener("click", exportDrawingImage)
    if (el.exportDrawingVideoBtn) el.exportDrawingVideoBtn.addEventListener("click", exportDrawingVideo)
    if (el.exportCoverBtn) el.exportCoverBtn.addEventListener("click", exportCover)
    if (el.shareBtn) el.shareBtn.addEventListener("click", shareLink)
    if (el.publishShareBtn) el.publishShareBtn.addEventListener("click", publishSharedWork)
    if (el.openShareStepBtn) el.openShareStepBtn.addEventListener("click", () => setStep(SHARE_STEP))
    if (el.shareChannelInput) {
      el.shareChannelInput.addEventListener("input", () => syncShareInputs(el.shareChannelInput.value))
    }
    if (el.channelBrowseInput) {
      el.channelBrowseInput.addEventListener("input", () => syncShareInputs(el.channelBrowseInput.value))
    }
    if (el.channelOpenForm) {
      el.channelOpenForm.addEventListener("submit", function (event) {
        event.preventDefault()
        openChannelPage(el.channelBrowseInput ? el.channelBrowseInput.value : state.sharedChannel)
      })
    } else if (el.loadChannelBtn) {
      el.loadChannelBtn.addEventListener("click", () => openChannelPage(el.channelBrowseInput ? el.channelBrowseInput.value : state.sharedChannel))
    }
    if (el.shareAdminPinInput) {
      el.shareAdminPinInput.addEventListener("input", renderSharedWorks)
    }

    el.titleInput.addEventListener("input", () => {
      state.title = el.titleInput.value || "무제"
    })
    if (el.composerInput) {
      el.composerInput.addEventListener("input", () => {
        state.composerName = cleanText(el.composerInput.value, COMPOSER_NAME_MAX)
      })
    }
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
    syncDrawingReferenceToggle()
    syncDrawingInputModeUI()
    syncBgPlayerUI()
    refreshTimeline(true)
    ensureFramePlayButton()
    bind()
    syncAdminModeUI()
    syncTransportButtons(false, false)
    syncReflectionInputs()
    syncShareInputs()
    updateReadouts()
    syncUndoButton()
    const restoredRecipeLink = restoreFromHash()
    setStep(restoredRecipeLink ? DRAWING_STEP : 0)
    if (!restoredRecipeLink) restoreSharedChannelFromUrl()
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
        drawingInputMode: state.drawingInputMode,
        bgOffset: state.bgOffset,
        bgEndOffset: state.bgEndOffset,
        composerName: state.composerName,
        backgroundReason: state.backgroundReason,
        melodyIntent: state.melodyIntent,
        hashtags: normalizeHashtags(state.hashtags),
        step: state.step,
        noteCount: state.mode === "rhythm" ? draw.hits.length : draw.notes.length,
        hasPicture: !!state.pic,
        takes: takes.list().length,
        sharedRecipeLoaded: state.sharedRecipeLoaded,
        adminMode: state.adminMode,
        sharedChannel: state.sharedChannel,
        sharedWorks: state.sharedWorks.length,
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
    publishSharedWork: publishSharedWork,
    loadSharedChannel: loadSharedChannel,
    exportDrawingImage: exportDrawingImage,
    exportDrawingVideo: exportDrawingVideo,
    shareLink: shareLink,
    loadRecipe: loadRecipe,
    buildRecipe: buildRecipe,
    buildSharedRecipe: buildSharedRecipe,
    setStep: setStep,
    setDrawingInputMode: function (mode) {
      setDrawingInputMode(mode, false)
    },
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
