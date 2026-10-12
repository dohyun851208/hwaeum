const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")
const { metadataFromInput } = require("../api/share/_utils.cjs")

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

test("gallery-generated cover images do not bake in a play button", () => {
  const shareStore = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")

  assert.doesNotMatch(functionBody(shareStore, "renderCoverCanvas"), /ctx\.arc\(cx,\s*cy|ctx\.lineTo\(cx/)
})

test("channel play overlay is only added for covers without an embedded play button", () => {
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")

  assert.match(functionBody(share, "sharedMetadata"), /coverHasEmbeddedPlay:\s*false/)
  assert.equal(metadataFromInput({ coverHasEmbeddedPlay: false }).coverHasEmbeddedPlay, false)
  assert.equal(metadataFromInput({}).coverHasEmbeddedPlay, true)
  assert.equal(metadataFromInput({ actionCount: 7.8 }).actionCount, 7)
  assert.match(functionBody(channel, "shouldShowCoverPlayOverlay"), /coverHasEmbeddedPlay === false/)
  assert.match(functionBody(channel, "createAlbumCard"), /shouldShowCoverPlayOverlay\(work\)/)
  assert.match(functionBody(channel, "updateViewerPlayState"), /shouldShowCoverPlayOverlay\(state\.activeWork\)/)
})

test("shared gallery cover images leave title text to the gallery UI", () => {
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")
  const shareStore = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")

  assert.doesNotMatch(functionBody(shareStore, "renderCoverCanvas"), /fillText|titleLine|options\.hashtags|options\.composerName/)
  assert.match(functionBody(share, "publishSharedWork"), /composerName: metadata\.composerName/)
  assert.match(functionBody(channel, "coverUrl"), /recipePictureUrl\(work\)/)
  assert.match(functionBody(channel, "workDisplayTitle"), /title \+ " \(" \+ composer \+ "\)"/)
  // 갤러리 이름표는 제목과 작곡가를 두 줄로 따로 적는다(합친 이름은 소리 내어 읽는 aria-label에 남는다).
  assert.match(functionBody(channel, "createAlbumCard"), /title\.textContent = workTitle\(work\)/)
  assert.match(functionBody(channel, "createAlbumCard"), /className = "channel-album-composer"[\s\S]*textContent = composer/)
  assert.match(functionBody(channel, "createAlbumCard"), /aria-label", options\.ariaLabel \|\| workDisplayTitle\(work\)/)
  assert.match(functionBody(channel, "openViewer"), /viewerTitle\.textContent = workTitle\(work\)/)
  assert.doesNotMatch(functionBody(channel, "openViewer"), /viewerTitle\.textContent = workDisplayTitle\(work\)/)
})
