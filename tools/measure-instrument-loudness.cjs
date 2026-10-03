const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const MusicCore = require(path.join(ROOT, "js", "music-core.js"))
const WESTERN_IDS = new Set(["flute", "oboe", "clarinet", "frenchHorn", "violin", "viola", "cello", "doubleBass"])
// 재생 시 포락선 기반 자동 루프를 쓰는 악기 — 들리는 음량이 그 루프 구간에서 나오므로
// 측정도 같은 구간을 잰다. js/audio-samples.js 의 SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS 와 맞출 것.
const AUTO_LOOP_IDS = new Set([...WESTERN_IDS, "sogeum", "daegeum", "danso", "haegeum"])
// js/audio-engine.js 의 WIDE_NOTE_GAIN_LIMIT_IDS 와 맞출 것(더블베이스 + 국악 4악기, 2026-10-03).
const EXTENDED_NOTE_GAIN_IDS = new Set(["doubleBass", "sogeum", "daegeum", "danso", "haegeum"])
// 뜯는 소리는 첫 0.2초만 재서 A-가중 값이 재는 위치에 크게 흔들린다(도구 −1.7 dB, 크롬 재생 +1.1 dB).
// 비교 청취도 하지 않았으니 악기 게인은 예전처럼 RMS로 맞춘다(2026-10-03).
const RMS_LEVEL_IDS = new Set(["gayageum"])
const PCM_SAMPLE_RATE = 44100
const INSTRUMENT_IDS = [
  "flute",
  "oboe",
  "clarinet",
  "frenchHorn",
  "violin",
  "viola",
  "cello",
  "doubleBass",
  "sogeum",
  "daegeum",
  "danso",
  "haegeum",
  "gayageum",
]
const WESTERN_UI_MIDI = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
const GUGAK_UI_MIDI = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]
const WESTERN_MELODY_OUTPUT_GAIN = 1.5
const GUGAK_DRAWING_GAIN_BOOST = 1.3
const NOTE_GAIN_LIMIT_DB = 3
// 루프 적용 범위와 별개인, 측정으로 승인된 음별 보정 예외.
// js/audio-engine.js 의 AUTO_LOOP_NOTE_GAIN_LIMIT_DB 와 맞출 것.
const AUTO_LOOP_NOTE_GAIN_LIMIT_DB = 12

function runScript(file, sandbox) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8")
  new Function("self", code + "\n;return self")(sandbox)
}

function loadData() {
  const sandbox = {}
  runScript("js/manifest.js", sandbox)
  runScript("js/sample-maps-western.js", sandbox)
  runScript("js/sample-maps.js", sandbox)
  return sandbox.SDStudioData
}

function currentInstrumentGains() {
  const src = fs.readFileSync(path.join(ROOT, "js/audio-engine.js"), "utf8")
  const match = src.match(/const INSTRUMENT_MELODY_OUTPUT_GAINS = \{([\s\S]*?)\n  \}/)
  if (!match) throw new Error("INSTRUMENT_MELODY_OUTPUT_GAINS not found")
  return new Function(`return ({${match[1]}\n})`)()
}

function currentNoteGains() {
  const src = fs.readFileSync(path.join(ROOT, "js/audio-engine.js"), "utf8")
  const match = src.match(/const NOTE_MELODY_OUTPUT_GAINS = \{([\s\S]*?)\r?\n  \}\r?\n  const LIVE_PREVIEW_MAX_GAIN/)
  if (!match) throw new Error("NOTE_MELODY_OUTPUT_GAINS not found")
  return new Function(`return ({${match[1]}\n})`)()
}

function dbGain(gain) {
  return 20 * Math.log10(gain)
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function energyAverageDb(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return NaN
  const avg = finite.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / finite.length
  return 10 * Math.log10(avg)
}

function relativePathToAbs(rel) {
  return path.join(ROOT, rel.replaceAll("/", path.sep))
}

function fileDuration(absPath) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", absPath],
    { encoding: "utf8" },
  )
  const duration = Number(String(result.stdout).trim())
  return Number.isFinite(duration) ? duration : 0
}

function measureMeanDb(absPath, offset, duration) {
  const nullOut = process.platform === "win32" ? "NUL" : "/dev/null"
  const args = ["-hide_banner", "-nostats"]
  if (offset > 0) args.push("-ss", String(offset))
  if (duration > 0) args.push("-t", String(duration))
  args.push("-i", absPath, "-af", "volumedetect", "-f", "null", nullOut)
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" })
  const output = `${result.stdout}\n${result.stderr}`
  const match = output.match(/mean_volume:\s*([-0-9.]+) dB/)
  return match ? Number(match[1]) : NaN
}

// 재생처럼 원래 채널 그대로 디코드한다(채널 배열을 돌려준다).
// ffmpeg 의 float 모노 다운믹스(-ac 1)는 두 채널을 √½ 씩 더해서, 두 채널이 같은 스테레오 파일(단소)을
// 실제 재생보다 3 dB 크게 쟀다 → 단소 게인이 3 dB 낮게 잡혔다(2026-10-03 실측).
const pcmCache = new Map()
function decodePcm(absPath) {
  if (pcmCache.has(absPath)) return pcmCache.get(absPath)
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", absPath],
    { encoding: "utf8" },
  )
  const channelCount = Math.max(1, parseInt(String(probe.stdout).trim(), 10) || 1)
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", absPath, "-f", "f32le", "-ar", String(PCM_SAMPLE_RATE), "-"],
    { maxBuffer: 1 << 27 },
  )
  const buf = result.stdout
  if (!buf || !buf.length) return null
  const interleaved = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
  const frameCount = Math.floor(interleaved.length / channelCount)
  const channels = []
  for (let ch = 0; ch < channelCount; ch++) {
    const data = new Float32Array(frameCount)
    for (let i = 0; i < frameCount; i++) data[i] = interleaved[i * channelCount + ch]
    channels.push(data)
  }
  pcmCache.set(absPath, channels)
  return channels
}

// js/audio-engine.js 의 configureSampleToneFilter 와 같은 국악 음색 필터(가야금 제외).
// 공진이 있어 해금은 1.7 dB, 소금은 0.6 dB 커진다 — 재는 쪽도 같은 필터를 거쳐야 한다.
// Web Audio 의 lowpass Q 는 dB 단위다: alpha = sin(w0) / (2 * 10^(Q/20)).
const GUGAK_TONE_FILTER_IDS = new Set(["sogeum", "daegeum", "danso", "haegeum"])
const GUGAK_TONE_FILTER = { frequency: 2300, qDb: 0.9 }
// js/audio-engine.js 의 HAEGEUM_RESONANCE_CUTS 와 맞출 것 — 해금 울림통 공명(1.4~1.8 kHz)을 깎는 두 필터(2026-10-04).
// 공명이 해금 소리의 대부분이라, 깎은 뒤를 재지 않으면 해금 게인이 18 dB쯤 작게 잡힌다.
const HAEGEUM_RESONANCE_CUTS = [
  { frequency: 1450, Q: 1.4, gainDb: -14 },
  { frequency: 1750, Q: 1.6, gainDb: -14 },
]
const HAEGEUM_TONE_FILTER = Object.assign({}, GUGAK_TONE_FILTER, { cuts: HAEGEUM_RESONANCE_CUTS })
function webAudioLowpass(pcm, sampleRate, frequency, qDb) {
  const w0 = (2 * Math.PI * frequency) / sampleRate
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20))
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 - cos) / 2 / a0
  const b1 = (1 - cos) / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const out = new Float32Array(pcm.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < pcm.length; i++) {
    const y = b0 * pcm[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = pcm[i]
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

// Web Audio 의 peaking 필터(RBJ): A = 10^(gain/40), alpha = sin(w0) / (2Q).
function webAudioPeaking(pcm, sampleRate, frequency, q, gainDb) {
  const w0 = (2 * Math.PI * frequency) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha / A
  const b0 = (1 + alpha * A) / a0
  const b1 = (-2 * cos) / a0
  const b2 = (1 - alpha * A) / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha / A) / a0
  const out = new Float32Array(pcm.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < pcm.length; i++) {
    const y = b0 * pcm[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = pcm[i]
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

// 재생과 같은 순서로 국악 음색 필터(저역 통과)와 해금 공명 깎기를 거친다.
function applyToneFilter(pcm, toneFilter) {
  let out = webAudioLowpass(pcm, PCM_SAMPLE_RATE, toneFilter.frequency, toneFilter.qDb)
  for (const cut of toneFilter.cuts || []) out = webAudioPeaking(out, PCM_SAMPLE_RATE, cut.frequency, cut.Q, cut.gainDb)
  return out
}

function pcmMeanDb(pcm, offset, duration) {
  const startI = Math.max(0, Math.round(offset * PCM_SAMPLE_RATE))
  const endI = Math.min(pcm.length, Math.round((offset + duration) * PCM_SAMPLE_RATE))
  if (endI - startI < 8) return NaN
  let sum = 0
  for (let i = startI; i < endI; i++) sum += pcm[i] * pcm[i]
  return 10 * Math.log10(sum / (endI - startI) + 1e-12)
}

// A-가중(IEC 61672) 크기. 사람 귀는 낮은 소리에 둔해서 에너지(RMS)가 같아도 첼로·더블베이스·대금·호른처럼
// 낮은 악기가 작게 들린다(2026-10-03 비교 청취에서 사용자가 A-가중으로 맞춘 쪽을 골랐다).
// 악기끼리의 크기(INSTRUMENT_MELODY_OUTPUT_GAINS)는 이 값으로 맞추고, 악기 안의 음별 보정은 RMS로 둔다.
function aWeightingPower(frequency) {
  const f2 = frequency * frequency
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return Math.pow(ra * Math.pow(10, 2 / 20), 2) // +2.0 dB: 1 kHz 에서 0 dB
}

function fftPower(frame) {
  const n = frame.length
  const re = Float64Array.from(frame)
  const im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [re[i], re[j]] = [re[j], re[i]]
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k)
        const a = i + k, b = a + len / 2
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  const power = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k]
  return power
}

// Welch 평균 스펙트럼(한 창, 절반 겹침)에 A-가중을 곱해 더한다. 가중 없이 더하면 pcmMeanDb 와 같은 값이 된다.
function pcmAWeightedDb(pcm, startI, endI) {
  const length = Math.min(pcm.length, endI) - Math.max(0, startI)
  if (length < 1024) return NaN
  let n = 8192
  while (n > length) n >>= 1
  const window = new Float64Array(n)
  let windowPower = 0
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    windowPower += window[i] * window[i]
  }
  const weights = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) weights[k] = aWeightingPower((k * PCM_SAMPLE_RATE) / n) * (k === 0 || k === n / 2 ? 1 : 2)
  let sum = 0
  let frames = 0
  for (let at = Math.max(0, startI); at + n <= Math.max(0, startI) + length; at += n / 2) {
    const frame = new Float64Array(n)
    for (let i = 0; i < n; i++) frame[i] = pcm[at + i] * window[i]
    const power = fftPower(frame)
    for (let k = 0; k <= n / 2; k++) sum += (power[k] * weights[k]) / (windowPower * n)
    frames++
  }
  return 10 * Math.log10(sum / frames + 1e-12)
}

// 일반 구간(뜯는 소리·루프 검출 실패)의 A-가중 크기. 국악 음색 필터가 있으면 재생처럼 거친 뒤 잰다.
function rangeAWeightedDb(absPath, range, toneFilter) {
  const pcm = decodePcm(absPath)
  if (!pcm || !pcm.length) return NaN
  const startI = Math.max(0, Math.round(range.offset * PCM_SAMPLE_RATE))
  const endI = Math.min(pcm[0].length, Math.round((range.offset + range.duration) * PCM_SAMPLE_RATE))
  let power = 0
  for (const channel of pcm) {
    const filtered = toneFilter ? applyToneFilter(channel, toneFilter) : channel
    power += Math.pow(10, pcmAWeightedDb(filtered, startI, endI) / 10)
  }
  return 10 * Math.log10(power / pcm.length)
}

// 자동 루프 악기: 재생이 실제로 반복하는 안정 구간의 RMS와 A-가중 크기를 잰다. 검출 실패 시 null(호출부 폴백).
// 엔진(autoSustainLoopHint)처럼 첫 채널로 구간을 찾고 모든 채널을 같은 구간으로 구운 뒤, 채널 평균 전력을 쓴다.
function autoLoopMeanDb(absPath, offset, duration, toneFilter) {
  const pcm = decodePcm(absPath)
  if (!pcm || !pcm.length || !pcm[0].length) return null
  const first = Math.floor((offset || 0) * PCM_SAMPLE_RATE)
  const last = duration > 0 ? Math.min(pcm[0].length, Math.ceil(((offset || 0) + duration) * PCM_SAMPLE_RATE)) : pcm[0].length
  const sources = pcm.map((channel) => channel.subarray(first, last))
  const region = MusicCore.findStableLoopRegion(sources[0], PCM_SAMPLE_RATE, 0, sources[0].length / PCM_SAMPLE_RATE, { targetLoopSec: 1.02, minLoopSec: 0.42, align: false })
  if (!region) return null
  const leveled = MusicCore.levelSustainSupport(sources, PCM_SAMPLE_RATE, region)
  const frames = MusicCore.sustainLoopFrames(leveled, PCM_SAMPLE_RATE, region)
  if (!frames) return null
  let power = 0
  let powerA = 0
  for (const channel of leveled) {
    let baked = MusicCore.crossfadeSustainLoop(channel, frames)
    if (toneFilter) baked = applyToneFilter(baked, toneFilter)
    power += Math.pow(10, pcmMeanDb(baked, frames.start / PCM_SAMPLE_RATE, (frames.end - frames.start) / PCM_SAMPLE_RATE) / 10)
    powerA += Math.pow(10, pcmAWeightedDb(baked, frames.start, frames.end) / 10)
  }
  return { rmsDb: 10 * Math.log10(power / leveled.length), aDb: 10 * Math.log10(powerA / leveled.length) }
}

function nearestSample(asset, midi) {
  const map = Array.isArray(asset.sampleMap) ? asset.sampleMap : []
  if (!map.length) return null
  let best = map[0]
  for (const item of map) {
    if (Math.abs(item.midi - midi) < Math.abs(best.midi - midi)) best = item
  }
  return best
}

function stableWholeFileRange(absPath) {
  const duration = fileDuration(absPath)
  const offset = Math.max(0, duration * 0.28)
  return {
    offset,
    duration: Math.max(0.05, Math.min(duration * 0.5, duration - offset)),
  }
}

function stableSegmentRange(segment) {
  const segmentOffset = Number(segment.offset) || 0
  const segmentDuration = Number(segment.duration) || 0
  const offset = segmentOffset + segmentDuration * 0.28
  return {
    offset,
    duration: Math.max(0.05, Math.min(segmentDuration * 0.5, segmentOffset + segmentDuration - offset)),
  }
}

function pluckedAttackRange(segment) {
  const segmentOffset = Number(segment && segment.offset) || 0
  const segmentDuration = Number(segment && segment.duration) || 0
  const leadIn = Math.min(0.02, segmentDuration * 0.05)
  return {
    offset: segmentOffset + leadIn,
    duration: Math.max(0.05, Math.min(0.22, segmentDuration * 0.4)),
  }
}

function measureSegmentSource(id, asset, segment) {
  const rel = segment && segment.src ? segment.src : asset.src
  if (!rel) return null
  const absPath = relativePathToAbs(rel)
  if (!fs.existsSync(absPath)) return null
  const range = id === "gayageum" ? pluckedAttackRange(segment) : segment && !segment.src && (segment.offset != null || segment.duration != null)
    ? stableSegmentRange(segment)
    : stableWholeFileRange(absPath)
  const toneFilter = id === "haegeum" ? HAEGEUM_TONE_FILTER : GUGAK_TONE_FILTER_IDS.has(id) ? GUGAK_TONE_FILTER : null
  const loop = AUTO_LOOP_IDS.has(id) ? autoLoopMeanDb(absPath, segment && !segment.src ? segment.offset : 0, segment && !segment.src ? segment.duration : 0, toneFilter) : null
  return {
    sourceDb: loop ? loop.rmsDb : measureMeanDb(absPath, range.offset, range.duration),
    sourceDbA: loop ? loop.aDb : rangeAWeightedDb(absPath, range, toneFilter),
    sourceFile: path.basename(rel),
  }
}

function instrumentRows(data, id, gains) {
  const asset = data.melodies[id]
  const uiMidi = WESTERN_IDS.has(id) ? WESTERN_UI_MIDI : GUGAK_UI_MIDI
  const categoryGain = WESTERN_IDS.has(id) ? WESTERN_MELODY_OUTPUT_GAIN : GUGAK_DRAWING_GAIN_BOOST
  const currentGain = gains && gains[id] != null ? gains[id] : 1
  const rows = []
  for (const ui of uiMidi) {
    const playbackMidi = ui + (asset.playbackTranspose || 0)
    const segment = nearestSample(asset, playbackMidi)
    const measured = measureSegmentSource(id, asset, segment)
    if (!measured) continue
    rows.push({
      uiMidi: ui,
      playbackMidi,
      sourceMidi: segment && segment.midi,
      sourceNote: segment && segment.note,
      sourceFile: measured.sourceFile,
      sourceDb: measured.sourceDb,
      sourceDbA: measured.sourceDbA,
      effectiveDb: measured.sourceDb + dbGain(categoryGain) + dbGain(currentGain),
    })
  }
  return rows
}

function instrumentMeans(data, id) {
  return instrumentRows(data, id).map((row) => row.sourceDb)
}

// 악기 게인을 정하는 크기: 음별 보정(RMS 기준)을 곱한 뒤의 A-가중 에너지 평균 — 재생에서 들리는 그대로.
function instrumentLevelA(data, id, noteGains) {
  const table = (noteGains && noteGains[id]) || {}
  return energyAverageDb(instrumentRows(data, id).map((row) => row.sourceDbA + dbGain(table[row.uiMidi] || 1)))
}

function printNoteGainCandidates(data, gains) {
  console.log("")
  console.log(`note gain limit: +/-${NOTE_GAIN_LIMIT_DB} dB`)
  console.log("const NOTE_MELODY_OUTPUT_GAINS = {")
  const summaries = []
  for (const id of INSTRUMENT_IDS) {
    const rows = instrumentRows(data, id, gains)
    const targetDb = energyAverageDb(rows.map((row) => row.effectiveDb))
    const map = {}
    let minRaw = Infinity
    let maxRaw = -Infinity
    let minAfter = Infinity
    let maxAfter = -Infinity
    const limitDb = EXTENDED_NOTE_GAIN_IDS.has(id) ? AUTO_LOOP_NOTE_GAIN_LIMIT_DB : NOTE_GAIN_LIMIT_DB
    // 보정 한도 때문에 큰 음만 줄어드는 경우에도 악기 전체의 평균은 유지한다.
    let low = -24, high = 24
    for (let pass = 0; pass < 48; pass++) {
      const center = (low + high) / 2
      const adjusted = energyAverageDb(rows.map((row) => row.effectiveDb + clamp(targetDb - row.effectiveDb + center, -limitDb, limitDb)))
      if (adjusted < targetDb) low = center
      else high = center
    }
    const normalizationDb = (low + high) / 2
    for (const row of rows) {
      const deltaDb = clamp(targetDb - row.effectiveDb + normalizationDb, -limitDb, limitDb)
      const gain = id === "gayageum" ? 1 : Math.pow(10, deltaDb / 20)
      map[row.uiMidi] = Number(gain.toFixed(3))
      minRaw = Math.min(minRaw, row.effectiveDb)
      maxRaw = Math.max(maxRaw, row.effectiveDb)
      const afterDb = row.effectiveDb + dbGain(gain)
      minAfter = Math.min(minAfter, afterDb)
      maxAfter = Math.max(maxAfter, afterDb)
    }
    const entries = Object.entries(map).map(([midi, gain]) => `${midi}: ${gain}`).join(", ")
    console.log(`  ${id}: { ${entries} },`)
    summaries.push({
      id,
      targetDb,
      rawSpreadDb: maxRaw - minRaw,
      afterSpreadDb: maxAfter - minAfter,
    })
  }
  console.log("}")
  console.log("")
  console.log("instrument,targetDb,rawSpreadDb,afterSpreadDb")
  for (const item of summaries) {
    console.log([item.id, item.targetDb.toFixed(2), item.rawSpreadDb.toFixed(1), item.afterSpreadDb.toFixed(1)].join(","))
  }
}

function printNoteDetails(data, gains, noteGains) {
  console.log("")
  console.log("instrument,uiMidi,playbackMidi,sourceMidi,sourceNote,sourceDb,currentAfterDb,localReferenceDb,quietVsNeighborsDb,upperGainLimit,sourceFile")
  for (const id of INSTRUMENT_IDS) {
    const rows = instrumentRows(data, id, gains)
    const limitDb = EXTENDED_NOTE_GAIN_IDS.has(id) ? AUTO_LOOP_NOTE_GAIN_LIMIT_DB : NOTE_GAIN_LIMIT_DB
    const maxGain = Math.pow(10, limitDb / 20)
    const afterRows = rows.map((row) => {
      const gain = noteGains[id] && noteGains[id][row.uiMidi] > 0 ? noteGains[id][row.uiMidi] : 1
      return {
        ...row,
        currentNoteGain: gain,
        currentAfterDb: row.effectiveDb + dbGain(gain),
      }
    })
    for (let index = 0; index < afterRows.length; index++) {
      const row = afterRows[index]
      const neighbors = []
      if (index > 0) neighbors.push(afterRows[index - 1].currentAfterDb)
      if (index + 1 < afterRows.length) neighbors.push(afterRows[index + 1].currentAfterDb)
      const localReferenceDb = neighbors.length === 2 ? energyAverageDb(neighbors) : NaN
      const quietVsNeighborsDb = localReferenceDb - row.currentAfterDb
      console.log(
        [
          id,
          row.uiMidi,
          row.playbackMidi,
          row.sourceMidi == null ? "" : row.sourceMidi,
          row.sourceNote || "",
          row.sourceDb.toFixed(2),
          row.currentAfterDb.toFixed(2),
          Number.isFinite(localReferenceDb) ? localReferenceDb.toFixed(2) : "",
          Number.isFinite(quietVsNeighborsDb) ? quietVsNeighborsDb.toFixed(2) : "",
          row.currentNoteGain >= maxGain * 0.999 ? "yes" : "no",
          row.sourceFile,
        ].join(","),
      )
    }
  }
}

function printReplacementCandidates(data, gains, noteGains) {
  console.log("")
  console.log("instrument,uiMidi,quietDb,currentSource,suggestedSource,pitchCents,suggestedGain,predictedResidualDb")
  for (const id of INSTRUMENT_IDS) {
    if (id === "gayageum") continue
    const asset = data.melodies[id]
    const rows = instrumentRows(data, id, gains)
    const targetDb = energyAverageDb(rows.map((row) => row.effectiveDb))
    const limitDb = EXTENDED_NOTE_GAIN_IDS.has(id) ? AUTO_LOOP_NOTE_GAIN_LIMIT_DB : NOTE_GAIN_LIMIT_DB
    const baseOutputDb =
      dbGain(WESTERN_IDS.has(id) ? WESTERN_MELODY_OUTPUT_GAIN : GUGAK_DRAWING_GAIN_BOOST) +
      dbGain(gains[id] == null ? 1 : gains[id])
    const afterRows = rows.map((row) => {
      const gain = noteGains[id] && noteGains[id][row.uiMidi] > 0 ? noteGains[id][row.uiMidi] : 1
      return { ...row, currentAfterDb: row.effectiveDb + dbGain(gain) }
    })
    for (let index = 0; index < afterRows.length; index++) {
      const row = afterRows[index]
      const neighbors = []
      if (index > 0) neighbors.push(afterRows[index - 1].currentAfterDb)
      if (index + 1 < afterRows.length) neighbors.push(afterRows[index + 1].currentAfterDb)
      if (!neighbors.length) continue
      const localReferenceDb = energyAverageDb(neighbors)
      const referenceDb = Math.min(localReferenceDb, targetDb)
      const quietDb = referenceDb - row.currentAfterDb
      if (quietDb < 3) continue

      const candidates = []
      for (const candidate of Array.isArray(asset.sampleMap) ? asset.sampleMap : []) {
        if (candidate.midi === row.sourceMidi) continue
        const pitchDistance = Math.abs(candidate.midi - row.playbackMidi)
        if (pitchDistance > 3) continue
        const measured = measureSegmentSource(id, asset, candidate)
        if (!measured || !Number.isFinite(measured.sourceDb)) continue
        const neededDb = referenceDb - (measured.sourceDb + baseOutputDb)
        const appliedDb = clamp(neededDb, -limitDb, limitDb)
        const residualDb = Math.abs(neededDb - appliedDb)
        candidates.push({
          sourceFile: measured.sourceFile,
          pitchCents: Math.round((candidate.midi - row.playbackMidi) * 100 + (candidate.cents || 0)),
          suggestedGain: Math.pow(10, appliedDb / 20),
          residualDb,
          pitchDistance,
        })
      }
      candidates.sort((a, b) => {
        const aFits = a.residualDb <= 0.5
        const bFits = b.residualDb <= 0.5
        if (aFits !== bFits) return aFits ? -1 : 1
        return a.pitchDistance - b.pitchDistance || a.residualDb - b.residualDb
      })
      const best = candidates[0]
      if (!best || best.residualDb >= quietDb - 0.5) continue
      console.log(
        [
          id,
          row.uiMidi,
          quietDb.toFixed(2),
          row.sourceFile,
          best.sourceFile,
          best.pitchCents,
          best.suggestedGain.toFixed(3),
          best.residualDb.toFixed(2),
        ].join(","),
      )
    }
  }
}

function printPluckedDetails(data, gains) {
  const id = "gayageum"
  const asset = data.melodies[id]
  const baseOutputDb = dbGain(GUGAK_DRAWING_GAIN_BOOST) + dbGain(gains[id] == null ? 1 : gains[id])
  const rows = []
  for (const uiMidi of GUGAK_UI_MIDI) {
    const playbackMidi = uiMidi + (asset.playbackTranspose || 0)
    const segment = nearestSample(asset, playbackMidi)
    const rel = segment && segment.src ? segment.src : asset.src
    if (!segment || !rel) continue
    const absPath = relativePathToAbs(rel)
    if (!fs.existsSync(absPath)) continue
    const range = pluckedAttackRange(segment)
    const sourceAttackDb = measureMeanDb(absPath, range.offset, range.duration)
    rows.push({
      uiMidi,
      sourceMidi: segment.midi,
      sourceAttackDb,
      effectiveAttackDb: sourceAttackDb + baseOutputDb,
    })
  }
  const targetDb = energyAverageDb(rows.map((row) => row.effectiveAttackDb))
  console.log("")
  console.log("instrument,uiMidi,sourceMidi,sourceAttackDb,effectiveAttackDb,quietVsNeighborsDb")
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const neighbors = []
    if (index > 0) neighbors.push(rows[index - 1].effectiveAttackDb)
    if (index + 1 < rows.length) neighbors.push(rows[index + 1].effectiveAttackDb)
    const localReferenceDb = neighbors.length ? Math.min(energyAverageDb(neighbors), targetDb) : NaN
    const quietDb = localReferenceDb - row.effectiveAttackDb
    console.log(
      [
        id,
        row.uiMidi,
        row.sourceMidi,
        row.sourceAttackDb.toFixed(2),
        row.effectiveAttackDb.toFixed(2),
        Number.isFinite(quietDb) ? quietDb.toFixed(2) : "",
      ].join(","),
    )
  }
}

function main() {
  const data = loadData()
  const gains = currentInstrumentGains()
  const noteGains = currentNoteGains()
  const summaries = INSTRUMENT_IDS.map((id) => {
    const metric = RMS_LEVEL_IDS.has(id) ? "rms" : "a"
    const sourceEnergyDb = metric === "a" ? instrumentLevelA(data, id, noteGains) : energyAverageDb(instrumentMeans(data, id))
    const categoryGain = WESTERN_IDS.has(id) ? WESTERN_MELODY_OUTPUT_GAIN : GUGAK_DRAWING_GAIN_BOOST
    const currentGain = gains[id] == null ? 1 : gains[id]
    return {
      id,
      metric,
      sourceEnergyDb,
      categoryGain,
      currentGain,
      currentEffectiveDb: sourceEnergyDb + dbGain(categoryGain) + dbGain(currentGain),
    }
  })
  const violin = summaries.find((item) => item.id === "violin")
  const violinRmsDb = energyAverageDb(instrumentMeans(data, "violin")) + dbGain(violin.categoryGain) + dbGain(violin.currentGain)
  const targetDb = { a: violin.currentEffectiveDb, rms: violinRmsDb }
  console.log(`target: violin effective ${targetDb.a.toFixed(2)} dB A-weighted after note gains (rms-level instruments: ${targetDb.rms.toFixed(2)} dB RMS)`)
  console.log("instrument,metric,sourceDb,currentGain,effectiveDb,recommendedGain,deltaDb")
  for (const item of summaries) {
    const recommendedGain = Math.pow(10, (targetDb[item.metric] - item.sourceEnergyDb - dbGain(item.categoryGain)) / 20)
    const deltaDb = dbGain(recommendedGain / item.currentGain)
    console.log(
      [
        item.id,
        item.metric,
        item.sourceEnergyDb.toFixed(2),
        item.currentGain.toFixed(2),
        item.currentEffectiveDb.toFixed(2),
        recommendedGain.toFixed(2),
        deltaDb.toFixed(1),
      ].join(","),
    )
  }
  if (process.argv.includes("--notes")) printNoteGainCandidates(data, gains)
  if (process.argv.includes("--note-details")) printNoteDetails(data, gains, noteGains)
  if (process.argv.includes("--replacement-candidates")) printReplacementCandidates(data, gains, noteGains)
  if (process.argv.includes("--plucked-details")) printPluckedDetails(data, gains)
}

main()
