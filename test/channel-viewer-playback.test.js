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

test("opening a channel work does not auto-play audio", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const openViewerBody = functionBody(channel, "openViewer")
  const createCardBody = functionBody(channel, "createAlbumCard")
  const renderFlowBody = functionBody(channel, "renderCoverFlow")

  assert.doesNotMatch(openViewerBody, /viewerAudio\.play\(\)/)
  assert.doesNotMatch(createCardBody, /play:\s*true/)
  assert.doesNotMatch(renderFlowBody, /play:\s*true/)
  assert.match(renderFlowBody, /open\.textContent = "크게 보기"/)
})

test("channel viewer audio starts only from the play button handler", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const bindBody = functionBody(channel, "bind")

  assert.match(bindBody, /el\.viewerPlay\.addEventListener\("click"/)
  assert.match(bindBody, /el\.viewerAudio\.play\(\)/)
})
