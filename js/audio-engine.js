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
  if (!root.SDAudioSamples) throw new Error("audio-samples.js must load before audio-engine.js")
  const { continuousSustainPlan, applySustainPlanToSource } = root.SDAudioSamples({ core: Core, audioPlan: AudioPlan })
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
  const SOUND_LAYER_OUTPUT_GAIN = 0.8
  const BACKGROUND_OUTPUT_GAIN = 1.5
  const WESTERN_MELODY_OUTPUT_GAIN = 1.5
  // Instrument gain is calibrated from the stable sustain region of the default
  // drawing pitch rows, with violin as the reference loudness.
  // 악기끼리는 A-가중 크기(낮은 소리를 덜 세는 귀 기준, 음별 보정 뒤)로 맞춘다. 에너지(RMS)로 맞추면
  // 첼로 −3.8 · 더블베이스 −8.4 · 호른 −3.3 · 대금 −3.2 dB만큼 작게 들렸다(2026-10-03 비교 청취로 결정).
  // 뜯는 가야금만 RMS 그대로다. 해금은 울림통 공명을 깎은 뒤(HAEGEUM_RESONANCE_CUTS)를 재서 게인이 크다.
  // 값은 npm run measure:loudness 가 추천한 그대로 쓴다.
  const INSTRUMENT_MELODY_OUTPUT_GAINS = {
    flute: 2.45,
    oboe: 0.73,
    clarinet: 1.15,
    frenchHorn: 1.97,
    violin: 0.81,
    viola: 1.47,
    cello: 1.41,
    doubleBass: 0.94,
    sogeum: 0.53,
    daegeum: 1.70,
    danso: 0.25,
    haegeum: 2.00,
    gayageum: 0.47,
  }
  const NOTE_MELODY_OUTPUT_GAIN_LIMIT_DB = 3
  // 측정으로 승인된 ±12 dB 예외. 자동 루프 적용 범위와 분리한다.
  // 더블베이스는 샘플 사이 녹음 강약 차, 국악 4악기는 국립국악원 음계 녹음이 음마다 한 번뿐이라
  // 바꿀 녹음이 없고 음 사이 차이가 9~21 dB라서다(2026-10-03, 소금 낮은 음이 기준보다 10.9 dB 작았다).
  const AUTO_LOOP_NOTE_GAIN_LIMIT_DB = 12
  const WIDE_NOTE_GAIN_LIMIT_IDS = { doubleBass: true, sogeum: true, daegeum: true, danso: true, haegeum: true }
  // Per-note gain is measured inside each instrument after the instrument-level
  // calibration above and clamped to +/-3 dB so the sample character survives.
  const NOTE_MELODY_OUTPUT_GAINS = {
    flute: { 55: 1.392, 57: 1.039, 59: 1.214, 60: 1.373, 62: 0.888, 64: 0.877, 65: 1.003, 67: 0.764, 69: 1.049, 71: 1.049, 72: 1.413, 74: 0.751, 76: 0.97, 77: 0.97, 79: 1.098 },
    oboe: { 55: 1.287, 57: 1.358, 59: 0.963, 60: 0.862, 62: 1.297, 64: 0.708, 65: 0.708, 67: 1.125, 69: 0.761, 71: 1.169, 72: 1.169, 74: 1.145, 76: 1.275, 77: 1.208, 79: 1.413 },
    clarinet: { 55: 0.97, 57: 1.23, 59: 1.244, 60: 0.926, 62: 1.252, 64: 1.413, 65: 1.356, 67: 1.413, 69: 0.945, 71: 0.849, 72: 0.828, 74: 0.766, 76: 0.995, 77: 0.9, 79: 0.875 },
    frenchHorn: { 55: 1.16, 57: 1.413, 59: 1.391, 60: 1.413, 62: 1.413, 64: 1.299, 65: 1.129, 67: 0.974, 69: 0.905, 71: 0.902, 72: 1.413, 74: 1.146, 76: 0.744, 77: 0.802, 79: 0.708 },
    violin: { 55: 0.721, 57: 0.708, 59: 1.098, 60: 0.955, 62: 1.335, 64: 1.263, 65: 1.182, 67: 1.413, 69: 0.708, 71: 1.219, 72: 1.311, 74: 1.413, 76: 1.413, 77: 1.413, 79: 1.064 },
    viola: { 55: 1.413, 57: 1.337, 59: 0.708, 60: 0.848, 62: 1.413, 64: 1.413, 65: 1.413, 67: 1.413, 69: 1.405, 71: 0.94, 72: 1.26, 74: 1.26, 76: 1.169, 77: 0.885, 79: 1.251 },
    cello: { 55: 0.788, 57: 1.413, 59: 1.413, 60: 1.295, 62: 1.083, 64: 0.708, 65: 0.708, 67: 1.344, 69: 0.831, 71: 1.413, 72: 1.132, 74: 1.173, 76: 1.271, 77: 0.997, 79: 1.049 },
    doubleBass: { 55: 0.993, 57: 0.98, 59: 0.81, 60: 0.591, 62: 1.027, 64: 1.764, 65: 1.291, 67: 0.744, 69: 0.877, 71: 3.955, 72: 1.604, 74: 0.791, 76: 2.566, 77: 1.613, 79: 1.001 },
    sogeum: { 55: 3.981, 57: 3.981, 60: 3.981, 62: 3.981, 64: 2.816, 67: 2.318, 69: 1.425, 72: 1.425, 74: 0.606, 76: 0.478 },
    daegeum: { 55: 1.791, 57: 1.791, 60: 2.048, 62: 1.601, 64: 0.941, 67: 0.736, 69: 0.715, 72: 0.953, 74: 0.735, 76: 1.072 },
    danso: { 55: 2.02, 57: 2.02, 60: 1.05, 62: 1.05, 64: 1.146, 67: 1.12, 69: 1.12, 72: 0.86, 74: 0.708, 76: 0.708 },
    haegeum: { 55: 1.871, 57: 1.871, 60: 2.084, 62: 1.56, 64: 0.856, 67: 2.54, 69: 2.214, 72: 1.072, 74: 0.42, 76: 1.374 },
    gayageum: { 55: 1, 57: 1, 60: 1, 62: 1, 64: 1, 67: 1, 69: 1, 72: 1, 74: 1, 76: 1 },
  }
  const LIVE_PREVIEW_MAX_GAIN = 3.2
  // 실제 녹음 펜 소리의 기준 게인(악기 게인까지 곱한 값) 상한. 0.95 였을 때는 악기 게인이 큰 악기의
  // 펜 소리가 재생보다 작아 악기끼리 크기가 어긋났다(플루트·비올라·호른·클라리넷 0.3~1.8 dB, 2026-10-03 실측).
  // 가장 큰 기준 게인(플루트 · "그림소리 강조" 3.11)도 걸리지 않게 둔다. 플루트는 원음이 작아 게인이 크다.
  // 음별 보정까지 곱한 뒤의 상한. 보정을 온전히 전달하려면 최대 4.40 이 필요하다(플루트 · "그림소리 강조").
  // 게인이 큰 악기일수록 원음이 작아서 곱하면 상쇄된다. 실측 출력 피크(크롬 렌더, "그림소리 강조"):
  // 2026-07-29 2.109 필요·최대 0.241 / 2026-10-03 4.40 필요·서양 악기 펜 소리 최대 -12.6 dBFS(비올라, 플루트 -15.9).
  const LIVE_PREVIEW_NOTE_MAX_GAIN = 4.5
  // 음원 없이 열었을 때의 합성음은 원음 보정과 무관한 최대 진폭 파형이라 예전 천장을 그대로 쓴다.
  const SYNTH_LIVE_PREVIEW_MAX_GAIN = 0.95
  const SYNTH_LIVE_PREVIEW_NOTE_MAX_GAIN = 2.2
  const MASTER_OUTPUT_GAIN = 0.56
  const NOTE_PREVIEW_GAIN_BOOST = 2
  const NOTE_PREVIEW_SYNTH_GAIN = 0.24 * NOTE_PREVIEW_GAIN_BOOST
  const NOTE_PREVIEW_SAMPLE_GAIN = 0.34 * NOTE_PREVIEW_GAIN_BOOST
  const GUGAK_DRAWING_GAIN_BOOST = 1.3
  const NOTE_GLIDE_SECONDS = 0.035
  const LIVE_NOTE_GLIDE_SECONDS = 0.025
  // 해금 음 사이 미끄러짐의 시정수. 0.12초(펜 0.09초)는 0.5초짜리 음의 앞 3분의 1을 음정 사이에서 흐렸다
  // (음정이 맞는 시간 11%) → 비교 청취로 짧게 줄였다(2026-10-04).
  const HAEGEUM_NOTE_GLIDE_SECONDS = 0.05
  const HAEGEUM_LIVE_NOTE_GLIDE_SECONDS = 0.04
  const HAEGEUM_PHRASE_ATTACK_SECONDS = 0.06
  const STROKE_TAP_SECONDS = 0.16
  // 전체 재생을 예약할 때 두는 리드. 예약 시각이 과거로 가면 첫 음이 잘리므로 필요하다.
  // 우리가 정한 값이라 오차가 없다 → 플레이헤드에서 전액 보정해도 안전하다.
  const PLAYBACK_SCHEDULE_LEAD_SECONDS = 0.05
  // 브라우저가 보고하는 출력 지연의 신뢰 상한. 이보다 큰 값은 오보고로 보고 잘라 쓴다.
  const MAX_TRUSTED_OUTPUT_LATENCY_SECONDS = 0.3
  // 하드웨어 출력 지연을 얼마나 믿고 보정할지. 1 미만으로 두어 항상 과소 보정한다 —
  // 넘치면 소리가 그린 선보다 먼저 나기 때문(절대 금지). 0.8 이면 25% 과대 보고까지 안전하다.
  const HARDWARE_LATENCY_TRUST = 0.8
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
      if (Array.isArray(node)) {
        disconnectQuietly.apply(null, node)
        continue
      }
      try {
        node.disconnect()
      } catch (e) {}
    }
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
    return WIDE_NOTE_GAIN_LIMIT_IDS[instrumentId]
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

  function livePreviewTargetGain(plan, noteEnvPeak, maxGain) {
    const boost = isGugakInstrument(plan && plan.instrument) ? GUGAK_DRAWING_GAIN_BOOST : 1
    const outputGain = melodyOutputGain(plan, plan && plan.instrument) * noteEnvPeak * MASTER_OUTPUT_GAIN * boost
    return clamp(outputGain, 0.12, (maxGain || LIVE_PREVIEW_MAX_GAIN) * boost)
  }

  // 음별 보정은 측정으로 정한 "악기 안의 상대 보정"이라 기준 게인과 같은 천장으로 다시
  // 자르면 안 된다. 자르면 기준 게인이 이미 천장에 닿은 악기(비올라·프렌치호른)에서 보정이
  // 통째로 1.0 이 돼, 여리게 녹음된 음이 펜 소리에서 묻힌다. 전체 재생에는 이 천장이 없어서
  // 펜 소리와 재생이 서로 달라지기까지 했다.
  // (비올라는 원본을 piano 로 골라 와 기준 게인이 가장 높다 → 15칸 중 11칸이 보정을 잃었다.)
  function livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi, maxGain, noteMaxGain) {
    const boost = isGugakInstrument(plan && plan.instrument) ? GUGAK_DRAWING_GAIN_BOOST : 1
    const gain = livePreviewTargetGain(plan, noteEnvPeak, maxGain) * noteMelodyOutputGainForUiMidi(plan && plan.instrument, uiMidi)
    return clamp(gain, 0.12, (noteMaxGain || LIVE_PREVIEW_NOTE_MAX_GAIN) * boost)
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
  // 해금 녹음은 기본음이 거의 없고 1.4~1.8 kHz 배음 하나가 압도한다(울림통 콧소리 공명). 국립국악원 단음·확장,
  // 공유마당 세 출처가 모두 같아 녹음을 바꿔도 풀리지 않는다 → 그 공명을 두 곳에서 깎아 2·3배음을 살린다
  // (2026-10-04 비교 청취로 결정). tools/measure-instrument-loudness.cjs 의 같은 표와 맞출 것.
  const HAEGEUM_RESONANCE_CUTS = [
    { frequency: 1450, Q: 1.4, gainDb: -14 },
    { frequency: 1750, Q: 1.6, gainDb: -14 },
  ]
  // 국악 음색 필터(저역 통과) + 해금 공명 깎기. 앞에서부터 이어 붙인 필터 목록을 돌려준다.
  function sampleToneFilters(ctx, plan, when) {
    const filters = [ctx.createBiquadFilter()]
    configureSampleToneFilter(filters[0], plan, when)
    if (isHaegeumPlan(plan)) {
      HAEGEUM_RESONANCE_CUTS.forEach(function (cut) {
        const filter = ctx.createBiquadFilter()
        filter.type = "peaking"
        filter.frequency.setValueAtTime(cut.frequency, when)
        filter.Q.setValueAtTime(cut.Q, when)
        filter.gain.setValueAtTime(cut.gainDb, when)
        filters[filters.length - 1].connect(filter)
        filters.push(filter)
      })
    }
    return filters
  }
  function connectGugakSampleTone(ctx, source, env, plan, when) {
    if (isGayageumPlan(plan) || !isGugakInstrument(plan && plan.instrument) || typeof ctx.createBiquadFilter !== "function") {
      source.connect(env)
      return null
    }
    const filters = sampleToneFilters(ctx, plan, when)
    source.connect(filters[0])
    filters[filters.length - 1].connect(env)
    return filters
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
    this.livePending = null // 불러오는 중인 라이브 미리듣기 {token, src, signature, normY}
    this.liveRetiring = new Set()
    this.ambience = null // 드로잉 화면에서 깔리는 배경음(패드)
    this.ambienceToken = 0
    this.isPaused = false // 일시정지 상태(ctx.suspend)
    this.isStarting = false // play() preload/schedule race guard
    this.playGen = 0 // 재생 세대 토큰 — 비동기 play() 도중 stop/재요청 시 무효화용
    this.playEndsAtMs = 0 // 자동 정지 예정 시각(일시정지 잔여시간 계산용)
    this.pauseRemainingMs = 0 // 일시정지 시점의 남은 재생 시간(ms)
    this.playbackLeadMs = 0 // 재생 시작~실제로 들리기 시작까지의 지연(ms) — 플레이헤드 보정용
    this.lastStopReason = "idle"
  }

  AudioEngine.prototype.ensureContext = function () {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext
      this.ctx = new AC()
    }
    return this.ctx
  }

  // 스피커까지 나가는 하드웨어 지연(초). 브라우저 "추정치"라 그대로 믿으면 안 된다.
  // outputLatency 가 없거나 0인 브라우저는 baseLatency 로 대체한다 — baseLatency 는
  // 그래프→destination 버퍼링만 재므로 항상 실제보다 작다(= 과소 보정 쪽이라 안전).
  AudioEngine.prototype.outputLatencySeconds = function () {
    const ctx = this.ctx
    if (!ctx) return 0
    const reported = Number(ctx.outputLatency)
    const raw = isFinite(reported) && reported > 0 ? reported : Number(ctx.baseLatency)
    if (!isFinite(raw) || !(raw > 0)) return 0
    return Math.min(raw, MAX_TRUSTED_OUTPUT_LATENCY_SECONDS)
  }

  // 재생 시작 시점에서 "지금부터 몇 ms 뒤에 실제로 귀에 들리기 시작하는가".
  // 플레이헤드를 이 값만큼 늦춰 그림과 소리를 맞춘다.
  //
  // includeScheduleLead: 새 재생이면 true(50ms 예약 리드가 아직 남아 있음),
  //                      일시정지 후 이어재생이면 false(리드는 이미 흘러갔고 하드웨어 지연만 남음).
  //
  // ⚠ 이 값을 실제보다 크게 잡으면 플레이헤드가 소리보다 뒤처져 "소리가 선보다 먼저" 난다 —
  //    절대 허용되지 않는 방향이다. 작게 잡으면 소리가 조금 늦을 뿐이라 허용된다.
  AudioEngine.prototype.audioLeadMs = function (includeScheduleLead) {
    const scheduleLead = includeScheduleLead ? PLAYBACK_SCHEDULE_LEAD_SECONDS : 0
    const hardware = this.outputLatencySeconds()
    // 예약 리드는 우리가 정한 값이라 전액, 하드웨어 지연은 추정치라 깎아서 더한다.
    return (scheduleLead + hardware * HARDWARE_LATENCY_TRUST) * 1000
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

  AudioEngine.prototype.warmSoundLayer = function (layer) {
    if (!layer || !layer.src) return Promise.resolve(null)
    const ctx = this.ensureContext()
    return this.loadAssetBuffer(ctx, layer)
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
    const out = { pad: null, melody: null, melodySamples: null, effects: [], soundLayers: [], byInstrument: {} }
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
    ;(plan.soundLayers || []).forEach((layer, idx) => {
      jobs.push(this.loadAssetBuffer(ctx, layer.asset).then((b) => (out.soundLayers[idx] = { layer: layer, buffer: b })))
    })
    await Promise.all(jobs)
    out.effects = out.effects.filter(Boolean)
    out.soundLayers = out.soundLayers.filter(Boolean)
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

    // 3) 사용자가 올린 긴 소리 — 원본 구간을 작품의 절대 초 위치에 한 번만 놓는다.
    ;(buffers.soundLayers || []).forEach(function (item) {
      const buffer = item.buffer
      const layer = item.layer
      if (!buffer || !layer) return
      const at = start + Math.max(0, Number(layer.time) || 0)
      const sourceOffset = safeBufferOffset(buffer, layer.sourceOffset)
      const outDuration = safeBufferDuration(buffer, sourceOffset, Math.min(layer.duration, dur - layer.time))
      if (!(outDuration > 0.001)) return
      const src = ctx.createBufferSource()
      const g = ctx.createGain()
      const level = clamp(Number(layer.gain) || 0, 0, 1) * SOUND_LAYER_OUTPUT_GAIN
      const fade = Math.min(0.03, Math.max(0.003, outDuration * 0.2))
      src.buffer = buffer
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(level, at + fade)
      g.gain.setValueAtTime(level, Math.max(at + fade, at + outDuration - fade))
      g.gain.linearRampToValueAtTime(0, at + outDuration)
      src.connect(g)
      g.connect(dest)
      register(src)
      try {
        src.start(at, sourceOffset, outDuration)
        src.stop(at + outDuration + 0.02)
        usedReal = true
      } catch (error) {
        warnScheduleFallback("추가 소리 스케줄 실패", error, {
          id: layer.id,
          time: layer.time,
          sourceOffset: sourceOffset,
          duration: outDuration,
        })
        disconnectQuietly(src, g)
      }
    })

    // 4) 선율 또는 리듬 — 오케스트라: voice(획)마다 그 악기로 따로 스케줄해 동시에 울린다
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
      ;(plan.sourceStrokeSegments || plan.strokeSegments || []).forEach(function (segment) {
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
          sampleSourceNotes: plan.sourceNotes && plan.sourceNotes.filter((note) => (note.voice == null ? "_" : String(note.voice)) === key),
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
        const itemTime = Math.min(Number(item.time) || 0, Math.max(0, sequenceEnd))
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
    const prepared = options.retriggerRepeated ? items : AudioPlan.sampleVoiceRuns(items, sequenceEnd, AudioPlan.DRAWING_PITCH_SETTLE_SECONDS)
    const triggers = pluckedSampleTriggers(prepared, sequenceEnd, !!options.retriggerRepeated)
    for (let i = 0; i < triggers.length; i++) {
      const item = triggers[i]
      const eventStart = Math.min(Number(item.time) || 0, sequenceEnd)
      const when = start + Math.max(0, eventStart)
      const segment = nearestSampleSegment(asset, item.midi)
      const srcBuffer = multi ? sampleBufferFor(sampleBuffers, segment, buffer) : buffer
      if (!srcBuffer) continue
      const baseRate = segmentPlaybackRate(asset, item.midi, segment)
      const fallbackOffset = 0
      const sourceBounds = multi ? { offset: 0, duration: audioBufferDuration(srcBuffer) } : sampleSegmentBounds(srcBuffer, segment, fallbackOffset)
      const pluck = continuousSustainPlan(ctx, srcBuffer, sourceBounds.offset, sourceBounds.duration, plan, segment)
      const elapsed = Math.max(0, -eventStart)
      const offset = pluck.offset + elapsed * baseRate
      const usableSourceDur = pluck.duration - elapsed * baseRate
      if (!(usableSourceDur > 0.01)) continue

      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      const velocity = item.velocity == null ? 0.7 : item.velocity
      const srcPlaySeconds = usableSourceDur / baseRate
      src.buffer = pluck.buffer
      src.playbackRate.setValueAtTime(baseRate, when)
      // 원음에 이미 들어 있는 감쇠를 보존한다. 끝 페이드는 격리한 버퍼에 구워져 있다.
      const peak = melodyPlaybackEnvPeak(plan, velocity * 0.85)
      env.gain.setValueAtTime(elapsed ? peak : 0.0001, when)
      if (!elapsed) env.gain.linearRampToValueAtTime(peak, when + 0.005)
      const filter = connectGugakSampleTone(ctx, src, env, plan, when)
      const noteGain = connectMelodyEnv(ctx, env, dest, plan, [item], start, when, 0.001)
      src.onended = function () { disconnectQuietly(src, env, noteGain, filter) }

      try {
        const srcDur = Math.max(0.001, safeBufferDuration(src.buffer, offset, usableSourceDur))
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

  const SAMPLE_HANDOFF_SECONDS = 0.04

  function sampleStartOffset(sustain, plan, continuation, live) {
    return sustain.loop && (continuation || (live && isWesternInstrument(plan.instrument))) ? sustain.loopStart : sustain.offset
  }

  function rampSampleGain(param, peak, when, duration, fadeIn) {
    for (let i = 1; i <= 16; i++) {
      const x = i / 16
      const weight = fadeIn ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2)
      param.linearRampToValueAtTime(Math.max(0.0001, peak * weight), when + duration * x)
    }
  }

  function sampleEnvelope(param, run, finish, peak, start, at, followed) {
    const attack = Math.min(run.continuation ? SAMPLE_HANDOFF_SECONDS : 0.005, Math.max(0.001, run.end - run.time))
    const elapsed = at > run.time
    function level(t) {
      const enter = clamp((t - run.time) / attack, 0, 1)
      const leave = clamp((t - run.end) / SAMPLE_HANDOFF_SECONDS, 0, 1)
      const entry = elapsed ? clamp((t - at) / 0.005, 0, 1) : 1
      return Math.max(0.0001, peak * entry * (run.continuation ? Math.sin(enter * Math.PI / 2) : enter) *
        (followed ? Math.cos(leave * Math.PI / 2) : 1 - leave))
    }
    const times = [at, finish, run.end]
    if (elapsed) times.push(Math.min(at + 0.005, finish))
    for (let i = 0; i <= 16; i++) {
      times.push(run.time + attack * i / 16, run.end + SAMPLE_HANDOFF_SECONDS * i / 16)
    }
    param.setValueAtTime(level(at), start + at)
    Array.from(new Set(times)).filter((t) => t > at && t <= finish).sort((a, b) => a - b).forEach(function (t) {
      param.linearRampToValueAtTime(level(t), start + t)
    })
  }

  function progressedSampleOffset(sustain, initial, elapsed, rate) {
    let offset = initial + Math.max(0, elapsed) * rate
    if (sustain.loop && offset >= sustain.loopEnd) {
      offset = sustain.loopStart + (offset - sustain.loopStart) % (sustain.loopEnd - sustain.loopStart)
    }
    return offset
  }

  function scheduleSustainedSequence(ctx, dest, plan, events, end, instBuffers, start, register, settleSeconds) {
    const asset = plan.melodyAsset
    const runs = AudioPlan.sampleVoiceRuns(events, end, settleSeconds)
    const sampleRate = ctx.sampleRate || 48000
    const motionOrigin = start + (plan.playbackOffset || 0)
    const motions = isHaegeumPlan(plan) ? AudioPlan.samplePitchMotion(runs, HAEGEUM_NOTE_GLIDE_SECONDS, sampleRate, motionOrigin) : null
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index]
      const finish = Math.min(end + SAMPLE_HANDOFF_SECONDS, run.end + SAMPLE_HANDOFF_SECONDS)
      if (finish <= 0) continue
      const segment = nearestSampleSegment(asset, run.midi)
      const buffer = isMultiSample(asset) ? sampleBufferFor(instBuffers.melodySamples, segment, instBuffers.melody) : instBuffers.melody
      if (!buffer) continue
      const bounds = isMultiSample(asset) ? { offset: 0, duration: audioBufferDuration(buffer) } : sampleSegmentBounds(buffer, segment, 0)
      const sustain = continuousSustainPlan(ctx, buffer, bounds.offset, bounds.duration, plan, segment)
      const rate = segmentPlaybackRate(asset, run.midi, segment)
      const at = Math.max(0, run.time)
      const elapsed = at - run.time
      const initial = sampleStartOffset(sustain, plan, run.continuation)
      let traveled = elapsed * rate
      const scale = rate / midiToFreq(run.midi)
      if (motions) {
        traveled = AudioPlan.samplePitchTravel(motions, index, run.time, at, scale, sampleRate, motionOrigin)
      }
      const offset = progressedSampleOffset(sustain, initial, traveled, 1)
      if (!sustain.loop && offset >= sustain.offset + sustain.duration) continue
      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      src.buffer = sustain.buffer
      applySustainPlanToSource(src, sustain)
      if (motions) {
        let active = index
        while (active + 1 < motions.length && motions[active + 1].time <= at) active++
        src.playbackRate.value = AudioPlan.pitchMotionValue(motions[active], at) * scale
        src.playbackRate.setValueAtTime(src.playbackRate.value, start + at)
        src.playbackRate.setTargetAtTime(motions[active].target * scale, start + Math.max(at, motions[active].time), motions[active].tau)
        for (let j = active + 1; j < motions.length && motions[j].time < finish; j++) {
          src.playbackRate.setTargetAtTime(motions[j].target * scale, start + motions[j].time, motions[j].tau)
        }
      } else {
        src.playbackRate.value = rate
        src.playbackRate.setValueAtTime(rate, start + at)
      }
      const peak = melodyPlaybackEnvPeak(plan, (run.velocity == null ? 0.7 : run.velocity) * 0.85)
      sampleEnvelope(env.gain, run, finish, peak, start, at, index + 1 < runs.length)
      const filter = connectGugakSampleTone(ctx, src, env, plan, start + at)
      const noteGain = connectMelodyEnv(ctx, env, dest, plan, [run], start, start + at, 0.001)
      src.onended = function () { disconnectQuietly(src, env, noteGain, filter) }
      if (src.loop) src.start(start + at, safeBufferOffset(src.buffer, offset))
      else src.start(start + at, safeBufferOffset(src.buffer, offset), Math.max(0.001, sustain.offset + sustain.duration - offset))
      src.stop(start + finish)
      register(src)
    }
  }

  AudioEngine.prototype.scheduleSampleStrokes = function (ctx, dest, plan, strokeSegments, instBuffers, start, register) {
    for (const stroke of strokeSegments || []) {
      if (!stroke || !stroke.events || !stroke.events.length) continue
      if (isGayageumPlan(plan)) schedulePluckedSampleSequence(ctx, dest, plan, stroke.sourceEvents || stroke.events, instBuffers, start, stroke.end, register)
      else scheduleSustainedSequence(ctx, dest, plan, stroke.sourceEvents || stroke.events, stroke.end, instBuffers, start, register, AudioPlan.DRAWING_PITCH_SETTLE_SECONDS)
    }
  }

  AudioEngine.prototype.scheduleSampleMelody = function (ctx, dest, plan, notes, instBuffers, start, register) {
    for (const phrase of contiguousPhrases(plan.sampleSourceNotes || plan.sourceNotes || notes)) {
      if (isGayageumPlan(plan)) schedulePluckedSampleSequence(ctx, dest, plan, phrase, instBuffers, start, phraseEnd(phrase), register, { retriggerRepeated: true })
      else scheduleSustainedSequence(ctx, dest, plan, phrase, phraseEnd(phrase), instBuffers, start, register)
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
    this.playbackLeadMs = 0
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
    // 이어재생은 이미 예약된 노드가 다시 흐르는 것이라 50ms 리드가 없다 — 하드웨어 지연만 보정.
    this.playbackLeadMs = this.audioLeadMs(false)
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

  AudioEngine.prototype._createSampleLivePreview = function (ctx, plan, buffer, normY, transition) {
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
    if (transition && !isGayageumPlan(plan)) rampSampleGain(env.gain, baseTargetGain, start, SAMPLE_HANDOFF_SECONDS, true)
    else env.gain.linearRampToValueAtTime(baseTargetGain, start + (isGayageumPlan(plan) ? 0.005 : SAMPLE_HANDOFF_SECONDS))
    noteGain.gain.setValueAtTime(noteGainValue, start)

    // 멀티샘플(서양 선율)은 원음 음색을 그대로 살리기 위해 필터 없이 source → env 직결.
    // 풀 플레이백(connectGugakSampleTone)과 동일한 신호 경로.
    const useFilter = isGugakInstrument(plan.instrument) && !isGayageumPlan(plan)
    const toneFilters = useFilter ? sampleToneFilters(ctx, plan, start) : []
    if (useFilter) {
      filter = toneFilters[0]
      toneFilters[toneFilters.length - 1].connect(env)
    }
    env.connect(noteGain)
    noteGain.connect(ctx.destination)

    // 재생 스케줄러와 똑같은 지속음 정책. source.buffer 는 "한 번만" 설정(이중 설정 시 무음).
    const sustain = continuousSustainPlan(ctx, buffer, offset, segmentDur, plan, segment)
    const source = ctx.createBufferSource()
    source.buffer = sustain.buffer
    applySustainPlanToSource(source, sustain)
    const glideStart = Math.ceil(start * (ctx.sampleRate || 48000) / 128 - 1e-9) * 128 / (ctx.sampleRate || 48000)
    const pitchMotion = { time: glideStart, from: midiToFreq(midi), target: midiToFreq(midi), tau: HAEGEUM_LIVE_NOTE_GLIDE_SECONDS }
    if (transition && isHaegeumPlan(plan)) pitchMotion.from = transition.frequency || pitchMotion.target
    const rateScale = baseRate / pitchMotion.target
    source.playbackRate.value = pitchMotion.from === pitchMotion.target ? baseRate : pitchMotion.from * rateScale
    source.playbackRate.setValueAtTime(source.playbackRate.value, start)
    if (pitchMotion.from !== pitchMotion.target) source.playbackRate.setTargetAtTime(baseRate, glideStart, pitchMotion.tau)
    // 펜 소리는 "즉각 반응"이 목적 — 파일 어택을 기다리지 않고 안정 구간(loopStart)에서 시작한다.
    // 필하모니아 서양 원본은 음정이 뜨는 시점이 느리다(측정 중앙값 110~180ms, 비올라는 최대 390ms).
    // 국악 음원은 반대로 소금 20ms · 대금 10ms 로 이미 즉각 발음돼 손댈 이유가 없고,
    // 시김새·발음이 학습 내용이라 원음 그대로 둔다 → 서양 악기에만 적용한다.
    // 저장 획의 첫 발음은 원래 어택을 보존한다. 펜의 즉답 정책만 별도다.
    const liveStartOffset = sampleStartOffset(sustain, plan, !!transition, true)

    if (useFilter) source.connect(filter)
    else source.connect(env)

    const live = {
      kind: "sample",
      midi: midi,
      startedAt: start,
      fadeIn: !!transition && !isGayageumPlan(plan),
      pitchMotion: pitchMotion,
      rateScale: rateScale,
      plucked: isGayageumPlan(plan),
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
      // 이 발음이 고른 원음의 조율·음량 보정은 발음이 끝날 때까지 유지한다.
      sampleSegment: segment || null,
      stopNodes: [source],
    }
    const engine = this
    source.onended = function () {
      live.ended = true
      engine.liveRetiring.delete(live)
      ;[source, env, noteGain].concat(toneFilters).forEach(function (node) {
        try {
          node.disconnect()
        } catch (e) {}
      })
    }
    if (sustain.loop) source.start(start, liveStartOffset)
    else source.start(start, liveStartOffset, Math.max(0.001, sustain.duration))
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
    const baseTargetGain = livePreviewTargetGain(plan, noteEnvPeak, SYNTH_LIVE_PREVIEW_MAX_GAIN)
    const targetGain = livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi, SYNTH_LIVE_PREVIEW_MAX_GAIN, SYNTH_LIVE_PREVIEW_NOTE_MAX_GAIN)
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
    const engine = this
    osc.onended = function () {
      engine.liveRetiring.delete(live)
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

  // 이 음높이가 필요로 하는 실제 녹음 파일. liveDrawingStart와 liveDrawingMove가
  // "지금 불러오는 중인 파일이 내가 필요한 그 파일인가"를 같은 기준으로 판단해야 한다.
  AudioEngine.prototype._liveSampleSrc = function (plan, midi) {
    const asset = plan && plan.melodyAsset
    if (!asset) return null
    // 멀티샘플이면 현재 음높이에 가장 가까운 실제 녹음 파일을 쓴다.
    if (isMultiSample(asset)) {
      const seg = nearestSampleSegment(asset, midi)
      if (seg && seg.src) return seg.src
    }
    return asset.src || null
  }

  function clearLivePending(engine) {
    if (engine.livePending && engine.livePending.timer != null) root.clearTimeout(engine.livePending.timer)
    engine.livePending = null
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
      self.stopLivePreview(false)
      const token = ++self.livePreviewToken
      const plan = self.resolvePlan(recipe, [])
      const midi = self._liveMidi(plan, normY)
      if (midi == null) return Promise.resolve()
      const src = self._liveSampleSrc(plan, midi)
      if (src) {
        // 로딩이 끝날 때까지 livePreview는 null이다. 그동안 들어오는 펜 이동이 이 로딩을
        // 취소시키지 않도록(취소되면 펜을 멈출 때까지 소리가 안 난다) 진행 상황을 남겨 둔다.
        // normY는 착지 시점에 다시 읽는다 — 불러오는 사이 펜이 옮겨간 음높이로 시작해야 한다.
        const pending = { token: token, src: src, signature: self._liveSignature(plan), normY: normY }
        self.livePending = pending
        const loading = self.loadBuffer(ctx, src)
        if (isMultiSample(plan.melodyAsset)) {
          ;(plan.melodyAsset.sampleMap || []).forEach(function (segment) {
            if (segment.src && segment.src !== src) self.loadBuffer(ctx, segment.src)
          })
        }
        return loading.then(function (buffer) {
          if (token !== self.livePreviewToken) return
          self.livePending = null
          self.livePreview = self._createLivePreview(ctx, plan, pending.normY, buffer)
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
      if (!self.livePreview) {
        // 이미 같은 악기·같은 파일을 불러오는 중이면 새로 시작하지 않는다. 새로 시작하면
        // 토큰이 올라가 그 로딩이 폐기되고, 펜을 움직이는 내내 첫 음이 무음이 된다.
        const pending = self.livePending
        if (pending && pending.signature === self._liveSignature(plan) && pending.src === self._liveSampleSrc(plan, midi)) {
          pending.normY = normY
          return
        }
        self.liveDrawingStart(recipe, normY)
        return
      }
      if (self.livePreview.signature !== self._liveSignature(plan)) {
        self.liveDrawingStart(recipe, normY)
        return
      }
      const live = self.livePreview
      const now = ctx.currentTime
      if (live.kind === "sample") {
        if (live.midi === midi) {
          if (self.livePending) { self.livePreviewToken++; clearLivePending(self) }
          return
        }
        const pending = self.livePending
        if (pending && pending.midi === midi) { pending.normY = normY; return }
        clearLivePending(self)
        const token = ++self.livePreviewToken
        const src = self._liveSampleSrc(plan, midi)
        const next = { token, src, midi, normY, signature: self._liveSignature(plan) }
        self.livePending = next
        function switchVoice(buffer) {
          if (token !== self.livePreviewToken || self.livePreview !== live) return
          self.livePending = null
          // 새 파일이 준비된 순간에만 교체한다. 빠른 왕복/펜 떼기는 토큰으로 취소된다.
          const when = Math.ceil((ctx.currentTime + 0.005) * (ctx.sampleRate || 48000) / 128 - 1e-9) * 128 / (ctx.sampleRate || 48000)
          const frequency = live.pitchMotion ? AudioPlan.pitchMotionValue(live.pitchMotion, when) : midiToFreq(live.midi)
          const replacement = buffer ? self._createSampleLivePreview(ctx, plan, buffer, next.normY, { frequency: frequency }) : self._createSynthLivePreview(ctx, plan, next.normY)
          if (!replacement) return
          if (isHaegeumPlan(plan) && live.rateScale) {
            live.rateParam.cancelScheduledValues(when)
            live.rateParam.setValueAtTime(frequency * live.rateScale, when)
            live.rateParam.setTargetAtTime(midiToFreq(midi) * live.rateScale, when, HAEGEUM_LIVE_NOTE_GLIDE_SECONDS)
          }
          if (live.plucked && !live.ended) self.liveRetiring.add(live)
          else self._retireLivePreview(live, ctx, SAMPLE_HANDOFF_SECONDS, true)
          self.livePreview = replacement
        }
        // 멈춰 있는 펜에도 적용되도록 pointermove 횟수가 아닌 타이머로 체류를 확인한다.
        next.timer = root.setTimeout(function () {
          if (token !== self.livePreviewToken) return
          next.timer = null
          if (self.decodedCache.has(src)) switchVoice(self.decodedCache.get(src))
          else self.loadBuffer(ctx, src).then(switchVoice)
        }, AudioPlan.DRAWING_PITCH_SETTLE_SECONDS * 1000)
      } else {
        if (live.noteGain) {
          const gain = livePreviewNoteTargetGain(plan, live.noteEnvPeak || 0.7 * 0.78, uiMidi, SYNTH_LIVE_PREVIEW_MAX_GAIN, SYNTH_LIVE_PREVIEW_NOTE_MAX_GAIN) / (live.baseTargetGain || 1)
          live.noteGain.gain.setTargetAtTime(gain, now, liveNoteGlideSeconds(plan))
        }
        live.osc.frequency.cancelScheduledValues(now)
        live.osc.frequency.setTargetAtTime(midiToFreq(midi), now, liveNoteGlideSeconds(plan))
      }
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    run()
    return Promise.resolve()
  }

  AudioEngine.prototype.liveDrawingEnd = function () {
    this.stopLivePreview(false)
  }

  AudioEngine.prototype._retireLivePreview = function (live, ctx, release, handoff) {
    if (!live || live.ended) return
    const now = ctx.currentTime + 0.005
    this.liveRetiring.add(live)
    try {
      const gain = live.env.gain
      const progress = clamp((now - (live.startedAt || 0)) / SAMPLE_HANDOFF_SECONDS, 0, 1)
      const currentGain = (live.baseTargetGain || gain.value || 0.5) * (live.fadeIn ? Math.sin(progress * Math.PI / 2) : progress)
      if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now)
      else {
        gain.cancelScheduledValues(now)
        gain.setValueAtTime(currentGain, now)
      }
      if (handoff) rampSampleGain(gain, currentGain, now, release, false)
      else gain.linearRampToValueAtTime(0.0001, now + release)
    } catch (e) {}
    ;(live.stopNodes || []).forEach(function (node) { try { node.stop(now + release) } catch (e) {} })
  }

  AudioEngine.prototype.stopLivePreview = function (immediate) {
    this.livePreviewToken++
    clearLivePending(this)
    const live = this.livePreview
    this.livePreview = null
    if (!this.ctx) return
    if (!immediate && live && live.plucked) { if (!live.ended) this.liveRetiring.add(live); return }
    if (immediate) {
      for (const old of this.liveRetiring) this._retireLivePreview(old, this.ctx, 0.005)
      this.liveRetiring.clear()
    }
    this._retireLivePreview(live, this.ctx, immediate ? 0.005 : 0.09)
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
    // 재생·펜 소리와 같은 음색 필터를 거친다(해금은 공명을 깎은 만큼 게인이 커서, 빼면 이 소리만 크게 난다).
    const toneFilters = connectGugakSampleTone(ctx, src, env, plan, start)
    env.connect(ctx.destination)
    this._registerPreviewNode(src, [env].concat(toneFilters || []))
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
      const start = ctx.currentTime + PLAYBACK_SCHEDULE_LEAD_SECONDS
      const master = ctx.createGain()
      master.gain.setValueAtTime(MASTER_OUTPUT_GAIN, start)
      connectMasterToOutput(ctx, master, ctx.destination, start)
      this.master = master
      const usedReal = this.schedule(ctx, master, plan, buffers, start, register)
      this.lastMode = usedReal ? "real" : "synth"
      this.isPlaying = true
      // emitState() 가 동기적으로 플레이헤드를 출발시키므로, 그 직전에 리드를 갱신해 둔다.
      this.playbackLeadMs = this.audioLeadMs(true)
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
