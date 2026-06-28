const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const WESTERN_IDS = new Set(["flute", "oboe", "clarinet", "frenchHorn", "violin", "viola", "cello", "doubleBass"])
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

function instrumentRows(data, id, gains) {
  const asset = data.melodies[id]
  const uiMidi = WESTERN_IDS.has(id) ? WESTERN_UI_MIDI : GUGAK_UI_MIDI
  const categoryGain = WESTERN_IDS.has(id) ? WESTERN_MELODY_OUTPUT_GAIN : GUGAK_DRAWING_GAIN_BOOST
  const currentGain = gains && gains[id] != null ? gains[id] : 1
  const rows = []
  for (const ui of uiMidi) {
    const playbackMidi = ui + (asset.playbackTranspose || 0)
    const segment = nearestSample(asset, playbackMidi)
    const rel = segment && segment.src ? segment.src : asset.src
    if (!rel) continue
    const absPath = relativePathToAbs(rel)
    if (!fs.existsSync(absPath)) continue
    const range = segment && !segment.src && (segment.offset != null || segment.duration != null)
      ? stableSegmentRange(segment)
      : stableWholeFileRange(absPath)
    const sourceDb = measureMeanDb(absPath, range.offset, range.duration)
    rows.push({
      uiMidi: ui,
      sourceDb,
      effectiveDb: sourceDb + dbGain(categoryGain) + dbGain(currentGain),
    })
  }
  return rows
}

function instrumentMeans(data, id) {
  return instrumentRows(data, id).map((row) => row.sourceDb)
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
    for (const row of rows) {
      const deltaDb = clamp(targetDb - row.effectiveDb, -NOTE_GAIN_LIMIT_DB, NOTE_GAIN_LIMIT_DB)
      const gain = Math.pow(10, deltaDb / 20)
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

function main() {
  const data = loadData()
  const gains = currentInstrumentGains()
  const summaries = INSTRUMENT_IDS.map((id) => {
    const sourceEnergyDb = energyAverageDb(instrumentMeans(data, id))
    const categoryGain = WESTERN_IDS.has(id) ? WESTERN_MELODY_OUTPUT_GAIN : GUGAK_DRAWING_GAIN_BOOST
    const currentGain = gains[id] == null ? 1 : gains[id]
    return {
      id,
      sourceEnergyDb,
      categoryGain,
      currentGain,
      currentEffectiveDb: sourceEnergyDb + dbGain(categoryGain) + dbGain(currentGain),
    }
  })
  const violin = summaries.find((item) => item.id === "violin")
  const targetDb = violin.currentEffectiveDb
  console.log(`target: violin effective ${targetDb.toFixed(2)} dB`)
  console.log("instrument,sourceDb,currentGain,effectiveDb,recommendedGain,deltaDb")
  for (const item of summaries) {
    const recommendedGain = Math.pow(10, (targetDb - item.sourceEnergyDb - dbGain(item.categoryGain)) / 20)
    const deltaDb = dbGain(recommendedGain / item.currentGain)
    console.log(
      [
        item.id,
        item.sourceEnergyDb.toFixed(2),
        item.currentGain.toFixed(2),
        item.currentEffectiveDb.toFixed(2),
        recommendedGain.toFixed(2),
        deltaDb.toFixed(1),
      ].join(","),
    )
  }
  if (process.argv.includes("--notes")) printNoteGainCandidates(data, gains)
}

main()
