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
  const EFFECT_MAX_SECONDS = window.AudioEngine.EFFECT_MAX_SECONDS
  // 띠 끝을 끌어 줄일 수 있는 가장 짧은 도장 길이(초).
  const EFFECT_STAMP_MIN_SECONDS = 0.5
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
  const PICTURE_BACKDROP_COLOR = "#fffaf0"
  const SOUND_STEP = 1
  const DRAWING_STEP = 2
  const COMPLETE_STEP = 3
  const SHARE_STEP = 4
  const SHARE_AUDIO_BITS_PER_SECOND = 64000
  const DEFAULT_ATMOSPHERE_ID = "none"
  const CUSTOM_BG_ID_PREFIX = "custom-"
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
  const RESET_CONFIRM_MESSAGE = "그린 선율과 효과음 도장, 추가 소리를 모두 지울까요?\n지운 뒤에도 되돌리기(3)로 다시 살릴 수 있어요."
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
  bgPreview.volume = 0.9
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
    dropframe: $("dropframe"),
    drawingWorkspace: $("drawingWorkspace"),
    drawingReference: $("drawingReference"),
    drawingReferenceToggle: $("drawingReferenceToggle"),
    drawingReferenceImg: $("drawingReferenceImg"),
    atmosphereGrid: $("atmosphereGrid"),
    bgUploadInput: $("bgUploadInput"),
    bgUploadStatus: $("bgUploadStatus"),
    instrumentGroups: $("instrumentGroups"),
    instrumentGrid: $("instrumentGrid"),
    instrumentStatus: $("instrumentStatus"),
    drawingStatus: $("drawingStatus"),
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

  // 그린 선율·도장·추가 소리가 몇 초까지 이어지는지(구간 끝 너머에 숨은 것까지).
  function contentEndSeconds() {
    const duration = Number(state.duration) || DEFAULT_DURATION_SECONDS
    let end = 0
    ;(draw ? draw.strokes : []).forEach((stroke) => {
      ;(stroke || []).forEach((point) => {
        end = Math.max(end, (Number(point.x) || 0) * duration)
      })
    })
    ;(state.effectStamps || []).forEach((stamp) => {
      end = Math.max(end, (Number(stamp.x) || 0) * duration)
    })
    ;(state.soundLayers || []).forEach((layer) => {
      const length = Math.max(0, (Number(layer.trimEnd) || 0) - (Number(layer.trimStart) || 0))
      end = Math.max(end, (Number(layer.startTime) || 0) + length)
    })
    return end
  }

  // 배경을 새로 고를 때 길이를 맞춘다(그린 것은 같은 초에 남는다). studio-transport.js가 실제로 바꾼다.
  function startNewBackground() {
    if (studioTransport) studioTransport.startNewBackground(contentEndSeconds())
  }

  // 도장도 선율처럼 같은 '초'에 남긴다 — 구간 길이를 바꿔도 선율과 어긋나지 않게(되돌리기 기록 속 도장도 함께).
  function retimeEffectStamps(previous, next) {
    if (!(previous > 0) || !(next > 0) || Math.abs(previous - next) < 1e-9) return
    const factor = previous / next
    const retime = (stamps) => {
      ;(stamps || []).forEach((stamp) => {
        stamp.x = Math.max(0, (Number(stamp.x) || 0) * factor)
      })
    }
    retime(state.effectStamps)
    appUndoStack.forEach((action) => retime(action && action.effectStamps))
    renderEffectStamps()
  }

  // === § 6  DrawingCanvas 생성 ===

  const draw = new window.DrawingCanvas(el.canvas, {
    activeInstrument: state.instrument.id,
    instrumentColor: colorForInstrument,
    melodyAssetForInstrument: (id) => D.melodies[id] || null,
    maxInstruments: 4,
    onInstrumentLimit: (max) => {
      say("악기는 한 곡에 최대 " + max + "개까지예요. 줄을 지우면 다른 악기를 더할 수 있어요.", { error: true })
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
      say("음악에 맞춰 그리기 중입니다. 손을 떼면 들은 타이밍대로 악보에 남아요.")
    },
    onFlowEnd: () => {
      if (state.drawingInputMode !== DRAW_MODE_SOUND) return
      say("음악에 맞춰 그린 선율을 악보에 남겼어요.")
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

  // === § 7a  안내 문구 — 지금 보이는 단계의 안내 줄에 쓴다 ===
  // 3단계는 따로 안내 줄이 없어 도화지 아래에 잠깐 떴다 사라지는 알림으로 보인다.

  const DRAWING_TOAST_MS = 4500
  let drawingToastTimer = null

  function statusLineForStep(step) {
    if (step === 0) return el.picStatus
    if (step === SOUND_STEP) return el.instrumentStatus || el.bgUploadStatus
    if (step === DRAWING_STEP) return el.drawingStatus
    if (step === SHARE_STEP) return el.shareStatus
    return el.exportStatus
  }

  function hideDrawingToast() {
    if (drawingToastTimer) clearTimeout(drawingToastTimer)
    drawingToastTimer = null
    if (el.drawingStatus) el.drawingStatus.classList.remove("show")
  }

  function say(message, options) {
    const text = String(message || "")
    const line = statusLineForStep(state.step) || el.exportStatus
    if (!line) return
    line.textContent = text
    line.classList.toggle("error", !!(options && options.error))
    if (line !== el.drawingStatus) return
    hideDrawingToast()
    if (!text) return
    line.classList.add("show")
    drawingToastTimer = setTimeout(hideDrawingToast, (options && options.duration) || DRAWING_TOAST_MS)
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
    // 페이지를 열 때마다 1부터 세면 예전 작품의 음악 번호와 겹친다 — 시각까지 넣어 겹치지 않게 한다.
    getNextCustomBgId: () => CUSTOM_BG_ID_PREFIX + Date.now().toString(36) + "-" + (++customBgSeq).toString(36),
    reloadBackground: () => {
      if (studioTransport) studioTransport.setupBgPlayer(true)
    },
    syncReflectionFromNotes,
    say,
    startNewBackground,
  })
  const {
    bgSrcFor,
    backgroundFor,
    missingCustomBackground,
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
    say,
    hasUnsavedWork,
    markWorkSaved,
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
    sharedWorkFor: (takeId, channel) => (typeof takes.sharedWorkId === "function" ? takes.sharedWorkId(takeId, channel) : ""),
    rememberSharedWork: (takeId, channel, workId) => {
      if (typeof takes.markShared === "function") takes.markShared(takeId, channel, workId)
    },
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
    onDurationChange: (previous, next) => {
      retimeEffectStamps(previous, next)
      if (soundLayerUI) soundLayerUI.handleDurationChange()
    },
    say,
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
    const recipe = recipeModel.buildRecipe(state, {
      strokes: draw.getStrokes(),
      strokeInstruments: draw.getStrokeInstruments(),
      path: draw.getPath(),
      soundLayers: soundLayerUI ? soundLayerUI.recipeLayers() : [],
      bgRangeEnabled: canSelectBgRange(),
    })
    // '내가 찾은 음악'은 파일을 저장하지 않으므로 이름을 함께 남겨, 파일이 없을 때도 무엇을 다시 올릴지 알려 준다.
    const atmosphere = state.atmosphere || {}
    if (atmosphere.custom) recipe.atmosphereLabel = atmosphere.label
    if (atmosphere.missing && atmosphere.savedRange) {
      recipe.bgOffset = Math.max(0, Number(atmosphere.savedRange.bgOffset) || 0)
      recipe.bgEndOffset = Math.max(0, Number(atmosphere.savedRange.bgEndOffset) || 0)
    }
    return recipe
  }

  function notesFor(recipe) {
    return recipeModel.notesFor(recipe)
  }

  // === § 9b  저장하지 않은 바뀜 알아보기 ===
  // 마지막으로 저장하거나 불러온 때의 지문과 지금 지문을 견준다. 저절로 늘어나는 시도 횟수와
  // 획에서 다시 만드는 path는 빼고, 그림은 원본 글자 대신 짧은 지문으로 견준다(뒤에서 압축돼도 같게).
  let savedWorkSignature = ""

  function pictureFingerprint(text) {
    let hash = 2166136261
    for (let i = 0; i < text.length; i += 7) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36) + ":" + text.length
  }

  function workSignature() {
    const recipe = buildRecipe()
    delete recipe.actionCount
    delete recipe.path
    recipe.picture = state.pic ? pictureFingerprint(String(state.pic)) : ""
    recipe.soundLayers = (recipe.soundLayers || []).map(function (layer) {
      return [layer.id, layer.trimStart, layer.trimEnd, layer.startTime, layer.volume]
    })
    return JSON.stringify(recipe)
  }

  function markWorkSaved() {
    savedWorkSignature = workSignature()
  }

  function hasUnsavedWork() {
    return workSignature() !== savedWorkSignature
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
          say(instLabel + " 줄을 모두 지웠어요. 되돌리기(3 또는 Ctrl+Z)로 다시 살릴 수 있어요.")
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
        say(state.effectStampId ? effect.label + " 도장을 캔버스에 찍을 수 있습니다." : "효과음 도장 선택을 해제했습니다.")
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
      const x = stamp.x || 0
      if (x > 1 + 1e-6) return // 구간 끝 너머에 숨은 도장 — 구간을 다시 늘리면 보인다
      const left = timelineCssX(x)
      const top = Math.max(0.04, Math.min(0.96, stamp.y == null ? 0.5 : stamp.y)) * 100 + "%"
      // 도장은 찍은 자리부터 소리 길이만큼 난다 → 그 길이를 옅은 띠로 보여 준다(겹치면 진해진다).
      const seconds = effectStampSeconds(stamp, effect)
      const mark = document.createElement("span")
      mark.className = "effect-stamp"
      mark.style.left = Math.round(left) + "px"
      mark.style.top = top
      mark.title = seconds > 0 ? effect.label + " (" + secondsLabel(seconds) + ")" : effect.label
      if (effect.image) {
        const img = document.createElement("img")
        img.src = effect.image
        img.alt = ""
        mark.appendChild(img)
      } else {
        mark.textContent = effect.label
      }
      if (seconds > 0) {
        const span = document.createElement("span")
        span.className = "effect-stamp-span"
        span.style.left = Math.round(left) + "px"
        span.style.width = effectSpanWidth(x, seconds) + "px"
        span.style.top = top
        el.effectStampLayer.appendChild(span)
        // 띠 끝 손잡이: 마우스를 대면 ↔ 커서로 바뀌고, 끌면 이 도장의 소리 길이를 바꾼다.
        const handle = document.createElement("span")
        handle.className = "effect-stamp-handle"
        handle.style.left = Math.round(left) + effectSpanWidth(x, seconds) + "px"
        handle.style.top = top
        handle.title = "끝을 끌어 소리 길이 바꾸기"
        handle.addEventListener("pointerdown", (e) => startEffectStampResize(e, stamp, { span, handle, mark }))
        el.effectStampLayer.appendChild(mark)
        el.effectStampLayer.appendChild(handle)
      } else {
        el.effectStampLayer.appendChild(mark)
      }
    })
  }

  // 도장 하나가 실제로 나는 길이(초): 학생이 줄인 길이 · 파일 길이 · 엔진 최대 길이 중 가장 짧은 것.
  function effectStampSeconds(stamp, effect) {
    const full = Math.min(Number(effect && effect.duration) || 0, EFFECT_MAX_SECONDS)
    const chosen = Number(stamp && stamp.duration)
    return chosen > 0 ? Math.min(chosen, full) : full
  }

  function effectSpanWidth(x, seconds) {
    const left = timelineCssX(x)
    return Math.max(0, Math.round(timelineCssX(x + seconds / Math.max(1, state.duration || 30)) - left))
  }

  function startEffectStampResize(e, stamp, nodes) {
    const effect = D.effects[stamp.id]
    if (!effect || e.button > 0) return
    // 도화지로 넘어가 선이 그어지거나 도장이 찍히지 않게 막는다.
    e.preventDefault()
    e.stopPropagation()
    const full = effectStampSeconds({}, effect)
    const min = Math.min(EFFECT_STAMP_MIN_SECONDS, full)
    const before = effectStampSeconds(stamp, effect)
    const x = stamp.x || 0
    const left = Math.round(timelineCssX(x))
    let seconds = before
    let undoPushed = false
    if (nodes.handle.setPointerCapture) nodes.handle.setPointerCapture(e.pointerId)
    nodes.handle.classList.add("is-resizing")
    nodes.handle.dataset.label = secondsLabel(seconds)
    document.body.classList.add("effect-stamp-resizing")

    const move = (ev) => {
      const raw = (timelineProgressFromClientX(ev.clientX) - x) * Math.max(1, state.duration || 30)
      const next = Math.round(Math.max(min, Math.min(full, raw)) * 10) / 10
      if (next === seconds) return
      if (!undoPushed) {
        pushEffectStampUndo()
        undoPushed = true
      }
      seconds = next
      // 끝까지 늘리면 길이를 따로 두지 않는다(파일 길이·최대 길이를 그대로 따른다).
      if (seconds >= full - 0.05) delete stamp.duration
      else stamp.duration = seconds
      const width = effectSpanWidth(x, seconds)
      nodes.span.style.width = width + "px"
      nodes.handle.style.left = left + width + "px"
      nodes.handle.dataset.label = secondsLabel(seconds)
      nodes.mark.title = effect.label + " (" + secondsLabel(seconds) + ")"
    }
    const end = () => {
      nodes.handle.removeEventListener("pointermove", move)
      nodes.handle.removeEventListener("pointerup", end)
      nodes.handle.removeEventListener("pointercancel", end)
      nodes.handle.classList.remove("is-resizing")
      document.body.classList.remove("effect-stamp-resizing")
      if (seconds === before) return
      renderEffectStamps()
      updateReadouts()
      say(effect.label + " 도장 소리를 " + secondsLabel(seconds) + "로 " + (seconds < before ? "줄였습니다." : "늘렸습니다."))
    }
    nodes.handle.addEventListener("pointermove", move)
    nodes.handle.addEventListener("pointerup", end)
    nodes.handle.addEventListener("pointercancel", end)
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
    say(effect.label + " 도장을 찍었습니다.")
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
    say((effect ? effect.label : "효과음") + " 도장을 지웠습니다.")
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
          // 지우개는 여기서 멈추지 않고 그대로 넘겨, 도장 위에서 시작한 같은 긋기로 선도 지운다.
          if (draw.eraseMode) return
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
          // JPEG에는 투명이 없어 그대로 두면 투명한 곳이 검게 저장된다 — 1단계 그림 칸과 같은 크림색을 먼저 칠한다.
          ctx.fillStyle = PICTURE_BACKDROP_COLOR
          ctx.fillRect(0, 0, canvas.width, canvas.height)
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
    if (el.drawingReferenceImg) {
      const ref = el.drawingReferenceImg
      ref.onload = function () {
        const ratio = (ref.naturalWidth || 1) / (ref.naturalHeight || 1)
        ref.classList.toggle("fit-whole", ratio > 1.6 || ratio < 0.625)
      }
      ref.src = normalized
    }
    el.frameImg.src = normalized
    el.frameImg.style.display = "block"
    el.frameCanvas.style.display = "none"
    el.picStatus.textContent = state.picName + " 적용됨"
    el.picStatus.classList.remove("error")
  }

  function clearPicture() {
    state.pic = ""
    state.recipePicture = ""
    state.picName = ""
    pictureCompressSeq += 1 // 늦게 끝난 압축이 지운 그림을 되살리지 않게
    el.dropPreview.removeAttribute("src")
    el.dropPreview.hidden = true
    el.dropEmpty.style.display = ""
    el.picChip.hidden = true
    if (el.drawingReferenceImg) {
      el.drawingReferenceImg.src = DEFAULT_COVER_SRC
      el.drawingReferenceImg.classList.remove("fit-whole")
    }
    el.picStatus.textContent = ""
    el.picStatus.classList.remove("error")
    drawFrameFallback()
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
    say("먼저 캔버스에 점을 찍거나 선을 그려주세요.", { error: true })
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
    if (on) say(ERASER_TOOL_STATUS)
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
    if (announce) say(PEN_TOOL_STATUS)
  }

  function activateEraserTool(announce) {
    if (announce) recordUserAction()
    setEraser(true)
    // 지우개로 바꿀 땐 재생은 멈추되 재생바는 제자리에 둔다(정지 버튼처럼 맨 앞으로 되돌리지 않음).
    freezePlayheadAtLivePosition()
    engine.stop()
    if (announce) say(ERASER_TOOL_STATUS)
  }

  function isPressableTarget(target) {
    if (!target || !target.closest) return false
    return !!target.closest("button, a[href], [role='button'], .take")
  }

  function isTypingTarget(target) {
    if (!target) return false
    const tag = (target.tagName || "").toLowerCase()
    return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable
  }

  function handleKeyboardShortcut(event) {
    if (!event || event.defaultPrevented || event.repeat) return
    // Ctrl+Z(맥은 ⌘+Z)도 되돌리기다. 한글 입력 상태에서도 잡히게 글쇠 위치(KeyZ)로 본다.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === "KeyZ" || event.key === "z" || event.key === "Z")) {
      if (state.step !== DRAWING_STEP || isTypingTarget(event.target)) return
      event.preventDefault()
      announceUndoLastAction()
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (event.key === " " || event.code === "Space" || event.key === "Spacebar") {
      // 재생 단추가 있는 3·4단계에서만 작품을 듣는다. 단추·링크·카드에 초점이 있으면 그것을 누르는 키로 둔다.
      if (state.step !== DRAWING_STEP && state.step !== COMPLETE_STEP) return
      if (isPressableTarget(event.target)) return
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
      if (action.type === "reset") {
        undoReset(action)
        syncUndoButton()
        recordUserAction()
        return "초기화"
      }
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
    say(
      undone === "초기화"
        ? "초기화하기 전으로 되돌렸어요."
        : undone === "효과음"
          ? "마지막 효과음 작업을 되돌렸어요."
          : "마지막 드로잉 작업을 되돌렸어요.",
    )
  }

  function syncUndoButton() {
    if (!el.undoBtn || typeof draw.canUndo !== "function") return
    el.undoBtn.disabled = !(appUndoStack.length || draw.canUndo())
  }

  function hasComposeContent() {
    return draw.strokes.length > 0 || (state.effectStamps || []).length > 0 || (state.soundLayers || []).length > 0
  }

  // 초기화는 키보드 4 한 번으로도 일어나므로, 지울 것이 있으면 먼저 묻고
  // 지운 뒤에도 되돌리기(3·Ctrl+Z)로 바로 앞 상태를 다시 살릴 수 있게 한다.
  function resetCompose() {
    const hadContent = hasComposeContent()
    if (hadContent && typeof window.confirm === "function" && !window.confirm(RESET_CONFIRM_MESSAGE)) return
    recordUserAction({ update: false })
    engine.stop()
    draw.finishFlowStroke(false)
    setEraser(false)
    const resetAction = {
      type: "reset",
      drawPushed: false,
      effectStamps: effectStampSnapshot(),
      effectIds: (state.effectIds || []).slice(),
      soundLayers: soundLayerUI ? soundLayerUI.recipeLayers() : [],
      activeTakeId: state.activeTakeId,
    }
    const depthBefore = drawUndoDepth()
    suppressDrawUndoTracking = true
    draw.clear(true) // 획이 있으면 그 상태를 되돌리기 기록에 남긴다(구간 길이가 바뀌어도 함께 맞춰진다)
    suppressDrawUndoTracking = false
    resetAction.drawPushed = drawUndoDepth() > depthBefore
    syncTrackedDrawUndoDepth()
    draw.setActiveInstrument(state.instrument.id)
    state.effectIds = []
    state.effectStamps = []
    state.effectStampId = null
    if (soundLayerUI) soundLayerUI.clear({ silent: true })
    // 처음부터 다시 그리는 작품이므로, 다음 저장은 앞 작품을 덮어쓰지 않고 새로 저장한다.
    state.activeTakeId = null
    if (hadContent) pushAppUndoAction(resetAction)
    renderEffects()
    renderEffectStamps()
    renderOrchestraLegend()
    setupBgPlayer(true)
    setSelectedPlayhead(0, false, false)
    el.statusText.textContent = "전체 듣기"
    say(hadContent ? "드로잉, 효과음, 추가 소리를 지웠어요. 되돌리기(3)로 다시 살릴 수 있어요." : "지울 드로잉이 없어요.")
  }

  function undoReset(action) {
    if (action.drawPushed) {
      suppressDrawUndoTracking = true
      draw.undo()
      suppressDrawUndoTracking = false
      syncTrackedDrawUndoDepth()
    }
    state.effectIds = (action.effectIds || []).slice()
    restoreEffectStamps(action.effectStamps)
    if (soundLayerUI && action.soundLayers && action.soundLayers.length) soundLayerUI.restoreRecipe(action.soundLayers)
    if (action.activeTakeId && takes.get(action.activeTakeId)) state.activeTakeId = action.activeTakeId
    renderEffects()
    renderOrchestraLegend()
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
    else clearPicture() // 그림 없이 저장한 작품 — 앞 작품의 그림이 남아 그 작품에 붙지 않게
    state.duration = normalizeDuration(recipe.duration || DEFAULT_DURATION_SECONDS)
    state.actionCount = normalizeActionCount(recipe.actionCount)
    const isCustomBackground = typeof recipe.atmosphere === "string" && recipe.atmosphere.indexOf(CUSTOM_BG_ID_PREFIX) === 0
    state.atmosphere =
      D.atmospheres.find((a) => a.id === recipe.atmosphere && !a.missing) ||
      (isCustomBackground
        ? missingCustomBackground(recipe.atmosphere, recipe.atmosphereLabel, { bgOffset: recipe.bgOffset, bgEndOffset: recipe.bgEndOffset })
        : null) ||
      defaultAtmosphere()
    state.instrument = D.instruments.find((i) => i.id === recipe.instrument) || D.instruments[0]
    state.style = styleForInstrument(state.instrument) // 음계는 악기 그룹을 따른다(서양=C장조, 국악=5음)
    state.version = defaultVersion()
    state.mode = "melody"
    state.group = state.instrument.group
    state.effectStamps = simplifyEffectStamps(recipe.effectStamps || [])
    const stampIds = state.effectStamps.map((stamp) => stamp.id)
    state.effectIds = (recipe.effectIds || []).filter((id) => !!D.effects[id] && stampIds.indexOf(id) === -1)
    state.effectStampId = null
    const missingSoundLayers = soundLayerUI ? soundLayerUI.restoreRecipe(recipe.soundLayers || []) : 0
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
    // 불러온 작품에서 이 컴퓨터에 없는 파일(오디오는 저장하지 않는다)을 알려 줄 문구를 돌려준다.
    const notices = []
    if (state.atmosphere.missing) {
      notices.push("배경 음악 ‘" + state.atmosphere.label + "’ 파일은 이 컴퓨터에 없어요. 2단계에서 같은 파일을 다시 올리면 이어서 들을 수 있어요.")
    }
    if (missingSoundLayers) notices.push("추가 소리 " + missingSoundLayers + "개는 원본 파일을 다시 올려야 들을 수 있어요.")
    return { notice: notices.join(" ") }
  }

  // 공유 모달·화음 갤러리·링크 생성은 studio-share.js가 맡는다.
  // 이 파일에는 앱 전체 상태를 되살리는 레시피 해시 복원만 남긴다.
  // 불러왔으면 3단계에서 보여 줄 안내 문구를, 아니면 ""를 돌려준다.
  function restoreFromHash() {
    const h = location.hash || ""
    if (h.indexOf("#copy=") === 0) {
      try {
        const payload = takeStudioCopyPayload(decodeURIComponent(h.slice(6)))
        loadRecipe(studioCopyRecipe(payload.recipe))
        state.sharedRecipeLoaded = true
        state.activeTakeId = null
        state.playingTakeId = null
        return "갤러리 작품을 스튜디오에서 열었어요. 바꿔도 원래 작품은 그대로예요."
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
        return "공유 링크에서 불러왔습니다. 드로잉을 이어서 볼 수 있어요."
      } catch (e) {
        console.warn("공유 링크 복원 실패", e)
      }
    }
    return ""
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
    hideDrawingToast() // 3단계 알림은 그 단계에서만 보인다
    if (soundLayerUI) soundLayerUI.stopPreview()
    if (nextStep !== DRAWING_STEP && typeof engine.stopLivePreview === "function") engine.stopLivePreview(true)
    // 재생·정지 단추는 3·4단계에만 있다. 다른 단계로 가면 소리를 멈춘다(멈출 단추가 없는 화면에서 계속 나지 않게).
    if (nextStep !== DRAWING_STEP && nextStep !== COMPLETE_STEP && (engine.isPlaying || engine.isPaused)) engine.stop()
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
      // 2단계 감상 메모는 '최종으로 고른' 배경·악기의 것만 성찰 칸으로 옮긴다(4단계에서 고친 칸은 그대로).
      syncReflectionFromNotes()
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
      handlePictureFile(e.target.files && e.target.files[0])
      el.picInput.value = "" // 같은 파일을 다시 골라도 다시 올라가게
    })

    // 그림 파일을 '그림 올리기' 칸에 끌어다 놓아도 올라가게 한다. 다른 곳에 떨어뜨리면 브라우저가 그 파일을
    // 열어 페이지를 떠나(하던 작업이 사라졌다) — 창 전체에서 파일 놓기의 기본 동작을 막는다.
    window.addEventListener("dragover", (e) => e.preventDefault())
    window.addEventListener("drop", (e) => e.preventDefault())
    if (el.dropframe) {
      el.dropframe.addEventListener("dragover", (e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
        el.dropframe.classList.add("dragging")
      })
      el.dropframe.addEventListener("dragleave", () => el.dropframe.classList.remove("dragging"))
      el.dropframe.addEventListener("drop", (e) => {
        e.preventDefault()
        el.dropframe.classList.remove("dragging")
        handlePictureFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])
      })
    }

    function pictureError(message) {
      el.picStatus.textContent = message
      el.picStatus.classList.add("error")
    }

    function handlePictureFile(f) {
      if (!f) return
      // 아이폰 사진(HEIC)은 형식 이름이 비어 오기도 해 "이미지 파일만"이라는 엉뚱한 안내가 나왔다.
      if (/\.(heic|heif)$/i.test(f.name || "") || /hei[cf]/i.test(f.type || "")) {
        pictureError("아이폰 사진(HEIC)은 열 수 없어요. 사진을 JPG로 바꿔서 올려 주세요.")
        return
      }
      if (!f.type || f.type.indexOf("image/") !== 0) {
        pictureError("이미지 파일만 올릴 수 있어요.")
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        // 이름만 그림인 파일·브라우저가 못 여는 형식(TIFF 등)은 "적용됨" 대신 열 수 없다고 알린다.
        const probe = new Image()
        probe.onload = () => applyPictureFile(String(reader.result), f.name)
        probe.onerror = () => pictureError("이 파일은 그림으로 열 수 없어요. jpg·png 같은 그림 파일을 올려 주세요.")
        probe.src = String(reader.result)
      }
      reader.readAsDataURL(f)
    }

    function applyPictureFile(dataUrl, name) {
      setPicture(dataUrl, name)
      // 새 그림은 새 작품이다 — 다음 저장이 앞 작품을 덮어쓰지 않고 새로 저장되게 한다.
      if (state.activeTakeId) {
        state.activeTakeId = null
        el.picStatus.textContent = state.picName + " 적용됨 · 저장하면 새 작품으로 저장돼요."
      }
    }

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
      if (!engine.isPlaying && !engine.isPaused) setSelectedPlayhead(0, false, false)
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
    const restoredRecipeMessage = restoreFromHash()
    setStep(restoredRecipeMessage ? DRAWING_STEP : 0)
    if (restoredRecipeMessage) say(restoredRecipeMessage)
    else restoreSharedChannelFromUrl()
    markWorkSaved() // 처음 연 상태(또는 링크로 불러온 작품)를 기준으로 삼는다
    window.addEventListener("beforeunload", function (event) {
      if (!hasUnsavedWork()) return
      event.preventDefault()
      event.returnValue = ""
    })
    // 다른 탭에서 작품을 저장·삭제하면 목록을 다시 읽는다.
    window.addEventListener("storage", function (event) {
      if (event.key && event.key.indexOf(takes.key) !== 0) return
      takes.refresh()
      renderTakes()
    })
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
        effectStamps: simplifyEffectStamps(state.effectStamps),
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
