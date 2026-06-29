const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")
const utils = require(path.join(projectDir, "api", "share", "_utils.cjs"))

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
  assert.match(store, /function deleteChannel\(channel, pass\)/)
  assert.match(store, /rememberPass:/)
  assert.match(store, /loadPass:/)
  assert.match(store, /deleteChannel: deleteChannel/)
})

test("share + channel pages carry the 2차 비밀번호 UI", () => {
  const studio = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const styles = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(studio, /채널에 들어가 그림 음악을 감상합니다\./)
  assert.match(studio, /채널 번호를 입력하면 같은 채널에 모인 그림 음악이 갤러리처럼 펼쳐집니다\./)
  assert.doesNotMatch(studio, /채널을 열면 선생님이 알려 준 2차 비밀번호/)
  assert.doesNotMatch(studio, /채널 열기/)
  assert.match(studio, /id="channelOpenTitle">채널 들어가기/)
  assert.doesNotMatch(studio, /관리자 채널 만들기/)
  assert.match(studio, /id="channelAdminTitle">채널 만들기/)
  assert.match(studio, /class="channel-gate-grid"/)
  assert.match(studio, /id="claimChannelBtn"/)
  assert.match(studio, /id="deleteChannelBtn"/)
  assert.match(studio, /id="shareChannelPassInput"/)
  assert.match(studio, /id="shareDisplayNameInput"/)
  assert.match(styles, /\.channel-gate-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/)
  assert.match(styles, /\.channel-gate\[hidden\],\s*\.channel-empty\[hidden\]\s*\{[\s\S]*display:\s*none/)
  assert.match(channelHtml, /id="channelGate"/)
  assert.match(channelHtml, /id="channelGateInput"/)
  assert.match(channelHtml, /id="channelDeleteBtn"/)
})

test("channel delete API verifies the channel 2차 비밀번호", () => {
  const channelDelete = fs.readFileSync(path.join(projectDir, "api", "share", "channel-delete.js"), "utf8")
  assert.match(channelDelete, /loadChannelMeta/)
  assert.match(channelDelete, /hashPass\(channel, pass\) !== channelMeta\.passHash/)
  assert.match(channelDelete, /const prefix = "share\/channels\/" \+ channel \+ "\/"/)
  assert.match(channelDelete, /await del\(targets\)/)
  assert.doesNotMatch(channelDelete, /hashAdmin/)
})

test("channel page opens locked channels only after the gate password is typed", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const loadChannelBody = functionBody(channel, "loadChannel")
  const submitGatePassBody = functionBody(channel, "submitGatePass")
  const openInputChannelBody = functionBody(channel, "openInputChannel")

  assert.doesNotMatch(loadChannelBody, /ShareStore\.loadPass/)
  assert.match(loadChannelBody, /options\.pass != null/)
  assert.match(loadChannelBody, /ShareStore\.listChannel\(normalized, state\.pass\)/)
  assert.doesNotMatch(submitGatePassBody, /rememberPass/)
  assert.match(submitGatePassBody, /loadChannel\(state\.channel, \{ pass: pin \}\)/)
  assert.match(openInputChannelBody, /state\.pass = ""/)
})
