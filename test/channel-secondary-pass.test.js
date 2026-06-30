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
  // 같은 코드라도 갤러리가 다르면 해시가 다르다(갤러리 번호로 소금).
  assert.notEqual(a, utils.hashPass("78", "1234"))
  // 코드가 다르면 해시도 다르다.
  assert.notEqual(a, utils.hashPass("77", "1235"))
  // 평문 코드가 그대로 드러나지 않는다.
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

test("server gates: publish + channel list verify the gallery code", () => {
  const publish = fs.readFileSync(path.join(projectDir, "api", "share", "publish.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "api", "share", "channel.js"), "utf8")
  // 공유는 화음 갤러리가 점유돼 있고 갤러리 코드가 맞아야 한다.
  assert.match(publish, /loadChannelMeta/)
  assert.match(publish, /hashPass\(channel, cleanPin\(body\.pass\)\) !== channelMeta\.passHash/)
  // 목록은 잠긴 화음 갤러리면 코드가 맞아야 작품을 내준다.
  assert.match(channel, /channelMeta\.passHash/)
  assert.match(channel, /locked: true/)
})

test("channel-claim rejects other teachers and requires the admin pin", () => {
  const claim = fs.readFileSync(path.join(projectDir, "api", "share", "channel-claim.js"), "utf8")
  assert.match(claim, /hashAdmin\(body\.adminPin\)/)
  assert.match(claim, /existing\.ownerHash !== ownerHash/)
  assert.match(claim, /이미 다른 선생님이 사용 중인 화음 갤러리/)
})

test("share-store exposes channel claim + pass-aware listing", () => {
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  assert.match(store, /claimChannel: claimChannel/)
  assert.match(store, /function listChannel\(channel, pass\)/)
  assert.match(store, /function deleteChannel\(channel, adminPin\)/)
  assert.match(store, /rememberPass:/)
  assert.match(store, /loadPass:/)
  assert.match(store, /deleteChannel: deleteChannel/)
})

test("share + channel pages carry the gallery code UI", () => {
  const studio = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const styles = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(studio, /화음 갤러리에 공유합니다\./)
  assert.match(studio, /번호와 갤러리 코드를 입력하면 같은 화음 갤러리에 모인 완성 작품을 함께 감상할 수 있습니다\./)
  assert.doesNotMatch(studio, new RegExp("화음 갤러리를 열면 선생님이 알려 준 " + "2" + "차 " + "코드"))
  assert.doesNotMatch(studio, new RegExp("화음 갤러리 " + "열기"))
  assert.match(studio, /id="channelOpenTitle">화음 갤러리 들어가기/)
  assert.match(studio, /id="channelBrowsePassInput"/)
  assert.doesNotMatch(studio, new RegExp("관리자 " + "화음 갤러리 만들기"))
  assert.match(studio, /id="channelAdminTitle">화음 갤러리 생성하기/)
  assert.match(studio, /placeholder="관리자 번호 \(8624\)"/)
  assert.match(studio, /placeholder="번호 \(예 107\)"/)
  assert.match(studio, /class="channel-number-field"[\s\S]*id="claimChannelInput"/)
  assert.match(studio, /placeholder="갤러리 이름 \(예: 여름 빛깔을 담은 노래\)"/)
  assert.match(studio, /placeholder="갤러리 코드 \(숫자 4자리 이상\)"/)
  assert.match(studio, /id="claimChannelBtn">화음 갤러리 생성하기/)
  assert.match(studio, /관리자 번호\(8624\)로 화음 갤러리 생성이 가능하며/)
  assert.match(studio, /학생은 교사가 알려 준 번호 \+ 갤러리 코드를 통해 들어갈 수 있습니다\./)
  assert.doesNotMatch(studio, /화음 갤러리 삭제/)
  assert.match(studio, /class="channel-gate-grid"/)
  assert.match(studio, /id="claimChannelBtn"/)
  assert.doesNotMatch(studio, /id="deleteChannelBtn"/)
  assert.match(studio, /id="shareChannelPassInput"/)
  assert.match(studio, /id="shareDisplayNameInput"/)
  assert.match(styles, /\.channel-gate-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/)
  assert.match(styles, /\.channel-open-pass\s*\{[\s\S]*border-left:\s*1px solid var\(--line\)/)
  assert.match(styles, /\.channel-number-field\s*\{[\s\S]*display:\s*flex/)
  assert.match(styles, /\.channel-claim-form #shareChannelPassInput\s*\{[\s\S]*grid-column:\s*1 \/ -1/)
  assert.match(styles, /\.channel-gate-form\s*\{[\s\S]*grid-template-columns:\s*minmax\(176px,\s*1fr\)\s*64px/)
  assert.match(styles, /\.channel-gate\[hidden\],\s*\.channel-empty\[hidden\]\s*\{[\s\S]*display:\s*none/)
  assert.match(channelHtml, /id="channelGate"/)
  assert.match(channelHtml, /id="channelGateInput"/)
  assert.match(channelHtml, /placeholder="갤러리 코드"/)
  assert.match(channelHtml, /id="channelCodeInput"/)
  assert.match(channelHtml, /id="channelDeleteBtn"/)
  assert.match(channelHtml, /id="channelRenameBtn"[^>]*>이름 변경/)
  assert.doesNotMatch(channelHtml, /id="channelAdminPin"/)
  assert.doesNotMatch(channelHtml, /id="channelNameInput"/)
  assert.doesNotMatch(channelHtml, /id="channelNamePass"/)
  assert.doesNotMatch(channelHtml, /어느 화음 갤러리에서든 작품을 지울 수 있어요/)
  assert.doesNotMatch(channelHtml, /이름 저장은 관리자 번호와 갤러리 코드가 필요합니다/)
  assert.doesNotMatch(studio + channelHtml, new RegExp("갤러리 " + "비밀" + "번호"))
})

test("channel delete API verifies the admin pin", () => {
  const channelDelete = fs.readFileSync(path.join(projectDir, "api", "share", "channel-delete.js"), "utf8")
  assert.match(channelDelete, /loadChannelMeta/)
  assert.match(channelDelete, /hashAdmin\(body\.adminPin\)/)
  assert.doesNotMatch(channelDelete, /hashPass/)
  assert.match(channelDelete, /const prefix = "share\/channels\/" \+ channel \+ "\/"/)
  assert.match(channelDelete, /await del\(targets\)/)
})

test("shared work delete requires the admin pin even for the same browser owner", () => {
  const deleteApi = fs.readFileSync(path.join(projectDir, "api", "share", "delete.js"), "utf8")
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const studioShareUi = fs.readFileSync(path.join(projectDir, "js", "studio-share-ui.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const bindChannelBody = functionBody(channel, "bind")
  const renameChannelBody = functionBody(channel, "renameChannel")
  const deleteCurrentChannelBody = functionBody(channel, "deleteCurrentChannel")

  assert.match(deleteApi, /hashAdmin\(body\.adminPin\)/)
  assert.doesNotMatch(deleteApi, /ownerOk/)
  assert.doesNotMatch(deleteApi, /hashOwner/)

  assert.match(functionBody(store, "deleteLocalWork"), /String\(adminPin \|\| ""\)\.trim\(\) === LOCAL_ADMIN_PIN/)
  assert.doesNotMatch(functionBody(store, "deleteLocalWork"), /record\.ownerId === owner\.id \|\| !!adminPin/)
  assert.doesNotMatch(functionBody(store, "deleteWork"), /ownerKey/)

  assert.match(functionBody(channel, "canDeleteActive"), /!!state\.activeWork/)
  assert.doesNotMatch(functionBody(channel, "canDeleteActive"), /state\.adminPin/)
  assert.match(functionBody(channel, "deleteActiveWork"), /promptTrimmed\("관리자 번호를 입력하세요\."/)
  assert.match(functionBody(channel, "deleteActiveWork"), /ShareStore\.deleteWork\(work, adminPin\)/)
  assert.doesNotMatch(bindChannelBody, /setAdminPin\(el\.adminPin\.value\)/)
  assert.match(renameChannelBody, /promptTrimmed\("관리자 번호를 입력하세요\."/)
  assert.match(renameChannelBody, /promptTrimmed\("바꿀 갤러리 이름을 입력하세요\."/)
  assert.match(renameChannelBody, /const pin = currentGalleryPass\(\)/)
  assert.match(renameChannelBody, /adminPin: adminPin/)
  assert.match(deleteCurrentChannelBody, /promptTrimmed\("관리자 번호를 입력하세요\."/)
  assert.match(deleteCurrentChannelBody, /ShareStore\.deleteChannel\(channel, adminPin\)/)
  assert.doesNotMatch(deleteCurrentChannelBody, /currentGalleryPass\(\)/)
  assert.match(functionBody(studio, "deleteSharedWork"), /if \(!pin\)/)
  assert.doesNotMatch(functionBody(studio, "deleteSharedWork"), /!workIsMine\(work\) && !pin/)
  assert.match(functionBody(studioShareUi, "renderSharedWorks"), /if \(adminReady\)/)
  assert.doesNotMatch(functionBody(studioShareUi, "renderSharedWorks"), /workIsMine\(work\) \|\| adminReady/)
})

test("channel page opens locked channels with the student entry code or the gate code", () => {
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const openChannelPageBody = functionBody(studio, "openChannelPage")
  const loadChannelBody = functionBody(channel, "loadChannel")
  const submitGatePassBody = functionBody(channel, "submitGatePass")
  const openInputChannelBody = functionBody(channel, "openInputChannel")

  assert.doesNotMatch(channelHtml, /channelRefreshBtn/)
  assert.doesNotMatch(channel, /refreshBtn/)
  assert.match(openChannelPageBody, /rememberChannelEntryPass\(channel, pass\)/)
  assert.match(channel, /function loadStashedChannelPass\(channel\)/)
  assert.match(channel, /loadChannel\(channel, \{ updateUrl: false, focusWork: workIdFromHash\(\), pass: loadStashedChannelPass\(channel\) \}\)/)
  assert.doesNotMatch(loadChannelBody, /ShareStore\.loadPass/)
  assert.match(loadChannelBody, /options\.pass != null/)
  assert.match(loadChannelBody, /ShareStore\.listChannel\(normalized, state\.pass\)/)
  assert.doesNotMatch(submitGatePassBody, /rememberPass/)
  assert.match(submitGatePassBody, /loadChannel\(state\.channel, \{ pass: pin \}\)/)
  assert.match(openInputChannelBody, /const pin = ShareStore[\s\S]*cleanPin/)
  assert.match(openInputChannelBody, /if \(!pin\)[\s\S]*갤러리 코드를 넣어 주세요/)
  assert.match(openInputChannelBody, /channel === normalizeChannel\(state\.channel\)[\s\S]*loadChannel\(channel, \{ pass: pin \}\)[\s\S]*return/)
  assert.match(openInputChannelBody, /state\.pass = pin/)
  assert.match(openInputChannelBody, /loadChannel\(channel, \{ updateUrl: false, pass: pin \}\)/)
  assert.doesNotMatch(openInputChannelBody, /loadChannel\(channel\)/)
})
