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

test("shared gallery viewers separate composer, description, and uploaded time", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(functionBody(channel, "workViewerMetaText"), /workDescriptionLine\(work\)/)
  assert.match(functionBody(channel, "workViewerMetaText"), /join\("\\n"\)/)
  assert.match(functionBody(channel, "openViewer"), /viewerMeta\.textContent = workViewerMetaText\(work\)/)
  assert.match(functionBody(studio, "sharedViewerMetaText"), /join\("\\n"\)/)
  assert.match(functionBody(studio, "openSharedViewer"), /viewer\.meta\.textContent = sharedViewerMetaText\(work\)/)
  assert.match(css, /\.channel-viewer-meta\s*\{[\s\S]*white-space:\s*pre-line/)
  assert.match(css, /\.shared-viewer-meta\s*\{[\s\S]*white-space:\s*pre-line/)
})

test("saved takes and shared works describe every used instrument", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")

  assert.match(functionBody(studio, "renderTakes"), /usedInstrumentLabelsForRecipe\(t\.recipe\)/)
  assert.match(functionBody(studio, "sharedMetadata"), /usedInstrumentLabelsForRecipe\(recipe\)/)
  assert.match(functionBody(studio, "publishSharedWork"), /const metadata = sharedMetadata\(recipe\)/)
  assert.match(functionBody(channel, "workDescriptionLine"), /cleanText\(meta\.instrumentLabel,\s*72\)/)
})
