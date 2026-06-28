const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

function functionBody(source, name) {
  const marker = "function " + name + "("
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, name + " should exist")
  const open = source.indexOf("{", start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1
    else if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error("Could not parse function body for " + name)
}

test("main playback can start without a drawn melody so background music can play alone", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const playBody = functionBody(source, "play")
  const saveTakeBody = functionBody(source, "saveTake")

  assert.doesNotMatch(playBody, /requireDrawn\(\)/)
  assert.match(saveTakeBody, /requireDrawn\(\)/, "empty-canvas checks should remain on take saving")
})

test("main playback button starts the full song instead of pausing drawing ambience", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const toggleBody = functionBody(source, "toggleTransport")
  const syncBody = functionBody(source, "syncTransportButtons")

  assert.doesNotMatch(toggleBody, /engine\.isPlaying \|\| engine\.ambience/)
  assert.match(toggleBody, /if \(engine\.isPlaying\)[\s\S]*engine\.pause\(\)/)
  assert.match(toggleBody, /engine\.stop\(\{ emitState: false \}\)/)
  assert.match(syncBody, /const activeAudio = !!playing && !paused/)
})

test("background range pause keeps its current position for resume", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const pauseBody = functionBody(source, "pauseBgPlayer")
  const playBody = functionBody(source, "playBgPlayer")
  const toggleBody = functionBody(source, "toggleBgPlay")

  assert.match(source, /let bgPausedAt = null/)
  assert.match(pauseBody, /const pausedAt = bgPlayer\.currentTime/)
  assert.match(pauseBody, /if \(keepPosition && bgTimeInSelectedRange\(pausedAt\)\)/)
  assert.match(pauseBody, /bgPausedAt = pausedAt/)
  assert.match(playBody, /const startAt = bgTimeInSelectedRange\(bgPausedAt\) \? bgPausedAt : state\.bgOffset/)
  assert.match(playBody, /bgPlayer\.currentTime = startAt/)
  assert.match(playBody, /bgPausedAt = null/)
  assert.match(toggleBody, /else pauseBgPlayer\(true\)/)
})

test("paused playback stores the visible playhead position for later controls", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const pauseBody = functionBody(source, "pausePlayhead")
  const stopBody = functionBody(source, "stopPlayhead")

  assert.match(pauseBody, /const pausedProgress = Math\.max\(0, Math\.min\(1, playheadElapsedMs \/ durMs\)\)/)
  assert.match(pauseBody, /selectedPlayheadProgress = clampPlayheadProgress\(pausedProgress\)/)
  assert.match(pauseBody, /positionPlayhead\(pausedProgress\)/)
  assert.match(stopBody, /playheadElapsedMs = selectedPlaybackStartSec\(\) \* 1000/)
})

test("background range changes do not rewrite the drawing timeline duration", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const ensureBody = functionBody(source, "ensureTimelineDuration")
  const syncUiBody = functionBody(source, "syncBgPlayerUI")

  assert.doesNotMatch(ensureBody, /state\.bgEndOffset\s*-\s*state\.bgOffset/)
  assert.doesNotMatch(ensureBody, /state\.duration\s*=\s*next/)
  assert.doesNotMatch(ensureBody, /bgMinGap\(total\)/)
  assert.match(syncUiBody, /const durationChanged = ensureTimelineDuration\(false\)/)
})
