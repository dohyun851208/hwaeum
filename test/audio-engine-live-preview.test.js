const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

function prototypeBody(source, name) {
  const marker = "AudioEngine.prototype." + name + " ="
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
  throw new Error("Could not parse prototype body for " + name)
}

test("live drawing preview does not resume the shared AudioContext while paused", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")

  for (const name of ["liveDrawingStart", "liveDrawingMove"]) {
    const body = prototypeBody(source, name)
    const guardAt = body.indexOf("if (this.isPaused)")
    const resumeAt = body.indexOf('ctx.state === "suspended"')

    assert.notEqual(guardAt, -1, name + " should guard paused playback")
    assert.notEqual(resumeAt, -1, name + " should still resume for normal previews")
    assert.ok(guardAt < resumeAt, name + " must not resume before checking pause state")
    assert.match(body, /this\.stopLivePreview\(true\)[\s\S]*return Promise\.resolve\(\)/)
  }
})

test("play exposes a startup state while async loading can still be canceled", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "audio-engine.js"), "utf8")
  const ctorBody = source.slice(source.indexOf("function AudioEngine()"), source.indexOf("AudioEngine.prototype.ensureContext"))
  const stopBody = prototypeBody(source, "stop")
  const playBody = prototypeBody(source, "play")

  assert.match(ctorBody, /this\.isStarting = false/)
  assert.match(stopBody, /this\.isStarting/)
  assert.match(stopBody, /this\.isStarting = false/)
  assert.match(playBody, /this\.isStarting = true/)
  assert.match(playBody, /finally[\s\S]*if \(gen === this\.playGen\) this\.isStarting = false/)
})
