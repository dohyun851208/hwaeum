const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

test("studio and gallery user-facing labels avoid leftover English section words", () => {
  const studio = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const index = fs.readFileSync(path.join(projectDir, "index.html"), "utf8")
  const studioSource = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const channelSource = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const shareStore = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")

  for (const html of [studio, channel, index]) {
    assert.doesNotMatch(html, />\s*(Step [1-5]|Atmosphere|Instrument|Student|Teacher|BGM|PIN)\s*</)
    assert.doesNotMatch(html, /placeholder="[^"]*(BGM|PIN)[^"]*"/)
    assert.doesNotMatch(html, /aria-label="[^"]*(BGM|PIN)[^"]*"/)
    assert.doesNotMatch(html, /<title>[^<]*(BGM|PIN)[^<]*<\/title>/)
  }

  assert.match(studio, />1단계</)
  assert.match(studio, />배경음악</)
  assert.match(studio, />연주 악기</)
  assert.match(studio, />학생</)
  assert.match(studio, />선생님</)
  assert.match(studio, /채널 들어가기/)
  assert.doesNotMatch(studio, /채널 열기/)
  assert.match(index, /나만의 음악 만들기/)
  assert.match(channel, /관리자 번호/)
  assert.doesNotMatch(studioSource, /관리자 PIN/)
  assert.doesNotMatch(channelSource, /관리자 PIN/)
  assert.doesNotMatch(shareStore, /관리자 PIN이 필요/)
})
