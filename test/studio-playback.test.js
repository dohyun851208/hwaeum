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

test("switching to sound mode does not auto-start the background player", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const modeBody = functionBody(source, "setDrawingInputMode")

  assert.doesNotMatch(modeBody, /playBgPlayer\(\)/)
  assert.match(modeBody, /const bgWasPaused = bgPlayer\.paused/)
  assert.match(modeBody, /if \(bgWasPaused && !bgPlayer\.paused\) pauseBgPlayer\(true\)/)
})

test("sound-mode drawing resumes the clock from the current playhead, not 0", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const progressBody = functionBody(source, "soundDrawingProgress")
  const liveBody = functionBody(source, "livePlayheadProgress")
  const bgTimeBody = functionBody(source, "bgTimeFromProgress")

  // 첫 터치 때 배경음악(시계)이 멈춰 있으면, bgOffset(0)로 튀지 말고 현재 재생바 위치를 이어받아야 한다.
  assert.match(progressBody, /if \(bgPlayer\.paused\)/)
  assert.match(progressBody, /bgTimeFromProgress\(livePlayheadProgress\(\)\)/)
  assert.match(progressBody, /bgPausedAt = resumeTime/, "resume time must seed playBgPlayer's start position")
  assert.match(progressBody, /playBgPlayer\(\)/)

  // 전체곡(엔진) 재생 중이면 그 진행을 읽어 와야 한다.
  assert.match(liveBody, /engine\.isPlaying && !engine\.isPaused && playheadStartedAt/)
  // 진행(0..1)을 배경음악 시간으로 환산하는 식은 bgPlayheadProgress와 같은 구간을 써야 한다.
  assert.match(bgTimeBody, /state\.bgOffset \+ clampPlayheadProgress\(progress\) \* segment/)
})

test("drawing during full playback keeps the song playing instead of stopping the engine", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const progressBody = functionBody(source, "soundDrawingProgress")
  const startPlayheadBody = functionBody(source, "startPlayhead")

  // 전체곡 재생 중 펜을 대도 bgPlayer로 갈아타지 말고(=playBgPlayer→engine.stop 회피)
  // 엔진 플레이헤드를 드로잉 시계로 써야, 이미 그려둔 선율이 끊기지 않는다.
  const engineGuard = progressBody.indexOf("(engine.isPlaying || engine.isStarting) && !engine.isPaused")
  const bgPausedBranch = progressBody.indexOf("bgPlayer.paused")
  assert.notEqual(engineGuard, -1, "재생 중 분기가 있어야 한다")
  assert.ok(engineGuard < bgPausedBranch, "엔진 재생 분기는 bgPlayer 재개보다 먼저 와야 한다")
  assert.match(progressBody, /if \(\(engine\.isPlaying \|\| engine\.isStarting\) && !engine\.isPaused\) return livePlayheadProgress\(\)/)

  // 엔진이 시계가 되면 bgTick이 안 돌므로, 엔진 플레이헤드 틱이 직접 새 획을 기록해야 한다.
  assert.match(startPlayheadBody, /state\.drawingInputMode === DRAW_MODE_SOUND && draw\.flowActive/)
  assert.match(startPlayheadBody, /draw\.flowRecord\(prog\)/)
  assert.match(startPlayheadBody, /draw\.finishFlowStroke\(true\)/)
})

test("pausing during sound-mode flow commits the stroke at the current playhead", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const helperBody = functionBody(source, "finishSoundFlowAtCurrentPoint")
  const playBody = functionBody(source, "play")
  const toggleBody = functionBody(source, "toggleTransport")
  const pauseBody = functionBody(source, "pause")

  assert.match(helperBody, /state\.drawingInputMode !== DRAW_MODE_SOUND/)
  assert.match(helperBody, /!draw\.flowActive/)
  assert.match(helperBody, /draw\.flowRecord\(livePlayheadProgress\(\)\)/)
  assert.match(helperBody, /draw\.finishFlowStroke\(true\)/)

  for (const body of [playBody, toggleBody, pauseBody]) {
    const finishAt = body.indexOf("finishSoundFlowAtCurrentPoint()")
    const pauseAt = body.indexOf("engine.pause()")
    assert.notEqual(finishAt, -1)
    assert.notEqual(pauseAt, -1)
    assert.ok(finishAt < pauseAt)
  }
})

test("배경음악 없는 소리모드는 소리 없는 내부 시계로 드로잉 시간을 흐르게 한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const progressBody = functionBody(source, "soundDrawingProgress")
  const clockBody = functionBody(source, "startSilentFlowClock")

  // 배경음이 없으면 bgPlayer(시계)가 없으니, 무음 내부 시계로 갈아탄다.
  assert.match(progressBody, /if \(!bgSrcFor\(state\.atmosphere\)\)/)
  assert.match(progressBody, /startSilentFlowClock\(\)/)

  // 무음 시계는 매 프레임 진행도를 기록(가로 전진)하고, 곡 끝에서 획을 마무리한다.
  assert.match(clockBody, /draw\.flowRecord\(prog\)/)
  assert.match(clockBody, /draw\.finishFlowStroke\(true\)/)
  // 유휴 시 rAF를 돌리지 않도록, 드로잉이 끝나면 스스로 멈춰야 한다.
  assert.match(clockBody, /!draw\.flowActive/)
  assert.match(clockBody, /stopSilentFlowClock\(\)/)
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

test("switching to the eraser keeps the playhead in place instead of resetting to the start", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const eraserBody = functionBody(source, "activateEraserTool")
  const freezeBody = functionBody(source, "freezePlayheadAtLivePosition")

  // 재생바를 현재 위치에 굳힌 뒤에 stop 해야 시작점으로 튀지 않는다.
  const freezeAt = eraserBody.indexOf("freezePlayheadAtLivePosition()")
  const stopAt = eraserBody.indexOf("engine.stop()")
  assert.notEqual(freezeAt, -1, "eraser should freeze the playhead before stopping")
  assert.ok(freezeAt < stopAt, "freeze must happen before engine.stop() resets the playhead")

  assert.match(freezeBody, /if \(!engine\.isPlaying \|\| engine\.isPaused\) return/)
  assert.match(freezeBody, /rememberPlayheadProgress\(playheadElapsedMs \/ durMs\)/)
})

test("background range changes update the drawing timeline duration", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const ensureBody = functionBody(source, "ensureTimelineDuration")
  const syncUiBody = functionBody(source, "syncBgPlayerUI")

  assert.match(ensureBody, /Number\(state\.bgEndOffset\)\s*-\s*Number\(state\.bgOffset\)/)
  assert.match(ensureBody, /next = normalizeDuration\(segment\)/)
  assert.match(ensureBody, /state\.duration\s*=\s*next/)
  assert.match(syncUiBody, /const durationChanged = ensureTimelineDuration\(false\)/)
})
