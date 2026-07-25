/*
 * audio-engine.js — Web Audio 합주 엔진 (window.AudioEngine)
 *
 * 레이어: 배경 패드 + 자연 효과음 + 드로잉 선율.
 * 실제 음원 우선, 로드 실패 층만 합성음으로 대체.
 * 같은 그래프를 라이브(AudioContext)와 오프라인(OfflineAudioContext) 양쪽에 구성 → 압축 오디오 내보내기.
 */
;(function (root) {
  "use strict"

  // === § 1  모듈 전역 · 상수 ===

  const Core = root.MusicCore
  const Data = root.SDStudioData
  const AudioPlan = root.SDAudioPlan
  const AudioNodeScope = root.SDAudioNodeScope
  const AudioPadGraph = root.SDAudioPadGraph
  if (!AudioPlan) throw new Error("audio-plan.js must load before audio-engine.js")
  if (!AudioNodeScope) throw new Error("audio-node-scope.js must load before audio-engine.js")
  if (!AudioPadGraph) throw new Error("audio-pad-graph.js must load before audio-engine.js")
  const audioBufferDuration = AudioPlan.audioBufferDuration
  const backgroundRange = AudioPlan.backgroundRange
  const contiguousPhrases = AudioPlan.contiguousPhrases
  const isMultiSample = AudioPlan.isMultiSample
  const nearestSampleSegment = AudioPlan.nearestSampleSegment
  const phraseEnd = AudioPlan.phraseEnd
  const playbackMidiForInstrument = AudioPlan.playbackMidiForInstrument
  const playbackTranspose = AudioPlan.playbackTranspose
  const sampleBufferFor = AudioPlan.sampleBufferFor
  const sampleMapFor = AudioPlan.sampleMapFor
  const sampleSegmentBounds = AudioPlan.sampleSegmentBounds
  const segmentPlaybackRate = AudioPlan.segmentPlaybackRate
  const EFFECT_GAIN = 0.15
  const BACKGROUND_OUTPUT_GAIN = 1.5
  const WESTERN_MELODY_OUTPUT_GAIN = 1.5
  // Instrument gain is calibrated from the stable sustain region of the default
  // drawing pitch rows, with violin as the reference loudness.
  const INSTRUMENT_MELODY_OUTPUT_GAINS = {
    flute: 1.08,
    oboe: 1.03,
    clarinet: 0.91,
    frenchHorn: 1.3332,
    violin: 0.81,
    viola: 1.15,
    cello: 0.73,
    doubleBass: 0.296,
    sogeum: 0.52,
    daegeum: 0.97,
    danso: 0.23,
    haegeum: 0.36,
    // Gayageum keeps its raw tone path, but its plucked sample has much higher
    // attack peaks than sustained gugak samples. Trim output instead of filtering.
    gayageum: 0.522,
  }
  const NOTE_MELODY_OUTPUT_GAIN_LIMIT_DB = 3
  // 자동 루프(지속음) 파일럿 악기는 음마다 녹음 강약 차가 커서(더블베이스 B2·E3는 ±3dB로도
  // 15dB가량 조용하게 남음) 루프 구간 RMS 측정 기준으로 더 넓게 보정한다.
  const AUTO_LOOP_NOTE_GAIN_LIMIT_DB = 12
  // Per-note gain is measured inside each instrument after the instrument-level
  // calibration above and clamped to +/-3 dB so the sample character survives.
  const NOTE_MELODY_OUTPUT_GAINS = {
    flute: { 55: 1.413, 57: 1.413, 59: 1.413, 60: 1.413, 62: 1.413, 64: 1.413, 65: 1.413, 67: 1.413, 69: 1.413, 71: 1.306, 72: 1.413, 74: 1.413, 76: 1.288, 77: 0.732, 79: 0.708 },
    oboe: { 55: 1.413, 57: 1.031, 59: 1.413, 60: 1.413, 62: 0.996, 64: 0.708, 65: 1.043, 67: 0.848, 69: 1.328, 71: 1.344, 72: 1.413, 74: 1.344, 76: 0.708, 77: 0.919, 79: 1.17 },
    clarinet: { 55: 0.969, 57: 1.165, 59: 1.248, 60: 0.936, 62: 1.22, 64: 1.413, 65: 1.307, 67: 1.413, 69: 0.958, 71: 0.825, 72: 0.844, 74: 0.77, 76: 1.015, 77: 0.904, 79: 0.854 },
    frenchHorn: { 55: 1.413, 57: 1.413, 59: 1.413, 60: 1.413, 62: 1.413, 64: 1.341, 65: 1.141, 67: 1.017, 69: 0.938, 71: 0.917, 72: 1.413, 74: 1.413, 76: 0.754, 77: 0.856, 79: 0.708 },
    violin: { 55: 0.708, 57: 0.868, 59: 0.909, 60: 0.747, 62: 1.184, 64: 1.008, 65: 0.919, 67: 1.329, 69: 0.919, 71: 1.068, 72: 0.941, 74: 1.413, 76: 1.323, 77: 1.413, 79: 1.068 },
    viola: { 55: 1.413, 57: 1.413, 59: 0.708, 60: 0.885, 62: 1.413, 64: 1.413, 65: 1.345, 67: 1.413, 69: 1.295, 71: 0.747, 72: 1.236, 74: 1.236, 76: 1.153, 77: 0.865, 79: 1.208 },
    cello: { 55: 1.127, 57: 1.413, 59: 1.413, 60: 1.309, 62: 0.96, 64: 0.708, 65: 0.708, 67: 1.309, 69: 0.765, 71: 1.413, 72: 1.077, 74: 1.14, 76: 1.208, 77: 0.96, 79: 1.413 },
    // doubleBass 는 자동 루프 파일럿 — 루프 구간 RMS 기준 ±12dB 측정값 (B2·E3 샘플이 유독 작게 녹음됨).
    doubleBass: { 55: 0.985, 57: 0.984, 59: 0.8, 60: 0.591, 62: 0.989, 64: 1.783, 65: 1.269, 67: 0.748, 69: 0.871, 71: 3.981, 72: 1.6, 74: 0.787, 76: 3.981, 77: 1.595, 79: 1.013 },
    sogeum: { 55: 1.413, 57: 1.413, 60: 1.413, 62: 1.413, 64: 1.413, 67: 1.413, 69: 1.047, 72: 1.212, 74: 0.708, 76: 0.708 },
    daegeum: { 55: 1.413, 57: 1.413, 60: 1.413, 62: 1.413, 64: 0.943, 67: 0.749, 69: 0.724, 72: 0.943, 74: 0.724, 76: 1.071 },
    danso: { 55: 1.413, 57: 1.413, 60: 0.977, 62: 0.977, 64: 1.122, 67: 1.148, 69: 1.148, 72: 0.871, 74: 0.733, 76: 0.733 },
    haegeum: { 55: 1.413, 57: 1.413, 60: 1.413, 62: 1.135, 64: 0.708, 67: 1.122, 69: 1.059, 72: 0.708, 74: 0.804, 76: 1.413 },
    // Preserve gayageum sample dynamics; do not boost individual plucked rows.
    gayageum: { 55: 1, 57: 1, 60: 1, 62: 1, 64: 1, 67: 1, 69: 1, 72: 1, 74: 1, 76: 1 },
  }
  const LIVE_PREVIEW_MAX_GAIN = 0.95
  const MASTER_OUTPUT_GAIN = 0.56
  const NOTE_PREVIEW_GAIN_BOOST = 2
  const NOTE_PREVIEW_SYNTH_GAIN = 0.24 * NOTE_PREVIEW_GAIN_BOOST
  const NOTE_PREVIEW_SAMPLE_GAIN = 0.34 * NOTE_PREVIEW_GAIN_BOOST
  const GUGAK_DRAWING_GAIN_BOOST = 1.3
  const NOTE_GLIDE_SECONDS = 0.035
  const LIVE_NOTE_GLIDE_SECONDS = 0.025
  const HAEGEUM_NOTE_GLIDE_SECONDS = 0.12
  const HAEGEUM_LIVE_NOTE_GLIDE_SECONDS = 0.09
  const HAEGEUM_PHRASE_ATTACK_SECONDS = 0.06
  const STROKE_TAP_SECONDS = 0.16
  // === § 2  공유 유틸리티 ===

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }
  function finiteOr(value, fallback) {
    const n = Number(value)
    return isFinite(n) ? n : fallback
  }

  function safeBufferOffset(buffer, offset) {
    const total = audioBufferDuration(buffer)
    if (!(total > 0)) return 0
    return clamp(finiteOr(offset, 0), 0, Math.max(0, total - 0.001))
  }

  function safeBufferDuration(buffer, offset, duration) {
    const total = audioBufferDuration(buffer)
    const safeOffset = safeBufferOffset(buffer, offset)
    const remaining = Math.max(0, total - safeOffset)
    const requested = finiteOr(duration, remaining)
    if (!(remaining > 0.001)) return 0
    return clamp(requested, 0.001, remaining)
  }

  function disconnectQuietly() {
    for (let i = 0; i < arguments.length; i += 1) {
      const node = arguments[i]
      if (!node) continue
      try {
        node.disconnect()
      } catch (e) {}
    }
  }

  function stopQuietly(node, when) {
    if (!node) return
    try {
      node.stop(Math.max(0, finiteOr(when, 0)))
    } catch (e) {}
  }

  function warnScheduleFallback(label, error, detail) {
    try {
      console.warn(label, error, detail || {})
    } catch (e) {}
  }

  function isWesternInstrument(instrument) {
    return !!(instrument && instrument.group === "서양")
  }
  function isGugakInstrument(instrument) {
    return !!(instrument && instrument.group === "국악")
  }

  // === § 3  게인 계산 함수 ===

  function backgroundOutputGain(plan) {
    return ((plan && plan.version && plan.version.padGain) || 0) * BACKGROUND_OUTPUT_GAIN
  }

  function instrumentMelodyOutputGain(instrument) {
    const id = instrument && instrument.id
    return id && INSTRUMENT_MELODY_OUTPUT_GAINS[id] ? INSTRUMENT_MELODY_OUTPUT_GAINS[id] : 1
  }

  function noteMelodyOutputGainLimitDb(instrumentId) {
    return instrumentId && SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS[instrumentId]
      ? AUTO_LOOP_NOTE_GAIN_LIMIT_DB
      : NOTE_MELODY_OUTPUT_GAIN_LIMIT_DB
  }

  function noteMelodyOutputGainForUiMidi(instrument, uiMidi) {
    const id = instrument && instrument.id
    const midi = uiMidi == null ? null : Math.round(Number(uiMidi))
    const row = id && NOTE_MELODY_OUTPUT_GAINS[id]
    const value = row && midi != null ? row[midi] : 1
    const limitDb = noteMelodyOutputGainLimitDb(id)
    const minGain = Math.pow(10, -limitDb / 20)
    const maxGain = Math.pow(10, limitDb / 20)
    return value > 0 && isFinite(value) ? clamp(value, minGain, maxGain) : 1
  }

  function noteMelodyOutputGain(plan, note) {
    if (!note) return 1
    const instrument = plan && plan.instrument
    const asset = plan && plan.melodyAsset
    const uiMidi =
      note.uiMidi != null
        ? note.uiMidi
        : note.midi != null
          ? note.midi - playbackTranspose(instrument, asset)
          : null
    return noteMelodyOutputGainForUiMidi(instrument, uiMidi)
  }

  function melodyOutputGain(plan, instrument) {
    const inst = instrument || (plan && plan.instrument)
    const base = ((plan && plan.version && plan.version.melodyGain) || 0)
    return base * (isWesternInstrument(inst) ? WESTERN_MELODY_OUTPUT_GAIN : 1) * instrumentMelodyOutputGain(inst)
  }

  function livePreviewTargetGain(plan, noteEnvPeak) {
    const boost = isGugakInstrument(plan && plan.instrument) ? GUGAK_DRAWING_GAIN_BOOST : 1
    const outputGain = melodyOutputGain(plan, plan && plan.instrument) * noteEnvPeak * MASTER_OUTPUT_GAIN * boost
    return clamp(outputGain, 0.12, LIVE_PREVIEW_MAX_GAIN * boost)
  }

  function livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi) {
    const boost = isGugakInstrument(plan && plan.instrument) ? GUGAK_DRAWING_GAIN_BOOST : 1
    const gain = livePreviewTargetGain(plan, noteEnvPeak) * noteMelodyOutputGainForUiMidi(plan && plan.instrument, uiMidi)
    return clamp(gain, 0.12, LIVE_PREVIEW_MAX_GAIN * boost)
  }

  function melodyPlaybackEnvPeak(plan, noteEnvPeak) {
    if (!isGugakInstrument(plan && plan.instrument)) return noteEnvPeak
    const outputGain = melodyOutputGain(plan, plan && plan.instrument)
    if (!(outputGain > 0)) return noteEnvPeak
    return livePreviewTargetGain(plan, noteEnvPeak) / (outputGain * MASTER_OUTPUT_GAIN)
  }

  function previewOutputGain(plan) {
    const inst = plan && plan.instrument
    return (isWesternInstrument(inst) ? WESTERN_MELODY_OUTPUT_GAIN : 1) * instrumentMelodyOutputGain(inst)
  }
  function createNoteMelodyOutputGain(ctx, plan, items, start, phraseStart, glideSeconds) {
    const list = (items || []).filter(Boolean)
    if (!list.length || typeof ctx.createGain !== "function") return null
    const gains = list.map(function (item) {
      return noteMelodyOutputGain(plan, item)
    })
    const needsGain = gains.some(function (gain) {
      return Math.abs(gain - 1) > 1e-6
    })
    if (!needsGain) return null
    const node = ctx.createGain()
    node.gain.setValueAtTime(gains[0], phraseStart)
    for (let k = 1; k < list.length; k++) {
      const at = start + list[k].time
      if (at <= phraseStart + 1e-6) node.gain.setValueAtTime(gains[k], phraseStart)
      else node.gain.setTargetAtTime(gains[k], at, glideSeconds || NOTE_GLIDE_SECONDS)
    }
    return node
  }
  function connectMelodyEnv(ctx, env, dest, plan, items, start, phraseStart, glideSeconds) {
    const noteGain = createNoteMelodyOutputGain(ctx, plan, items, start, phraseStart, glideSeconds)
    if (noteGain) {
      env.connect(noteGain)
      noteGain.connect(dest)
      return noteGain
    }
    env.connect(dest)
    return null
  }
  function isHaegeumPlan(plan) {
    return !!(plan && plan.instrument && plan.instrument.id === "haegeum")
  }
  function isGayageumPlan(plan) {
    return !!(plan && plan.instrument && plan.instrument.id === "gayageum")
  }
  function shouldSustainSample(plan) {
    return !isGayageumPlan(plan)
  }
  function noteGlideSeconds(plan) {
    return isHaegeumPlan(plan) ? HAEGEUM_NOTE_GLIDE_SECONDS : NOTE_GLIDE_SECONDS
  }
  function liveNoteGlideSeconds(plan) {
    return isHaegeumPlan(plan) ? HAEGEUM_LIVE_NOTE_GLIDE_SECONDS : LIVE_NOTE_GLIDE_SECONDS
  }
  function phraseAttackSeconds(plan) {
    return isHaegeumPlan(plan) ? HAEGEUM_PHRASE_ATTACK_SECONDS : NOTE_GLIDE_SECONDS
  }
  function configureSampleToneFilter(filter, plan, when) {
    const isGugak = isGugakInstrument(plan && plan.instrument)
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(isGugak ? 2300 : 2600, when)
    filter.Q.setValueAtTime(isGugak ? 0.9 : 0.65, when)
  }
  function connectGugakSampleTone(ctx, source, env, plan, when) {
    if (isGayageumPlan(plan) || !isGugakInstrument(plan && plan.instrument) || typeof ctx.createBiquadFilter !== "function") {
      source.connect(env)
      return null
    }
    const filter = ctx.createBiquadFilter()
    configureSampleToneFilter(filter, plan, when)
    source.connect(filter)
    filter.connect(env)
    return filter
  }
  // === § 4  Sustain Loop 시스템 ===

  function sampleSustainLoopRegion(offset, duration, loopHint) {
    const dur = Number(duration) || 0
    if (dur <= 0.25) return null
    const minLoop = Math.min(0.22, dur * 0.35)
    if (loopHint && loopHint.start != null && loopHint.end != null) {
      // 절대 초 힌트(포락선에서 검출한 안정 구간) — 세그먼트 경계 안쪽으로만 다듬는다.
      const relStart = clamp(loopHint.start - offset, 0.02, Math.max(0.02, dur - minLoop - 0.06))
      const relEnd = clamp(loopHint.end - offset, relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
      if (relEnd > relStart + 0.06) return { start: offset + relStart, end: offset + relEnd }
    }
    if (loopHint && loopHint.startRatio != null && loopHint.endRatio != null) {
      const relStart = clamp(dur * loopHint.startRatio, Math.min(0.18, Math.max(0, dur - minLoop)), Math.max(0, dur - minLoop - 0.06))
      const relEnd = clamp(dur * loopHint.endRatio, relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
      if (relEnd > relStart + 0.06) return { start: offset + relStart, end: offset + relEnd }
    }
    const relStart = clamp(dur * 0.28, Math.min(0.18, Math.max(0, dur - minLoop)), Math.max(0, dur - minLoop - 0.06))
    const relEnd = clamp(Math.max(relStart + minLoop, dur * 0.78), relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
    if (relEnd <= relStart + 0.06) return null
    return { start: offset + relStart, end: offset + relEnd }
  }
  function nearestZeroCrossingTime(buffer, targetTime, minTime, maxTime) {
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate) return targetTime
    let channel = null
    try {
      channel = buffer.getChannelData(0)
    } catch (e) {
      return targetTime
    }
    if (!channel || !channel.length) return targetTime
    const sr = buffer.sampleRate
    const target = clamp(Math.round(targetTime * sr), 1, channel.length - 2)
    const lo = clamp(Math.floor(minTime * sr), 1, channel.length - 2)
    const hi = clamp(Math.ceil(maxTime * sr), lo, channel.length - 2)
    let best = target
    let bestScore = Infinity
    for (let i = lo; i <= hi; i++) {
      const a = channel[i - 1]
      const b = channel[i]
      if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) {
        const distance = Math.abs(i - target) / sr
        const amplitude = Math.abs(a) + Math.abs(b)
        const score = distance + amplitude * 0.002
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      }
    }
    return bestScore < Infinity ? best / sr : targetTime
  }
  function refineSustainLoopRegion(region, offset, duration, buffer, loopHint) {
    if (!region || !buffer) return region
    // 포락선에서 검출한 절대 초 힌트는 파형 정렬(상호상관)까지 끝난 값 — 제로크로싱 재스냅이 정렬을 깨뜨린다.
    if (loopHint && loopHint.start != null && loopHint.end != null) return region
    const dur = Number(duration) || 0
    const windowSec = Math.min(0.08, dur * 0.08)
    const absoluteEnd = offset + dur
    const start = nearestZeroCrossingTime(
      buffer,
      region.start,
      Math.max(offset, region.start - windowSec),
      Math.min(region.start + windowSec, absoluteEnd - 0.12),
    )
    const end = nearestZeroCrossingTime(
      buffer,
      region.end,
      Math.max(start + 0.08, region.end - windowSec),
      Math.min(region.end + windowSec, absoluteEnd - 0.02),
    )
    if (end <= start + 0.06) return region
    return { start: start, end: end }
  }
  function applySustainLoop(source, offset, duration, loopHint) {
    const region = refineSustainLoopRegion(sampleSustainLoopRegion(offset || 0, duration, loopHint), offset || 0, duration, source && source.buffer, loopHint)
    if (!region) return false
    source.loop = true
    source.loopStart = region.start
    source.loopEnd = region.end
    return true
  }
  function createCrossfadedSustainBuffer(ctx, buffer, offset, duration, loopHint) {
    if (!ctx || typeof ctx.createBuffer !== "function") return null
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate || !buffer.numberOfChannels) return null
    const total = audioBufferDuration(buffer)
    if (!(total > 0)) return null
    const safeOffset = clamp(Number(offset) || 0, 0, Math.max(0, total - 0.01))
    const safeDuration = Math.min(Math.max(0, Number(duration) || 0), Math.max(0, total - safeOffset))
    if (!(safeDuration > 0.08)) return null
    const region = refineSustainLoopRegion(sampleSustainLoopRegion(safeOffset, safeDuration, loopHint), safeOffset, safeDuration, buffer, loopHint)
    if (!region) return null
    const sampleRate = buffer.sampleRate
    const sourceLength = buffer.length || Math.round(total * sampleRate)
    const startFrame = clamp(Math.floor(safeOffset * sampleRate), 0, Math.max(0, sourceLength - 1))
    const endFrame = clamp(Math.ceil((safeOffset + safeDuration) * sampleRate), startFrame + 1, sourceLength)
    const outLength = endFrame - startFrame
    const loopStartFrame = clamp(Math.round((region.start - safeOffset) * sampleRate), 0, Math.max(0, outLength - 2))
    const loopEndFrame = clamp(Math.round((region.end - safeOffset) * sampleRate), loopStartFrame + 2, outLength)
    const loopFrames = loopEndFrame - loopStartFrame
    // 포락선에서 검출한 구간(절대 초 힌트)은 이음매 양쪽 음량이 다를 수 있어 크로스페이드를 길게 잡는다.
    const fadeSec = loopHint && loopHint.start != null ? 0.16 : 0.08
    const fadeFrames = Math.floor(Math.min(fadeSec * sampleRate, loopFrames * 0.25))
    if (fadeFrames < 8) return null
    const out = ctx.createBuffer(buffer.numberOfChannels, outLength, sampleRate)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch)
      const data = out.getChannelData(ch)
      for (let i = 0; i < outLength; i++) data[i] = input[startFrame + i] || 0
      for (let i = 0; i < fadeFrames; i++) {
        const x = (i + 1) / (fadeFrames + 1)
        const tailIndex = loopEndFrame - fadeFrames + i
        const headIndex = loopStartFrame + i
        const fadeOut = Math.cos(x * Math.PI * 0.5)
        const fadeIn = Math.sin(x * Math.PI * 0.5)
        data[tailIndex] = data[tailIndex] * fadeOut + data[headIndex] * fadeIn
      }
    }
    return {
      buffer: out,
      offset: 0,
      duration: outLength / sampleRate,
      loopStart: loopStartFrame / sampleRate,
      loopEnd: loopEndFrame / sampleRate,
    }
  }
  function preparePlaybackSustain(ctx, source, offset, duration, loopHint) {
    const total = audioBufferDuration(source && source.buffer)
    const safeOffset = total > 0 ? clamp(Number(offset) || 0, 0, Math.max(0, total - 0.01)) : 0
    const fallbackDuration = total > 0 ? Math.max(0, total - safeOffset) : 0
    const requestedDuration = Number(duration)
    const safeDuration = isFinite(requestedDuration) && requestedDuration > 0
      ? Math.min(requestedDuration, fallbackDuration)
      : fallbackDuration
    const baked = createCrossfadedSustainBuffer(ctx, source && source.buffer, safeOffset, safeDuration, loopHint)
    if (baked) {
      source.buffer = baked.buffer
      source.loop = true
      source.loopStart = baked.loopStart
      source.loopEnd = baked.loopEnd
      return baked
    }
    if (safeDuration > 0.01 && applySustainLoop(source, safeOffset, safeDuration, loopHint)) {
      return { buffer: source.buffer, offset: safeOffset, duration: safeDuration, loopStart: source.loopStart, loopEnd: source.loopEnd }
    }
    return { buffer: source.buffer, offset: safeOffset, duration: safeDuration }
  }
  // 라이브 미리듣기와 재생이 "지속음(loop)"을 똑같이 처리하도록, 버퍼만 받아 loop 계획을 계산한다.
  // ⚠ AudioBufferSourceNode.buffer 는 "한 번만" 설정 가능 — 두 번 설정하면 브라우저가 InvalidStateError 를
  //   던져 드로잉 미리듣기/선율이 통째로 무음이 된다. 그래서 이 함수는 실제 source 를 만지지 않고(순수),
  //   호출부가 반환된 buffer 를 source.buffer 에 "딱 한 번" 설정한다.
  // 기준: 샘플이 충분히 길면(원본 >0.45s, 사용 구간 >0.45s) 무조건 안정 구간을 루프 → 드로잉 중과 재생이
  //   같은 연속감. 루프는 preparePlaybackSustain(크로스페이드로 구운 버퍼)로 통일 → 이음매 잡음 제거.
  function sustainLoopHint(plan, segment) {
    const instrumentId = plan && plan.instrument && plan.instrument.id
    if (instrumentId === "violin" && segment && segment.midi === 55) {
      return { startRatio: 0.28, endRatio: 0.58 }
    }
    return null
  }
  // 포락선 기반 자동 루프 구간 파일럿. 고정 비율(28~78%)은 파일 안에 감쇠가 포함된
  // 샘플(필하모니아 현악)에서 조용한 꼬리를 물고 돌아 맥동이 들린다. 측정에서 이음매
  // 음량차가 가장 컸던 악기부터 켜고, 귀 검증 후 명단을 넓힌다.
  // (docs/decisions/2026-07-02-sustain-loop-stable-region.md)
  const SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS = { doubleBass: true }
  function autoSustainLoopHint(buffer, offset, usableSourceDur, plan) {
    const instrumentId = plan && plan.instrument && plan.instrument.id
    if (!instrumentId || !SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS[instrumentId]) return null
    if (!Core || typeof Core.findStableLoopRegion !== "function") return null
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate) return null
    let channel = null
    try {
      channel = buffer.getChannelData(0)
    } catch (e) {
      return null
    }
    if (!channel || !channel.length) return null
    return Core.findStableLoopRegion(channel, buffer.sampleRate, offset, usableSourceDur)
  }

  function continuousSustainPlan(ctx, buffer, offset, usableSourceDur, plan, segment) {
    const bufferDuration = audioBufferDuration(buffer)
    if (!shouldSustainSample(plan) || !(bufferDuration > 0.45 && usableSourceDur > 0.45)) {
      return { buffer: buffer, offset: offset, duration: usableSourceDur, loop: false }
    }
    // preparePlaybackSustain 의 baking/clamp/loop 로직을 그대로 재사용하되, 실제 source 가 아니라
    // 가짜 probe 에 적용해 결과만 읽는다(실제 source.buffer 이중 설정 방지).
    const probe = { buffer: buffer }
    const loopHint = sustainLoopHint(plan, segment) || autoSustainLoopHint(buffer, offset, usableSourceDur, plan)
    const sustain = preparePlaybackSustain(ctx, probe, offset, usableSourceDur, loopHint)
    return {
      buffer: probe.buffer,
      offset: sustain.offset,
      duration: sustain.duration,
      loop: !!probe.loop,
      loopStart: probe.loopStart,
      loopEnd: probe.loopEnd,
    }
  }
  // 계산된 loop 계획을 source 에 적용한다(buffer 는 호출부가 한 번만 설정하므로 여기선 loop 파라미터만).
  function applySustainPlanToSource(source, plan) {
    if (plan && plan.loop) {
      source.loop = true
      source.loopStart = plan.loopStart
      source.loopEnd = plan.loopEnd
    }
  }
  // 마스터 → (있으면) 브릭월 리미터 → 출력. 배경·선율을 ×2 로 키운 뒤 피크만 잡아
  // 클리핑(지직거림)을 막는다. 컴프레서가 없는 환경(테스트 목 등)은 그대로 직결.
  function connectMasterToOutput(ctx, master, output, when) {
    if (typeof ctx.createDynamicsCompressor === "function") {
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.setValueAtTime(-3, when) // -3dBFS 이상 피크만 제한
      limiter.knee.setValueAtTime(0, when)
      limiter.ratio.setValueAtTime(20, when) // 사실상 브릭월
      limiter.attack.setValueAtTime(0.003, when)
      limiter.release.setValueAtTime(0.25, when)
      master.connect(limiter)
      limiter.connect(output)
    } else {
      master.connect(output)
    }
  }
  // === § 5  샘플 맵 & 재생 헬퍼 ===

  // === § 6  합성 음색 설정 ===
  // 실제 샘플이 없을 때도 악기가 구분되어 들리도록
  // (필터 컷오프/공명 Q, 어택, 비브라토 속도/깊이를 악기마다 다르게).
  const SYNTH_VOICE_DEFAULTS = {
    서양: { cutoff: 1800, Q: 0.7, attack: 0.05, vibratoRate: 5, vibratoDepth: 8 },
    국악: { cutoff: 1900, Q: 1.1, attack: 0.045, vibratoRate: 5.6, vibratoDepth: 16 },
    전자: { cutoff: 2600, Q: 0.6, attack: 0.006, vibratoRate: 0, vibratoDepth: 0 },
  }
  const SYNTH_VOICE_OVERRIDES = {
    violin: { cutoff: 2900, Q: 0.8, vibratoDepth: 10 }, // 밝고 가는 현
    viola: { cutoff: 2100, vibratoDepth: 9 },
    cello: { cutoff: 1200, attack: 0.06, vibratoDepth: 7 }, // 낮고 따뜻
    doubleBass: { cutoff: 600, attack: 0.07, vibratoRate: 4, vibratoDepth: 5 }, // 묵직
    clarinet: { cutoff: 1700, Q: 1.2, attack: 0.05, vibratoDepth: 6 }, // 둥글고 부드러운 목관
    flute: { cutoff: 3600, Q: 0.5, attack: 0.05, vibratoDepth: 5 }, // 맑은 숨결
    oboe: { cutoff: 2300, Q: 1.6, vibratoDepth: 9 }, // 코맹맹이 공명
    frenchHorn: { cutoff: 1250, attack: 0.1, vibratoRate: 4.2, vibratoDepth: 5 }, // 둥글고 긴 호흡
    daegeum: { cutoff: 2200, vibratoDepth: 22 }, // 큰 시김새
    sogeum: { cutoff: 3500, vibratoDepth: 13 },
    gayageum: { cutoff: 2000, Q: 0.9, attack: 0.004, vibratoRate: 0, vibratoDepth: 0 }, // 뜯는음(비브라토 없음)
    haegeum: { cutoff: 2500, Q: 1.6, vibratoDepth: 24 }, // 강한 흔들림
    synth: { cutoff: 2800, Q: 0.6 },
  }
  function synthVoiceFor(instrument) {
    const base = SYNTH_VOICE_DEFAULTS[instrument.group] || SYNTH_VOICE_DEFAULTS["서양"]
    return Object.assign({ waveform: instrument.waveform || "sine" }, base, SYNTH_VOICE_OVERRIDES[instrument.id] || {})
  }

  // 연속으로 그린 음들은 하나의 프레이즈 엔벨로프로 감싸, 경계마다 다시 타격되지 않게 한다.
  // === § 8  엔벨로프 적용 ===

  function applyPhraseEnv(env, peak, phraseStart, phraseDuration, maxAttack) {
    const attack = Math.min(maxAttack || NOTE_GLIDE_SECONDS, phraseDuration * 0.25)
    const release = Math.min(0.18, Math.max(0.08, phraseDuration * 0.2))
    const phraseEndTime = phraseStart + phraseDuration
    const holdEnd = Math.max(phraseStart + attack + 0.005, phraseEndTime - release)
    env.gain.setValueAtTime(0.0001, phraseStart)
    env.gain.linearRampToValueAtTime(peak, phraseStart + attack)
    env.gain.setValueAtTime(peak, holdEnd)
    env.gain.linearRampToValueAtTime(0.0001, phraseEndTime + 0.04)
  }
  function applyPluckedPhraseEnv(env, peak, phraseStart, phraseDuration, maxAttack) {
    const attack = Math.min(maxAttack || 0.012, 0.012, Math.max(0.004, phraseDuration * 0.18))
    const decay = Math.min(0.72, Math.max(0.09, phraseDuration * 0.55))
    env.gain.setValueAtTime(0.0001, phraseStart)
    env.gain.linearRampToValueAtTime(peak, phraseStart + attack)
    env.gain.exponentialRampToValueAtTime(0.001, phraseStart + attack + decay)
  }
  function applyMelodyEnv(env, peak, phraseStart, phraseDuration, maxAttack, plan) {
    if (isGayageumPlan(plan)) {
      applyPluckedPhraseEnv(env, peak, phraseStart, phraseDuration, maxAttack)
      return
    }
    applyPhraseEnv(env, peak, phraseStart, phraseDuration, maxAttack)
  }
  function applySampleMelodyEnv(env, peak, phraseStart, phraseDuration, maxAttack, plan) {
    applyPhraseEnv(env, peak, phraseStart, phraseDuration, maxAttack)
  }

  // === § 9  AudioEngine 클래스 & Prototype 메서드 ===

  function AudioEngine() {
    this.ctx = null
    this.bufferCache = new Map() // url -> Promise<AudioBuffer|null>
    this.decodedCache = new Map() // url -> AudioBuffer|null
    this.transportScope = new AudioNodeScope("transport")
    this.previewScope = new AudioNodeScope("preview")
    this.previewGen = 0
    this.master = null
    this.stopTimer = null
    this.isPlaying = false
    this.lastMode = "ready"
    this.onState = null // (isPlaying) 콜백
    this.livePreview = null
    this.livePreviewToken = 0
    this.ambience = null // 드로잉 화면에서 깔리는 배경음(패드)
    this.ambienceToken = 0
    this.isPaused = false // 일시정지 상태(ctx.suspend)
    this.isStarting = false // play() preload/schedule race guard
    this.playGen = 0 // 재생 세대 토큰 — 비동기 play() 도중 stop/재요청 시 무효화용
    this.playEndsAtMs = 0 // 자동 정지 예정 시각(일시정지 잔여시간 계산용)
    this.pauseRemainingMs = 0 // 일시정지 시점의 남은 재생 시간(ms)
    this.lastStopReason = "idle"
  }

  AudioEngine.prototype.ensureContext = function () {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext
      this.ctx = new AC()
    }
    return this.ctx
  }

  AudioEngine.prototype.emitState = function () {
    if (!this.onState) return
    try {
      this.onState(this.isPlaying, this.isPaused)
    } catch (e) {
      console.error("재생 상태 UI 갱신 실패", e)
    }
  }

  // 디코드된 AudioBuffer는 컨텍스트 간 공유 가능(같은 sampleRate면 안전).
  AudioEngine.prototype.loadBuffer = function (ctx, url) {
    if (!url) return Promise.resolve(null)
    if (this.decodedCache.has(url)) return Promise.resolve(this.decodedCache.get(url))
    const fetchFn = root.fetch || (typeof fetch !== "undefined" ? fetch : null)
    if (!fetchFn) return Promise.resolve(null)
    const self = this
    if (!this.bufferCache.has(url)) {
      const p = fetchFn(url)
        .then((r) => {
          if (!r.ok) throw new Error(r.status + " " + r.statusText)
          return r.arrayBuffer()
        })
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buffer) => {
          self.decodedCache.set(url, buffer)
          return buffer
        })
        .catch(() => {
          self.decodedCache.set(url, null)
          return null
        })
      this.bufferCache.set(url, p)
    }
    return this.bufferCache.get(url)
  }

  AudioEngine.prototype.loadAssetBuffer = function (ctx, asset) {
    if (!asset || !asset.src) return Promise.resolve(null)
    if (this.decodedCache.has(asset.src)) return Promise.resolve(this.decodedCache.get(asset.src))
    if (!asset.file || typeof asset.file.arrayBuffer !== "function") {
      return this.loadBuffer(ctx, asset.src)
    }
    const self = this
    if (!this.bufferCache.has(asset.src)) {
      const p = asset.file
        .arrayBuffer()
        .then((ab) => ctx.decodeAudioData(ab.slice ? ab.slice(0) : ab))
        .then((buffer) => {
          self.decodedCache.set(asset.src, buffer)
          return buffer
        })
        .catch(() => {
          self.decodedCache.set(asset.src, null)
          return null
        })
      this.bufferCache.set(asset.src, p)
    }
    return this.bufferCache.get(asset.src)
  }

  AudioEngine.prototype.warmEffect = function (effect) {
    if (!effect || !effect.src) return Promise.resolve(null)
    const ctx = this.ensureContext()
    return this.loadAssetBuffer(ctx, effect)
  }

  // recipe(ids) → 실제 데이터 객체로 해석
  AudioEngine.prototype.resolvePlan = function (recipe, notes) {
    return AudioPlan.resolvePlan(recipe, notes, { core: Core, data: Data })
  }

  AudioEngine.prototype.seekPlan = function (plan, offsetSec) {
    return AudioPlan.seekPlan(plan, offsetSec)
  }

  AudioEngine.prototype.preload = async function (ctx, plan) {
    const self = this
    const jobs = []
    const out = { pad: null, melody: null, melodySamples: null, effects: [], byInstrument: {} }
    const padAsset = plan.padAsset && plan.padAsset.src ? plan.padAsset : plan.backgroundAsset
    jobs.push(this.loadAssetBuffer(ctx, padAsset).then((b) => (out.pad = b)))

    // 오케스트라: 쓰이는 악기(기본 + voice별)별로 버퍼/멀티샘플을 모두 디코드해 둔다.
    const wanted = []
    const seen = {}
    function want(inst, asset) {
      if (!inst || seen[inst.id]) return
      seen[inst.id] = true
      wanted.push({ id: inst.id, asset: asset })
    }
    want(plan.instrument, plan.melodyAsset)
    Object.keys(plan.voiceAssets || {}).forEach((v) => want(plan.voiceAssets[v].instrument, plan.voiceAssets[v].melodyAsset))
    wanted.forEach((entry) => {
      const slot = (out.byInstrument[entry.id] = { melody: null, melodySamples: null })
      const asset = entry.asset
      if (asset && asset.src) jobs.push(self.loadAssetBuffer(ctx, asset).then((b) => (slot.melody = b)))
      // 멀티샘플(서양 선율): 음마다의 실제 녹음을 모두 디코드(가장 가까운 음을 골라 재생).
      const multiMap = isMultiSample(asset) ? sampleMapFor(asset) : null
      if (multiMap) {
        slot.melodySamples = {}
        multiMap.forEach((seg) => {
          if (!seg.src) return
          jobs.push(self.loadBuffer(ctx, seg.src).then((b) => { if (b) slot.melodySamples[seg.midi] = b }))
        })
      }
    })

    plan.effects.forEach((fx, idx) => {
      jobs.push(this.loadAssetBuffer(ctx, fx).then((b) => (out.effects[idx] = { asset: fx, buffer: b })))
    })
    await Promise.all(jobs)
    out.effects = out.effects.filter(Boolean)
    // 기본 악기 버퍼를 out.melody/out.melodySamples 로도 노출(하위 호환 경로).
    const def = out.byInstrument[plan.instrument.id]
    if (def) {
      out.melody = def.melody
      out.melodySamples = def.melodySamples
    }
    return out
  }

  AudioEngine.prototype.warmInstrument = function (recipe) {
    const ctx = this.ensureContext()
    const plan = this.resolvePlan(recipe, [])
    const asset = plan.melodyAsset
    const src = asset && asset.src
    if (!src) return Promise.resolve(null)
    // 멀티샘플이면 음마다의 파일을 미리 디코드(그리는 중 음 전환 시 끊김 방지).
    // 모든 샘플 디코드가 끝난 뒤 resolve → 워밍 완료 후엔 어느 음을 처음 그려도 즉시 소리남
    // (예전엔 await 하지 않아 더블베이스 E2 처럼 덜 받은 음을 처음 그리면 "멈칫"했다).
    const base = this.loadAssetBuffer(ctx, asset)
    const multiMap = isMultiSample(asset) ? sampleMapFor(asset) : null
    if (multiMap) {
      const self = this
      const jobs = multiMap.filter((seg) => seg.src).map((seg) => self.loadBuffer(ctx, seg.src).catch(() => null))
      return Promise.all([base].concat(jobs)).then((res) => res[0])
    }
    return base
  }

  // 핵심: 주어진 컨텍스트/목적지에 전체 합주를 스케줄 (라이브/오프라인 공용)
  AudioEngine.prototype.schedule = function (ctx, dest, plan, buffers, start, register) {
    const dur = plan.duration
    let usedReal = false

    // 1) 배경 패드 — bgOffset(사용자가 캔버스 아래 플레이어로 고른 지점)부터 깐다
    // 배경음악 없음(plan.silent)이면 배경 버퍼도 합성 패드 폴백도 깔지 않는다(악기 소리만).
    if (plan.silent) {
      // 배경 패드 스킵
    } else if (buffers.pad) {
      const src = ctx.createBufferSource()
      const g = ctx.createGain()
      src.buffer = buffers.pad

      const bgRange = backgroundRange(plan, buffers.pad)
      const realStart = safeBufferOffset(buffers.pad, bgRange.start)
      const realEnd = Math.max(realStart + 0.001, safeBufferOffset(buffers.pad, bgRange.end))
      const realLength = Math.max(0.001, realEnd - realStart)

      const playbackOffset = finiteOr(plan.playbackOffset, 0)
      const rel = ((playbackOffset % realLength) + realLength) % realLength
      const bgPlaybackOffset = safeBufferOffset(buffers.pad, realStart + rel)

      src.loopStart = realStart
      src.loopEnd = realEnd
      src.loop = realLength < dur || audioBufferDuration(buffers.pad) < bgPlaybackOffset + dur

      const padGain = backgroundOutputGain(plan)
      const fadeInEnd = start + Math.min(0.35, Math.max(0.01, dur * 0.25))
      const fadeOutStart = start + Math.max(0.01, dur - Math.min(1.5, dur * 0.35))

      g.gain.setValueAtTime(padGain * 0.35, start)
      g.gain.linearRampToValueAtTime(padGain, fadeInEnd)
      g.gain.setValueAtTime(padGain, fadeOutStart)
      g.gain.linearRampToValueAtTime(0, start + dur)

      src.connect(g)
      g.connect(dest)

      try {
        src.start(start, bgPlaybackOffset)
        src.stop(start + dur + 0.05)
        register(src)
        usedReal = true
      } catch (e) {
        warnScheduleFallback("배경 음원 스케줄 실패 — 합성 패드로 대체", e, {
          bgStart: realStart,
          bgEnd: realEnd,
          bgPlaybackOffset: bgPlaybackOffset,
          bufferDuration: audioBufferDuration(buffers.pad),
          duration: dur,
        })
        disconnectQuietly(src, g)
        this.scheduleSynthPad(ctx, dest, plan, start, register)
      }
    } else {
      this.scheduleSynthPad(ctx, dest, plan, start, register)
    }

    // 2) 자연 효과음
    const stampsByEffect = new Map()
    ;(plan.effectStamps || []).forEach(function (stamp) {
      if (!stampsByEffect.has(stamp.id)) stampsByEffect.set(stamp.id, [])
      stampsByEffect.get(stamp.id).push(stamp)
    })
    buffers.effects.forEach((item, index) => {
      const buffer = item.buffer
      const asset = item.asset
      if (!buffer) return
      const stamps = stampsByEffect.get(asset.id) || []
      const interval = clamp(buffer.duration * 0.85, 3.2, 10)
      const offsets = stamps.length
        ? stamps.map((stamp) => stamp.time)
        : /^thunder/.test(asset.id || "") || asset.label.indexOf("천둥") >= 0
          ? [dur * (0.45 + index * 0.08)]
          : Array.from({ length: Math.ceil(dur / interval) }, (_, k) => k * interval + index * 1.7)
      offsets
        .filter((o) => o >= 0 && o < dur - 0.2)
        .forEach((o) => {
          const src = ctx.createBufferSource()
          const g = ctx.createGain()
          const at = start + o
          const outDur = Math.min(buffer.duration, dur - o)
          src.buffer = buffer
          g.gain.setValueAtTime(EFFECT_GAIN, at)
          g.gain.linearRampToValueAtTime(0, at + outDur)
          src.connect(g)
          g.connect(dest)
          register(src)
          src.start(at, 0, outDur)
        })
      usedReal = true
    })

    // 3) 선율 또는 리듬 — 오케스트라: voice(획)마다 그 악기로 따로 스케줄해 동시에 울린다
    if (plan.mode === "rhythm") {
      const melodyGain = ctx.createGain()
      melodyGain.gain.setValueAtTime(melodyOutputGain(plan, plan.instrument), start)
      melodyGain.connect(dest)
      this.scheduleRhythm(ctx, melodyGain, plan, buffers, start, register)
    } else {
      const self = this
      const byVoice = new Map()
      const strokesByVoice = new Map()
      const voiceKeys = new Set()
      ;(plan.notes || []).forEach(function (note) {
        const key = note.voice == null ? "_" : String(note.voice)
        voiceKeys.add(key)
        if (!byVoice.has(key)) byVoice.set(key, [])
        byVoice.get(key).push(note)
      })
      ;(plan.strokeSegments || []).forEach(function (segment) {
        const key = segment.voice == null ? "_" : String(segment.voice)
        voiceKeys.add(key)
        if (!strokesByVoice.has(key)) strokesByVoice.set(key, [])
        strokesByVoice.get(key).push(segment)
      })
      Array.from(voiceKeys).sort().forEach(function (key) {
        const voiceNotes = byVoice.get(key) || []
        const voiceStrokes = strokesByVoice.get(key) || []
        const va = key !== "_" && plan.voiceAssets ? plan.voiceAssets[key] : null
        const inst = va ? va.instrument : plan.instrument
        const asset = va ? va.melodyAsset : plan.melodyAsset
        const instBuffers = (buffers.byInstrument && buffers.byInstrument[inst.id]) || {
          melody: buffers.melody,
          melodySamples: buffers.melodySamples,
        }
        // voice별로 악기/asset/gugak 을 덮어쓴 plan 으로 기존 스케줄러를 그대로 재사용
        const voicePlan = Object.assign({}, plan, {
          instrument: inst,
          melodyAsset: asset,
          gugak: va ? va.gugak : plan.gugak,
        })
        const melodyGain = ctx.createGain()
        melodyGain.gain.setValueAtTime(melodyOutputGain(voicePlan, inst), start)
        melodyGain.connect(dest)
        if (instBuffers.melody) {
          try {
            if (voiceStrokes.length) {
              self.scheduleSampleStrokes(ctx, melodyGain, voicePlan, voiceStrokes, instBuffers, start, register)
            } else {
              self.scheduleSampleMelody(ctx, melodyGain, voicePlan, voiceNotes, instBuffers, start, register)
            }
            usedReal = true
          } catch (e) {
            warnScheduleFallback("악기 샘플 스케줄 실패 — 합성 선율로 대체", e, {
              instrument: inst.id,
              voice: key,
              noteCount: voiceNotes.length,
              strokeCount: voiceStrokes.length,
            })
            if (voiceNotes.length) {
              self.scheduleSynthMelody(ctx, melodyGain, voicePlan, voiceNotes, start, register)
            }
          }
        } else if (voiceNotes.length) {
          self.scheduleSynthMelody(ctx, melodyGain, voicePlan, voiceNotes, start, register)
        }
      })
    }

    return usedReal
  }

  AudioEngine.prototype.scheduleSampleTremolo = function (ctx, dest, note, srcBuffer, baseRate, start, register) {
    const step = 0.12
    const end = start + note.time + note.duration
    let at = start + note.time
    while (at < end - 0.025) {
      const sliceDur = Math.min(step * 0.88, end - at)
      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      src.buffer = srcBuffer
      src.playbackRate.setValueAtTime(baseRate, at)
      env.gain.setValueAtTime(0.0001, at)
      env.gain.linearRampToValueAtTime(note.velocity * 0.62, at + 0.008)
      env.gain.exponentialRampToValueAtTime(0.001, at + Math.max(0.035, sliceDur))
      src.connect(env)
      env.connect(dest)
      register(src)
      src.start(at, 0, Math.min(srcBuffer.duration, sliceDur * baseRate + 0.04))
      src.stop(at + sliceDur + 0.04)
      at += step
    }
  }

  function pluckedSampleTriggers(items, sequenceEnd, retriggerRepeated) {
    const triggers = []
    let lastMidi = null
    ;(items || [])
      .filter(function (item) {
        return item && item.midi != null && isFinite(Number(item.time))
      })
      .slice()
      .sort(function (a, b) {
        return a.time - b.time
      })
      .forEach(function (item) {
        const midi = Math.round(Number(item.midi))
        if (!isFinite(midi)) return
        const itemTime = clamp(Number(item.time) || 0, 0, Math.max(0, sequenceEnd))
        if (!triggers.length || retriggerRepeated || midi !== lastMidi) {
          triggers.push(Object.assign({}, item, { time: itemTime, midi: midi }))
          lastMidi = midi
        }
      })
    return triggers
  }

  function schedulePluckedSampleSequence(ctx, dest, plan, items, instBuffers, start, sequenceEnd, register, options) {
    options = options || {}
    const asset = plan.melodyAsset
    const buffer = instBuffers.melody
    const sampleBuffers = instBuffers.melodySamples
    const multi = isMultiSample(asset)
    const triggers = pluckedSampleTriggers(items, sequenceEnd, !!options.retriggerRepeated)
    const minEnvDuration = options.minEnvDuration || STROKE_TAP_SECONDS
    for (let i = 0; i < triggers.length; i++) {
      const item = triggers[i]
      const next = triggers[i + 1]
      const eventStart = clamp(Number(item.time) || 0, 0, sequenceEnd)
      let eventEnd = next ? next.time : sequenceEnd
      if (item.duration != null && isFinite(Number(item.duration))) {
        eventEnd = Math.min(eventEnd, eventStart + Math.max(0, Number(item.duration)))
      }
      const eventDuration = Math.max(0.03, eventEnd - eventStart)
      const envDuration = Math.max(eventDuration, minEnvDuration)
      const when = start + eventStart
      const segment = nearestSampleSegment(asset, item.midi)
      const srcBuffer = multi ? sampleBufferFor(sampleBuffers, segment, buffer) : buffer
      if (!srcBuffer) continue
      const baseRate = segmentPlaybackRate(asset, item.midi, segment)
      const fallbackOffset = 0
      const sourceBounds = multi ? { offset: 0, duration: audioBufferDuration(srcBuffer) } : sampleSegmentBounds(srcBuffer, segment, fallbackOffset)
      const offset = sourceBounds.offset
      const usableSourceDur = sourceBounds.duration
      if (!(usableSourceDur > 0.01)) continue

      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      const velocity = item.velocity == null ? 0.7 : item.velocity
      const srcPlaySeconds = Math.max(eventDuration + 0.18, minEnvDuration)
      src.buffer = srcBuffer
      src.playbackRate.setValueAtTime(baseRate, when)
      applySampleMelodyEnv(env, melodyPlaybackEnvPeak(plan, velocity * 0.85), when, envDuration, 0.012, plan)
      connectGugakSampleTone(ctx, src, env, plan, when)
      const noteGain = connectMelodyEnv(ctx, env, dest, plan, [item], start, when, 0.001)

      try {
        const srcDur = Math.max(0.001, safeBufferDuration(src.buffer, offset, Math.min(usableSourceDur, srcPlaySeconds * baseRate + 0.02)))
        src.start(when, safeBufferOffset(src.buffer, offset), srcDur)
        src.stop(when + srcPlaySeconds + 0.05)
        register(src)
      } catch (e) {
        warnScheduleFallback("pluck sample start failed", e, {
          instrument: plan.instrument && plan.instrument.id,
          offset: offset,
          sourceDuration: usableSourceDur,
          bufferDuration: audioBufferDuration(src.buffer),
        })
        disconnectQuietly(src, env, noteGain)
      }
    }
  }

  // ⚠ source.buffer 는 "한 번만" 설정(이중 설정 시 브라우저 throw → 선율 무음).
  // continuousSustainPlan 이후 공통 블록: source 노드 설정·글라이드·엔벨로프·start/stop.
  // scheduleSampleStrokes / scheduleSampleMelody 두 경로의 공통 코어.
  function _scheduleSampleSourceNode(ctx, dest, plan, asset, segment, sustain, baseRate,
                                      phraseStart, phraseDuration, phraseStop,
                                      events, start, glideSeconds, attackSeconds, envPeakArg, register) {
    const env = ctx.createGain()
    const startOffset = sustain.offset
    const startSourceDur = sustain.duration
    const src = ctx.createBufferSource()
    src.buffer = sustain.buffer
    applySustainPlanToSource(src, sustain)
    src.playbackRate.setValueAtTime(baseRate, phraseStart)
    for (let k = 1; k < events.length; k++) {
      const ev = events[k]
      const nextRate = segmentPlaybackRate(asset, ev.midi, segment)
      src.playbackRate.setTargetAtTime(nextRate, start + ev.time, glideSeconds)
    }
    applySampleMelodyEnv(env, melodyPlaybackEnvPeak(plan, envPeakArg * 0.85), phraseStart, phraseDuration, attackSeconds, plan)
    connectGugakSampleTone(ctx, src, env, plan, phraseStart)
    const noteGain = connectMelodyEnv(ctx, env, dest, plan, events, start, phraseStart, glideSeconds)
    try {
      if (src.loop) {
        src.start(phraseStart, safeBufferOffset(src.buffer, startOffset))
      } else {
        const srcDur = Math.max(0.001, safeBufferDuration(src.buffer, startOffset, Math.min(startSourceDur, phraseDuration * baseRate + 0.18)))
        src.start(phraseStart, safeBufferOffset(src.buffer, startOffset), srcDur)
      }
      src.stop(phraseStop + 0.18)
      register(src)
    } catch (e) {
      warnScheduleFallback("샘플 프레이즈 시작 실패", e, {
        instrument: plan.instrument && plan.instrument.id,
        offset: startOffset,
        sourceDuration: startSourceDur,
        bufferDuration: audioBufferDuration(src.buffer),
      })
      disconnectQuietly(src, env, noteGain)
    }
  }

  AudioEngine.prototype.scheduleSampleStrokes = function (ctx, dest, plan, strokeSegments, instBuffers, start, register) {
    const asset = plan.melodyAsset
    const buffer = instBuffers.melody
    const sampleBuffers = instBuffers.melodySamples
    const multi = isMultiSample(asset)
    const samplePhrase = asset.sampleMode === "phrase"
    const glideSeconds = liveNoteGlideSeconds(plan)
    const attackSeconds = 0.035
    for (const stroke of strokeSegments || []) {
      if (!stroke || !stroke.events || !stroke.events.length) continue
      if (isGayageumPlan(plan)) {
        schedulePluckedSampleSequence(ctx, dest, plan, stroke.events, instBuffers, start, stroke.end, register)
        continue
      }
      const first = stroke.events[0]
      const phraseStart = start + stroke.start
      const phraseDuration = Math.max(0.03, stroke.duration)
      const phraseStop = start + stroke.end
      const segment = nearestSampleSegment(asset, first.midi)
      const srcBuffer = multi ? sampleBufferFor(sampleBuffers, segment, buffer) : buffer
      if (!srcBuffer) continue
      const baseRate = segmentPlaybackRate(asset, first.midi, segment)
      const fallbackOffset = segment ? 0 : samplePhrase ? Math.min(0.05, Math.max(0, audioBufferDuration(srcBuffer) * 0.08)) : 0
      const sourceBounds = multi ? { offset: 0, duration: audioBufferDuration(srcBuffer) } : sampleSegmentBounds(srcBuffer, segment, fallbackOffset)
      const offset = sourceBounds.offset
      const usableSourceDur = sourceBounds.duration
      if (!(usableSourceDur > 0.01)) continue
      const sustain = continuousSustainPlan(ctx, srcBuffer, offset, usableSourceDur, plan, segment)
      _scheduleSampleSourceNode(ctx, dest, plan, asset, segment, sustain, baseRate,
        phraseStart, phraseDuration, phraseStop,
        stroke.events, start, glideSeconds, attackSeconds, 0.7, register)
    }
  }

  AudioEngine.prototype.scheduleSampleMelody = function (ctx, dest, plan, notes, instBuffers, start, register) {
    const asset = plan.melodyAsset
    const buffer = instBuffers.melody
    const sampleBuffers = instBuffers.melodySamples
    const multi = isMultiSample(asset)
    const samplePhrase = asset.sampleMode === "phrase"
    const glideSeconds = noteGlideSeconds(plan)
    const attackSeconds = phraseAttackSeconds(plan)
    if (isGayageumPlan(plan)) {
      const phrases = contiguousPhrases(notes)
      for (const phraseNotes of phrases) {
        schedulePluckedSampleSequence(ctx, dest, plan, phraseNotes, instBuffers, start, phraseEnd(phraseNotes), register, {
          retriggerRepeated: true,
        })
      }
      return
    }
    if (multi) {
      const phrases = contiguousPhrases(notes)
      for (const phraseNotes of phrases) {
        const first = phraseNotes[0]
        const last = phraseNotes[phraseNotes.length - 1]
        const phraseStart = start + first.time
        const phraseDuration = phraseEnd(phraseNotes) - first.time
        const phraseStop = start + last.time + last.duration
        const segment = nearestSampleSegment(asset, first.midi)
        const srcBuffer = sampleBufferFor(sampleBuffers, segment, buffer)
        if (!srcBuffer) continue
        const baseRate = segmentPlaybackRate(asset, first.midi, segment)
        const usableSourceDur = audioBufferDuration(srcBuffer)
        if (!(usableSourceDur > 0.01)) continue
        // 라이브 미리듣기와 같은 기준으로 지속음(loop)을 건다. source.buffer 는 한 번만 설정.
        const sustain = continuousSustainPlan(ctx, srcBuffer, 0, usableSourceDur, plan, segment)
        _scheduleSampleSourceNode(ctx, dest, plan, asset, segment, sustain, baseRate,
          phraseStart, phraseDuration, phraseStop,
          phraseNotes, start, glideSeconds, attackSeconds, first.velocity, register)
      }
      return
    }
    const phrases = contiguousPhrases(notes)
    for (const notes of phrases) {
      const first = notes[0]
      const last = notes[notes.length - 1]
      const phraseStart = start + first.time
      const phraseDuration = phraseEnd(notes) - first.time
      const phraseStop = start + last.time + last.duration
      const segment = nearestSampleSegment(asset, first.midi)
      const srcBuffer = buffer
      if (!srcBuffer) continue
      const baseRate = segmentPlaybackRate(asset, first.midi, segment)
      const fallbackOffset = segment ? 0 : samplePhrase ? this.phraseOffset(srcBuffer, first) : 0
      const sourceBounds = sampleSegmentBounds(srcBuffer, segment, fallbackOffset)
      const offset = sourceBounds.offset
      const usableSourceDur = sourceBounds.duration
      if (!(usableSourceDur > 0.01)) continue
      // 길게 그린 선은 샘플 원본보다 길어도 한 음으로 이어지고, 짧게 그려도 라이브처럼 안 끊긴다.
      const sustain = continuousSustainPlan(ctx, srcBuffer, offset, usableSourceDur, plan, segment)
      _scheduleSampleSourceNode(ctx, dest, plan, asset, segment, sustain, baseRate,
        phraseStart, phraseDuration, phraseStop,
        notes, start, glideSeconds, attackSeconds, first.velocity, register)
    }
  }

  AudioEngine.prototype.scheduleSynthMelody = function (ctx, dest, plan, notes, start, register) {
    const voice = synthVoiceFor(plan.instrument)
    const glideSeconds = noteGlideSeconds(plan)
    const attackSeconds = phraseAttackSeconds(plan)
    const phrases = contiguousPhrases(notes)
    for (const notes of phrases) {
      const first = notes[0]
      const last = notes[notes.length - 1]
      const phraseStart = start + first.time
      const phraseDuration = phraseEnd(notes) - first.time
      const phraseStop = start + last.time + last.duration
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      const filter = ctx.createBiquadFilter()
      osc.type = voice.waveform
      osc.frequency.setValueAtTime(midiToFreq(first.midi), phraseStart)
      for (let k = 1; k < notes.length; k++) {
        const note = notes[k]
        osc.frequency.setTargetAtTime(midiToFreq(note.midi), start + note.time, glideSeconds)
      }
      for (let k = 0; k < notes.length; k++) {
        const note = notes[k]
        this.applySigimsae(null, osc, midiToFreq(note.midi), note, plan, start + note.time, {
          skipGrace: isHaegeumPlan(plan) && k > 0,
        })
      }
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(voice.cutoff, phraseStart)
      filter.Q.setValueAtTime(voice.Q, phraseStart)
      // 합성 선율은 실제 샘플(0.85)보다 작게 들려 묻히므로 피크를 끌어올림.
      applyMelodyEnv(env, melodyPlaybackEnvPeak(plan, first.velocity * 0.78), phraseStart, phraseDuration, attackSeconds, plan)
      osc.connect(filter)
      filter.connect(env)
      connectMelodyEnv(ctx, env, dest, plan, notes, start, phraseStart, glideSeconds)
      register(osc)
      osc.start(phraseStart)
      osc.stop(phraseStop + 0.18)
    }
  }

  // 리듬형: 타격 온셋마다 짧은 음/타격
  AudioEngine.prototype.scheduleRhythm = function (ctx, dest, plan, buffers, start, register) {
    const onsets = plan.rhythmHits || []
    const tonic = plan.style.root + 12
    onsets.forEach((h) => {
      const at = start + h.time
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = "triangle"
      osc.frequency.setValueAtTime(midiToFreq(tonic), at)
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime((h.velocity || 0.7) * 0.4, at + 0.005)
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.18)
      osc.connect(env)
      env.connect(dest)
      register(osc)
      osc.start(at)
      osc.stop(at + 0.22)
    })
  }

  // 시김새: source(샘플) 또는 osc(합성)에 피치 자동화 적용
  AudioEngine.prototype.applySigimsae = function (source, osc, baseValue, note, plan, t0, options) {
    const durationBeats = note.duration / 0.5
    const segs = Core.sigimsaeFor({ gugak: plan.gugak, durationBeats: durationBeats })
    if (!segs.length) return
    const noteLen = note.duration
    for (const seg of segs) {
      const at = t0 + clamp(seg.at, 0, 0.95) * noteLen
      if (seg.type === "grace") {
        if (options && options.skipGrace) continue
        // 꺾음: 짧게 위로 꺾었다가 본음으로
        if (source) {
          const up = baseValue * Math.pow(2, seg.semitones / 12)
          source.playbackRate.setValueAtTime(up, t0)
          source.playbackRate.linearRampToValueAtTime(baseValue, t0 + Math.min(seg.dur, noteLen * 0.5))
        } else if (osc) {
          const up = baseValue * Math.pow(2, seg.semitones / 12)
          osc.frequency.setValueAtTime(up, t0)
          osc.frequency.linearRampToValueAtTime(baseValue, t0 + Math.min(seg.dur, noteLen * 0.5))
        }
      } else if (seg.type === "vibrato") {
        // 떠는음: detune 진동
        const param = source ? source.detune : osc ? osc.detune : null
        if (param) {
          const cycles = Math.max(2, Math.floor((noteLen - seg.at * noteLen) * seg.rateHz))
          const stepT = noteLen / (seg.rateHz * 2)
          let tt = at
          for (let c = 0; c < cycles && tt < t0 + noteLen; c++) {
            param.linearRampToValueAtTime(c % 2 === 0 ? seg.cents : -seg.cents, tt)
            tt += stepT
          }
          param.linearRampToValueAtTime(0, t0 + noteLen)
        }
      } else if (seg.type === "slide") {
        // 흘러내림: 끝에서 아래로
        const target = baseValue * Math.pow(2, seg.semitones / 12)
        if (source) {
          source.playbackRate.setValueAtTime(baseValue, at)
          source.playbackRate.linearRampToValueAtTime(target, t0 + noteLen)
        } else if (osc) {
          osc.frequency.setValueAtTime(baseValue, at)
          osc.frequency.linearRampToValueAtTime(target, t0 + noteLen)
        }
      }
    }
  }

  AudioEngine.prototype.phraseOffset = function (buffer, note) {
    const maxOffset = Math.max(0, audioBufferDuration(buffer) - 2.4)
    if (maxOffset === 0) return 0
    const seed = Math.sin((note.time + 1) * 41.73 + note.midi * 5.91) * 10000
    return (seed - Math.floor(seed)) * maxOffset
  }

  AudioEngine.prototype.scheduleSynthPad = function (ctx, dest, plan, start, register) {
    const dur = plan.duration
    const graph = AudioPadGraph.createSynthPadGraph(ctx, dest, plan, start)
    const padGain = graph.gain
    const targetGain = backgroundOutputGain(plan)
    padGain.gain.setValueAtTime(targetGain * 0.35, start)
    padGain.gain.linearRampToValueAtTime(targetGain, start + 0.45)
    padGain.gain.setValueAtTime(targetGain, start + Math.max(1.6, dur - 1.5))
    padGain.gain.linearRampToValueAtTime(0, start + dur)
    graph.sources.forEach((source, index) => {
      register(source, [graph.cleanupNodes[index]])
      source.start(start)
      source.stop(start + dur + 0.2)
    })
  }

  // --- 라이브 재생 ---

  AudioEngine.prototype.stop = function (options) {
    const emitState = !options || options.emitState !== false
    const hadPlayback = this.isPlaying || this.isPaused || this.isStarting || !!this.master || !!this.stopTimer || !!this.ambience
    this.lastStopReason = options && options.ended ? "ended" : "stopped"
    this.playGen++ // 진행 중인 비동기 play() 를 무효화(로딩 중 정지가 확실히 먹히도록)
    this.previewGen++ // suspend/디코드 완료를 기다리는 미리듣기가 정지 뒤 다시 시작되지 않게 한다.
    this.isPaused = false
    this.isStarting = false
    this.pauseRemainingMs = 0
    this.playEndsAtMs = 0
    this.stopLivePreview(true)
    this.stopAmbience(true)
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.master) {
      try {
        this.master.gain.cancelScheduledValues(0)
        this.master.disconnect()
      } catch (e) {}
    }
    this.transportScope.stopAll(0)
    this.previewScope.stopAll(0)
    this.master = null
    this.isPlaying = false
    // 일시정지(suspend) 상태로 멈췄다면 컨텍스트를 다시 깨워 다음 재생에 대비
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        this.ctx.resume()
      } catch (e) {}
    }
    if (emitState && hadPlayback) this.emitState()
  }

  // 일시정지 — 컨텍스트를 suspend 해 스케줄된 소리를 그 자리에서 멈춘다(자동 정지 타이머도 보류).
  AudioEngine.prototype.pause = function () {
    const hasAudio = this.isPlaying || !!this.master || !!this.stopTimer || !!this.ambience
    if (!hasAudio || this.isPaused || !this.ctx || this.ctx.state !== "running") return false
    this.isPaused = true
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    this.pauseRemainingMs = this.isPlaying ? Math.max(0, this.playEndsAtMs - Date.now()) : 0
    try {
      this.ctx.suspend()
    } catch (e) {}
    this.emitState()
    return true
  }

  // 이어재생 — 멈춘 지점에서 다시 진행하고 남은 시간만큼 자동 정지 타이머를 다시 건다.
  AudioEngine.prototype.resume = function () {
    if (!this.isPaused || !this.ctx) return false
    const resumePlayback = this.isPlaying
    this.isPaused = false
    try {
      this.ctx.resume()
    } catch (e) {}
    if (resumePlayback) {
      this.playEndsAtMs = Date.now() + this.pauseRemainingMs
      const self = this
      if (this.stopTimer) clearTimeout(this.stopTimer)
      this.stopTimer = setTimeout(function () {
        self.stop({ ended: true })
      }, this.pauseRemainingMs)
    } else {
      this.pauseRemainingMs = 0
    }
    this.emitState()
    return true
  }

  AudioEngine.prototype._liveSignature = function (plan) {
    return plan.instrument.id + "|" + plan.style.id + "|" + plan.mode
  }

  AudioEngine.prototype._liveUiMidi = function (plan, normY) {
    return Core.quantizePitch(normY, plan.pitchStyle || plan.style, plan.melodyAsset)
  }

  AudioEngine.prototype._liveMidi = function (plan, normY) {
    const uiMidi = this._liveUiMidi(plan, normY)
    return playbackMidiForInstrument(uiMidi, plan.instrument, plan.melodyAsset)
  }

  AudioEngine.prototype._liveFrequency = function (plan, normY) {
    const midi = this._liveMidi(plan, normY)
    return midi == null ? null : midiToFreq(midi)
  }

  AudioEngine.prototype._livePlaybackRate = function (plan, normY) {
    const midi = this._liveMidi(plan, normY)
    if (midi == null) return null
    return segmentPlaybackRate(plan.melodyAsset, midi, nearestSampleSegment(plan.melodyAsset, midi))
  }

  AudioEngine.prototype._createSampleLivePreview = function (ctx, plan, buffer, normY) {
    const uiMidi = this._liveUiMidi(plan, normY)
    const midi = playbackMidiForInstrument(uiMidi, plan.instrument, plan.melodyAsset)
    if (midi == null) return null
    const start = ctx.currentTime + 0.005
    const env = ctx.createGain()
    const noteGain = ctx.createGain()
    let filter = null
    const noteEnvPeak = 0.7 * 0.85
    const baseTargetGain = livePreviewTargetGain(plan, noteEnvPeak)
    const targetGain = livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi)
    const noteGainValue = baseTargetGain > 0 ? targetGain / baseTargetGain : 1
    const multi = isMultiSample(plan.melodyAsset)
    const segment = nearestSampleSegment(plan.melodyAsset, midi)
    const fallbackOffset = segment ? 0 : Math.min(0.05, Math.max(0, audioBufferDuration(buffer) * 0.08))
    const sourceBounds = multi ? { offset: 0, duration: audioBufferDuration(buffer) } : sampleSegmentBounds(buffer, segment, fallbackOffset)
    const offset = sourceBounds.offset
    const segmentDur = sourceBounds.duration
    if (!(segmentDur > 0.01)) return null
    const baseRate = segmentPlaybackRate(plan.melodyAsset, midi, segment)

    env.gain.setValueAtTime(0.0001, start)
    env.gain.linearRampToValueAtTime(baseTargetGain, start + 0.035)
    noteGain.gain.setValueAtTime(noteGainValue, start)

    // 멀티샘플(서양 선율)은 원음 음색을 그대로 살리기 위해 필터 없이 source → env 직결.
    // 풀 플레이백(connectGugakSampleTone)과 동일한 신호 경로.
    const useFilter = !multi && !isGayageumPlan(plan)
    if (useFilter) {
      filter = ctx.createBiquadFilter()
      configureSampleToneFilter(filter, plan, start)
      filter.connect(env)
    }
    env.connect(noteGain)
    noteGain.connect(ctx.destination)

    // 재생 스케줄러와 똑같은 지속음 정책. source.buffer 는 "한 번만" 설정(이중 설정 시 무음).
    const sustain = continuousSustainPlan(ctx, buffer, offset, segmentDur, plan, segment)
    const source = ctx.createBufferSource()
    source.buffer = sustain.buffer
    applySustainPlanToSource(source, sustain)
    source.playbackRate.setValueAtTime(baseRate, start)

    if (useFilter) source.connect(filter)
    else source.connect(env)

    const live = {
      kind: "sample",
      source: source,
      env: env,
      noteGain: noteGain,
      noteEnvPeak: noteEnvPeak,
      baseTargetGain: baseTargetGain,
      filter: filter,
      rateParam: source.playbackRate,
      rateParams: [source.playbackRate],
      signature: this._liveSignature(plan),
      sampleMidi: segment ? segment.midi : null,
      stopNodes: [source],
    }
    source.onended = function () {
      ;[source, env, noteGain, filter].forEach(function (node) {
        try {
          node.disconnect()
        } catch (e) {}
      })
    }
    source.start(start, sustain.offset)
    return live
  }

  AudioEngine.prototype._createSynthLivePreview = function (ctx, plan, normY) {
    const uiMidi = this._liveUiMidi(plan, normY)
    const midi = playbackMidiForInstrument(uiMidi, plan.instrument, plan.melodyAsset)
    if (midi == null) return null
    const frequency = midiToFreq(midi)
    const start = ctx.currentTime + 0.005
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const noteGain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    const noteEnvPeak = 0.7 * 0.78
    const baseTargetGain = livePreviewTargetGain(plan, noteEnvPeak)
    const targetGain = livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi)
    const noteGainValue = baseTargetGain > 0 ? targetGain / baseTargetGain : 1
    const voice = synthVoiceFor(plan.instrument)

    osc.type = voice.waveform
    osc.frequency.setValueAtTime(frequency, start)
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(voice.cutoff, start)
    filter.Q.setValueAtTime(voice.Q, start)

    lfo.type = "sine"
    lfo.frequency.setValueAtTime(voice.vibratoRate || 0.01, start)
    lfoGain.gain.setValueAtTime(voice.vibratoDepth, start)
    lfo.connect(lfoGain)
    lfoGain.connect(osc.detune)

    env.gain.setValueAtTime(0.0001, start)
    env.gain.linearRampToValueAtTime(baseTargetGain, start + 0.035)
    noteGain.gain.setValueAtTime(noteGainValue, start)
    if (isGayageumPlan(plan)) env.gain.exponentialRampToValueAtTime(0.001, start + 0.72)
    osc.connect(filter)
    filter.connect(env)
    env.connect(noteGain)
    noteGain.connect(ctx.destination)

    const live = {
      osc: osc,
      env: env,
      noteGain: noteGain,
      noteEnvPeak: noteEnvPeak,
      baseTargetGain: baseTargetGain,
      filter: filter,
      lfo: lfo,
      lfoGain: lfoGain,
      signature: this._liveSignature(plan),
      stopNodes: [osc, lfo],
    }
    osc.onended = function () {
      ;[osc, env, noteGain, filter, lfo, lfoGain].forEach(function (node) {
        try {
          node.disconnect()
        } catch (e) {}
      })
    }
    osc.start(start)
    lfo.start(start)
    return live
  }

  AudioEngine.prototype._createLivePreview = function (ctx, plan, normY, buffer) {
    if (this._liveMidi(plan, normY) == null) return null
    if (buffer && plan.melodyAsset && plan.melodyAsset.src) {
      return this._createSampleLivePreview(ctx, plan, buffer, normY)
    }
    return this._createSynthLivePreview(ctx, plan, normY)
  }

  AudioEngine.prototype.liveDrawingStart = function (recipe, normY) {
    const ctx = this.ensureContext()
    if (this.isPaused) {
      this.stopLivePreview(true)
      return Promise.resolve()
    }
    const self = this
    const run = function () {
      // 전체곡 재생 중에도 펜 소리가 들리도록 재생은 멈추지 않고 라이브 미리듣기만 새로 깐다.
      // (라이브 미리듣기는 ctx.destination에 직접 연결돼 본 재생 master와 독립적으로 믹스된다.)
      self.stopLivePreview(true)
      const token = ++self.livePreviewToken
      const plan = self.resolvePlan(recipe, [])
      const midi = self._liveMidi(plan, normY)
      if (midi == null) return Promise.resolve()
      const asset = plan.melodyAsset
      // 멀티샘플이면 현재 음높이에 가장 가까운 실제 녹음 파일을 불러온다(음 바뀌면 liveDrawingMove가 다시 호출).
      let src = asset && asset.src
      if (isMultiSample(asset)) {
        const seg = nearestSampleSegment(asset, midi)
        if (seg && seg.src) src = seg.src
      }
      if (src) {
        return self.loadBuffer(ctx, src).then(function (buffer) {
          if (token !== self.livePreviewToken) return
          self.livePreview = self._createLivePreview(ctx, plan, normY, buffer)
        })
      }
      self.livePreview = self._createLivePreview(ctx, plan, normY, null)
      return Promise.resolve()
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    return run()
  }

  AudioEngine.prototype.liveDrawingMove = function (recipe, normY) {
    const ctx = this.ensureContext()
    if (this.isPaused) {
      this.stopLivePreview(true)
      return Promise.resolve()
    }
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const uiMidi = self._liveUiMidi(plan, normY)
      const midi = playbackMidiForInstrument(uiMidi, plan.instrument, plan.melodyAsset)
      if (midi == null) {
        self.stopLivePreview(true)
        return
      }
      if (!self.livePreview || self.livePreview.signature !== self._liveSignature(plan)) {
        self.liveDrawingStart(recipe, normY)
        return
      }
      const now = ctx.currentTime
      const liveGlideSeconds = liveNoteGlideSeconds(plan)
      if (self.livePreview.noteGain) {
        const nextTargetGain = livePreviewNoteTargetGain(plan, self.livePreview.noteEnvPeak || 0.7 * 0.85, uiMidi)
        const baseTargetGain = self.livePreview.baseTargetGain || 1
        const nextGain = baseTargetGain > 0 ? nextTargetGain / baseTargetGain : 1
        self.livePreview.noteGain.gain.cancelScheduledValues(now)
        self.livePreview.noteGain.gain.setTargetAtTime(nextGain, now, liveGlideSeconds)
      }
      if (self.livePreview.kind === "sample") {
        if (isMultiSample(plan.melodyAsset)) {
          // 멀티샘플(서양 선율): 드로잉 중엔 시작 시 불러온 한 음을 기준으로 피치만 매끄럽게 글라이드.
          // (음마다 파일을 비동기로 다시 불러오면 빠른 드로잉에서 매번 무효화돼 소리가 안 남)
          const baseMidi =
            self.livePreview.sampleMidi != null
              ? self.livePreview.sampleMidi
              : plan.melodyAsset.baseMidi != null
                ? plan.melodyAsset.baseMidi
                : midi
          const nextRate = Math.pow(2, (midi - baseMidi) / 12)
          ;(self.livePreview.rateParams || [self.livePreview.rateParam]).forEach(function (rateParam) {
            if (!rateParam) return
            rateParam.cancelScheduledValues(now)
            rateParam.setTargetAtTime(nextRate, now, liveGlideSeconds)
          })
        } else {
          const nextSegment = nearestSampleSegment(plan.melodyAsset, midi)
          const nextSampleMidi = nextSegment ? nextSegment.midi : null
          if (nextSampleMidi !== self.livePreview.sampleMidi) {
            self.stopLivePreview(true)
            self.liveDrawingStart(recipe, normY)
            return
          }
          const nextRate = segmentPlaybackRate(plan.melodyAsset, midi, nextSegment)
          ;(self.livePreview.rateParams || [self.livePreview.rateParam]).forEach(function (rateParam) {
            if (!rateParam) return
            rateParam.cancelScheduledValues(now)
            rateParam.setTargetAtTime(nextRate, now, liveGlideSeconds)
          })
        }
      } else {
        const nextFreq = midiToFreq(midi)
        self.livePreview.osc.frequency.cancelScheduledValues(now)
        self.livePreview.osc.frequency.setTargetAtTime(nextFreq, now, liveGlideSeconds)
      }
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    run()
    return Promise.resolve()
  }

  AudioEngine.prototype.liveDrawingEnd = function () {
    this.stopLivePreview(false)
  }

  AudioEngine.prototype.stopLivePreview = function (immediate) {
    this.livePreviewToken += 1
    const live = this.livePreview
    if (!live || !this.ctx) return
    this.livePreview = null
    const now = this.ctx.currentTime
    const stopAt = immediate ? now : now + 0.09
    try {
      live.env.gain.cancelScheduledValues(now)
      live.env.gain.setTargetAtTime(0.0001, now, immediate ? 0.001 : 0.025)
    } catch (e) {}
    try {
      ;(live.stopNodes || []).forEach(function (node) {
        try {
          node.stop(stopAt)
        } catch (e) {}
      })
    } catch (e) {}
  }

  // --- 드로잉 화면 배경음(패드 루프) ---
  // 라이브 선율 프리뷰와 독립적으로 깔리지만, 사용자가 누르는 정지/일시정지에는 같이 반응한다.

  // 배경 음원(특히 큰 배경 mp3)을 미리 디코드해 두어, 드로잉 진입 시 즉시 깔리게 한다.
  AudioEngine.prototype.warmAmbience = function (recipe) {
    const ctx = this.ensureContext()
    const plan = this.resolvePlan(recipe, [])
    const padAsset = plan.padAsset && plan.padAsset.src ? plan.padAsset : plan.backgroundAsset
    if (!padAsset || !padAsset.src) return Promise.resolve(null)
    return this.loadAssetBuffer(ctx, padAsset)
  }

  AudioEngine.prototype._ambienceSignature = function (plan) {
    return plan.atmosphere.id + "|" + plan.version.id + "|" + plan.bgOffset + "|" + plan.bgEndOffset
  }

  AudioEngine.prototype._startAmbienceBuffer = function (ctx, plan, buffer, sig) {
    const now = ctx.currentTime + 0.02
    const src = ctx.createBufferSource()
    const g = ctx.createGain()
    src.buffer = buffer
    const bgRange = backgroundRange(plan, buffer)
    src.loop = true
    src.loopStart = bgRange.start
    src.loopEnd = bgRange.end
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(backgroundOutputGain(plan), now + 0.4) // 빠른 페이드인 → 바로 들리게
    src.connect(g)
    g.connect(ctx.destination)
    src.start(now, bgRange.start)
    this.ambience = { signature: sig, gain: g, nodes: [src] }
  }

  AudioEngine.prototype._startAmbienceSynth = function (ctx, plan, sig) {
    const now = ctx.currentTime + 0.02
    const graph = AudioPadGraph.createSynthPadGraph(ctx, ctx.destination, plan, now)
    const padGain = graph.gain
    padGain.gain.setValueAtTime(0.0001, now)
    padGain.gain.linearRampToValueAtTime(backgroundOutputGain(plan), now + 0.5) // 빠른 페이드인 → 바로 들리게
    graph.sources.forEach(function (source) {
      source.start(now)
    })
    this.ambience = {
      signature: sig,
      gain: padGain,
      nodes: graph.sources,
      cleanupNodes: graph.cleanupNodes,
    }
  }

  AudioEngine.prototype.startAmbience = function (recipe) {
    const ctx = this.ensureContext()
    if (this.isPaused && ctx.state === "suspended") return Promise.resolve()
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const sig = self._ambienceSignature(plan)
      // 같은 배경·믹스로 이미 깔려 있으면 끊지 않는다(악기만 바꿔도 배경음 유지).
      if (self.ambience && self.ambience.signature === sig) return Promise.resolve()
      self.stopAmbience(true)
      // 배경음악 없음(plan.silent)이면 드로잉 배경 앰비언스도 합성 패드도 깔지 않는다.
      if (plan.silent) return Promise.resolve()
      const token = ++self.ambienceToken
      const padAsset = plan.padAsset && plan.padAsset.src ? plan.padAsset : plan.backgroundAsset
      if (padAsset && padAsset.src) {
        return self.loadAssetBuffer(ctx, padAsset).then(function (buffer) {
          if (token !== self.ambienceToken) return
          if (buffer) self._startAmbienceBuffer(ctx, plan, buffer, sig)
          else self._startAmbienceSynth(ctx, plan, sig)
        })
      }
      self._startAmbienceSynth(ctx, plan, sig)
      return Promise.resolve()
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    return run()
  }

  AudioEngine.prototype.stopAmbience = function (immediate) {
    this.ambienceToken += 1 // 진행 중인 startAmbience 로드를 무효화
    const amb = this.ambience
    this.ambience = null
    if (!amb || !this.ctx) return
    const now = this.ctx.currentTime
    const stopAt = immediate ? now : now + 0.5
    try {
      amb.gain.gain.cancelScheduledValues(now)
      amb.gain.gain.setTargetAtTime(0.0001, now, immediate ? 0.01 : 0.2)
    } catch (e) {}
    amb.nodes.forEach(function (node) {
      try {
        node.stop(stopAt)
      } catch (e) {}
      if (immediate) {
        try {
          node.disconnect()
        } catch (e) {}
      }
    })
    if (immediate) {
      ;(amb.cleanupNodes || []).forEach(function (node) {
        disconnectQuietly(node)
      })
      disconnectQuietly(amb.gain)
    }
  }

  AudioEngine.prototype._registerPreviewNode = function (node, cleanupNodes) {
    this.previewScope.track(node, cleanupNodes)
  }

  AudioEngine.prototype._previewSynth = function (ctx, plan, note, start) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const voice = synthVoiceFor(plan.instrument)
    osc.type = voice.waveform
    osc.frequency.setValueAtTime(midiToFreq(note.midi), start)
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(voice.cutoff, start)
    filter.Q.setValueAtTime(voice.Q, start)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.velocity * NOTE_PREVIEW_SYNTH_GAIN * previewOutputGain(plan) * noteMelodyOutputGain(plan, note), start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, start + note.duration)
    osc.connect(filter)
    filter.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(osc, [filter, env])
    osc.start(start)
    osc.stop(start + note.duration + 0.03)
  }

  AudioEngine.prototype._previewSample = function (ctx, plan, buffer, note, start) {
    const asset = plan.melodyAsset
    const multi = isMultiSample(asset)
    const src = ctx.createBufferSource()
    const env = ctx.createGain()
    const segment = nearestSampleSegment(asset, note.midi)
    const baseRate = segmentPlaybackRate(asset, note.midi, segment)
    const fallbackOffset = segment ? 0 : asset.sampleMode === "phrase" ? this.phraseOffset(buffer, note) : 0
    const sourceBounds = multi ? { offset: 0, duration: audioBufferDuration(buffer) } : sampleSegmentBounds(buffer, segment, fallbackOffset)
    const offset = sourceBounds.offset
    const usableSourceDur = sourceBounds.duration
    if (!(usableSourceDur > 0.01)) return
    src.buffer = buffer
    src.playbackRate.setValueAtTime(baseRate, start)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.velocity * NOTE_PREVIEW_SAMPLE_GAIN * previewOutputGain(plan) * noteMelodyOutputGain(plan, note), start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, start + note.duration)
    src.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(src, [env])
    src.start(start, offset, Math.min(usableSourceDur, note.duration * baseRate + 0.04))
    src.stop(start + note.duration + 0.03)
  }

  AudioEngine.prototype._playEffectBufferPreview = function (ctx, buffer, start) {
    const src = ctx.createBufferSource()
    const env = ctx.createGain()
    const duration = Math.min(buffer.duration || 0.8, 1.2)
    src.buffer = buffer
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(EFFECT_GAIN * 1.6, start + 0.015)
    env.gain.setTargetAtTime(0.001, start + Math.max(0.05, duration * 0.72), 0.06)
    src.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(src, [env])
    src.start(start, 0, duration)
    src.stop(start + duration + 0.04)
  }

  AudioEngine.prototype._previewEffectFallback = function (ctx, effect, start) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const filter = typeof ctx.createBiquadFilter === "function" ? ctx.createBiquadFilter() : null
    const id = (effect && effect.id) || ""
    const isThunder = /^thunder/.test(id)
    const isAnimal = /^animal/.test(id)
    const isPercussive = /^sfx(Bell|Tambourine|BubblePop)/.test(id)
    let fallbackFreq = 460
    if (isThunder) fallbackFreq = 120
    else if (/^animalWhale/.test(id)) fallbackFreq = 180
    else if (isAnimal) fallbackFreq = 760
    else if (/^sfxHarp/.test(id)) fallbackFreq = 880
    else if (isPercussive) fallbackFreq = 980
    else if (/^forest/.test(id)) fallbackFreq = 620
    else if (/^rain/.test(id)) fallbackFreq = 360
    osc.type = isThunder ? "triangle" : "sine"
    osc.frequency.setValueAtTime(fallbackFreq, start)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(EFFECT_GAIN * 0.9, start + 0.01)
    env.gain.exponentialRampToValueAtTime(0.001, start + 0.24)
    if (filter) {
      filter.type = isThunder || /^animalWhale/.test(id) ? "lowpass" : "bandpass"
      filter.frequency.setValueAtTime(isThunder ? 240 : /^animalWhale/.test(id) ? 320 : isPercussive ? 1800 : 900, start)
      filter.Q.setValueAtTime(isPercussive ? 1.4 : 0.8, start)
      osc.connect(filter)
      filter.connect(env)
    } else {
      osc.connect(env)
    }
    env.connect(ctx.destination)
    this._registerPreviewNode(osc, [filter, env])
    osc.start(start)
    osc.stop(start + 0.27)
  }

  AudioEngine.prototype.previewEffect = function (effect) {
    if (!effect || !effect.src) return Promise.resolve(false)
    const ctx = this.ensureContext()
    const self = this
    const previewGen = this.previewGen
    const run = function () {
      if (previewGen !== self.previewGen) return false
      const start = ctx.currentTime + 0.01
      const readyBuffer = effect.src ? self.decodedCache.get(effect.src) : null
      if (readyBuffer) {
        self._playEffectBufferPreview(ctx, readyBuffer, start)
        return Promise.resolve(true)
      }
      self._previewEffectFallback(ctx, effect, start)
      const requestedAt = ctx.currentTime
      return self.loadAssetBuffer(ctx, effect).then(function (buffer) {
        if (previewGen === self.previewGen && buffer && ctx.currentTime - requestedAt < 0.7) {
          self._playEffectBufferPreview(ctx, buffer, ctx.currentTime + 0.03)
        }
        return !!buffer
      })
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    return run()
  }

  AudioEngine.prototype.previewNote = function (recipe, normY) {
    const ctx = this.ensureContext()
    const self = this
    const previewGen = this.previewGen
    const run = function () {
      if (previewGen !== self.previewGen) return
      const plan = self.resolvePlan(recipe, [])
      const uiMidi = self._liveUiMidi(plan, normY)
      const midi = playbackMidiForInstrument(uiMidi, plan.instrument, plan.melodyAsset)
      if (midi == null) return
      const note = {
        time: 0,
        duration: 0.24,
        midi: midi,
        uiMidi: uiMidi,
        velocity: 0.7,
      }
      const start = ctx.currentTime + 0.01
      const asset = plan.melodyAsset
      // 멀티샘플이면 이 음에 가장 가까운 실제 녹음 파일을 미리듣기 한다.
      let src = asset && asset.src
      if (isMultiSample(asset)) {
        const seg = nearestSampleSegment(asset, note.midi)
        if (seg && seg.src) src = seg.src
      }
      const readyBuffer = src ? self.decodedCache.get(src) : null
      if (readyBuffer) {
        self._previewSample(ctx, plan, readyBuffer, note, start)
        return
      }
      // 디코딩 중인 Promise에 재생 콜백을 매달면 빠른 클릭들이 완료 순간 한꺼번에 울린다.
      // 준비 전에는 클릭마다 합성음을 즉시 한 번만 내고, 실제 샘플은 다음 클릭을 위해 워밍만 한다.
      if (src) self.loadBuffer(ctx, src)
      self._previewSynth(ctx, plan, note, start)
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    run()
    return Promise.resolve()
  }

  AudioEngine.prototype.play = async function (recipe, notes, options) {
    this.stop({ emitState: false })
    this.stopAmbience(true) // 완성곡 재생 중엔 드로잉 배경음을 끈다(중복 방지)
    const gen = ++this.playGen // 이 재생의 세대 토큰 (this.stop() 이 playGen 을 올린 뒤 새로 받음)
    this.isStarting = true
    try {
      this.isPaused = false
      this.pauseRemainingMs = 0
      const ctx = this.ensureContext()
      if (ctx.state === "suspended") await ctx.resume()
      if (gen !== this.playGen) return this.lastMode // 깨우는 사이 정지/재요청됨 → 중단
      const basePlan = this.resolvePlan(recipe, notes)
      const plan = this.seekPlan(basePlan, options && options.startOffset)
      const buffers = await this.preload(ctx, plan)
      if (gen !== this.playGen) return this.lastMode // 음원 디코드 사이 정지됨 → 소리 내지 않음
      const self = this
      const register = function (node, cleanupNodes) {
        self.transportScope.track(node, cleanupNodes)
      }
      const start = ctx.currentTime + 0.05
      const master = ctx.createGain()
      master.gain.setValueAtTime(MASTER_OUTPUT_GAIN, start)
      connectMasterToOutput(ctx, master, ctx.destination, start)
      this.master = master
      const usedReal = this.schedule(ctx, master, plan, buffers, start, register)
      this.lastMode = usedReal ? "real" : "synth"
      this.isPlaying = true
      this.emitState()
      const self2 = this
      this.playEndsAtMs = Date.now() + plan.duration * 1000 + 200
      this.stopTimer = setTimeout(function () {
        self2.stop({ ended: true })
      }, plan.duration * 1000 + 200)
      return this.lastMode
    } finally {
      if (gen === this.playGen) this.isStarting = false
    }
  }

  // --- 오프라인 렌더 + 오디오 내보내기 ---

  function supportedCompressedAudioMime() {
    if (!root.MediaRecorder) return ""
    const list = ["audio/webm;codecs=opus", "audio/webm"]
    for (const type of list) {
      if (!root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(type)) return type
    }
    return ""
  }

  AudioEngine.prototype.renderOffline = async function (recipe, notes) {
    const live = this.ensureContext()
    const sampleRate = live.sampleRate || 44100
    const plan = this.resolvePlan(recipe, notes)
    // 버퍼는 라이브 컨텍스트로 디코드해 재사용
    const buffers = await this.preload(live, plan)
    const length = Math.ceil(sampleRate * (plan.duration + 0.5))
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext
    const offline = new OAC(2, length, sampleRate)
    const master = offline.createGain()
    master.gain.setValueAtTime(MASTER_OUTPUT_GAIN, 0)
    connectMasterToOutput(offline, master, offline.destination, 0)
    const noop = function () {}
    this.schedule(offline, master, plan, buffers, 0, noop)
    return await offline.startRendering()
  }

  AudioEngine.prototype.renderCompressedAudioBlob = async function (recipe, notes, options) {
    options = options || {}
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null
    const mimeType = supportedCompressedAudioMime()
    if (!mimeType) throw new Error("Compressed WebM audio recording is not supported")
    const ctx = this.ensureContext()
    if (ctx.state === "suspended") await ctx.resume()
    if (typeof ctx.createMediaStreamDestination !== "function") {
      throw new Error("Audio recording destination is not supported")
    }
    if (onProgress) onProgress(0)
    const rendered = await this.renderOffline(recipe, notes)
    if (onProgress) onProgress(0.2)
    const dest = ctx.createMediaStreamDestination()
    const source = ctx.createBufferSource()
    source.buffer = rendered
    source.connect(dest)
    const chunks = []
    const recorderOptions = { mimeType: mimeType }
    if (options.audioBitsPerSecond) recorderOptions.audioBitsPerSecond = options.audioBitsPerSecond
    const recorder = new root.MediaRecorder(dest.stream, recorderOptions)
    let stopTimer = 0
    let progressTimer = 0
    let stopped = false
    const stopRecorder = function () {
      if (stopped) return
      stopped = true
      if (recorder.state !== "inactive") recorder.stop()
    }
    const done = new Promise(function (resolve, reject) {
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size) chunks.push(event.data)
      }
      recorder.onstop = resolve
      recorder.onerror = function (event) {
        reject((event && event.error) || new Error("MediaRecorder error"))
      }
    })
    try {
      source.onended = stopRecorder
      recorder.start()
      source.start(ctx.currentTime + 0.05)
      stopTimer = root.setTimeout(stopRecorder, Math.max(1000, (rendered.duration + 1) * 1000))
      if (onProgress && rendered.duration > 0) {
        const recStart = Date.now()
        const totalMs = rendered.duration * 1000
        progressTimer = root.setInterval(function () {
          const ratio = Math.min(1, (Date.now() - recStart) / totalMs)
          onProgress(0.2 + ratio * 0.7) // 20% → 90%
        }, 200)
      }
      await done
    } finally {
      if (stopTimer) root.clearTimeout(stopTimer)
      if (progressTimer) root.clearInterval(progressTimer)
      try {
        source.disconnect()
      } catch (e) {}
      try {
        dest.disconnect()
      } catch (e) {}
      dest.stream.getTracks().forEach((track) => track.stop())
    }
    if (onProgress) onProgress(0.9)
    if (!chunks.length) throw new Error("Compressed audio is empty")
    return new Blob(chunks, { type: mimeType })
  }

  AudioEngine.prototype.exportCompressedAudio = async function (recipe, notes, filename) {
    const blob = await this.renderCompressedAudioBlob(recipe, notes)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename || "sound-drawing.webm"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(function () {
      URL.revokeObjectURL(url)
    }, 2000)
    return { size: blob.size, mimeType: blob.type }
  }

  root.AudioEngine = AudioEngine
})(typeof self !== "undefined" ? self : this)
