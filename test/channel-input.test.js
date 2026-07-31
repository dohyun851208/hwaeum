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

test("channel input can be cleared without restoring the previous channel", () => {
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")

  assert.match(functionBody(share, "sharedChannelInputSource"), /value == null \? state\.sharedChannel : value/)
  assert.match(functionBody(share, "syncShareInputs"), /sharedChannelInputSource\(channel\)/)
  assert.doesNotMatch(functionBody(share, "syncShareInputs"), /channel \|\| state\.sharedChannel/)
  assert.doesNotMatch(functionBody(share, "openChannelPage"), /channelArg \|\| state\.sharedChannel/)
})
