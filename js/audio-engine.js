/*
 * audio-engine.js — Web Audio 합주 엔진 (window.AudioEngine)
 *
 * 레이어: 배경 패드 + 자연 효과음 + 드로잉 선율.
 * 실제 음원 우선, 로드 실패 층만 합성음으로 대체.
 * 같은 그래프를 라이브(AudioContext)와 오프라인(OfflineAudioContext) 양쪽에 구성 → WAV 내보내기.
 */
;(function (root) {
  "use strict"

  const Core = root.MusicCore
  const Data = root.SDStudioData

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
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
    let best = map[0]
    for (const item of map) {
      if (Math.abs(item.midi - midi) < Math.abs(best.midi - midi)) best = item
    }
    return best
  }
  function segmentPlaybackRate(asset, midi, segment) {
    if (!segment) return samplePlaybackRate(asset, midi)
    return Math.pow(2, (midi - segment.midi) / 12)
  }

  // 합성 폴백 음색 — 실제 샘플이 없을 때도 악기가 구분되어 들리도록
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
    flute: { cutoff: 3600, Q: 0.5, attack: 0.05, vibratoDepth: 5 }, // 맑은 숨결
    oboe: { cutoff: 2300, Q: 1.6, vibratoDepth: 9 }, // 코맹맹이 공명
    frenchHorn: { cutoff: 1250, attack: 0.1, vibratoRate: 4.2, vibratoDepth: 5 }, // 둥글고 긴 호흡
    daegeum: { cutoff: 2200, vibratoDepth: 22 }, // 큰 시김새
    danso: { cutoff: 3100, vibratoDepth: 13 },
    sogeum: { cutoff: 3500, vibratoDepth: 13 },
    nagak: { cutoff: 850, attack: 0.07, vibratoDepth: 6 }, // 낮은 의식음
    gayageum: { cutoff: 2000, Q: 0.9, attack: 0.004, vibratoRate: 0, vibratoDepth: 0 }, // 뜯는음(비브라토 없음)
    ajaeng: { cutoff: 1050, Q: 1.3, vibratoDepth: 18 }, // 거친 저음
    haegeum: { cutoff: 2500, Q: 1.6, vibratoDepth: 24 }, // 강한 흔들림
    synth: { cutoff: 2800, Q: 0.6 },
  }
  function synthVoiceFor(instrument) {
    const base = SYNTH_VOICE_DEFAULTS[instrument.group] || SYNTH_VOICE_DEFAULTS["서양"]
    return Object.assign({ waveform: instrument.waveform || "sine" }, base, SYNTH_VOICE_OVERRIDES[instrument.id] || {})
  }

  // 두 음이 시간상 맞붙어 있으면(연속) 레가토로 이어 들리게 한다.
  function isContiguous(note, next) {
    return !!next && Math.abs(note.time + note.duration - next.time) < 1e-3
  }

  function phraseEnd(notes) {
    const last = notes[notes.length - 1]
    return last.time + last.duration
  }

  function contiguousPhrases(notes) {
    const phrases = []
    let current = []
    for (let i = 0; i < notes.length; i++) {
      current.push(notes[i])
      if (!isContiguous(notes[i], notes[i + 1])) {
        phrases.push(current)
        current = []
      }
    }
    return phrases
  }

  // 연속으로 그린 음들은 하나의 프레이즈 엔벨로프로 감싸, 경계마다 다시 타격되지 않게 한다.
  function applyPhraseEnv(env, peak, phraseStart, phraseDuration) {
    const attack = Math.min(0.035, phraseDuration * 0.25)
    const release = Math.min(0.18, Math.max(0.08, phraseDuration * 0.2))
    const phraseEndTime = phraseStart + phraseDuration
    const holdEnd = Math.max(phraseStart + attack + 0.005, phraseEndTime - release)
    env.gain.setValueAtTime(0.0001, phraseStart)
    env.gain.linearRampToValueAtTime(peak, phraseStart + attack)
    env.gain.setValueAtTime(peak, holdEnd)
    env.gain.linearRampToValueAtTime(0.0001, phraseEndTime + 0.04)
  }

  function AudioEngine() {
    this.ctx = null
    this.bufferCache = new Map() // url -> Promise<AudioBuffer|null>
    this.active = [] // 현재 재생 중 노드
    this.master = null
    this.stopTimer = null
    this.isPlaying = false
    this.lastMode = "ready"
    this.onState = null // (isPlaying) 콜백
    this.livePreview = null
    this.livePreviewToken = 0
    this.ambience = null // 드로잉 화면에서 깔리는 배경음(패드)
    this.ambienceToken = 0
  }

  AudioEngine.prototype.ensureContext = function () {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext
      this.ctx = new AC()
    }
    return this.ctx
  }

  // 디코드된 AudioBuffer는 컨텍스트 간 공유 가능(같은 sampleRate면 안전).
  AudioEngine.prototype.loadBuffer = function (ctx, url) {
    if (!url) return Promise.resolve(null)
    if (!this.bufferCache.has(url)) {
      const p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(r.status + " " + r.statusText)
          return r.arrayBuffer()
        })
        .then((ab) => ctx.decodeAudioData(ab))
        .catch(() => null)
      this.bufferCache.set(url, p)
    }
    return this.bufferCache.get(url)
  }

  AudioEngine.prototype.loadAssetBuffer = function (ctx, asset) {
    if (!asset || !asset.src) return Promise.resolve(null)
    if (!asset.file || typeof asset.file.arrayBuffer !== "function") {
      return this.loadBuffer(ctx, asset.src)
    }
    if (!this.bufferCache.has(asset.src)) {
      const p = asset.file
        .arrayBuffer()
        .then((ab) => ctx.decodeAudioData(ab.slice ? ab.slice(0) : ab))
        .catch(() => null)
      this.bufferCache.set(asset.src, p)
    }
    return this.bufferCache.get(asset.src)
  }

  // recipe(ids) → 실제 데이터 객체로 해석
  AudioEngine.prototype.resolvePlan = function (recipe, notes) {
    const atmosphere = Data.atmospheres.find((a) => a.id === recipe.atmosphere) || Data.atmospheres[0]
    const instrument = Data.instruments.find((i) => i.id === recipe.instrument) || Data.instruments[0]
    const style = Data.styles.find((s) => s.id === recipe.style) || Data.styles[0]
    const version = Data.versions.find((v) => v.id === recipe.version) || Data.versions[0]
    const padAsset = Data.pads[atmosphere.padType] || null
    const backgroundAsset = Data.backgrounds[atmosphere.backgroundId] || null
    const melodyAsset = Data.melodies[instrument.id] || null
    const effects = (atmosphere.effectIds || []).map((id) => Data.effects[id]).filter(Boolean)
    const gugak = !!style.gugak || instrument.group === "국악" || !!version.ornament
    const mode = recipe.mode || "melody"
    const duration = recipe.duration || 30
    const rhythmHits =
      mode === "rhythm" ? Core.autocompleteRhythm(recipe.path || [], { durationSec: duration, bpm: 100 }) : []
    return {
      duration: duration,
      mode: mode,
      atmosphere: atmosphere,
      instrument: instrument,
      style: style,
      pitchStyle: style,
      version: version,
      padAsset: padAsset,
      backgroundAsset: backgroundAsset,
      melodyAsset: melodyAsset,
      effects: effects,
      gugak: gugak,
      notes: notes || [],
      rhythmHits: rhythmHits,
    }
  }

  AudioEngine.prototype.preload = async function (ctx, plan) {
    const jobs = []
    const out = { pad: null, melody: null, effects: [] }
    const padAsset = plan.padAsset && plan.padAsset.src ? plan.padAsset : plan.backgroundAsset
    jobs.push(this.loadAssetBuffer(ctx, padAsset).then((b) => (out.pad = b)))
    if (plan.melodyAsset && plan.melodyAsset.src) {
      jobs.push(this.loadAssetBuffer(ctx, plan.melodyAsset).then((b) => (out.melody = b)))
    }
    plan.effects.forEach((fx, idx) => {
      jobs.push(this.loadAssetBuffer(ctx, fx).then((b) => (out.effects[idx] = { asset: fx, buffer: b })))
    })
    await Promise.all(jobs)
    out.effects = out.effects.filter(Boolean)
    return out
  }

  AudioEngine.prototype.warmInstrument = function (recipe) {
    const ctx = this.ensureContext()
    const plan = this.resolvePlan(recipe, [])
    const src = plan.melodyAsset && plan.melodyAsset.src
    if (!src) return Promise.resolve(null)
    return this.loadAssetBuffer(ctx, plan.melodyAsset)
  }

  // 핵심: 주어진 컨텍스트/목적지에 전체 합주를 스케줄 (라이브/오프라인 공용)
  AudioEngine.prototype.schedule = function (ctx, dest, plan, buffers, start, register) {
    const dur = plan.duration
    const v = plan.version
    let usedReal = false

    // 1) 배경 패드
    if (buffers.pad) {
      const src = ctx.createBufferSource()
      const g = ctx.createGain()
      src.buffer = buffers.pad
      src.loop = buffers.pad.duration < dur
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(v.padGain, start + 1.2)
      g.gain.setValueAtTime(v.padGain, start + Math.max(1.2, dur - 1.5))
      g.gain.linearRampToValueAtTime(0, start + dur)
      src.connect(g)
      g.connect(dest)
      register(src)
      src.start(start, 0)
      src.stop(start + dur + 0.05)
      usedReal = true
    } else {
      this.scheduleSynthPad(ctx, dest, plan, start, register)
    }

    // 2) 자연 효과음
    buffers.effects.forEach((item, index) => {
      const buffer = item.buffer
      const asset = item.asset
      if (!buffer) return
      const isThunder = asset.label.indexOf("천둥") === 0
      const interval = clamp(buffer.duration * 0.85, 3.2, 10)
      const offsets = isThunder
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
          g.gain.setValueAtTime(isThunder ? 0.1 : 0.05, at)
          g.gain.linearRampToValueAtTime(0, at + outDur)
          src.connect(g)
          g.connect(dest)
          register(src)
          src.start(at, 0, outDur)
        })
      usedReal = true
    })

    // 3) 선율 또는 리듬
    const melodyGain = ctx.createGain()
    melodyGain.gain.setValueAtTime(v.melodyGain, start)
    melodyGain.connect(dest)
    if (plan.mode === "rhythm") {
      this.scheduleRhythm(ctx, melodyGain, plan, buffers, start, register)
    } else if (buffers.melody) {
      this.scheduleSampleMelody(ctx, melodyGain, plan, buffers.melody, start, register)
      usedReal = true
    } else {
      this.scheduleSynthMelody(ctx, melodyGain, plan, start, register)
    }

    return usedReal
  }

  AudioEngine.prototype.scheduleSampleMelody = function (ctx, dest, plan, buffer, start, register) {
    const asset = plan.melodyAsset
    const samplePhrase = asset.sampleMode === "phrase"
    const phrases = contiguousPhrases(plan.notes)
    for (const notes of phrases) {
      const first = notes[0]
      const last = notes[notes.length - 1]
      const phraseStart = start + first.time
      const phraseDuration = phraseEnd(notes) - first.time
      const phraseStop = start + last.time + last.duration
      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      const segment = nearestSampleSegment(asset, first.midi)
      const baseRate = segmentPlaybackRate(asset, first.midi, segment)
      src.buffer = buffer
      src.playbackRate.setValueAtTime(baseRate, phraseStart)
      for (let k = 1; k < notes.length; k++) {
        const note = notes[k]
        const noteStart = start + note.time
        const nextRate = segmentPlaybackRate(asset, note.midi, segment)
        src.playbackRate.setTargetAtTime(nextRate, noteStart, 0.035)
      }
      for (const note of notes) {
        this.applySigimsae(src, null, segmentPlaybackRate(asset, note.midi, segment), note, plan, start + note.time)
      }
      const offset = segment ? segment.offset : samplePhrase ? this.phraseOffset(buffer, first) : 0
      const usableSourceDur = segment ? segment.duration : buffer.duration - offset
      const needSustain = phraseDuration * baseRate > usableSourceDur * 0.85
      if (needSustain && usableSourceDur > 0.25) {
        src.loop = true
        src.loopStart = offset + Math.min(0.12, usableSourceDur * 0.2)
        src.loopEnd = offset + Math.max(usableSourceDur - Math.min(0.08, usableSourceDur * 0.1), src.loopStart - offset + 0.15)
      }
      applyPhraseEnv(env, first.velocity * 0.85, phraseStart, phraseDuration)
      src.connect(env)
      env.connect(dest)
      register(src)
      if (src.loop) {
        src.start(phraseStart, offset)
      } else {
        const srcDur = Math.max(0.05, Math.min(usableSourceDur, phraseDuration * baseRate + 0.18))
        src.start(phraseStart, offset, srcDur)
      }
      src.stop(phraseStop + 0.18)
    }
  }

  AudioEngine.prototype.scheduleSynthMelody = function (ctx, dest, plan, start, register) {
    const voice = synthVoiceFor(plan.instrument)
    const phrases = contiguousPhrases(plan.notes)
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
        osc.frequency.setTargetAtTime(midiToFreq(note.midi), start + note.time, 0.035)
      }
      for (const note of notes) {
        this.applySigimsae(null, osc, midiToFreq(note.midi), note, plan, start + note.time)
      }
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(voice.cutoff, phraseStart)
      filter.Q.setValueAtTime(voice.Q, phraseStart)
      // 합성 선율은 실제 샘플(0.85)보다 작게 들려 묻히므로 피크를 끌어올림.
      applyPhraseEnv(env, first.velocity * 0.78, phraseStart, phraseDuration)
      osc.connect(filter)
      filter.connect(env)
      env.connect(dest)
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
  AudioEngine.prototype.applySigimsae = function (source, osc, baseValue, note, plan, t0) {
    const durationBeats = note.duration / 0.5
    const segs = Core.sigimsaeFor({ gugak: plan.gugak, durationBeats: durationBeats })
    if (!segs.length) return
    const noteLen = note.duration
    for (const seg of segs) {
      const at = t0 + clamp(seg.at, 0, 0.95) * noteLen
      if (seg.type === "grace") {
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
    const maxOffset = Math.max(0, buffer.duration - 2.4)
    if (maxOffset === 0) return 0
    const seed = Math.sin((note.time + 1) * 41.73 + note.midi * 5.91) * 10000
    return (seed - Math.floor(seed)) * maxOffset
  }

  AudioEngine.prototype.scheduleSynthPad = function (ctx, dest, plan, start, register) {
    const dur = plan.duration
    const padGain = ctx.createGain()
    padGain.gain.setValueAtTime(0, start)
    padGain.gain.linearRampToValueAtTime(plan.version.padGain, start + 1.6)
    padGain.gain.setValueAtTime(plan.version.padGain, start + Math.max(1.6, dur - 1.5))
    padGain.gain.linearRampToValueAtTime(0, start + dur)
    padGain.connect(dest)
    const base = plan.style.root - 12
    const iv = plan.style.intervals
    const chord = [base, base + (iv[2] || 4), base + (iv[4] || 7)]
    const wave = (plan.padAsset && plan.padAsset.fallbackWave) || "sine"
    chord.forEach((midi, index) => {
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      osc.type = index === 0 ? "triangle" : wave
      osc.frequency.setValueAtTime(midiToFreq(midi), start)
      osc.detune.setValueAtTime((index - 1) * 7, start)
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(plan.atmosphere.id === "rain" ? 560 : 950, start)
      osc.connect(filter)
      filter.connect(padGain)
      register(osc)
      osc.start(start)
      osc.stop(start + dur + 0.2)
    })
  }

  // --- 라이브 재생 ---

  AudioEngine.prototype.stop = function () {
    this.stopLivePreview(true)
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
    for (const node of this.active) {
      try {
        node.stop(0)
      } catch (e) {}
      try {
        node.disconnect()
      } catch (e) {}
    }
    this.active = []
    this.master = null
    this.isPlaying = false
    if (this.onState) this.onState(false)
  }

  AudioEngine.prototype._liveSignature = function (plan) {
    return plan.instrument.id + "|" + plan.style.id + "|" + plan.mode
  }

  AudioEngine.prototype._liveMidi = function (plan, normY) {
    return Core.quantizePitch(normY, plan.pitchStyle || plan.style)
  }

  AudioEngine.prototype._liveFrequency = function (plan, normY) {
    return midiToFreq(this._liveMidi(plan, normY))
  }

  AudioEngine.prototype._livePlaybackRate = function (plan, normY) {
    const midi = this._liveMidi(plan, normY)
    return segmentPlaybackRate(plan.melodyAsset, midi, nearestSampleSegment(plan.melodyAsset, midi))
  }

  AudioEngine.prototype._createSampleLivePreview = function (ctx, plan, buffer, normY) {
    const start = ctx.currentTime + 0.005
    const source = ctx.createBufferSource()
    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const isGugak = plan.instrument.group === "국악"
    const targetGain = isGugak ? 0.34 : 0.3 // 그리는 중 선율을 배경 위로 더 또렷하게
    const midi = this._liveMidi(plan, normY)
    const segment = nearestSampleSegment(plan.melodyAsset, midi)
    const offset = segment ? segment.offset : Math.min(0.05, Math.max(0, buffer.duration * 0.08))
    const segmentDur = segment ? segment.duration : buffer.duration - offset

    source.buffer = buffer
    source.playbackRate.setValueAtTime(segmentPlaybackRate(plan.melodyAsset, midi, segment), start)
    if (buffer.duration > 0.45 && segmentDur > 0.45 && plan.instrument.id !== "gayageum") {
      source.loop = true
      source.loopStart = offset + Math.min(0.18, Math.max(0.04, segmentDur * 0.18))
      source.loopEnd = offset + Math.max(source.loopStart - offset + 0.18, segmentDur - Math.min(0.08, segmentDur * 0.12))
    }
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(isGugak ? 2300 : 2600, start)
    filter.Q.setValueAtTime(isGugak ? 0.9 : 0.65, start)
    env.gain.setValueAtTime(0.0001, start)
    env.gain.linearRampToValueAtTime(targetGain, start + 0.035)

    source.connect(filter)
    filter.connect(env)
    env.connect(ctx.destination)

    const live = {
      kind: "sample",
      source: source,
      env: env,
      filter: filter,
      rateParam: source.playbackRate,
      signature: this._liveSignature(plan),
      sampleMidi: segment ? segment.midi : null,
      stopNodes: [source],
    }
    source.onended = function () {
      ;[source, env, filter].forEach(function (node) {
        try {
          node.disconnect()
        } catch (e) {}
      })
    }
    source.start(start, offset)
    return live
  }

  AudioEngine.prototype._createSynthLivePreview = function (ctx, plan, normY) {
    const start = ctx.currentTime + 0.005
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    const isGugak = plan.instrument.group === "국악"
    const isElectronic = plan.instrument.group === "전자"
    const targetGain = isElectronic ? 0.2 : isGugak ? 0.26 : 0.24 // 그리는 중 선율을 배경 위로 더 또렷하게
    const voice = synthVoiceFor(plan.instrument)

    osc.type = voice.waveform
    osc.frequency.setValueAtTime(this._liveFrequency(plan, normY), start)
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(voice.cutoff, start)
    filter.Q.setValueAtTime(voice.Q, start)

    lfo.type = "sine"
    lfo.frequency.setValueAtTime(voice.vibratoRate || 0.01, start)
    lfoGain.gain.setValueAtTime(voice.vibratoDepth, start)
    lfo.connect(lfoGain)
    lfoGain.connect(osc.detune)

    env.gain.setValueAtTime(0.0001, start)
    env.gain.linearRampToValueAtTime(targetGain, start + 0.035)
    osc.connect(filter)
    filter.connect(env)
    env.connect(ctx.destination)

    const live = {
      osc: osc,
      env: env,
      filter: filter,
      lfo: lfo,
      lfoGain: lfoGain,
      signature: this._liveSignature(plan),
      stopNodes: [osc, lfo],
    }
    osc.onended = function () {
      ;[osc, env, filter, lfo, lfoGain].forEach(function (node) {
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
    if (buffer && plan.melodyAsset && plan.melodyAsset.src) {
      return this._createSampleLivePreview(ctx, plan, buffer, normY)
    }
    return this._createSynthLivePreview(ctx, plan, normY)
  }

  AudioEngine.prototype.liveDrawingStart = function (recipe, normY) {
    const ctx = this.ensureContext()
    const self = this
    const run = function () {
      if (self.isPlaying) self.stop()
      else self.stopLivePreview(true)
      const token = ++self.livePreviewToken
      const plan = self.resolvePlan(recipe, [])
      const src = plan.melodyAsset && plan.melodyAsset.src
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
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      if (!self.livePreview || self.livePreview.signature !== self._liveSignature(plan)) {
        self.liveDrawingStart(recipe, normY)
        return
      }
      const now = ctx.currentTime
      if (self.livePreview.kind === "sample") {
        const midi = self._liveMidi(plan, normY)
        const nextSegment = nearestSampleSegment(plan.melodyAsset, midi)
        const nextSampleMidi = nextSegment ? nextSegment.midi : null
        if (nextSampleMidi !== self.livePreview.sampleMidi) {
          self.stopLivePreview(true)
          self.liveDrawingStart(recipe, normY)
          return
        }
        const nextRate = segmentPlaybackRate(plan.melodyAsset, midi, nextSegment)
        self.livePreview.rateParam.cancelScheduledValues(now)
        self.livePreview.rateParam.setTargetAtTime(nextRate, now, 0.025)
      } else {
        const nextFreq = self._liveFrequency(plan, normY)
        self.livePreview.osc.frequency.cancelScheduledValues(now)
        self.livePreview.osc.frequency.setTargetAtTime(nextFreq, now, 0.025)
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

  // --- 드로잉 화면 배경음(분위기 패드 루프) ---
  // 라이브 선율 프리뷰와 독립적으로 깔린다. stop() 은 배경음을 끄지 않는다.

  // 배경 음원(특히 큰 배경 mp3)을 미리 디코드해 두어, 드로잉 진입 시 즉시 깔리게 한다.
  AudioEngine.prototype.warmAmbience = function (recipe) {
    const ctx = this.ensureContext()
    const plan = this.resolvePlan(recipe, [])
    const padAsset = plan.padAsset && plan.padAsset.src ? plan.padAsset : plan.backgroundAsset
    if (!padAsset || !padAsset.src) return Promise.resolve(null)
    return this.loadAssetBuffer(ctx, padAsset)
  }

  AudioEngine.prototype._ambienceSignature = function (plan) {
    return plan.atmosphere.id + "|" + plan.version.id
  }

  AudioEngine.prototype._startAmbienceBuffer = function (ctx, plan, buffer, sig) {
    const now = ctx.currentTime + 0.02
    const src = ctx.createBufferSource()
    const g = ctx.createGain()
    src.buffer = buffer
    src.loop = true
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(plan.version.padGain, now + 0.4) // 빠른 페이드인 → 바로 들리게
    src.connect(g)
    g.connect(ctx.destination)
    src.start(now)
    this.ambience = { signature: sig, gain: g, nodes: [src] }
  }

  AudioEngine.prototype._startAmbienceSynth = function (ctx, plan, sig) {
    const now = ctx.currentTime + 0.02
    const padGain = ctx.createGain()
    padGain.gain.setValueAtTime(0.0001, now)
    padGain.gain.linearRampToValueAtTime(plan.version.padGain, now + 0.5) // 빠른 페이드인 → 바로 들리게
    padGain.connect(ctx.destination)
    const base = plan.style.root - 12
    const iv = plan.style.intervals
    const chord = [base, base + (iv[2] || 4), base + (iv[4] || 7)]
    const wave = (plan.padAsset && plan.padAsset.fallbackWave) || "sine"
    const nodes = []
    chord.forEach(function (midi, index) {
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      osc.type = index === 0 ? "triangle" : wave
      osc.frequency.setValueAtTime(midiToFreq(midi), now)
      osc.detune.setValueAtTime((index - 1) * 7, now)
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(plan.atmosphere.id === "rain" ? 560 : 950, now)
      osc.connect(filter)
      filter.connect(padGain)
      osc.start(now)
      nodes.push(osc)
    })
    this.ambience = { signature: sig, gain: padGain, nodes: nodes }
  }

  AudioEngine.prototype.startAmbience = function (recipe) {
    const ctx = this.ensureContext()
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const sig = self._ambienceSignature(plan)
      // 같은 분위기·믹스로 이미 깔려 있으면 끊지 않는다(악기만 바꿔도 배경음 유지).
      if (self.ambience && self.ambience.signature === sig) return Promise.resolve()
      self.stopAmbience(true)
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
  }

  AudioEngine.prototype._registerPreviewNode = function (node) {
    const self = this
    this.active.push(node)
    node.onended = function () {
      self.active = self.active.filter((n) => n !== node)
    }
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
    env.gain.linearRampToValueAtTime(note.velocity * 0.24, start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, start + note.duration)
    osc.connect(filter)
    filter.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(osc)
    osc.start(start)
    osc.stop(start + note.duration + 0.03)
  }

  AudioEngine.prototype._previewSample = function (ctx, plan, buffer, note, start) {
    const asset = plan.melodyAsset
    const src = ctx.createBufferSource()
    const env = ctx.createGain()
    const segment = nearestSampleSegment(asset, note.midi)
    const baseRate = segmentPlaybackRate(asset, note.midi, segment)
    const offset = segment ? segment.offset : asset.sampleMode === "phrase" ? this.phraseOffset(buffer, note) : 0
    const usableSourceDur = segment ? segment.duration : buffer.duration - offset
    src.buffer = buffer
    src.playbackRate.setValueAtTime(baseRate, start)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.velocity * 0.34, start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, start + note.duration)
    src.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(src)
    src.start(start, offset, Math.min(usableSourceDur, note.duration * baseRate + 0.04))
    src.stop(start + note.duration + 0.03)
  }

  AudioEngine.prototype.previewNote = function (recipe, normY) {
    const ctx = this.ensureContext()
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const note = {
        time: 0,
        duration: 0.24,
        midi: Core.quantizePitch(normY, plan.pitchStyle || plan.style),
        velocity: 0.7,
      }
      const start = ctx.currentTime + 0.01
      const src = plan.melodyAsset && plan.melodyAsset.src
      if (src && self.bufferCache.has(src)) {
        self.bufferCache.get(src).then((buffer) => {
          if (buffer) self._previewSample(ctx, plan, buffer, note, start)
          else self._previewSynth(ctx, plan, note, start)
        })
      } else {
        if (src) self.loadBuffer(ctx, src)
        self._previewSynth(ctx, plan, note, start)
      }
    }
    if (ctx.state === "suspended") return ctx.resume().then(run)
    run()
    return Promise.resolve()
  }

  AudioEngine.prototype.play = async function (recipe, notes) {
    this.stop()
    this.stopAmbience(true) // 완성곡 재생 중엔 드로잉 배경음을 끈다(중복 방지)
    const ctx = this.ensureContext()
    if (ctx.state === "suspended") await ctx.resume()
    const plan = this.resolvePlan(recipe, notes)
    const buffers = await this.preload(ctx, plan)
    const self = this
    const register = function (node) {
      self.active.push(node)
      node.onended = function () {
        self.active = self.active.filter((n) => n !== node)
      }
    }
    const start = ctx.currentTime + 0.05
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.85, start)
    master.connect(ctx.destination)
    this.master = master
    const usedReal = this.schedule(ctx, master, plan, buffers, start, register)
    this.lastMode = usedReal ? "real" : "synth"
    this.isPlaying = true
    if (this.onState) this.onState(true)
    const self2 = this
    this.stopTimer = setTimeout(function () {
      self2.stop()
    }, plan.duration * 1000 + 200)
    return this.lastMode
  }

  // --- 오프라인 렌더 + WAV 내보내기 ---

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
    master.gain.setValueAtTime(0.85, 0)
    master.connect(offline.destination)
    const noop = function () {}
    this.schedule(offline, master, plan, buffers, 0, noop)
    return await offline.startRendering()
  }

  AudioEngine.prototype.exportWav = async function (recipe, notes, filename) {
    const rendered = await this.renderOffline(recipe, notes)
    const wav = Core.encodeWav(rendered)
    const blob = new Blob([wav], { type: "audio/wav" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename || "sound-drawing.wav"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(function () {
      URL.revokeObjectURL(url)
    }, 2000)
    return blob.size
  }

  root.AudioEngine = AudioEngine
})(typeof self !== "undefined" ? self : this)
