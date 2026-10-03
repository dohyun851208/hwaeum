/*
 * studio.js — 위저드 오케스트레이션
 * 상태 관리, 단계 이동, 그림 업로드, 무드 틴팅, 하위 워크플로 연결.
 */
;(function () {
  "use strict"

  // === § 1  모듈 전역 · 상수 ===

  const Core = window.MusicCore
  const D = window.SDStudioData
  const ShareStore = window.HwaeumShareStore || null
  const StudioUtils = window.HwaeumStudioUtils
  const recipeModel = window.HwaeumStudioRecipe({ core: Core, data: D, audioPlan: window.SDAudioPlan, utils: StudioUtils })

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
  const SOUND_LAYER_MAX_BYTES = 50 * 1024 * 1024
  const SOUND_LAYER_MAX_COUNT = 3
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
    copy.soundLayers = [] // 업로드 원본은 다른 탭/브라우저로 복사할 수 없다.
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
    soundLayers: [], // 사용자가 올린 긴 소리 최대 3개 — 원본 구간과 작품 안 시작 초를 따로 저장
    drawingInputMode: DRAW_MODE_PICTURE,
    bgPreviewId: null, // 현재 미리듣기 중인 배경 id
    examplePreviewId: null, // 현재 감상 재생 중인 악기 id
    instrumentNotes: {}, // 2단계 악기별 감상 메모 — 이번 화면에서만 유지(고른 악기 것만 4단계로 옮겨짐)
    instrumentAnswerShown: {}, // 예시 답안을 펼쳐 본 악기 id
    backgroundNotes: {}, // 2단계 배경별 감상 메모 — 이번 화면에서만 유지(고른 배경 것만 4단계로 옮겨짐)
    // 4단계에서 학생이 직접 손댄 칸. 한 번 손대면 2단계 메모가 그 칸을 덮지 않는다.
    reflectionEdited: {},
    pictureThought: "", // 1단계 그림 감상 — 4단계 칸과 같은 값을 공유하고 작품에 저장된다
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

  // 서양 연주곡 3개는 CC BY / CC BY-SA 녹음이라 연주곡을 듣는 2단계에 출처를 함께 적는다
  // (곡명·주소·라이선스 전문 링크는 sound/감상-연주곡(서양악기)/라이센스.txt).
  const AUDIO_MODE_CREDIT =
    "국악 음원 출처: 국립국악원 디지털음원 (공공누리 제1유형·출처표시) · 서양 연주곡(발췌·음량 조절): 플루트 Kristina Martincová (CC BY-SA 3.0), 바이올린 Howard Geisel·FreqMan (CC BY 4.0), 더블베이스 Răzvan Popescu·Radio România (CC BY-SA 4.0)"

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
    playheadStartBtn: $("playheadStartBtn"),
    drawingSaveTakeBtn: $("drawingSaveTakeBtn"),
    drawingSaveNewTakeBtn: $("drawingSaveNewTakeBtn"),
    scaleReadout: $("scaleReadout"),
    rhythmReadout: $("rhythmReadout"),
    noteReadout: $("noteReadout"),
    durReadout: $("durReadout"),
    composeInstrumentList: $("composeInstrumentList"),
    orchestraLegend: $("orchestraLegend"),
    effectList: $("effectList"),
    soundLayerInput: $("soundLayerInput"),
    soundLayerAddBtn: $("soundLayerAddBtn"),
    soundLayerList: $("soundLayerList"),
    soundLayerCount: $("soundLayerCount"),
    soundLayerStatus: $("soundLayerStatus"),
    frame: $("frame"),
    frameImg: $("frameImg"),
    frameCanvas: $("frameCanvas"),
    titleInput: $("titleInput"),
    composerInput: $("composerInput"),
    placardMeta: $("placardMeta"),
    placardDetail: $("placardDetail"),
    pictureThoughtInput: $("pictureThoughtInput"),
    pictureThoughtCompletionInput: $("pictureThoughtCompletionInput"),
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
  const reflectionUI = window.HwaeumStudioReflection({ state, el, document, utils: StudioUtils, composerNameMax: COMPOSER_NAME_MAX, updateReadouts })
  const { syncReflectionFromNotes, syncReflectionInputs, commitHashtagInput, renderHashtagChips, hashtagList } = reflectionUI

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
  let soundLayerUI = null
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
      if (soundLayerUI) soundLayerUI.stopPreview()
      // 전체곡 재생 중에도 펜 소리는 들린다(미리듣기는 본 재생과 독립 믹스). 다만 "재생 중" 표시는 그대로 둔다.
      if (!((engine.isPlaying || engine.isStarting) && !engine.isPaused)) {
        el.statusText.textContent = state.instrument.label + " 드로잉 중"
        el.statusText.classList.add("playing")
        el.body.dataset.livePreview = "drawing"
      }
      engine.liveDrawingStart(buildPreviewRecipe(), point.y).catch(function (e) {
        console.warn("드로잉 라이브 시작 실패", e)
      })
    },
    onPreview: (point) => {
      engine.liveDrawingMove(buildPreviewRecipe(), point.y).catch(function (e) {
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

  // 배경 구간 길이는 항상 마디(2.5초) 단위로 떨어지게 한다 — 도화지 마디선·시간 라벨이
  // 2.5초마다 찍히므로, 배수가 아니면 마지막에 토막 마디가 생기고 라벨이 겹친다.
  function snapDurationToSegments(value, maxSeconds) {
    return StudioUtils.snapDurationToSegments(value, SEGMENT_SECONDS, maxSeconds)
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
    syncReflectionFromNotes,
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

  // === § 7d  시도 저장·목록 UI (studio-takes-ui.js 초기화) ===

  const _studioTakesUI = window.HwaeumStudioTakesUI({
    root: window,
    document,
    state,
    el,
    D,
    engine,
    takes,
    StudioUtils,
    defaultCoverSrc: DEFAULT_COVER_SRC,
    composerNameMax: COMPOSER_NAME_MAX,
    drawingStep: DRAWING_STEP,
    defaultAtmosphere,
    renderThumbnail: window.TakesStore.renderThumbnail,
    usedInstrumentLabelsForRecipe,
    requireDrawn,
    commitHashtagInput,
    buildRecipe,
    loadRecipe,
    exportAudio,
    exportCover,
    setStep,
    play: () => studioTransport.play(),
    pause: () => studioTransport.pause(),
  })
  const { renderTakes, saveTake, saveNewTake, selectTake } = _studioTakesUI

  // === § 7e  공유·화음 갤러리 (studio-share.js 초기화) ===

  const _studioShare = window.HwaeumStudioShare({
    root: window,
    document,
    state,
    el,
    ShareStore,
    StudioUtils,
    Core,
    engine,
    shareStep: SHARE_STEP,
    composerNameMax: COMPOSER_NAME_MAX,
    defaultCoverSrc: DEFAULT_COVER_SRC,
    shareAudioBitsPerSecond: SHARE_AUDIO_BITS_PER_SECOND,
    saveTake,
    selectTake,
    hashtagList,
    defaultAtmosphere,
    usedInstrumentLabelsForRecipe,
    usedInstrumentLabels,
    normalizeActionCount,
    requireDrawn,
    buildRecipe,
    buildSharedRecipe,
    notesFor,
    canvasToBlob,
    renderDrawingSnapshotCanvas,
  })
  const {
    bindShareControls,
    syncShareInputs,
    prefillBrowsePass,
    publishSharedWork,
    loadSharedChannel,
    restoreSharedChannelFromUrl,
    shareLink,
  } = _studioShare

  // === § 7f  재생·시간 상태 (studio-transport.js 초기화) ===

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
    SEGMENT_SECONDS,
    snapDurationToSegments,
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
    stopSoundLayerPreview: () => {
      if (soundLayerUI) soundLayerUI.stopPreview()
    },
    getStateSummary: () =>
      window.SoundDrawing && window.SoundDrawing.getStateSummary ? window.SoundDrawing.getStateSummary() : null,
    onDurationChange: () => {
      if (soundLayerUI) soundLayerUI.handleDurationChange()
    },
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
    movePlayheadToStart,
  } = studioTransport

  soundLayerUI = window.HwaeumStudioSoundLayers({
    root: window,
    document,
    state,
    el,
    engine,
    maxLayers: SOUND_LAYER_MAX_COUNT,
    maxBytes: SOUND_LAYER_MAX_BYTES,
    copyrightNotice: CUSTOM_BG_COPYRIGHT_NOTICE,
    getProjectDuration: () => state.duration,
    beforePreview: () => {
      stopBackgroundPreview()
      stopExamplePreview()
      pauseBgPlayer()
      engine.stop()
    },
    beforeEdit: () => {
      if (engine.isPlaying || engine.isPaused || engine.ambience) {
        pauseBgPlayer()
        engine.stop()
      }
    },
    onChange: () => recordUserAction(),
  })

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

  // 저장/공유용 다운샘플 — 선율은 음 경계를 보존하고 썸네일만 균등 인덱스로 솎는다.
  // (resampleByTime은 x를 0..1로 정규화해 부분 드로잉을 늘려버리므로 여기선 쓰지 않음)
  function simplifyEffectStamps(stamps) {
    return StudioUtils.simplifyEffectStamps(stamps, D.effects)
  }

  // === § 9  레시피 — 캔버스를 여기서만 읽고 순수 변환 모듈에 전달 ===

  function buildPreviewRecipe() {
    return recipeModel.buildPreviewRecipe(state)
  }

  function buildRecipe() {
    return recipeModel.buildRecipe(state, {
      strokes: draw.getStrokes(),
      strokeInstruments: draw.getStrokeInstruments(),
      path: draw.getPath(),
      soundLayers: soundLayerUI ? soundLayerUI.recipeLayers() : [],
      bgRangeEnabled: canSelectBgRange(),
    })
  }

  function notesFor(recipe) {
    return recipeModel.notesFor(recipe)
  }

  function warmSelectedInstrument() {
    const inst = state.instrument
    const asset = D.melodies[inst.id]
    engine
      .warmInstrument(buildPreviewRecipe())
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
      soundLayers: [], // 업로드 원본은 레시피 링크에 저장하지 않는다. 갤러리 음악 렌더에는 buildRecipe()가 사용된다.
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
    // 새 길이의 실제 캔버스 폭을 먼저 적용해야 시간 라벨도 같은 폭을 기준으로 놓인다.
    syncTimelineWidth(resetScroll)
    renderPaletteLabels()
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
    return recipeModel.usedInstrumentIdsForRecipe(recipe, state.instrument && state.instrument.id)
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
    } else if (event.key === "5") {
      event.preventDefault()
      pulseControl(el.playheadStartBtn)
      movePlayheadToStart(true)
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
    if (soundLayerUI) soundLayerUI.clear({ silent: true })
    clearAppUndoHistory()
    renderEffects()
    renderEffectStamps()
    renderOrchestraLegend()
    setupBgPlayer(true)
    setSelectedPlayhead(0, false, false)
    el.statusText.textContent = "전체 듣기"
    el.exportStatus.textContent = "드로잉, 효과음, 추가 소리를 초기화했습니다. 배경음악 구간은 그대로 유지됩니다."
  }

  // === § 23  관리자 상태 · 공유 진입 ===

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
    if (soundLayerUI) soundLayerUI.restoreRecipe(recipe.soundLayers || [])
    if (canSelectBgRange()) {
      state.bgOffset = Math.max(0, Number(recipe.bgOffset) || 0)
      state.bgEndOffset = Math.max(0, Number(recipe.bgEndOffset) || 0)
    } else {
      state.bgOffset = 0
      state.bgEndOffset = 0
    }
    reflectionUI.restore(recipe)
    applyMoodTint()
    renderAtmospheres()
    renderInstrumentGroups()
    renderInstruments()
    renderComposeInstruments()
    renderEffects()
    syncTimelineWidth(true)
    renderPaletteLabels()
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

  // 공유 모달·화음 갤러리·링크 생성은 studio-share.js가 맡는다.
  // 이 파일에는 앱 전체 상태를 되살리는 레시피 해시 복원만 남긴다.
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
    if (el.playheadStartBtn) {
      el.playheadStartBtn.addEventListener("click", () => {
        pulseControl(el.playheadStartBtn)
        movePlayheadToStart(true)
      })
    }

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
    bindShareControls()

    reflectionUI.bind()
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
        soundLayers: state.soundLayers.map((layer) => ({
          id: layer.id,
          name: layer.name,
          sourceDuration: layer.sourceDuration,
          trimStart: layer.trimStart,
          trimEnd: layer.trimEnd,
          startTime: layer.startTime,
          volume: layer.volume,
          status: layer.status,
        })),
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
