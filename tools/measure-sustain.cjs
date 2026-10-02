// Real engine scheduling with ffmpeg-decoded, checked-in MP3s (no raw archive).
// node tools/measure-sustain.cjs <output-directory> [--uncalibrated]
// SAMPLE_RATE=44100 or 48000. PCM/report files are written only to that directory.
// Browser decoding, rendering and UI checks remain separate from this VM audit.
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { execFileSync } = require("node:child_process")

const PROJECT = path.resolve(__dirname, "..")
const OUT = path.resolve(process.argv[2] || require("node:os").tmpdir() + "/hwaeum-sustain-measure")
fs.mkdirSync(path.join(OUT, "pcm"), { recursive: true })
const SR = Number(process.env.SAMPLE_RATE) || 48000
const core = require(path.join(PROJECT, "js/music-core.js"))

function loadEngine() {
  const sandbox = { MusicCore: core, SD_DISABLE_SAMPLE_CALIBRATION: process.argv.includes("--uncalibrated"), setTimeout, clearTimeout, console }
  sandbox.self = sandbox
  for (const file of ["manifest.js", "sample-maps.js", "sample-maps-western.js", "sample-calibration.js", "audio-plan.js", "audio-node-scope.js", "audio-pad-graph.js", "audio-engine.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(PROJECT, "js", file), "utf8"), sandbox, { filename: file })
  }
  return sandbox
}

const decodeCache = new Map()
function decode(src) {
  if (decodeCache.has(src)) return decodeCache.get(src)
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(PROJECT, src), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 })
  const data = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const copy = new Float32Array(data) // own the memory
  const buffer = { numberOfChannels: 1, length: copy.length, sampleRate: SR, duration: copy.length / SR, getChannelData: () => copy }
  decodeCache.set(src, buffer)
  return buffer
}

function param() {
  return { events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]) }, linearRampToValueAtTime(v, t) { this.events.push(["lin", v, t]) }, exponentialRampToValueAtTime(v, t) { this.events.push(["exp", v, t]) }, setTargetAtTime(v, t, c) { this.events.push(["target", v, t, c]) }, cancelScheduledValues(t) { this.events.push(["cancel", t]) } }
}
function node(extra) {
  return Object.assign({ startCalls: [], stopCalls: [], connect() {}, disconnect() {}, start(...a) { this.startCalls.push(a) }, stop(...a) { this.stopCalls.push(a) } }, extra)
}
function makeCtx() {
  const created = { sources: [], gains: [] }
  return {
    created, currentTime: 0, sampleRate: SR, state: "running", destination: node(),
    createBufferSource() { const n = node({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(), detune: param() }); created.sources.push(n); return n },
    createBuffer(ch, length, sampleRate) { const chans = Array.from({ length: ch }, () => new Float32Array(length)); return { numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => chans[c] } },
    createGain() { const n = node({ gain: param() }); created.gains.push(n); return n },
    createBiquadFilter() { return node({ type: "lowpass", frequency: param(), Q: param() }) },
    createOscillator() { return node({ type: "sine", frequency: param(), detune: param() }) },
  }
}

const sb = loadEngine()
const Data = sb.SDStudioData
const AP = sb.SDAudioPlan
const cells = []
let mismatches = 0

for (const inst of Data.instruments) {
  const asset = Data.melodies[inst.id]
  const style = Data.styles.find((s) => s.id === (inst.group === "국악" ? "gugak" : "bright"))
  const visible = core.playableScale(style, asset)
  for (let index = 0; index < visible.length; index++) {
    const displayY = 1 - (index + 0.5) / visible.length
    const y = core.storedYFromDisplay(displayY, style, asset)
    const uiMidi = core.quantizePitch(y, style, asset)
    if (uiMidi !== visible[index]) mismatches++
    const backY = core.displayYFromStored(y, style, asset)
    const recipe = { duration: 6, atmosphere: "none", instrument: inst.id, style: style.id, version: "balanced", mode: "melody", strokes: [[{ x: 0, y }, { x: 0.5, y }, { x: 1, y }]], strokeInstruments: [inst.id] }
    const engine = new sb.AudioEngine()
    const plan = engine.resolvePlan(recipe, [])
    const seg0 = plan.strokeSegments[0]
    const midi = seg0.events[0].midi
    const segment = AP.nearestSampleSegment(asset, midi)
    const multi = asset.sampleMode === "multi"
    const src = multi && segment && segment.src ? segment.src : asset.src
    const buffer = decode(src)
    const rate = AP.segmentPlaybackRate(asset, midi, segment)

    const liveCtx = makeCtx()
    const live = engine._createSampleLivePreview(liveCtx, plan, buffer, y)
    const ls = live.source
    const playCtx = makeCtx()
    const regs = []
    engine.scheduleSampleStrokes(playCtx, playCtx.destination, plan, plan.strokeSegments, { melody: buffer, melodySamples: { [segment.midi]: buffer } }, 0, (n) => regs.push(n))
    const ps = playCtx.created.sources[0]

    const cell = {
      id: inst.id, group: inst.group, index, rows: visible.length, uiMidi, midi, expectedHz: 440 * Math.pow(2, (midi - 69) / 12),
      displayRoundTrip: Math.abs(backY - displayY), transpose: AP.playbackTranspose(inst, asset),
      segment: segment ? { midi: segment.midi, cents: segment.cents || 0, src: segment.src || null, offset: segment.offset, duration: segment.duration } : null,
      src, multi, rate, playSources: regs.length, strokeSegments: plan.strokeSegments.length,
      live: { loop: !!ls.loop, loopStart: ls.loopStart, loopEnd: ls.loopEnd, start: ls.startCalls[0], baked: ls.buffer !== buffer, bufferLength: ls.buffer.length },
      play: ps ? { loop: !!ps.loop, loopStart: ps.loopStart, loopEnd: ps.loopEnd, start: ps.startCalls[0], baked: ps.buffer !== buffer, sameAsLive: ps.buffer.length === ls.buffer.length && ps.loopStart === ls.loopStart && ps.loopEnd === ls.loopEnd } : null,
    }
    if (ls.buffer.getChannelData) {
      if (ls.loop) {
        const pcm = ls.buffer.getChannelData(0)
        const a = Math.round(ls.loopStart * SR), b = Math.round(ls.loopEnd * SR)
        const curvature = []
        for (let j = a + 2; j < b; j++) curvature.push(Math.abs(pcm[j] - 2 * pcm[j-1] + pcm[j-2]))
        curvature.sort((a, b) => a - b)
        const seam = Math.max(Math.abs(pcm[a] - 2*pcm[b-1] + pcm[b-2]), Math.abs(pcm[a+1] - 2*pcm[a] + pcm[b-1]))
        cell.seamP99Ratio = seam / Math.max(1e-20, curvature[Math.floor(curvature.length * .99)])
        cell.seamExceedsInteriorMax = seam > curvature[curvature.length - 1] + 1e-7
      }
      const file = `${inst.id}-${uiMidi}.f32`
      fs.writeFileSync(path.join(OUT, "pcm", file), Buffer.from(ls.buffer.getChannelData(0).buffer))
      cell.pcm = file
    }
    cells.push(cell)
  }
}
fs.writeFileSync(path.join(OUT, "cells.json"), JSON.stringify({ sampleRate: SR, mismatches, cells }, null, 1))
console.log("cells", cells.length, "axis mismatches", mismatches, "maxRoundTrip", Math.max(...cells.map((c) => c.displayRoundTrip)).toExponential(2))
const byInst = {}
for (const c of cells) (byInst[c.id] = byInst[c.id] || []).push(c)
for (const [id, list] of Object.entries(byInst)) {
  console.log(id, "rows", list.length, "tr", list[0].transpose, "oneSource", list.every((c) => c.playSources === 1), "loop", list.filter((c) => c.live.loop).length, "liveEqPlay", list.every((c) => !c.play || c.play.sameAsLive || !c.live.loop), "rates", list.map((c) => c.rate.toFixed(3)).join(" "))
}
const seamOutliers = cells.filter((c) => c.seamExceedsInteriorMax)
console.log("seam outliers", seamOutliers.length, "/", cells.filter((c) => c.live.loop).length)
if (mismatches || cells.some((c) => c.playSources !== 1 || !c.play || (c.live.loop && !c.play.sameAsLive))) process.exitCode = 1
