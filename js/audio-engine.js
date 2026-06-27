/*
 * audio-engine.js — Web Audio 합주 엔진 (window.AudioEngine)
 *
 * 레이어: 배경 패드 + 자연 효과음 + 드로잉 선율.
 * 실제 음원 우선, 로드 실패 층만 합성음으로 대체.
 * 같은 그래프를 라이브(AudioContext)와 오프라인(OfflineAudioContext) 양쪽에 구성 → 압축 오디오 내보내기.
 */
;(function (root) {
  "use strict"

  const Core = root.MusicCore
  const Data = root.SDStudioData
  const EFFECT_GAIN = 0.15
  const BACKGROUND_OUTPUT_GAIN = 1.5
  const WESTERN_MELODY_OUTPUT_GAIN = 1.5

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  function isWesternInstrument(instrument) {
    return !!(instrument && instrument.group === "서양")
  }

  function backgroundOutputGain(plan) {
    return ((plan && plan.version && plan.version.padGain) || 0) * BACKGROUND_OUTPUT_GAIN
  }

  function melodyOutputGain(plan, instrument) {
    const base = ((plan && plan.version && plan.version.melodyGain) || 0)
    return base * (isWesternInstrument(instrument || (plan && plan.instrument)) ? WESTERN_MELODY_OUTPUT_GAIN : 1)
  }

  function previewOutputGain(plan) {
    return isWesternInstrument(plan && plan.instrument) ? WESTERN_MELODY_OUTPUT_GAIN : 1
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
    // 검출된 샘플 구간은 segment.midi 에서 segment.cents 만큼 어긋나 있다(Hz 분석 메타).
    // 그 오차를 보정해 실제로 목표 음(midi)으로 정확히 재생되게 한다.
    // → 국악기 "삑사리"·"피치 안 맞음"(소금 E·대금 윗옥타브·해금 전체)의 근본 원인 해결.
    const detectedSemitone = segment.midi + (segment.cents || 0) / 100
    return Math.pow(2, (midi - detectedSemitone) / 12)
  }
  // 멀티샘플: 음(피치)마다 별도 녹음 파일을 가진 악기(서양 선율). phrase(국악 한 파일 분할)와 구분.
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
  // 멀티샘플에서 해당 음의 실제 녹음 버퍼를 고른다. 없으면 대표(폴백) 버퍼.
  function sampleBufferFor(sampleBuffers, segment, fallback) {
    if (sampleBuffers && segment && sampleBuffers[segment.midi]) return sampleBuffers[segment.midi]
    return fallback
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
    clarinet: { cutoff: 1700, Q: 1.2, attack: 0.05, vibratoDepth: 6 }, // 둥글고 부드러운 목관
    flute: { cutoff: 3600, Q: 0.5, attack: 0.05, vibratoDepth: 5 }, // 맑은 숨결
    oboe: { cutoff: 2300, Q: 1.6, vibratoDepth: 9 }, // 코맹맹이 공명
    frenchHorn: { cutoff: 1250, attack: 0.1, vibratoRate: 4.2, vibratoDepth: 5 }, // 둥글고 긴 호흡
    daegeum: { cutoff: 2200, vibratoDepth: 22 }, // 큰 시김새
    sogeum: { cutoff: 3500, vibratoDepth: 13 },
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
    if (!next) return false
    if (note.voice != null || next.voice != null) {
      if (note.voice !== next.voice) return false
    }
    return Math.abs(note.time + note.duration - next.time) < 1e-3
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
    this.decodedCache = new Map() // url -> AudioBuffer|null
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
    this.isPaused = false // 일시정지 상태(ctx.suspend)
    this.playGen = 0 // 재생 세대 토큰 — 비동기 play() 도중 stop/재요청 시 무효화용
    this.playEndsAtMs = 0 // 자동 정지 예정 시각(일시정지 잔여시간 계산용)
    this.pauseRemainingMs = 0 // 일시정지 시점의 남은 재생 시간(ms)
  }

  AudioEngine.prototype.ensureContext = function () {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext
      this.ctx = new AC()
    }
    return this.ctx
  }

  AudioEngine.prototype.emitState = function () {
    if (this.onState) this.onState(this.isPlaying, this.isPaused)
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
    const atmosphere = Data.atmospheres.find((a) => a.id === recipe.atmosphere) || Data.atmospheres[0]
    const instrument = Data.instruments.find((i) => i.id === recipe.instrument) || Data.instruments[0]
    const style = Data.styles.find((s) => s.id === recipe.style) || Data.styles[0]
    const version = Data.versions.find((v) => v.id === recipe.version) || Data.versions[0]
    const padAsset = Data.pads[atmosphere.padType] || null
    const backgroundAsset = Data.backgrounds[atmosphere.backgroundId] || null
    const melodyAsset = Data.melodies[instrument.id] || null
    // 오케스트라: 획(voice)마다 다른 악기. recipe.strokeInstruments[voice] → 악기/asset/gugak.
    // 비어 있으면(옛 레시피) 전 voice가 기본 instrument 하나로 재생.
    const voiceAssets = {}
    ;(recipe.strokeInstruments || []).forEach(function (instId, voice) {
      const inst = Data.instruments.find((i) => i.id === instId) || instrument
      voiceAssets[voice] = {
        instrument: inst,
        melodyAsset: Data.melodies[inst.id] || null,
        gugak: !!style.gugak || inst.group === "국악" || !!version.ornament,
      }
    })
    const duration = recipe.duration || 30
    const effectIds = []
    ;(atmosphere.effectIds || []).concat(recipe.effectIds || []).forEach(function (id) {
      if (Data.effects[id] && effectIds.indexOf(id) === -1) effectIds.push(id)
    })
    const effectStamps = (recipe.effectStamps || [])
      .filter(function (stamp) {
        return stamp && Data.effects[stamp.id]
      })
      .map(function (stamp) {
        const x = clamp(stamp.x == null ? 0 : stamp.x, 0, 1)
        const y = clamp(stamp.y == null ? 0.5 : stamp.y, 0, 1)
        const time = stamp.time == null ? x * duration : clamp(stamp.time, 0, duration)
        if (effectIds.indexOf(stamp.id) === -1) effectIds.push(stamp.id)
        return { id: stamp.id, x: x, y: y, time: time }
      })
    const effects = effectIds.map((id) => Object.assign({ id: id }, Data.effects[id]))
    const gugak = !!style.gugak || instrument.group === "국악" || !!version.ornament
    const mode = recipe.mode || "melody"
    const rhythmHits =
      mode === "rhythm" ? Core.autocompleteRhythm(recipe.path || [], { durationSec: duration, bpm: 100 }) : []
    return {
      duration: duration,
      totalDuration: duration,
      playbackOffset: 0,
      bgOffset: Math.max(0, recipe.bgOffset || 0), // 배경음악을 이 지점(초)부터 깐다(스케줄에서 버퍼 길이로 클램프)
      bgEndOffset: Math.max(0, recipe.bgEndOffset || 0),
      mode: mode,
      atmosphere: atmosphere,
      instrument: instrument,
      style: style,
      pitchStyle: style,
      version: version,
      padAsset: padAsset,
      backgroundAsset: backgroundAsset,
      melodyAsset: melodyAsset,
      voiceAssets: voiceAssets,
      effects: effects,
      effectStamps: effectStamps,
      gugak: gugak,
      notes: playbackNotesForPlan(notes || [], instrument, melodyAsset, voiceAssets),
      uiNotes: notes || [],
      rhythmHits: rhythmHits,
    }
  }

  AudioEngine.prototype.seekPlan = function (plan, offsetSec) {
    const totalDuration = Math.max(0.05, plan.totalDuration || plan.duration || 30)
    const offset = clamp(Number(offsetSec) || 0, 0, Math.max(0, totalDuration - 0.05))
    if (offset <= 0) {
      return Object.assign({}, plan, {
        totalDuration: totalDuration,
        playbackOffset: 0,
      })
    }
    const remaining = Math.max(0.05, totalDuration - offset)
    const shiftNotes = function (notes) {
      return (notes || [])
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
    return Object.assign({}, plan, {
      duration: remaining,
      totalDuration: totalDuration,
      playbackOffset: offset,
      notes: shiftNotes(plan.notes),
      uiNotes: shiftNotes(plan.uiNotes),
      rhythmHits: shiftTimed(plan.rhythmHits),
      effectStamps: shiftTimed(plan.effectStamps),
    })
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
    if (buffers.pad) {
      const src = ctx.createBufferSource()
      const g = ctx.createGain()
      src.buffer = buffers.pad
      const bgRange = backgroundRange(plan, buffers.pad)
      const bgPlaybackOffset =
        bgRange.length > 0 ? bgRange.start + ((plan.playbackOffset || 0) % bgRange.length) : bgRange.start
      src.loopStart = bgRange.start
      src.loopEnd = bgRange.end
      src.loop = bgRange.length < dur || buffers.pad.duration < bgPlaybackOffset + dur
      const padGain = backgroundOutputGain(plan)
      g.gain.setValueAtTime(padGain * 0.35, start)
      g.gain.linearRampToValueAtTime(padGain, start + 0.35)
      g.gain.setValueAtTime(padGain, start + Math.max(1.2, dur - 1.5))
      g.gain.linearRampToValueAtTime(0, start + dur)
      src.connect(g)
      g.connect(dest)
      register(src)
      src.start(start, bgPlaybackOffset)
      src.stop(start + dur + 0.05)
      usedReal = true
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
      ;(plan.notes || []).forEach(function (note) {
        const key = note.voice == null ? "_" : String(note.voice)
        if (!byVoice.has(key)) byVoice.set(key, [])
        byVoice.get(key).push(note)
      })
      byVoice.forEach(function (voiceNotes, key) {
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
          self.scheduleSampleMelody(ctx, melodyGain, voicePlan, voiceNotes, instBuffers, start, register)
          usedReal = true
        } else {
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

  AudioEngine.prototype.scheduleSampleMelody = function (ctx, dest, plan, notes, instBuffers, start, register) {
    const asset = plan.melodyAsset
    const buffer = instBuffers.melody
    const sampleBuffers = instBuffers.melodySamples
    const multi = isMultiSample(asset)
    const samplePhrase = asset.sampleMode === "phrase"
    if (multi) {
      for (const note of notes) {
        const noteStart = start + note.time
        const segment = nearestSampleSegment(asset, note.midi)
        const srcBuffer = sampleBufferFor(sampleBuffers, segment, buffer)
        if (!srcBuffer) continue
        const baseRate = segmentPlaybackRate(asset, note.midi, segment)
        if (asset.tremoloAfter != null && note.duration >= asset.tremoloAfter) {
          this.scheduleSampleTremolo(ctx, dest, note, srcBuffer, baseRate, start, register)
          continue
        }
        const src = ctx.createBufferSource()
        const env = ctx.createGain()
        const usableSourceDur = srcBuffer.duration
        const needSustain = note.duration * baseRate > usableSourceDur * 0.85
        src.buffer = srcBuffer
        src.playbackRate.setValueAtTime(baseRate, noteStart)
        this.applySigimsae(src, null, baseRate, note, plan, noteStart)
        if (needSustain && usableSourceDur > 0.25) {
          src.loop = true
          src.loopStart = Math.min(0.12, usableSourceDur * 0.2)
          src.loopEnd = Math.max(usableSourceDur - Math.min(0.08, usableSourceDur * 0.1), src.loopStart + 0.15)
        }
        applyPhraseEnv(env, note.velocity * 0.85, noteStart, note.duration)
        src.connect(env)
        env.connect(dest)
        register(src)
        if (src.loop) {
          src.start(noteStart, 0)
        } else {
          const srcDur = Math.max(0.05, Math.min(usableSourceDur, note.duration * baseRate + 0.18))
          src.start(noteStart, 0, srcDur)
        }
        src.stop(noteStart + note.duration + 0.18)
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
      const src = ctx.createBufferSource()
      const env = ctx.createGain()
      const segment = nearestSampleSegment(asset, first.midi)
      // 멀티샘플이면 프레이즈 첫 음에 가장 가까운 실제 녹음을 쓰고, 나머지는 거기서 미세 피치시프트.
      const srcBuffer = multi ? sampleBufferFor(sampleBuffers, segment, buffer) : buffer
      const baseRate = segmentPlaybackRate(asset, first.midi, segment)
      src.buffer = srcBuffer
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
      const offset = multi ? 0 : segment ? segment.offset : samplePhrase ? this.phraseOffset(srcBuffer, first) : 0
      const usableSourceDur = multi ? srcBuffer.duration : segment ? segment.duration : srcBuffer.duration - offset
      const needSustain = phraseDuration * baseRate > usableSourceDur * 0.85
      // 발현(뜯는) 악기인 가야금은 길게 끌어도 한 번 뜯고 자연 감쇠해야 한다.
      // 구간을 루프하면 "띵~띵~띵" 다시 뜯는 소리가 되므로 지속음 루프에서 제외한다.
      const plucked = plan.instrument && plan.instrument.id === "gayageum"
      if (needSustain && usableSourceDur > 0.25 && !plucked) {
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

  AudioEngine.prototype.scheduleSynthMelody = function (ctx, dest, plan, notes, start, register) {
    const voice = synthVoiceFor(plan.instrument)
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
    const targetGain = backgroundOutputGain(plan)
    padGain.gain.setValueAtTime(targetGain * 0.35, start)
    padGain.gain.linearRampToValueAtTime(targetGain, start + 0.45)
    padGain.gain.setValueAtTime(targetGain, start + Math.max(1.6, dur - 1.5))
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

  AudioEngine.prototype.stop = function (options) {
    const emitState = !options || options.emitState !== false
    const hadPlayback = this.isPlaying || this.isPaused || !!this.master || !!this.stopTimer || !!this.ambience
    this.playGen++ // 진행 중인 비동기 play() 를 무효화(로딩 중 정지가 확실히 먹히도록)
    this.isPaused = false
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
        self.stop()
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

  AudioEngine.prototype._liveMidi = function (plan, normY) {
    const uiMidi = Core.quantizePitch(normY, plan.pitchStyle || plan.style, plan.melodyAsset)
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
    const midi = this._liveMidi(plan, normY)
    if (midi == null) return null
    const start = ctx.currentTime + 0.005
    const source = ctx.createBufferSource()
    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const isGugak = plan.instrument.group === "국악"
    const targetGain = (isGugak ? 0.34 : 0.3) * previewOutputGain(plan) // 그리는 중 선율을 배경 위로 더 또렷하게
    const multi = isMultiSample(plan.melodyAsset)
    const segment = nearestSampleSegment(plan.melodyAsset, midi)
    const offset = multi ? 0 : segment ? segment.offset : Math.min(0.05, Math.max(0, buffer.duration * 0.08))
    const segmentDur = multi ? buffer.duration : segment ? segment.duration : buffer.duration - offset

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
    const frequency = this._liveFrequency(plan, normY)
    if (frequency == null) return null
    const start = ctx.currentTime + 0.005
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    const isGugak = plan.instrument.group === "국악"
    const isElectronic = plan.instrument.group === "전자"
    const targetGain = (isElectronic ? 0.2 : isGugak ? 0.26 : 0.24) * previewOutputGain(plan) // 그리는 중 선율을 배경 위로 더 또렷하게
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
    if (this._liveMidi(plan, normY) == null) return null
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
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const midi = self._liveMidi(plan, normY)
      if (midi == null) {
        self.stopLivePreview(true)
        return
      }
      if (!self.livePreview || self.livePreview.signature !== self._liveSignature(plan)) {
        self.liveDrawingStart(recipe, normY)
        return
      }
      const now = ctx.currentTime
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
          self.livePreview.rateParam.cancelScheduledValues(now)
          self.livePreview.rateParam.setTargetAtTime(nextRate, now, 0.025)
        } else {
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
        }
      } else {
        const nextFreq = midiToFreq(midi)
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
    const padGain = ctx.createGain()
    padGain.gain.setValueAtTime(0.0001, now)
    padGain.gain.linearRampToValueAtTime(backgroundOutputGain(plan), now + 0.5) // 빠른 페이드인 → 바로 들리게
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
    if (this.isPaused && ctx.state === "suspended") return Promise.resolve()
    const self = this
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const sig = self._ambienceSignature(plan)
      // 같은 배경·믹스로 이미 깔려 있으면 끊지 않는다(악기만 바꿔도 배경음 유지).
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
    env.gain.linearRampToValueAtTime(note.velocity * 0.24 * previewOutputGain(plan), start + 0.012)
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
    const multi = isMultiSample(asset)
    const src = ctx.createBufferSource()
    const env = ctx.createGain()
    const segment = nearestSampleSegment(asset, note.midi)
    const baseRate = segmentPlaybackRate(asset, note.midi, segment)
    const offset = multi ? 0 : segment ? segment.offset : asset.sampleMode === "phrase" ? this.phraseOffset(buffer, note) : 0
    const usableSourceDur = multi ? buffer.duration : segment ? segment.duration : buffer.duration - offset
    src.buffer = buffer
    src.playbackRate.setValueAtTime(baseRate, start)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.velocity * 0.34 * previewOutputGain(plan), start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, start + note.duration)
    src.connect(env)
    env.connect(ctx.destination)
    this._registerPreviewNode(src)
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
    this._registerPreviewNode(src)
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
    this._registerPreviewNode(osc)
    osc.start(start)
    osc.stop(start + 0.27)
  }

  AudioEngine.prototype.previewEffect = function (effect) {
    if (!effect || !effect.src) return Promise.resolve(false)
    const ctx = this.ensureContext()
    const self = this
    const run = function () {
      const start = ctx.currentTime + 0.01
      const readyBuffer = effect.src ? self.decodedCache.get(effect.src) : null
      if (readyBuffer) {
        self._playEffectBufferPreview(ctx, readyBuffer, start)
        return Promise.resolve(true)
      }
      self._previewEffectFallback(ctx, effect, start)
      const requestedAt = ctx.currentTime
      return self.loadAssetBuffer(ctx, effect).then(function (buffer) {
        if (buffer && ctx.currentTime - requestedAt < 0.7) {
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
    const run = function () {
      const plan = self.resolvePlan(recipe, [])
      const midi = self._liveMidi(plan, normY)
      if (midi == null) return
      const note = {
        time: 0,
        duration: 0.24,
        midi: midi,
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

  AudioEngine.prototype.play = async function (recipe, notes, options) {
    this.stop({ emitState: false })
    this.stopAmbience(true) // 완성곡 재생 중엔 드로잉 배경음을 끈다(중복 방지)
    const gen = ++this.playGen // 이 재생의 세대 토큰 (this.stop() 이 playGen 을 올린 뒤 새로 받음)
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
    const register = function (node) {
      self.active.push(node)
      node.onended = function () {
        self.active = self.active.filter((n) => n !== node)
      }
    }
    const start = ctx.currentTime + 0.05
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.85, start)
    connectMasterToOutput(ctx, master, ctx.destination, start)
    this.master = master
    const usedReal = this.schedule(ctx, master, plan, buffers, start, register)
    this.lastMode = usedReal ? "real" : "synth"
    this.isPlaying = true
    this.emitState()
    const self2 = this
    this.playEndsAtMs = Date.now() + plan.duration * 1000 + 200
    this.stopTimer = setTimeout(function () {
      self2.stop()
    }, plan.duration * 1000 + 200)
    return this.lastMode
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
    master.gain.setValueAtTime(0.85, 0)
    connectMasterToOutput(offline, master, offline.destination, 0)
    const noop = function () {}
    this.schedule(offline, master, plan, buffers, 0, noop)
    return await offline.startRendering()
  }

  AudioEngine.prototype.exportCompressedAudio = async function (recipe, notes, filename) {
    const mimeType = supportedCompressedAudioMime()
    if (!mimeType) throw new Error("Compressed WebM audio recording is not supported")
    const ctx = this.ensureContext()
    if (ctx.state === "suspended") await ctx.resume()
    if (typeof ctx.createMediaStreamDestination !== "function") {
      throw new Error("Audio recording destination is not supported")
    }
    const rendered = await this.renderOffline(recipe, notes)
    const dest = ctx.createMediaStreamDestination()
    const source = ctx.createBufferSource()
    source.buffer = rendered
    source.connect(dest)
    const chunks = []
    const recorder = new root.MediaRecorder(dest.stream, { mimeType })
    let stopTimer = 0
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
      await done
    } finally {
      if (stopTimer) root.clearTimeout(stopTimer)
      try {
        source.disconnect()
      } catch (e) {}
      try {
        dest.disconnect()
      } catch (e) {}
      dest.stream.getTracks().forEach((track) => track.stop())
    }
    if (!chunks.length) throw new Error("Compressed audio is empty")
    const blob = new Blob(chunks, { type: mimeType })
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
    return { size: blob.size, mimeType: mimeType }
  }

  root.AudioEngine = AudioEngine
})(typeof self !== "undefined" ? self : this)
