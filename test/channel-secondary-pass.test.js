const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")
const utils = require(path.join(projectDir, "api", "share", "_utils.cjs"))

test("cleanPin keeps digits only and caps length", () => {
  assert.equal(utils.cleanPin("12a3-4 5"), "12345")
  assert.equal(utils.cleanPin("0000"), "0000")
  assert.equal(utils.cleanPin("1234567890123456"), "123456789012")
  assert.equal(utils.cleanPin(null), "")
})

test("hashPass is deterministic, salted by channel, and never the raw pin", () => {
  const a = utils.hashPass("77", "1234")
  assert.equal(a, utils.hashPass("77", "1234"))
  // 같은 비번이라도 채널이 다르면 해시가 다르다(채널 번호로 소금).
  assert.notEqual(a, utils.hashPass("78", "1234"))
  // 비번이 다르면 해시도 다르다.
  assert.notEqual(a, utils.hashPass("77", "1235"))
  // 평문 비번이 그대로 드러나지 않는다.
  assert.doesNotMatch(a, /1234/)
  assert.equal(a.length, 64)
})

test("sanitizeChannelMeta hides owner/pass hashes but reports hasPass", () => {
  const safe = utils.sanitizeChannelMeta({
    channel: "77",
    displayName: "3반 봄 음악",
    ownerHash: "secret-owner",
    passHash: "secret-pass",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  })
  assert.equal(safe.channel, "77")
  assert.equal(safe.displayName, "3반 봄 음악")
  assert.equal(safe.hasPass, true)
  assert.equal("ownerHash" in safe, false)
  assert.equal("passHash" in safe, false)
  assert.equal(utils.sanitizeChannelMeta({ channel: "1" }).hasPass, false)
})

test("server gates: publish + channel list verify the channel 2차 비밀번호", () => {
  const publish = fs.readFileSync(path.join(projectDir, "api", "share", "publish.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "api", "share", "channel.js"), "utf8")
  // 공유는 채널이 점유돼 있고 2차 비번이 맞아야 한다.
  assert.match(publish, /loadChannelMeta/)
  assert.match(publish, /hashPass\(channel, cleanPin\(body\.pass\)\) !== channelMeta\.passHash/)
  // 목록은 잠긴 채널이면 비번이 맞아야 작품을 내준다.
  assert.match(channel, /channelMeta\.passHash/)
  assert.match(channel, /locked: true/)
})

test("channel-claim rejects other teachers and requires the admin pin", () => {
  const claim = fs.readFileSync(path.join(projectDir, "api", "share", "channel-claim.js"), "utf8")
  assert.match(claim, /hashAdmin\(body\.adminPin\)/)
  assert.match(claim, /existing\.ownerHash !== ownerHash/)
  assert.match(claim, /이미 다른 선생님이 점유한 채널/)
})

test("share-store exposes channel claim + pass-aware listing", () => {
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  assert.match(store, /claimChannel: claimChannel/)
  assert.match(store, /function listChannel\(channel, pass\)/)
  assert.match(store, /rememberPass:/)
  assert.match(store, /loadPass:/)
})

test("share + channel pages carry the 2차 비밀번호 UI", () => {
  const studio = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  assert.match(studio, /id="claimChannelBtn"/)
  assert.match(studio, /id="shareChannelPassInput"/)
  assert.match(studio, /id="shareDisplayNameInput"/)
  assert.match(channelHtml, /id="channelGate"/)
  assert.match(channelHtml, /id="channelGateInput"/)
})
