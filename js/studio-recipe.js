/*
 * studio-recipe.js — 상태 스냅샷과 레시피 사이의 순수 변환.
 * DOM·캔버스·현재 선택을 읽지 않는다. 저장 형식과 획/악기 인덱스를 한곳에서 관리한다.
 */
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory
  else root.HwaeumStudioRecipe = factory
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict"

  const Core = deps.core
  const D = deps.data
  const AudioPlan = deps.audioPlan
  const Utils = deps.utils
  const { cleanText, normalizePictureData, normalizeHashtags } = Utils
  const COMPOSER_NAME_MAX = 24
  const PICTURE_NAME_MAX = 80

  function stampedEffectIds(state) {
    const ids = state.effectIds.slice()
    state.effectStamps.forEach((stamp) => {
      if (D.effects[stamp.id] && ids.indexOf(stamp.id) === -1) ids.push(stamp.id)
    })
    return ids
  }

  function buildStrokesAndInstruments(state, drawing) {
    const rawStrokes = drawing.strokes || []
    const rawInsts = drawing.strokeInstruments || []
    const strokes = []
    const instruments = []
    rawStrokes.forEach((s, i) => {
      const instrumentId = rawInsts[i] != null ? rawInsts[i] : state.instrument.id
      const asset = D.melodies[instrumentId]
      const simplified = Utils.simplifyPoints(s, 70, (point) => Core.quantizePitch(point.y, state.style, asset))
      if (simplified.length > 0) {
        strokes.push(AudioPlan.compactStrokePoints(simplified, {
          duration: state.duration, style: state.style,
          instrument: D.instruments.find((item) => item.id === instrumentId) || state.instrument,
          melodyAsset: asset, core: Core,
        }))
        instruments.push(instrumentId)
      }
    })
    return { strokes: strokes, instruments: instruments }
  }

  function buildPreviewRecipe(state) {
    return {
      duration: state.duration,
      atmosphere: state.atmosphere.id,
      instrument: state.instrument.id,
      style: state.style.id,
      version: state.version.id,
      mode: "melody",
    }
  }

  function buildRecipe(state, drawing) {
    const built = buildStrokesAndInstruments(state, drawing)
    return Object.assign(buildPreviewRecipe(state), {
      title: cleanText(state.title || "무제", 24) || "무제",
      composerName: cleanText(state.composerName, COMPOSER_NAME_MAX),
      picture: normalizePictureData(state.recipePicture || state.pic),
      pictureName: cleanText(state.picName || "그림", PICTURE_NAME_MAX),
      actionCount: Math.max(0, Math.floor(Number(state.actionCount) || 0)),
      bgOffset: drawing.bgRangeEnabled ? state.bgOffset : 0,
      bgEndOffset: drawing.bgRangeEnabled ? state.bgEndOffset : 0,
      pictureThought: cleanText(state.pictureThought, 180),
      backgroundReason: cleanText(state.backgroundReason, 180),
      melodyIntent: cleanText(state.melodyIntent, 180),
      hashtags: normalizeHashtags(state.hashtags),
      effectIds: stampedEffectIds(state),
      effectStamps: Utils.simplifyEffectStamps(state.effectStamps, D.effects),
      soundLayers: drawing.soundLayers || [],
      path: Utils.simplifyPath(drawing.path || []), // 썸네일/재생용 시간순 평탄 경로
      strokes: built.strokes, // 그린 그대로의 다중 획(시각 복원용)
      strokeInstruments: built.instruments, // 획별 악기(오케스트라) — voice 인덱스와 1:1
    })
  }

  function notesFor(recipe) {
    if (recipe.mode === "rhythm") return []
    const instrument = D.instruments.find((item) => item.id === recipe.instrument) || D.instruments[0]
    const fallbackAsset = D.melodies[instrument.id] || null
    const style = D.styles.find((s) => s.id === recipe.style) || D.styles.find((item) => item.id === "bright") || D.styles[0]
    if (recipe.strokes && recipe.strokes.length) {
      const melodyAssets = (recipe.strokeInstruments || []).map((id) => D.melodies[id] || fallbackAsset)
      return Core.autocompleteMelodyStrokes(recipe.strokes, {
        durationSec: recipe.duration,
        style: style,
        melodyAsset: fallbackAsset,
        melodyAssets: melodyAssets,
      })
    }
    if (!recipe.path || recipe.path.length < 1) return []
    return Core.autocompleteMelody(recipe.path, { durationSec: recipe.duration, style: style, melodyAsset: fallbackAsset })
  }

  function usedInstrumentIdsForRecipe(recipe, selectedId) {
    const source = recipe || {}
    const fallbackId = source.instrument || selectedId || (D.instruments[0] && D.instruments[0].id)
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

  return { buildPreviewRecipe, buildRecipe, notesFor, usedInstrumentIdsForRecipe }
})
