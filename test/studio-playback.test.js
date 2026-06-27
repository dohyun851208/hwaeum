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
