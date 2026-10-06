/*
 * audio-plan.js — Web Audio와 DOM에 의존하지 않는 오디오 재생 계획 계산
 *
 * 브라우저: 클래식 <script>로 로드되어 window.SDAudioPlan 에 노출.
 * Node:     require("./js/audio-plan.js") 로 동일 API 사용.
 *
 * manifest와 MusicCore는 전역에서 직접 캡처하지 않고 resolvePlan 호출 시 주입한다.
 * sample-map 스크립트가 manifest를 보강한 뒤의 최신 데이터를 그대로 받기 위해서다.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = api
  else root.SDAudioPlan = api
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  const DRAWING_NOTE_GAP_TOLERANCE_SECONDS = 0.08
  const STROKE_TAP_SECONDS = 0.16

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value))
  }

  function audioBufferDuration(buffer) {
    const duration = buffer && Number(buffer.duration)
    if (isFinite(duration) && duration > 0) return duration
    const length = buffer && Number(buffer.length)
    const sampleRate = buffer && Number(buffer.sampleRate)
    if (isFinite(length) && isFinite(sampleRate) && length > 0 && sampleRate > 0) return length / sampleRate
    return 0
  }

  function samplePlaybackRate(asset, midi) {
    const baseMidi = asset && asset.baseMidi != null ? asset.baseMidi : midi
    return Math.pow(2, (midi - baseMidi) / 12)
  }

  function sampleMapFor(asset) {
    return asset && Array.isArray(asset.sampleMap) && asset.sampleMap.length ? asset.sampleMap : null
  }

  function nearestSampleSegment(asset, midi) {
    const map = sampleMapFor(asset)
    if (!map) return null
    // min/maxRate는 소스 선택 범위다. 재생 배속을 자르면 표시 음높이가 틀어진다.
    const eligible = map.filter(function (item) {
      const rate = segmentPlaybackRate(asset, midi, item)
      return (!asset.minRate || rate >= asset.minRate) && (!asset.maxRate || rate <= asset.maxRate)
    })
    const candidates = eligible.length ? eligible : map
    let best = candidates[0]
    for (const item of candidates) {
      if (Math.abs(item.midi - midi) < Math.abs(best.midi - midi)) best = item
    }
    return best
  }

  function segmentPlaybackRate(asset, midi, segment) {
    if (!segment) return samplePlaybackRate(asset, midi)
    const detectedSemitone = segment.midi + ((segment.cents || 0) + (segment.tuningCents || 0)) / 100
    return Math.pow(2, (midi - detectedSemitone) / 12)
  }

  function isMultiSample(asset) {
    return !!(asset && asset.sampleMode === "multi")
  }

  function playableMidiList(instrument, asset) {
    if (asset && Array.isArray(asset.playableMidi)) return asset.playableMidi
    if (instrument && Array.isArray(instrument.playableMidi)) return instrument.playableMidi
    return null
  }

  function playbackTranspose(instrument, asset) {
    const value =
      asset && asset.playbackTranspose != null
        ? asset.playbackTranspose
        : instrument && instrument.playbackTranspose != null
          ? instrument.playbackTranspose
          : 0
    return Number.isFinite(value) ? value : 0
  }

  function playbackMidiForInstrument(uiMidi, instrument, asset) {
    if (uiMidi == null) return null
    const midi = uiMidi + playbackTranspose(instrument, asset)
    const allowed = playableMidiList(instrument, asset)
    if (allowed && allowed.indexOf(uiMidi) === -1 && allowed.indexOf(midi) === -1) return null
    return midi
  }

  function playbackNoteForInstrument(note, instrument, asset) {
    const uiMidi = note.uiMidi != null ? note.uiMidi : note.midi
    const midi = playbackMidiForInstrument(uiMidi, instrument, asset)
    if (midi == null) return null
    return Object.assign({}, note, { uiMidi: uiMidi, midi: midi })
  }

  function playbackNotesForPlan(notes, instrument, melodyAsset, voiceAssets) {
    const out = []
    ;(notes || []).forEach(function (note) {
      const voiceAsset = note.voice != null && voiceAssets ? voiceAssets[note.voice] : null
      const inst = voiceAsset ? voiceAsset.instrument : instrument
      const asset = voiceAsset ? voiceAsset.melodyAsset : melodyAsset
      const next = playbackNoteForInstrument(note, inst, asset)
      if (next) out.push(next)
    })
    return out
  }

  function strokeSegmentsForPlan(recipe, duration, style, instrument, melodyAsset, voiceAssets, core) {
    const out = []
    const total = Math.max(0.05, Number(duration) || 30)
    ;(recipe.strokes || []).forEach(function (stroke, voice) {
      if (!Array.isArray(stroke) || !stroke.length) return
      const voiceAsset = voiceAssets && voiceAssets[voice] ? voiceAssets[voice] : null
      const inst = voiceAsset ? voiceAsset.instrument : instrument
      const asset = voiceAsset ? voiceAsset.melodyAsset : melodyAsset
      const points = stroke
        .map(function (point) {
          return {
            time: clamp(Number(point && point.x) || 0, 0, 1) * total,
            y: clamp(Number(point && point.y) || 0, 0, 1),
          }
        })
        .sort(function (a, b) {
          return a.time - b.time
        })
      let current = []
      function pushCurrent(endTime) {
        if (!current.length) return
        const startTime = current[0].time
        const lastTime = endTime == null ? current[current.length - 1].time : endTime
        const segmentEnd = Math.min(total, Math.max(lastTime, startTime + STROKE_TAP_SECONDS))
        if (segmentEnd <= startTime + 0.01) {
          current = []
          return
        }
        out.push({
          voice: voice,
          start: startTime,
          end: segmentEnd,
          duration: segmentEnd - startTime,
          events: current.slice(),
        })
        current = []
      }
      for (let i = 0; i < points.length; i++) {
        const point = points[i]
        const uiMidi = core.quantizePitch(point.y, style, asset)
        const midi = playbackMidiForInstrument(uiMidi, inst, asset)
        if (midi == null) {
          pushCurrent(point.time)
          continue
        }
        const event = { time: point.time, midi: midi, uiMidi: uiMidi }
        const prev = current[current.length - 1]
        if (prev && Math.abs(prev.time - event.time) < 1e-3) current[current.length - 1] = event
        else current.push(event)
      }
      pushCurrent(points.length ? points[points.length - 1].time : null)
    })
    return out.sort(function (a, b) {
      return a.start - b.start
    })
  }

  function strokeEventAt(events, time) {
    let found = events[0]
    for (let i = 0; i < events.length; i++) {
      if (events[i].time <= time + 1e-6) found = events[i]
      else break
    }
    return found
  }

  function shiftStrokeSegments(segments, offset, totalDuration) {
    return (segments || [])
      .filter(function (segment) {
        return segment && segment.end > offset && segment.start < totalDuration
      })
      .map(function (segment) {
        const startTime = Math.max(segment.start, offset)
        const endTime = Math.min(segment.end, totalDuration)
        const anchor = strokeEventAt(segment.events || [], startTime)
        const events = []
        if (anchor) events.push(Object.assign({}, anchor, { time: startTime - offset }))
        ;(segment.events || []).forEach(function (event) {
          if (event.time <= startTime + 1e-6 || event.time >= endTime - 1e-6) return
          events.push(Object.assign({}, event, { time: event.time - offset }))
        })
        return Object.assign({}, segment, {
          start: startTime - offset,
          end: endTime - offset,
          duration: Math.max(0.01, endTime - startTime),
          events: events,
          sourceEvents: (segment.sourceEvents || segment.events || []).map(function (event) {
            return Object.assign({}, event, { time: event.time - offset })
          }),
        })
      })
      .filter(function (segment) {
        return segment.events && segment.events.length && segment.duration > 0.01
      })
  }

  function sampleBufferFor(sampleBuffers, segment, fallback) {
    if (sampleBuffers && segment && sampleBuffers[segment.midi]) return sampleBuffers[segment.midi]
    return fallback
  }

  function sampleSegmentBounds(buffer, segment, fallbackOffset) {
    const total = audioBufferDuration(buffer)
    if (!(total > 0)) return { offset: 0, duration: 0 }
    const fallback = clamp(Number(fallbackOffset) || 0, 0, Math.max(0, total - 0.01))
    const segmentOffset = segment ? Number(segment.offset) : NaN
    const hasSegmentOffset = !!segment && isFinite(segmentOffset) && segmentOffset >= 0 && segmentOffset < total - 0.01
    const offset = hasSegmentOffset ? segmentOffset : fallback
    const remaining = Math.max(0, total - offset)
    const segmentDuration = segment ? Number(segment.duration) : NaN
    const duration = !!segment && isFinite(segmentDuration) && segmentDuration > 0.01 && segmentDuration <= remaining + 0.02
      ? Math.min(segmentDuration, remaining)
      : remaining
    return { offset: offset, duration: Math.max(0, duration) }
  }

  function backgroundRange(plan, buffer) {
    const total = buffer && isFinite(buffer.duration) ? Math.max(0, buffer.duration) : 0
    if (!total) return { start: 0, end: 0, length: 0 }
    const start = clamp(plan.bgOffset || 0, 0, Math.max(0, total - 0.05))
    let end = Number(plan.bgEndOffset || 0)
    if (!isFinite(end) || end <= start + 0.05) end = Math.min(total, start + (plan.totalDuration || plan.duration || 30))
    end = clamp(end, Math.min(total, start + 0.05), total)
    return { start: start, end: end, length: Math.max(0.05, end - start) }
  }

  // 한 칸을 오래 그린 것은 하나의 발음이다. 음이 바뀌면 그 음에 맞는 원음을
  // 선택하고 짧게 겹친다. 음량·조율 보정은 각 발음이 고른 원음에 고정한다.
  const DRAWING_PITCH_SETTLE_SECONDS = 0.07

  function sampleVoiceRuns(events, end, settleSeconds) {
    const runs = []
    for (const event of events || []) {
      // 획 끝점에만 있는 높이는 유지 시간이 0이다. 종료 뒤 새 소리를 만들지 않는다.
      if (event.time >= end && runs.length) continue
      const previous = runs[runs.length - 1]
      if (previous && previous.midi === event.midi) continue
      if (previous) previous.end = event.time
      runs.push(Object.assign({}, event, { end: end, continuation: runs.length > 0 }))
    }
    if (!(settleSeconds > 0)) return runs
    const settled = []
    for (const run of runs) {
      const previous = settled[settled.length - 1]
      if (!previous) settled.push(Object.assign({}, run, { end: end }))
      else if (run.midi !== previous.midi && run.end - run.time > settleSeconds) {
        const time = run.time + settleSeconds
        previous.end = time
        settled.push(Object.assign({}, run, { time: time, end: end, continuation: true }))
      }
    }
    return settled
  }

  // 레시피의 좌표 정밀도만 줄인다. 음 경계와 체류 판정이 바뀌는 예외는 원래 값을 쓴다.
  function compactStrokePoints(points, options) {
    const { duration, style, instrument, melodyAsset, core } = options
    const round5 = value => Math.round(value * 100000) / 100000
    const rounded = (points || []).map(function (point) {
      const y = round5(point.y)
      return {
        x: round5(point.x),
        y: core.quantizePitch(y, style, melodyAsset) === core.quantizePitch(point.y, style, melodyAsset) ? y : point.y,
      }
    })
    function voices(stroke) {
      return strokeSegmentsForPlan({ strokes: [stroke] }, duration, style, instrument, melodyAsset, null, core)
        .map(segment => sampleVoiceRuns(segment.events, segment.end, DRAWING_PITCH_SETTLE_SECONDS))
    }
    const before = voices(points), after = voices(rounded)
    const tolerance = Math.max(0.05, Number(duration) || 30) * 0.000005 + 1e-9
    const same = before.length === after.length && before.every(function (runs, index) {
      return runs.length === after[index].length && runs.every(function (run, i) {
        const next = after[index][i]
        return run.midi === next.midi && Math.abs(run.time - next.time) <= tolerance && Math.abs(run.end - next.end) <= tolerance
      })
    })
    // 70ms 경계뿐 아니라 가까운 점 합치기·무음 구간의 분리도 실제 재생 계획으로 확인한다.
    return same ? rounded : rounded.map((point, i) => ({ x: points[i].x, y: point.y }))
  }

  // Web Audio setTargetAtTime의 지수 곡선과 그 적분. 원음이 바뀌거나 중간부터
  // 재생해도 해금의 같은 미끄러짐과 버퍼 경과 위치를 복원한다.
  function pitchMotionValue(motion, time) {
    return motion.target + (motion.from - motion.target) * Math.exp(-Math.max(0, time - motion.time) / motion.tau)
  }

  function samplePitchMotion(runs, tau, sampleRate, origin) {
    return runs.reduce(function (motions, run) {
      const target = 440 * Math.pow(2, (run.midi - 69) / 12)
      const previous = motions[motions.length - 1]
      const time = sampleRate ? Math.ceil((run.time + origin) * sampleRate / 128 - 1e-9) * 128 / sampleRate - origin : run.time
      motions.push({ time: time, target: target, from: previous ? pitchMotionValue(previous, time) : target, tau: tau })
      return motions
    }, [])
  }

  // AudioBufferSource playbackRate는 128프레임마다 읽는 k-rate다. 연속 적분만
  // 쓰면 미끄러짐 뒤의 버퍼 위치가 어긋나므로 실제 양자화된 배속을 누적한다.
  function samplePitchTravel(motions, index, from, until, scale, sampleRate, origin) {
    let frame = Math.round((from + origin) * sampleRate)
    const last = Math.round((until + origin) * sampleRate)
    let traveled = 0, active = index
    while (frame < last) {
      const quantum = Math.floor(frame / 128) * 128
      const at = quantum / sampleRate - origin
      while (active + 1 < motions.length && motions[active + 1].time <= at) active++
      const rate = pitchMotionValue(motions[active], at) * scale
      const next = Math.min(last, quantum + 128)
      traveled += (next - frame) / sampleRate * rate
      frame = next
    }
    return traveled
  }

  // 사용자가 올린 긴 소리는 배경 구간과 독립된 작품 시간(초)에 놓인다.
  // 원본 자르기 범위와 작품 안 시작 시점을 분리해 배경 길이가 바뀌어도 위치가 흔들리지 않게 한다.
  function normalizeSoundLayers(layers, totalDuration) {
    const projectDuration = Math.max(0.05, Number(totalDuration) || 30)
    return (Array.isArray(layers) ? layers : [])
      .slice(0, 3)
      .map(function (layer, index) {
        if (!layer || !layer.src) return null
        const sourceDuration = Math.max(
          0.05,
          Number(layer.sourceDuration) || Number(layer.trimEnd) || Number(layer.duration) || projectDuration,
        )
        const sourceStart = clamp(Number(layer.trimStart) || 0, 0, Math.max(0, sourceDuration - 0.05))
        let sourceEnd = Number(layer.trimEnd)
        if (!isFinite(sourceEnd) || sourceEnd <= sourceStart + 0.01) {
          sourceEnd = Math.min(sourceDuration, sourceStart + projectDuration)
        }
        sourceEnd = clamp(sourceEnd, Math.min(sourceDuration, sourceStart + 0.05), sourceDuration)
        const time = Math.max(0, Number(layer.startTime) || 0)
        const duration = Math.min(sourceEnd - sourceStart, Math.max(0, projectDuration - time))
        if (!(duration > 0.001)) return null
        return {
          id: String(layer.id || "sound-layer-" + index),
          name: String(layer.name || "소리 파일"),
          asset: {
            id: String(layer.id || "sound-layer-" + index),
            label: String(layer.name || "소리 파일"),
            src: layer.src,
            file: layer.file,
          },
          time: time,
          sourceOffset: sourceStart,
          duration: duration,
          gain: clamp(layer.volume == null ? 0.65 : Number(layer.volume), 0, 1),
        }
      })
      .filter(Boolean)
  }

  function isContiguous(note, next) {
    if (!next) return false
    if (note.voice != null || next.voice != null) {
      if (note.voice !== next.voice) return false
    }
    const gap = next.time - (note.time + note.duration)
    return gap >= -1e-3 && gap <= DRAWING_NOTE_GAP_TOLERANCE_SECONDS
  }

  function phraseEnd(notes) {
    const last = notes[notes.length - 1]
    return last.time + last.duration
  }

  function contiguousPhrases(notes) {
    const phrases = []
    const byVoice = new Map()
    for (const note of notes) {
      const key = note.voice == null ? "_" : String(note.voice)
      if (!byVoice.has(key)) byVoice.set(key, [])
      byVoice.get(key).push(note)
    }
    byVoice.forEach(function (voiceNotes) {
      voiceNotes.sort(function (a, b) {
        return a.time - b.time
      })
      let current = []
      for (let i = 0; i < voiceNotes.length; i++) {
        current.push(voiceNotes[i])
        if (!isContiguous(voiceNotes[i], voiceNotes[i + 1])) {
          phrases.push(current)
          current = []
        }
      }
    })
    phrases.sort(function (a, b) {
      return a[0].time - b[0].time
    })
    return phrases
  }

  function resolveDependencies(options) {
    const core = options && options.core
    const data = options && options.data
    if (!core || typeof core.quantizePitch !== "function" || typeof core.autocompleteRhythm !== "function") {
      throw new Error("SDAudioPlan.resolvePlan requires MusicCore")
    }
    if (!data || !Array.isArray(data.atmospheres) || !Array.isArray(data.instruments)) {
      throw new Error("SDAudioPlan.resolvePlan requires SDStudioData")
    }
    return { core: core, data: data }
  }

  function resolvePlan(recipe, notes, options) {
    const dependencies = resolveDependencies(options)
    const core = dependencies.core
    const data = dependencies.data
    const atmosphere = data.atmospheres.find((item) => item.id === recipe.atmosphere) || data.atmospheres[0]
    const instrument = data.instruments.find((item) => item.id === recipe.instrument) || data.instruments[0]
    const style = data.styles.find((item) => item.id === recipe.style) || data.styles[0]
    const version = data.versions.find((item) => item.id === recipe.version) || data.versions[0]
    const padAsset = data.pads[atmosphere.padType] || null
    const backgroundAsset = data.backgrounds[atmosphere.backgroundId] || null
    const melodyAsset = data.melodies[instrument.id] || null
    const voiceAssets = {}
    ;(recipe.strokeInstruments || []).forEach(function (instrumentId, voice) {
      const voiceInstrument = data.instruments.find((item) => item.id === instrumentId) || instrument
      voiceAssets[voice] = {
        instrument: voiceInstrument,
        melodyAsset: data.melodies[voiceInstrument.id] || null,
        // 시김새는 그 획을 그린 악기를 따른다 — 지금 고른 악기가 국악기라고 서양 악기 줄에까지 붙이지 않는다.
        gugak: voiceInstrument.group === "국악" || !!version.ornament,
      }
    })
    const duration = recipe.duration || 30
    const effectIds = []
    ;(atmosphere.effectIds || []).concat(recipe.effectIds || []).forEach(function (id) {
      if (data.effects[id] && effectIds.indexOf(id) === -1) effectIds.push(id)
    })
    const effectStamps = (recipe.effectStamps || [])
      .filter(function (stamp) {
        // 구간 끝 너머에 숨은 도장(x>1)은 끝으로 끌어와 울리지 않는다.
        return stamp && data.effects[stamp.id] && !(Number(stamp.x) > 1 + 1e-6)
      })
      .map(function (stamp) {
        const x = clamp(stamp.x == null ? 0 : stamp.x, 0, 1)
        const y = clamp(stamp.y == null ? 0.5 : stamp.y, 0, 1)
        const time = stamp.time == null ? x * duration : clamp(stamp.time, 0, duration)
        if (effectIds.indexOf(stamp.id) === -1) effectIds.push(stamp.id)
        return { id: stamp.id, x: x, y: y, time: time }
      })
    const effects = effectIds.map((id) => Object.assign({ id: id }, data.effects[id]))
    const gugak = !!style.gugak || instrument.group === "국악" || !!version.ornament
    const mode = recipe.mode || "melody"
    const rhythmHits =
      mode === "rhythm" ? core.autocompleteRhythm(recipe.path || [], { durationSec: duration, bpm: 100 }) : []
    return {
      duration: duration,
      totalDuration: duration,
      playbackOffset: 0,
      bgOffset: Math.max(0, recipe.bgOffset || 0),
      bgEndOffset: Math.max(0, recipe.bgEndOffset || 0),
      mode: mode,
      atmosphere: atmosphere,
      instrument: instrument,
      style: style,
      pitchStyle: style,
      version: version,
      silent: !!atmosphere.silent,
      padAsset: padAsset,
      backgroundAsset: backgroundAsset,
      melodyAsset: melodyAsset,
      voiceAssets: voiceAssets,
      effects: effects,
      effectStamps: effectStamps,
      soundLayers: normalizeSoundLayers(recipe.soundLayers, duration),
      gugak: gugak,
      notes: playbackNotesForPlan(notes || [], instrument, melodyAsset, voiceAssets),
      uiNotes: notes || [],
      strokeSegments: strokeSegmentsForPlan(recipe, duration, style, instrument, melodyAsset, voiceAssets, core),
      rhythmHits: rhythmHits,
    }
  }

  function seekPlan(plan, offsetSec) {
    const totalDuration = Math.max(0.05, plan.totalDuration || plan.duration || 30)
    const offset = clamp(Number(offsetSec) || 0, 0, Math.max(0, totalDuration - 0.05))
    if (offset <= 0) {
      return Object.assign({}, plan, {
        totalDuration: totalDuration,
        playbackOffset: 0,
      })
    }
    const remaining = Math.max(0.05, totalDuration - offset)
    const shiftNotes = function (items) {
      return (items || [])
        .filter(function (note) {
          return note && note.time + note.duration > offset && note.time < totalDuration
        })
        .map(function (note) {
          const noteStart = Math.max(note.time, offset)
          const noteEnd = Math.min(note.time + note.duration, totalDuration)
          return Object.assign({}, note, {
            time: noteStart - offset,
            duration: Math.max(0.03, noteEnd - noteStart),
          })
        })
    }
    const shiftTimed = function (items) {
      return (items || [])
        .filter(function (item) {
          return item && item.time >= offset && item.time < totalDuration
        })
        .map(function (item) {
          return Object.assign({}, item, { time: item.time - offset })
        })
    }
    // 도장은 시작점만 정하고 파일을 끝까지 튼다. 탐색 지점 전에 찍힌 도장도 아직 울리고 있을 수 있어
    // 지나간 만큼을 sourceOffset 으로 넘긴다. 소리가 이미 끝났는지는 버퍼 길이를 아는 엔진이 판단한다.
    const shiftStamps = function (items) {
      return (items || [])
        .filter(function (item) {
          return item && item.time < totalDuration
        })
        .map(function (item) {
          const skipped = offset - item.time
          if (skipped <= 0) return Object.assign({}, item, { time: item.time - offset })
          return Object.assign({}, item, { time: 0, sourceOffset: (item.sourceOffset || 0) + skipped })
        })
    }
    const shiftSoundLayers = function (items) {
      return (items || [])
        .filter(function (item) {
          return item && item.time + item.duration > offset && item.time < totalDuration
        })
        .map(function (item) {
          const visibleStart = Math.max(item.time, offset)
          const visibleEnd = Math.min(item.time + item.duration, totalDuration)
          const skipped = Math.max(0, offset - item.time)
          return Object.assign({}, item, {
            time: visibleStart - offset,
            sourceOffset: item.sourceOffset + skipped,
            duration: Math.max(0.001, visibleEnd - visibleStart),
          })
        })
    }
    return Object.assign({}, plan, {
      duration: remaining,
      totalDuration: totalDuration,
      playbackOffset: offset,
      notes: shiftNotes(plan.notes),
      uiNotes: shiftNotes(plan.uiNotes),
      strokeSegments: shiftStrokeSegments(plan.strokeSegments, offset, totalDuration),
      sourceStrokeSegments: (plan.strokeSegments || []).map(function (segment) {
        return Object.assign({}, segment, {
          start: segment.start - offset, end: segment.end - offset,
          events: segment.events.map((event) => Object.assign({}, event, { time: event.time - offset })),
        })
      }).filter((segment) => segment.end + 6 > 0 && segment.start < remaining),
      sourceNotes: (plan.notes || []).map((note) => Object.assign({}, note, { time: note.time - offset })),
      rhythmHits: shiftTimed(plan.rhythmHits),
      effectStamps: shiftStamps(plan.effectStamps),
      soundLayers: shiftSoundLayers(plan.soundLayers),
    })
  }

  return {
    audioBufferDuration: audioBufferDuration,
    backgroundRange: backgroundRange,
    contiguousPhrases: contiguousPhrases,
    isContiguous: isContiguous,
    isMultiSample: isMultiSample,
    nearestSampleSegment: nearestSampleSegment,
    normalizeSoundLayers: normalizeSoundLayers,
    phraseEnd: phraseEnd,
    playableMidiList: playableMidiList,
    playbackMidiForInstrument: playbackMidiForInstrument,
    playbackNoteForInstrument: playbackNoteForInstrument,
    playbackNotesForPlan: playbackNotesForPlan,
    playbackTranspose: playbackTranspose,
    resolvePlan: resolvePlan,
    sampleBufferFor: sampleBufferFor,
    sampleMapFor: sampleMapFor,
    sampleVoiceRuns: sampleVoiceRuns,
    compactStrokePoints: compactStrokePoints,
    DRAWING_PITCH_SETTLE_SECONDS: DRAWING_PITCH_SETTLE_SECONDS,
    samplePitchMotion: samplePitchMotion,
    pitchMotionValue: pitchMotionValue,
    samplePitchTravel: samplePitchTravel,
    samplePlaybackRate: samplePlaybackRate,
    sampleSegmentBounds: sampleSegmentBounds,
    seekPlan: seekPlan,
    segmentPlaybackRate: segmentPlaybackRate,
    shiftStrokeSegments: shiftStrokeSegments,
    strokeEventAt: strokeEventAt,
    strokeSegmentsForPlan: strokeSegmentsForPlan,
  }
})
