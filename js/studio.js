/*
 * studio.js — 위저드 오케스트레이션
 * 상태 관리, 카드 렌더, 단계 이동, 그림 업로드, 무드 틴팅, 재생, 시도 저장, 내보내기, 공유 링크.
 */
;(function () {
  "use strict"

  // === § 1  모듈 전역 · 상수 ===

  const Core = window.MusicCore
  const D = window.SDStudioData
  const ShareStore = window.HwaeumShareStore || null
  const StudioUtils = window.HwaeumStudioUtils

  const engine = new window.AudioEngine()
  const takes = new window.TakesStore("sda.takes")
  const SEGMENT_SECONDS = 2.5
  const TIMELINE_PIXELS_PER_SECOND = 96
  const TIMELINE_LABEL_GUTTER_PX = 56
  const DEFAULT_DURATION_SECONDS = 30
  const MIN_DURATION_SECONDS = 1
  const DEFAULT_COVER_SRC = "./assets/default-cover.webp"
  const ADMIN_STORAGE_KEY = "sda.adminMode"
  const STUDIO_COPY_STORAGE_PREFIX = "hwaeum.studioCopy."
  const STUDIO_COPY_MAX_AGE_MS = 60 * 60 * 1000
  const TAKE_NAME_MAX = 24
  const COMPOSER_NAME_MAX = 24
  const PICTURE_NAME_MAX = 80
  const RECIPE_PICTURE_MAX_EDGE = 960
  const RECIPE_PICTURE_JPEG_QUALITY = 0.82
  const SOUND_STEP = 1
  const DRAWING_STEP = 2
  const COMPLETE_STEP = 3
  const SHARE_STEP = 4
  const SHARE_AUDIO_BITS_PER_SECOND = 64000
  const DEFAULT_ATMOSPHERE_ID = "none"
  const DEFAULT_STYLE_ID = "bright" // 기본 음계 = C장조(서양 악기는 파(F)도 난다)
  const GUGAK_STYLE_ID = "gugak" // 국악기만 5음(펜타토닉)+시김새 — 파(F)·시(B) 없음
  const CUSTOM_BG_MAX_BYTES = 50 * 1024 * 1024
  const PIXABAY_MUSIC_URL = "https://pixabay.com/music/"
  const INSTRUMENT_GROUPS = ["서양", "국악"]
  const DEFAULT_INSTRUMENT_FAMILY = "그 밖의 악기"
  const STUDENT_MUSIC_GROUP = "내가 찾은 음악"
  const ATMOSPHERE_GROUP_ORDER = ["배경 없음", "분위기", "소리풍경", "리듬장단", STUDENT_MUSIC_GROUP]
  const PEN_TOOL_STATUS = "펜을 선택했어요."
  const ERASER_TOOL_STATUS = "지우개를 선택했어요."
  const DRAW_MODE_PICTURE = "picture"
  const DRAW_MODE_SOUND = "sound"
  const APP_UNDO_MAX = 30
  const CUSTOM_BG_COPYRIGHT_NOTICE =
    "저작권 안내: 다른 사람이 만든 음악은 허락 없이 사용할 수 없어요. 직접 만든 음원이나 사용 허락을 받은 음원만 올려 주세요."

  // === § 2  앱 상태 헬퍼 & 초기 상태 ===

  function defaultStyle() {
    return D.styles.find((s) => s.id === DEFAULT_STYLE_ID) || D.styles[0]
  }

  function defaultAtmosphere() {
    return D.atmospheres.find((a) => a.id === DEFAULT_ATMOSPHERE_ID) || D.atmospheres[0]
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

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}))
  }

  function takeStudioCopyPayload(token) {
    if (!window.localStorage || !token) throw new Error("복사본을 찾지 못했어요.")
    const key = STUDIO_COPY_STORAGE_PREFIX + token
    const raw = window.localStorage.getItem(key)
    if (!raw) throw new Error("복사본을 찾지 못했어요.")
    window.localStorage.removeItem(key)
    const payload = JSON.parse(raw)
    const createdAt = Number(payload && payload.createdAt)
    if (createdAt && Date.now() - createdAt > STUDIO_COPY_MAX_AGE_MS) throw new Error("복사본 시간이 지나 다시 열어야 해요.")
    return payload || {}
  }

  function studioCopyRecipe(recipe) {
    const copy = cloneJson(recipe)
    const atmosphere = D.atmospheres.find((a) => a.id === copy.atmosphere)
    if (!atmosphere || atmosphere.custom || String(copy.atmosphere || "").indexOf("custom-") === 0) {
      copy.atmosphere = defaultAtmosphere().id
      copy.bgOffset = 0
      copy.bgEndOffset = 0
    }
    return copy
  }

  const state = {
    duration: DEFAULT_DURATION_SECONDS,
    atmosphere: defaultAtmosphere(),
    instrument: D.instruments[0],
    style: styleForInstrument(D.instruments[0]),
    version: defaultVersion(),
    mode: "melody",
    pic: null,
    picName: "",
    recipePicture: "",
    title: "무제",
    composerName: "",
    actionCount: 0,
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

  // === § 3  오디오 프리뷰 객체 ===
  // 배경 미리듣기 — Web Audio 합주 엔진과 독립된 단순 재생기
  const bgPreview = new Audio()
  bgPreview.preload = "none"
  let customBgSeq = 0

  // 악기 연주곡 감상 — 배경 미리듣기와 동일한 독립 재생기(한 번에 하나만)
  const examplePreview = new Audio()
  examplePreview.preload = "none"
  examplePreview.addEventListener("ended", () => {
    state.examplePreviewId = null
    renderInstruments()
  })

  const AUDIO_MODE_CREDIT = "국악 음원 출처: 국립국악원 디지털음원 (공공누리 제1유형·출처표시)"

  // === § 4  DOM 요소 참조 ===

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
    drawingSaveTakeBtn: $("drawingSaveTakeBtn"),
    drawingSaveNewTakeBtn: $("drawingSaveNewTakeBtn"),
    scaleReadout: $("scaleReadout"),
    rhythmReadout: $("rhythmReadout"),
    noteReadout: $("noteReadout"),
    durReadout: $("durReadout"),
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
    hashtagChipBox: $("hashtagChipBox"),
    hashtagHelp: $("hashtagHelp"),
    publishModal: $("publishModal"),
    publishModalForm: $("publishModalForm"),
    publishChannelInput: $("publishChannelInput"),
    publishPassInput: $("publishPassInput"),
    publishModalError: $("publishModalError"),
    publishModalCloseBtn: $("publishModalCloseBtn"),
    publishModalCancelBtn: $("publishModalCancelBtn"),
    publishModalSubmitBtn: $("publishModalSubmitBtn"),
    saveTakeBtn: $("saveTakeBtn"),
    publishShareBtn: $("publishShareBtn"),
    channelOpenForm: $("channelOpenForm"),
    channelBrowseInput: $("channelBrowseInput"),
    channelBrowsePassInput: $("channelBrowsePassInput"),
    loadChannelBtn: $("loadChannelBtn"),
    shareAdminPinInput: $("shareAdminPinInput"),
    claimChannelInput: $("claimChannelInput"),
    shareDisplayNameInput: $("shareDisplayNameInput"),
    shareChannelPassInput: $("shareChannelPassInput"),
    claimChannelBtn: $("claimChannelBtn"),
    openClaimedChannelBtn: $("openClaimedChannelBtn"),
    shareStatus: $("shareStatus"),
    exportStatus: $("exportStatus"),
    takesList: $("takesList"),
    takesCount: $("takesCount"),
    takesEmpty: $("takesEmpty"),
    audioModeNote: $("audioModeNote"),
  }

  // === § 5  악기 색 · Undo 변수 ===
  // 악기별 줄 색 — 오케스트라에서 어떤 줄이 어떤 악기인지 색으로 구분
  const INSTRUMENT_COLORS = {
    violin: "#c85f4d", viola: "#b8793f", cello: "#8f6046", doubleBass: "#5f5040",
    flute: "#2f9c95", oboe: "#788f4a", clarinet: "#5f6f9f", frenchHorn: "#c49732",
    sogeum: "#4b98a1", daegeum: "#2f8f86", danso: "#73986c", piri: "#b5614b",
    gayageum: "#9a7138", haegeum: "#985b76",
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

  // DrawingCanvas와 설정 렌더러가 transport보다 먼저 만들어지므로 호출 시점에 위임한다.
  let studioTransport = null
  function soundDrawingProgress() {
    return studioTransport ? studioTransport.soundDrawingProgress() : 0
  }
  function syncBgPlayerUI() {
    if (studioTransport) return studioTransport.syncBgPlayerUI()
  }

  // === § 6  DrawingCanvas 생성 ===

  const draw = new window.DrawingCanvas(el.canvas, {
    activeInstrument: state.instrument.id,
    instrumentColor: colorForInstrument,
    melodyAssetForInstrument: (id) => D.melodies[id] || null,
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
      if (!((engine.isPlaying || engine.isStarting) && !engine.isPaused)) {
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
      if (!engine.isPlaying && !engine.isStarting) {
        el.statusText.textContent = "전체 듣기"
        el.statusText.classList.remove("playing")
        el.body.dataset.livePreview = "idle"
      }
    },
    onFlowStart: () => {
      if (state.drawingInputMode !== DRAW_MODE_SOUND) return
      el.exportStatus.textContent = "음악에 맞춰 그리기 중입니다. 손을 떼면 들은 타이밍대로 악보에 남아요."
    },
    onFlowEnd: () => {
      if (state.drawingInputMode !== DRAW_MODE_SOUND) return
      el.exportStatus.textContent = "음악에 맞춰 그린 선율을 악보에 남겼어요."
    },
    accent: state.atmosphere.color,
  })

  // === § 7  Pure Utilities ===

  function hexToRgba(hex, alpha) {
    return StudioUtils.hexToRgba(hex, alpha)
  }

  function applyMoodTint() {
    const c = state.atmosphere.color
    document.documentElement.style.setProperty("--accent", c)
    document.documentElement.style.setProperty("--accent-soft", hexToRgba(c, 0.1))
    document.documentElement.style.setProperty("--accent-line", hexToRgba(c, 0.36))
    draw.setAccent(c)
  }

  function round3(v) {
    return StudioUtils.round3(v)
  }

  function normalizeDuration(value) {
    return StudioUtils.normalizeDuration(value, { min: MIN_DURATION_SECONDS, fallback: DEFAULT_DURATION_SECONDS })
  }

  function secondsLabel(value) {
    return StudioUtils.secondsLabel(value)
  }

  function clampNumber(value, min, max) {
    return StudioUtils.clampNumber(value, min, max)
  }

  function clampUnit(value) {
    return StudioUtils.clampUnit(value)
  }

  function normalizeActionCount(value) {
    const n = Math.floor(Number(value) || 0)
    return Math.max(0, n)
  }

  function actionCountLabel(value) {
    return normalizeActionCount(value) + "회"
  }

  function recordUserAction(options) {
    if (state.step !== DRAWING_STEP) return
    state.actionCount = normalizeActionCount(state.actionCount) + 1
    if (!options || options.update !== false) updateReadouts()
  }

  function cleanText(value, max) {
    return StudioUtils.cleanText(value, max)
  }

  function normalizePictureData(value) {
    return StudioUtils.normalizePictureData(value)
  }

  function normalizeHashtags(value) {
    return StudioUtils.normalizeHashtags(value)
  }

  function hashtagText(value) {
    return StudioUtils.hashtagText(value)
  }

  function keywordText(value) {
    return StudioUtils.keywordText ? StudioUtils.keywordText(value) : normalizeHashtags(value).join(" ")
  }

  // === § 7b  내보내기 워크플로 (studio-export.js 초기화) ===

  const _studioExport = window.HwaeumStudioExport({
    state,
    el,
    D,
    draw,
    engine,
    StudioUtils,
    timelineLabelTimes,
    getDuration: () => Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS),
    buildRecipe,
    notesFor,
    requireDrawn,
    drawProceduralFrameFallback,
    defaultCoverSrc: DEFAULT_COVER_SRC,
    hashtagText,
  })
  const {
    renderDrawingSnapshotCanvas,
    canvasToBlob,
    exportAudio,
    exportCover,
    exportDrawingImage,
    exportDrawingVideo,
  } = _studioExport

  // === § 7c  분위기·악기 렌더 Helpers (studio-setup-render.js 초기화) ===

  const _studioSetupRender = window.HwaeumStudioSetupRender({
    state,
    el,
    D,
    engine,
    draw,
    bgPreview,
    examplePreview,
    DEFAULT_DURATION_SECONDS,
    DEFAULT_INSTRUMENT_FAMILY,
    INSTRUMENT_GROUPS,
    STUDENT_MUSIC_GROUP,
    ATMOSPHERE_GROUP_ORDER,
    PIXABAY_MUSIC_URL,
    CUSTOM_BG_COPYRIGHT_NOTICE,
    CUSTOM_BG_MAX_BYTES,
    styleForInstrument,
    setEraser,
    renderEffects,
    renderEffectStamps,
    recordUserAction,
    renderOrchestraLegend,
    renderPitchAxisLabels,
    updateReadouts,
    warmSelectedInstrument,
    applyMoodTint,
    syncBgPlayerUI,
    buildRecipe,
    defaultAtmosphere,
    applyInstrumentTone,
    getNextCustomBgId: () => "custom-" + ++customBgSeq,
  })
  const {
    bgSrcFor,
    backgroundFor,
    stopBackgroundPreview,
    stopExamplePreview,
    renderAtmospheres,
    addCustomBackground,
    renderInstrumentGroups,
    renderInstruments,
    renderComposeInstruments: renderComposeInstrumentsFromSetup,
  } = _studioSetupRender

  // === § 7d  재생·시간 상태 (studio-transport.js 초기화) ===

  studioTransport = window.HwaeumStudioTransport({
    root: window,
    document,
    state,
    el,
    engine,
    draw,
    DRAW_MODE_SOUND,
    DRAWING_STEP,
    MIN_DURATION_SECONDS,
    DEFAULT_DURATION_SECONDS,
    canvasWrap,
    timelineProgressFromClientX,
    timelineCssX,
    syncCanvasScrollState,
    bgSrcFor,
    canSelectBgRange,
    normalizeDuration,
    clampNumber,
    refreshTimeline,
    updateReadouts,
    stopBackgroundPreview,
    stopExamplePreview,
    renderAtmospheres,
    buildRecipe,
    notesFor,
    renderTakes,
    getStateSummary: () =>
      window.SoundDrawing && window.SoundDrawing.getStateSummary ? window.SoundDrawing.getStateSummary() : null,
  })
  const {
    pulseControl,
    syncTransportButtons,
    finishSoundFlowAtCurrentPoint,
    freezePlayheadAtLivePosition,
    bindPlayheadSeeking,
    showSelectedPlayhead,
    setSelectedPlayhead,
    setupBgPlayer,
    pauseBgPlayer,
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
  } = studioTransport

  // === § 8  타임라인 지오메트리 & 스크롤 동기화 ===

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
    const actionText = collapsed ? "펴기" : "접기"
    const label = "그림 " + actionText
    const icon = el.drawingReferenceToggle.querySelector(".drawing-reference-icon")
    const text = el.drawingReferenceToggle.querySelector(".drawing-reference-toggle-text")
    if (icon) icon.classList.toggle("is-expand", collapsed)
    if (text) text.textContent = actionText
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
    return StudioUtils.simplifyPoints(points, maxPoints)
  }

  function simplifyPath(path) {
    return StudioUtils.simplifyPath(path)
  }

  function simplifyStrokes(strokes) {
    return StudioUtils.simplifyStrokes(strokes)
  }

  function simplifyEffectStamps(stamps) {
    return StudioUtils.simplifyEffectStamps(stamps, D.effects)
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

  // === § 9  Recipe 빌드 ===

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
      actionCount: normalizeActionCount(state.actionCount),
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
        if (!buffer) console.warn("악기 샘플을 불러오지 못해 합성음으로 대체합니다.")
      })
      .catch(function (e) {
        console.warn("악기 샘플 준비 실패", e)
      })
  }

  function syncAudioModeNote() {
    if (!el.audioModeNote) return
    el.audioModeNote.textContent = AUDIO_MODE_CREDIT
    el.audioModeNote.hidden = state.step !== SOUND_STEP
  }

  function instrumentParticle(label) {
    const code = label.charCodeAt(label.length - 1)
    if (code < 0xac00 || code > 0xd7a3) return label + "로"
    return label + ((code - 0xac00) % 28 === 0 ? "로" : "으로")
  }

  // === § 10  분위기 카드 렌더링 ===

  function canSelectBgRange() {
    const bg = backgroundFor(state.atmosphere)
    return !!(bg && bg.src)
  }

  // === § 12  Orchestra / Version / Compose ===

  function renderComposeInstruments() {
    return renderComposeInstrumentsFromSetup()
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
    tag.textContent = "악기 줄 · 선택 악기"
    el.orchestraLegend.appendChild(tag)
    if (!order.length) {
      const hint = document.createElement("span")
      hint.className = "orchestra-empty"
      hint.textContent = "줄을 그리면 여기에 쌓여요 (최대 4개)"
      el.orchestraLegend.appendChild(hint)
    } else {
      order.forEach((id) => {
        const inst = D.instruments.find((i) => i.id === id)
        const instLabel = inst ? inst.label : id
        const chip = document.createElement("span")
        chip.className = "orchestra-chip"
        applyInstrumentTone(chip, id)
        const dot = document.createElement("span")
        dot.className = "orchestra-dot"
        dot.style.background = colorForInstrument(id)
        chip.appendChild(dot)
        const text = document.createElement("span")
        text.textContent = instLabel + (counts[id] > 1 ? " ×" + counts[id] : "")
        chip.appendChild(text)
        const removeBtn = document.createElement("button")
        removeBtn.type = "button"
        removeBtn.className = "orchestra-chip-remove"
        removeBtn.setAttribute("aria-label", instLabel + " 줄 모두 지우기")
        removeBtn.title = instLabel + " 줄 모두 지우기"
        removeBtn.textContent = "×"
        removeBtn.addEventListener("click", () => {
          draw.clearInstrument(id)
          el.exportStatus.textContent = instLabel + " 줄을 모두 지웠어요. 되돌리기(Ctrl+Z)로 복구할 수 있어요."
        })
        chip.appendChild(removeBtn)
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
    ctext.appendChild(document.createTextNode("그릴 악기 "))
    const currentName = document.createElement("strong")
    currentName.textContent = state.instrument.label
    ctext.appendChild(currentName)
    current.appendChild(ctext)
    el.orchestraLegend.appendChild(current)
  }

  // === § 13  이펙트 스탬프 ===

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
        recordUserAction({ update: false })
        state.effectStampId = state.effectStampId === id ? null : id
        if (state.effectStampId) setEraser(false)
        if (state.effectStampId && engine.warmEffect) {
          engine.warmEffect(Object.assign({ id: id }, effect)).catch(function (err) {
            console.warn("효과음 도장 준비 실패", err)
          })
        }
        if (state.effectStampId && engine.previewEffect) {
          engine.previewEffect(Object.assign({ id: id }, effect)).catch(function (err) {
            console.warn("효과음 버튼 미리듣기 실패", err)
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

  // === § 14  팔레트 & 피치 축 레이블 ===

  function renderPaletteLabels() {
    const duration = Math.max(MIN_DURATION_SECONDS, state.duration || DEFAULT_DURATION_SECONDS)
    const times = timelineLabelTimes()
    el.paletteLabels.innerHTML = ""
    times.forEach((time, index) => {
      const d = document.createElement("div")
      d.className = "palette-label" + (index === times.length - 1 ? " palette-label-end" : "")
      d.style.left = Math.round(timelineCssX(time / duration)) + "px"
      const label = document.createElement("span")
      label.textContent = secondsLabel(time)
      d.appendChild(label)
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
    const axisRect =
      el.pitchLabels && typeof el.pitchLabels.getBoundingClientRect === "function"
        ? el.pitchLabels.getBoundingClientRect()
        : null
    const axisHeight = Math.round(el.pitchLabels.clientHeight || el.canvas.clientHeight || (axisRect && axisRect.height) || 0)
    const axisY = function (percent) {
      if (!(axisHeight > 0)) return null
      return Math.round(((Number(percent) || 0) / 100) * axisHeight)
    }
    rows.forEach((row) => {
      if (row.rowTop == null || row.rowHeight == null) return
      const d = document.createElement("span")
      d.className = "pitch-label-row" + (row.selected ? " selected" : "") + (!row.label ? " silent" : "")
      if (row.color) d.style.setProperty("--pitch-color", row.color)
      if (row.softColor) d.style.setProperty("--pitch-soft", row.softColor)
      const rowTop = axisY(row.rowTop)
      const rowBottom = axisY(row.rowBottom != null ? row.rowBottom : row.rowTop + row.rowHeight)
      if (rowTop != null && rowBottom != null) {
        d.style.top = rowTop + "px"
        d.style.height = Math.max(1, rowBottom - rowTop) + "px"
      } else {
        d.style.top = row.rowTop + "%"
        d.style.height = row.rowHeight + "%"
      }
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
      if (label.color) d.style.setProperty("--pitch-color", label.color)
      const labelTop = axisY(label.top)
      d.style.top = labelTop != null ? labelTop + "px" : label.top + "%"
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
    if (!engine.isPlaying && isBackgroundPaused()) showSelectedPlayhead(false)
    updateReadouts()
  }

  // === § 15  읽기 표시 (updateReadouts) ===

  function updateReadouts() {
    el.scaleReadout.textContent = state.instrument.label
    el.rhythmReadout.textContent = draw.getStrokes().length ? draw.getStrokes().length + "개 선" : "그린 선"
    el.durReadout.textContent = secondsLabel(state.duration)
    el.noteReadout.textContent = actionCountLabel(state.actionCount)
    const tags = hashtagText(state.hashtags)
    el.placardMeta.textContent = tags
    el.placardMeta.classList.toggle("is-empty", !tags)
    if (el.placardDetail) {
      // 제목과 설명 단어 사이: 고른 분위기 + 사용한 악기 이름
      const parts = []
      if (state.atmosphere && state.atmosphere.label) parts.push(state.atmosphere.label)
      const instruments = usedInstrumentLabels()
      if (instruments) parts.push(instruments)
      const detail = parts.join(" · ")
      el.placardDetail.textContent = detail
      el.placardDetail.classList.toggle("is-empty", !detail)
    }
  }

  function instrumentLabelById(id) {
    const inst = D.instruments.find((i) => i.id === id)
    return inst ? inst.label : id
  }

  function joinedInstrumentLabels(ids) {
    return (ids || [])
      .map(instrumentLabelById)
      .filter(Boolean)
      .join(", ")
  }

  function usedInstrumentIdsForRecipe(recipe) {
    const source = recipe || {}
    const fallbackId = source.instrument || (state.instrument && state.instrument.id) || (D.instruments[0] && D.instruments[0].id)
    const ids = []

    const add = function (id) {
      const realId = id || fallbackId
      if (ids.indexOf(realId) === -1) ids.push(realId)
    }

    const strokes = Array.isArray(source.strokes) ? source.strokes : []
    const strokeInsts = Array.isArray(source.strokeInstruments) ? source.strokeInstruments : []
    if (strokes.length) {
      strokes.forEach((stroke, index) => {
        if (Array.isArray(stroke) && stroke.length) add(strokeInsts[index])
      })
    } else {
      strokeInsts.forEach(add)
    }

    if (!ids.length) add(fallbackId)
    return ids
  }

  function usedInstrumentLabelsForRecipe(recipe) {
    return joinedInstrumentLabels(usedInstrumentIdsForRecipe(recipe))
  }

  // 곡에 실제로 쓰인 악기 이름(중복 제거). 그린 줄이 없으면 현재 선택 악기.
  function usedInstrumentLabels() {
    const recipe = {
      instrument: state.instrument.id,
      strokes: typeof draw.getStrokes === "function" ? draw.getStrokes() : [],
      strokeInstruments: typeof draw.getStrokeInstruments === "function" ? draw.getStrokeInstruments() : [],
    }
    return usedInstrumentLabelsForRecipe(recipe)
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
    if (el.hashtagsInput) {
      el.hashtagsInput.value = ""
      renderHashtagChips()
    }
  }

  // === § 15.5  설명 단어(해시태그 칩) ===
  // state.hashtags는 "따뜻함, 감정적인 노래"처럼 쉼표로 구분된 문자열.
  // 입력칸에 쉼표·엔터를 누르면 그 자리에서 #단어 칩이 된다.

  const HASHTAG_MAX = 3
  const HASHTAG_HELP_DEFAULT = "단어를 입력하고 엔터를 누르면 #태그로 분리됩니다. (최대 3개)"
  const HASHTAG_HELP_FULL = "태그는 3개까지예요. 지우려면 태그를 눌러 주세요."

  function hashtagList() {
    return normalizeHashtags(state.hashtags)
  }

  function setHashtags(tags) {
    state.hashtags = normalizeHashtags(tags).join(", ")
    renderHashtagChips()
    updateReadouts()
  }

  function renderHashtagChips() {
    if (!el.hashtagChipBox || !el.hashtagsInput) return
    el.hashtagChipBox.querySelectorAll(".hashtag-chip").forEach((chip) => chip.remove())
    const tags = hashtagList()
    tags.forEach((tag) => {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "hashtag-chip"
      chip.title = "누르면 지워요"
      chip.setAttribute("aria-label", "#" + tag + " 지우기")
      const text = document.createElement("span")
      text.textContent = "#" + tag
      const x = document.createElement("span")
      x.className = "hashtag-chip-x"
      x.setAttribute("aria-hidden", "true")
      x.textContent = "×"
      chip.appendChild(text)
      chip.appendChild(x)
      chip.addEventListener("click", () => {
        setHashtags(hashtagList().filter((item) => item !== tag))
        if (el.hashtagHelp) el.hashtagHelp.textContent = HASHTAG_HELP_DEFAULT
        el.hashtagsInput.focus()
      })
      el.hashtagChipBox.insertBefore(chip, el.hashtagsInput)
    })
    el.hashtagsInput.placeholder = tags.length ? "" : "따뜻함, 감정적인 노래"
    if (el.hashtagHelp && tags.length < HASHTAG_MAX) el.hashtagHelp.textContent = HASHTAG_HELP_DEFAULT
  }

  // 입력 중인 단어를 칩으로 확정한다. 저장·공유 직전에도 호출해 잃어버리지 않게.
  function commitHashtagInput() {
    if (!el.hashtagsInput) return
    const raw = el.hashtagsInput.value
    if (!raw.trim()) {
      el.hashtagsInput.value = ""
      return
    }
    const current = hashtagList()
    if (current.length >= HASHTAG_MAX) {
      if (el.hashtagHelp) el.hashtagHelp.textContent = HASHTAG_HELP_FULL
      return
    }
    el.hashtagsInput.value = ""
    setHashtags(current.join(",") + "," + raw)
  }

  // === § 16  그림 업로드 & 커버 프레임 ===

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

  // === § 17~20  Transport는 studio-transport.js가 소유 ===

  function requireDrawn() {
    if (draw.getPath().length >= 1) return true
    el.statusText.textContent = "먼저 선을 그려주세요"
    el.exportStatus.textContent = "먼저 캔버스에 점을 찍거나 선을 그려주세요."
    return false
  }

  // === § 21  드로잉 모드 & 키보드 단축키 ===

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
      if (soundMode) el.drawModePictureBtn.removeAttribute("aria-current")
      else el.drawModePictureBtn.setAttribute("aria-current", "true")
    }
    if (el.drawModeSoundBtn) {
      el.drawModeSoundBtn.classList.toggle("active", soundMode)
      el.drawModeSoundBtn.setAttribute("aria-pressed", soundMode ? "true" : "false")
      if (soundMode) el.drawModeSoundBtn.setAttribute("aria-current", "true")
      else el.drawModeSoundBtn.removeAttribute("aria-current")
    }
  }

  function setDrawingInputMode(mode, announce) {
    const next = mode === DRAW_MODE_SOUND ? DRAW_MODE_SOUND : DRAW_MODE_PICTURE
    if (announce) recordUserAction()
    const bgWasPaused = isBackgroundPaused()
    state.drawingInputMode = next
    draw.setFlowMode(next === DRAW_MODE_SOUND)
    if (next === DRAW_MODE_SOUND) {
      clearEffectStampSelection()
      setEraser(false)
      if (bgWasPaused && !isBackgroundPaused()) pauseBgPlayer(true)
      if (isBackgroundPaused()) showSelectedPlayhead(false)
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
    if (announce) recordUserAction()
    clearEffectStampSelection()
    setEraser(false)
    if (announce) el.exportStatus.textContent = PEN_TOOL_STATUS
  }

  function activateEraserTool(announce) {
    if (announce) recordUserAction()
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
    } else if (event.key === "3") {
      event.preventDefault()
      announceUndoLastAction()
    } else if (event.key === "4") {
      event.preventDefault()
      resetCompose()
    }
  }

  // === § 22  드로잉 Undo & 앱 수준 Undo 스택 ===

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
    recordUserAction({ update: false })
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
        recordUserAction()
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
          recordUserAction()
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
        recordUserAction()
        return "드로잉"
      }
    }
    syncUndoButton()
    return ""
  }

  function announceUndoLastAction() {
    const undone = undoLastAction()
    if (!undone) return
    el.exportStatus.textContent =
      undone === "효과음" ? "마지막 효과음 작업을 되돌렸어요." : "마지막 드로잉 작업을 되돌렸어요."
  }

  function syncUndoButton() {
    if (!el.undoBtn || typeof draw.canUndo !== "function") return
    el.undoBtn.disabled = !(appUndoStack.length || draw.canUndo())
  }

  function resetCompose() {
    recordUserAction({ update: false })
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
    el.statusText.textContent = "전체 듣기"
    el.exportStatus.textContent = "드로잉만 초기화했습니다. 배경음악 구간은 그대로 유지됩니다."
  }

  // === § 23  시도 (Takes) ===
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

  function takeDisplayTitle(take) {
    const rawTitle = (take && (take.name || (take.recipe && take.recipe.title))) || ""
    return rawTitle && rawTitle !== "무제" ? rawTitle : "제목"
  }

  function takePictureSrc(take) {
    const recipe = (take && take.recipe) || {}
    return normalizePictureData(recipe.picture) || DEFAULT_COVER_SRC
  }

  function renderTakes() {
    const items = state.sharedRecipeLoaded ? [] : takes.list()
    el.takesList.innerHTML = ""
    el.takesEmpty.style.display = items.length ? "none" : "block"
    el.takesEmpty.textContent = state.sharedRecipeLoaded
      ? "공유 링크로 불러온 곡입니다. 저장하면 내 작품에 추가됩니다."
      : "드로잉 후 저장하면 여기에 모입니다. 같은 작품은 저장할 때마다 다시 덮어씁니다."
    el.takesCount.textContent = items.length ? items.length + "개" : ""
    items.forEach((t, idx) => {
      const atmos = D.atmospheres.find((a) => a.id === t.recipe.atmosphere) || defaultAtmosphere()
      const wrap = document.createElement("div")
      wrap.className = "take" + (t.id === state.activeTakeId ? " active" : "")
      wrap.tabIndex = 0
      wrap.title = "이 작품 정보 보기"
      wrap.addEventListener("click", function () {
        selectTake(t)
      })
      wrap.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          selectTake(t)
        }
      })
      const cover = document.createElement("div")
      cover.className = "take-cover"
      const coverImg = document.createElement("img")
      coverImg.className = "take-cover-img"
      coverImg.alt = takeDisplayTitle(t) + " 그림"
      coverImg.src = takePictureSrc(t)
      coverImg.addEventListener("error", function () {
        if (coverImg.src !== DEFAULT_COVER_SRC) coverImg.src = DEFAULT_COVER_SRC
      })
      cover.appendChild(coverImg)
      const cv = document.createElement("canvas")
      cv.width = 160
      cv.height = 100
      cv.className = "take-thumb"
      window.TakesStore.renderThumbnail(cv, t.recipe, atmos.color)
      cover.appendChild(cv)
      const meta = document.createElement("div")
      meta.className = "take-meta"
      renderTakeName(meta, t, idx + 1)
      const detail = document.createElement("span")
      detail.className = "take-detail"
      detail.textContent = atmos.label + " · " + usedInstrumentLabelsForRecipe(t.recipe) + " · " + secondsLabel(t.recipe.duration)
      meta.appendChild(detail)
      if (t.recipe && t.recipe.composerName) {
        const composer = document.createElement("span")
        composer.className = "take-composer"
        composer.textContent = "작곡가 " + cleanText(t.recipe.composerName, COMPOSER_NAME_MAX)
        meta.appendChild(composer)
      }
      const tags = normalizeHashtags(t.recipe && t.recipe.hashtags)
      if (tags.length) {
        const tagLine = document.createElement("span")
        tagLine.className = "take-tags"
        tagLine.textContent = hashtagText(tags)
        meta.appendChild(tagLine)
      }
      const tools = document.createElement("div")
      tools.className = "take-tools"
      const isPlayingTake = state.playingTakeId === t.id && (engine.isPlaying || engine.isPaused || !!engine.ambience)
      const isPausedTake = isPlayingTake && engine.isPaused
      const playB = document.createElement("button")
      playB.type = "button"
      playB.className = "btn tiny primary take-play"
      playB.textContent = "▶"
      playB.title = "이 작품 처음부터 듣기"
      playB.setAttribute("aria-label", (t.name || "작품") + " 처음부터 듣기")
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
      pauseB.setAttribute("aria-label", (t.name || "작품") + " " + (isPausedTake ? "이어 듣기" : "일시정지"))
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

      const actions = document.createElement("div")
      actions.className = "take-actions"
      actions.appendChild(makeTakeActionButton("음악 저장", "이 작품의 음악을 WebM으로 저장", () => exportTakeAudio(t)))
      actions.appendChild(makeTakeActionButton("이미지 저장", "이 작품의 커버 이미지를 PNG로 저장", () => exportTakeImage(t)))
      actions.appendChild(makeTakeActionButton("수정", "이 작품을 3단계에서 수정", () => editTake(t)))

      wrap.appendChild(cover)
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

  function editTake(t) {
    selectTake(t)
    setStep(DRAWING_STEP)
    if (el.statusText) el.statusText.textContent = "작품 수정"
  }

  function publishCurrentTake() {
    const saved = saveTake()
    if (!saved) return
    publishTake(saved)
  }

  function publishTake(t) {
    selectTake(t)
    const missing = []
    if (!el.titleInput?.value.trim()) missing.push({ field: el.titleInput, label: "제목" })
    if (!el.composerInput?.value.trim()) missing.push({ field: el.composerInput, label: "작곡가" })
    if (!el.bgReasonInput?.value.trim()) missing.push({ field: el.bgReasonInput, label: "배경음악을 고른 이유" })
    if (!el.melodyIntentInput?.value.trim()) missing.push({ field: el.melodyIntentInput, label: "선율을 표현한 의도" })
    if (!hashtagList().length) missing.push({ field: el.hashtagsInput, label: "작품을 잘 나타내는 단어" })
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

  // === § 23.5  공유 모달 (번호 + 갤러리 코드 동시 입력) ===

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
    const focusTarget = !channel ? el.publishChannelInput : !el.publishPassInput.value ? el.publishPassInput : el.publishModalSubmitBtn || el.publishPassInput
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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && el.publishModal && !el.publishModal.hidden) {
        event.preventDefault()
        closePublishModal()
      }
    })
  }

  function saveTake() {
    return saveTakeWithMode(false)
  }

  function saveNewTake() {
    return saveTakeWithMode(true)
  }

  function saveTakeWithMode(forceNew) {
    if (!requireDrawn()) return
    commitHashtagInput() // 아직 칩이 안 된 단어도 잃지 않게
    const recipe = buildRecipe()
    const name = state.title
    let take = null
    if (!forceNew && !state.sharedRecipeLoaded && state.activeTakeId && typeof takes.update === "function") {
      take = takes.update(state.activeTakeId, recipe, name)
    }
    const updated = !!take
    if (!take) take = takes.add(recipe, name)
    state.activeTakeId = take.id
    state.sharedRecipeLoaded = false
    renderTakes()
    const message = updated ? "현재 작품을 다시 저장했어요." : forceNew ? "새 작품으로 저장했어요." : "내 작품에 저장했어요."
    if (state.step === DRAWING_STEP && el.statusText) el.statusText.textContent = updated ? "다시 저장했어요" : "저장했어요"
    el.exportStatus.textContent = message
    return take
  }

  // 시도 카드 클릭 → 그 시도의 결과(제목·분위기·악기·설명 단어·그린 음)를 완성 화면에 불러온다.
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
    el.exportStatus.textContent = "‘" + (title || "작품") + "’ 정보를 불러왔어요."
  }

  // === § 24  레시피 불러오기 ===

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
    state.actionCount = normalizeActionCount(recipe.actionCount)
    state.atmosphere = D.atmospheres.find((a) => a.id === recipe.atmosphere) || defaultAtmosphere()
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
    state.hashtags = Array.isArray(recipe.hashtags) ? keywordText(recipe.hashtags) : recipe.hashtags || ""
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
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

  // === § 25  공유 & 화음 갤러리 ===

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

  const CHANNEL_ENTRY_PASS_SESSION_KEY = "hwaeum.channelEntryPass"
  function rememberChannelEntryPass(channel, pass) {
    const normalized = normalizeSharedChannel(channel)
    const pin = ShareStore && ShareStore.cleanPin ? ShareStore.cleanPin(pass) : String(pass || "").replace(/\D/g, "").slice(0, 6)
    try {
      const s = window.sessionStorage
      if (!s || !normalized) return pin
      if (pin) s.setItem(CHANNEL_ENTRY_PASS_SESSION_KEY, JSON.stringify({ channel: normalized, pass: pin }))
      else s.removeItem(CHANNEL_ENTRY_PASS_SESSION_KEY)
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
    const pass = passArg != null ? ShareStore.cleanPin(passArg) : ShareStore.cleanPin(el.channelBrowsePassInput ? el.channelBrowsePassInput.value : "")
    if (!pass) {
      setShareMessage("갤러리 코드를 넣어 주세요.", true)
      return
    }
    syncShareInputs(channel)
    rememberChannelEntryPass(channel, pass)
    rememberAdminPin()
    window.location.href = channelPageUrl(channel, workId)
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

  // 관리자 번호(8624)로 화음 갤러리를 만들거나, 내가 점유한 갤러리 이름·코드를 고친다.
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
      setShareMessage("화음 갤러리를 만들려면 관리자 번호(8624)를 넣어 주세요.", true)
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
      const result = await ShareStore.claimChannel({ channel: channel, pin: pin, displayName: displayName, adminPin: adminPin })
      if (ShareStore.rememberPass) ShareStore.rememberPass(channel, pin)
      syncShareInputs(channel)
      showOpenClaimedChannelButton(channel)
      const name = (result.channel && result.channel.displayName) || displayName
      setShareMessage(
        (result.claimed === false ? "#" + channel + " 갤러리 설정을 저장했어요." : "#" + channel + " 갤러리를 만들었어요.") +
          (name ? " 갤러리 이름: " + name + "." : "") +
          (result.localOnly ? " (이 브라우저에만 저장됨)" : ""),
        false,
      )
    } catch (e) {
      console.error(e)
      setShareMessage(e.message || "화음 갤러리를 만들지 못했어요.", true)
    } finally {
      if (el.claimChannelBtn) el.claimChannelBtn.disabled = false
    }
  }

  // 관리자 번호를 화음 갤러리 페이지로 이어 보낸다(URL 대신 sessionStorage — 기록·로그에 번호가 남지 않게).
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

  function sharedMetadata(recipe) {
    const atmos = state.atmosphere || defaultAtmosphere()
    const instrumentLabel = recipe ? usedInstrumentLabelsForRecipe(recipe) : usedInstrumentLabels()
    return {
      title: state.title || "무제",
      composerName: cleanText(state.composerName, COMPOSER_NAME_MAX),
      backgroundReason: cleanText(state.backgroundReason, 180),
      melodyIntent: cleanText(state.melodyIntent, 180),
      hashtags: normalizeHashtags(state.hashtags),
      atmosphereLabel: atmos.label,
      instrumentLabel: instrumentLabel,
      duration: state.duration,
      actionCount: normalizeActionCount(recipe && recipe.actionCount),
      coverHasEmbeddedPlay: false,
    }
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
      const result = await ShareStore.listChannel(normalized, ShareStore.loadPass ? ShareStore.loadPass(normalized) : "")
      state.sharedWorks = result.works || []
      setShareMessage(
        "#" + normalized + " 갤러리에 " + (result.localOnly ? "이 브라우저에 저장된 " : "공유된 ") + "음악 " + state.sharedWorks.length + "개를 불러왔어요.",
        false,
      )
      if (options.updateUrl !== false) updateShareUrl(normalized)
    } catch (e) {
      console.error(e)
      state.sharedWorks = []
      setShareMessage(e.message || "화음 갤러리를 불러오지 못했어요.", true)
    } finally {
      state.sharedLoading = false
    }
  }

  async function publishSharedWork(channelArg, passArg) {
    if (!requireDrawn()) return
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
    const pass = passArg != null ? ShareStore.cleanPin(passArg) : ShareStore.loadPass ? ShareStore.loadPass(channel) : ""
    syncShareInputs(channel)
    const recipe = buildRecipe()
    const metadata = sharedMetadata(recipe)
    const publishButton = el.publishShareBtn
    if (publishButton) publishButton.disabled = true

    const progressEl = document.getElementById("publishProgress")
    const progressFill = document.getElementById("publishProgressFill")
    function setProgress(ratio) {
      if (!progressEl || !progressFill) return
      progressEl.hidden = false
      progressFill.style.width = Math.round(Math.min(1, ratio) * 100) + "%"
    }

    document.body.classList.add("is-publishing")
    try {
      el.exportStatus.classList.remove("error")
      el.exportStatus.textContent = "표지 이미지를 작게 압축하는 중입니다."
      setProgress(0.05)
      const images = await ShareStore.createImageBlobs({
        pictureSrc: state.pic,
        defaultCoverSrc: DEFAULT_COVER_SRC,
        title: metadata.title,
        composerName: metadata.composerName,
        hashtags: keywordText(metadata.hashtags),
        accent: state.atmosphere.color,
      })
      el.exportStatus.textContent = "드로잉 이미지를 작게 압축하는 중입니다."
      setProgress(0.08)
      const drawing = await canvasToBlob(await renderDrawingSnapshotCanvas(), "image/webp", 0.62)
      el.exportStatus.textContent = "음악을 압축하는 중입니다. 완료될 때까지 기다려 주세요."
      setProgress(0.1)
      if (!engine.renderCompressedAudioBlob) throw new Error("압축 음악을 만들 수 없는 브라우저입니다.")
      const music = await engine.renderCompressedAudioBlob(recipe, notesFor(recipe), {
        audioBitsPerSecond: SHARE_AUDIO_BITS_PER_SECOND,
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
      el.exportStatus.textContent = result.localOnly ? "#" + channel + " 갤러리에 이 브라우저용으로 저장했어요." : "#" + channel + " 갤러리에 공유했어요."
      state.sharedChannel = channel
      window.location.href = channelPageUrl(channel, work && work.id)
    } catch (e) {
      console.error(e)
      el.exportStatus.textContent = e.message || "공유 업로드에 실패했어요."
      el.exportStatus.classList.add("error")
      if (progressEl) progressEl.hidden = true
    } finally {
      document.body.classList.remove("is-publishing")
      if (publishButton) publishButton.disabled = false
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

  // === § 26  공유 링크 ===

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
    if (h.indexOf("#copy=") === 0) {
      try {
        const payload = takeStudioCopyPayload(decodeURIComponent(h.slice(6)))
        loadRecipe(studioCopyRecipe(payload.recipe))
        state.sharedRecipeLoaded = true
        state.activeTakeId = null
        state.playingTakeId = null
        el.exportStatus.textContent = "갤러리 작품을 스튜디오에서 열었어요. 바꿔도 원래 작품은 그대로예요."
        return true
      } catch (e) {
        console.warn("스튜디오 복사본 복원 실패", e)
      }
    }
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

  // === § 27  단계 이동 ===

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
    syncAudioModeNote()
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
      setupBgPlayer(true)
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

  // === § 28  이벤트 바인딩 ===

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
      el.undoBtn.addEventListener("click", announceUndoLastAction)
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
    if (el.saveTakeBtn) el.saveTakeBtn.addEventListener("click", saveTake)
    if (el.drawingSaveTakeBtn) el.drawingSaveTakeBtn.addEventListener("click", saveTake)
    if (el.drawingSaveNewTakeBtn) el.drawingSaveNewTakeBtn.addEventListener("click", saveNewTake)
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
      el.loadChannelBtn.addEventListener("click", () => openChannelPage(el.channelBrowseInput ? el.channelBrowseInput.value : state.sharedChannel))
    }
    if (el.claimChannelBtn) {
      el.claimChannelBtn.addEventListener("click", claimChannelFromForm)
    }
    if (el.openClaimedChannelBtn) {
      el.openClaimedChannelBtn.addEventListener("click", () => openChannelPage(el.openClaimedChannelBtn.dataset.channel || "", "", el.shareChannelPassInput ? el.shareChannelPassInput.value : ""))
    }
    const claimedChannelInputs = [el.shareAdminPinInput, el.claimChannelInput, el.shareDisplayNameInput, el.shareChannelPassInput]
    claimedChannelInputs.forEach(function (input) {
      if (input) input.addEventListener("input", hideOpenClaimedChannelButton)
    })

    el.titleInput.addEventListener("input", () => {
      el.titleInput.classList.remove("field-invalid")
      state.title = el.titleInput.value || "무제"
    })
    if (el.composerInput) {
      el.composerInput.addEventListener("input", () => {
        el.composerInput.classList.remove("field-invalid")
        state.composerName = cleanText(el.composerInput.value, COMPOSER_NAME_MAX)
      })
    }
    if (el.bgReasonInput) {
      el.bgReasonInput.addEventListener("input", () => {
        el.bgReasonInput.classList.remove("field-invalid")
        state.backgroundReason = el.bgReasonInput.value
      })
    }
    if (el.melodyIntentInput) {
      el.melodyIntentInput.addEventListener("input", () => {
        el.melodyIntentInput.classList.remove("field-invalid")
        state.melodyIntent = el.melodyIntentInput.value
      })
    }
    if (el.hashtagsInput) {
      el.hashtagsInput.addEventListener("keydown", (event) => {
        if (event.isComposing) return
        if (event.key === "," || event.key === "Enter") {
          event.preventDefault()
          commitHashtagInput()
        } else if (event.key === "Backspace" && !el.hashtagsInput.value) {
          const tags = hashtagList()
          if (tags.length) {
            event.preventDefault()
            setHashtags(tags.slice(0, -1))
          }
        }
      })
      el.hashtagsInput.addEventListener("input", () => {
        el.hashtagsInput.classList.remove("field-invalid")
        if (el.hashtagsInput.value.indexOf(",") !== -1) commitHashtagInput()
      })
      el.hashtagsInput.addEventListener("blur", commitHashtagInput)
    }
    if (el.hashtagChipBox && el.hashtagsInput) {
      el.hashtagChipBox.addEventListener("click", (event) => {
        if (event.target === el.hashtagChipBox) el.hashtagsInput.focus()
      })
    }
    bindPublishModal()
    window.addEventListener("resize", () => {
      if (state.step !== DRAWING_STEP) return
      refreshTimeline(false)
    })
  }

  // === § 29  초기화 ===

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
    prefillBrowsePass()
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
        actionCount: normalizeActionCount(state.actionCount),
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
    resume: resume,
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
