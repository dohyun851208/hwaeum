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
  assert.equal(utils.cleanPin("1234567890123456"), "123456")
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
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  assert.match(claim, /hashAdmin\(body\.adminPin\)/)
  assert.match(claim, /existing\.ownerHash !== ownerHash/)
  assert.match(claim, /이미 다른 선생님이 사용 중인 화음 갤러리/)
  // 갤러리 코드가 정확히 맞으면 다른 브라우저의 같은 선생님으로 보고 이름 변경을 허용한다.
  assert.match(claim, /passMatches/)
  assert.match(claim, /hashPass\(channel, pass\) === existing\.passHash/)
  assert.match(functionBody(store, "claimLocalChannel"), /existing\.pass !== pin/)
})

test("share-store exposes channel claim + pass-aware listing", () => {
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  assert.match(store, /claimChannel: claimChannel/)
  assert.match(store, /function listChannel\(channel, pass\)/)
  assert.match(store, /function deleteChannel\(channel, adminPin\)/)
  assert.match(store, /rememberPass:/)
  assert.match(store, /loadPass:/)
  assert.match(store, /deleteChannel: deleteChannel/)
  // 갤러리 코드는 localStorage에 기억한다 — 브라우저를 껐다 켜도 유지.
  assert.match(functionBody(store, "rememberPass"), /storage\(\)/)
  assert.doesNotMatch(functionBody(store, "rememberPass"), /sessionStorage/)
  assert.match(functionBody(store, "loadPass"), /storage\(\)/)
  assert.doesNotMatch(functionBody(store, "loadPass"), /sessionStorage/)
})

test("publish flow asks channel + code together in one modal", () => {
  const studioHtml = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const styles = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const publishTakeBody = functionBody(studio, "publishTake")
  const submitBody = functionBody(studio, "submitPublishModal")

  assert.match(studioHtml, /id="publishModal"/)
  assert.match(studioHtml, /id="publishChannelInput"[^>]*maxlength="4"/)
  assert.match(studioHtml, /id="publishPassInput"[^>]*maxlength="6"/)
  assert.match(studioHtml, /id="publishModalSubmitBtn">공유하기</)
  assert.match(styles, /\.publish-modal\s*\{/)
  // 예전 2단계 prompt 흐름은 사라졌다 — 번호와 코드를 모달에서 동시에 받는다.
  assert.doesNotMatch(publishTakeBody, /prompt\(/)
  assert.match(publishTakeBody, /openPublishModal\(\)/)
  assert.match(submitBody, /ShareStore\.rememberPass\(channel, pass\)/)
  assert.match(submitBody, /publishSharedWork\(channel, pass\)/)
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
  assert.match(studio, /placeholder="관리자 공통 코드 \(8624\)"/)
  assert.match(studio, /id="channelBrowseInput"[^>]*maxlength="4"[^>]*placeholder="번호 \(예 107\)"/)
  assert.match(studio, /class="channel-number-field"[\s\S]*id="claimChannelInput"/)
  assert.match(studio, /placeholder="갤러리 이름 \(예: 여름 빛깔을 담은 노래\)"/)
  assert.match(studio, /id="shareChannelPassInput"[^>]*maxlength="6"[^>]*placeholder="갤러리 코드 \(4~6자리\)"/)
  assert.match(studio, /id="claimChannelBtn">화음 갤러리 생성하기/)
  assert.match(studio, /관리자 공통 코드\(8624\)로 화음 갤러리 생성이 가능하며/)
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
  assert.doesNotMatch(styles, /\.channel-gate-form\s*\{/)
  assert.match(styles, /\.channel-empty\[hidden\]\s*\{[\s\S]*display:\s*none/)
  assert.doesNotMatch(channelHtml, /id="channelGate"/)
  assert.doesNotMatch(channelHtml, /id="channelGateInput"/)
  assert.match(channelHtml, /maxlength="6"[^>]*placeholder="코드"[^>]*aria-label="갤러리 코드"/)
  assert.match(channelHtml, /id="channelCodeInput"/)
  assert.match(channelHtml, /id="channelDeleteBtn"/)
  assert.match(channelHtml, /id="channelRenameBtn"[^>]*>이름 변경/)
  assert.doesNotMatch(channelHtml, /id="channelAdminPin"/)
  assert.doesNotMatch(channelHtml, /id="channelNameInput"/)
  assert.doesNotMatch(channelHtml, /id="channelNamePass"/)
  assert.doesNotMatch(channelHtml, /어느 화음 갤러리에서든 작품을 지울 수 있어요/)
  assert.doesNotMatch(channelHtml, /이름 저장은 관리자 공통 코드와 갤러리 코드가 필요합니다/)
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

test("shared work delete stays on the channel page and requires the admin pin", () => {
  const deleteApi = fs.readFileSync(path.join(projectDir, "api", "share", "delete.js"), "utf8")
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const bindChannelBody = functionBody(channel, "bind")
  const openRenameModalBody = functionBody(channel, "openRenameModal")
  const submitRenameModalBody = functionBody(channel, "submitRenameModal")
  const deleteCurrentChannelBody = functionBody(channel, "deleteCurrentChannel")

  assert.match(deleteApi, /hashAdmin\(body\.adminPin\)/)
  assert.doesNotMatch(deleteApi, /ownerOk/)
  assert.doesNotMatch(deleteApi, /hashOwner/)

  assert.match(functionBody(store, "deleteLocalWork"), /String\(adminPin \|\| ""\)\.trim\(\) === LOCAL_ADMIN_PIN/)
  assert.doesNotMatch(functionBody(store, "deleteLocalWork"), /record\.ownerId === owner\.id \|\| !!adminPin/)
  assert.doesNotMatch(functionBody(store, "deleteWork"), /ownerKey/)

  assert.match(functionBody(channel, "canDeleteActive"), /!!state\.activeWork/)
  assert.doesNotMatch(functionBody(channel, "canDeleteActive"), /state\.adminPin/)
  assert.match(functionBody(channel, "deleteActiveWork"), /promptTrimmed\("관리자 공통 코드를 입력하세요\."/)
  assert.match(functionBody(channel, "deleteActiveWork"), /ShareStore\.deleteWork\(work, adminPin\)/)
  assert.doesNotMatch(bindChannelBody, /setAdminPin\(el\.adminPin\.value\)/)
  // 이름 변경은 관리자 공통 코드 + 새 이름을 한 모달에서 받는다(prompt 없음).
  assert.match(openRenameModalBody, /currentGalleryPass\(\)/)
  assert.doesNotMatch(openRenameModalBody + submitRenameModalBody, /promptTrimmed/)
  assert.match(submitRenameModalBody, /const pin = currentGalleryPass\(\)/)
  assert.match(submitRenameModalBody, /ShareStore\.claimChannel\(/)
  assert.match(submitRenameModalBody, /adminPin: adminPin/)
  assert.match(deleteCurrentChannelBody, /promptTrimmed\("관리자 공통 코드를 입력하세요\."/)
  assert.match(deleteCurrentChannelBody, /ShareStore\.deleteChannel\(channel, adminPin\)/)
  assert.doesNotMatch(deleteCurrentChannelBody, /currentGalleryPass\(\)/)
  assert.equal(fs.existsSync(path.join(projectDir, "js", "studio-share-ui.js")), false)
  assert.doesNotMatch(studio, /function deleteSharedWork\(/)
})

test("channel page opens locked channels with the student entry code or the gate code", () => {
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const studio = fs.readFileSync(path.join(projectDir, "js", "studio.js"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const openChannelPageBody = functionBody(studio, "openChannelPage")
  const loadChannelBody = functionBody(channel, "loadChannel")
  const openInputChannelBody = functionBody(channel, "openInputChannel")

  assert.doesNotMatch(channelHtml, /channelRefreshBtn/)
  assert.doesNotMatch(channel, /refreshBtn/)
  assert.match(openChannelPageBody, /rememberChannelEntryPass\(channel, pass\)/)
  assert.match(channel, /function loadStashedChannelPass\(channel\)/)
  // 한 번 입장한 갤러리는 코드를 브라우저에 기억한다 — 새로고침해도 다시 묻지 않게.
  assert.match(channel, /function savedChannelPass\(channel\)/)
  assert.match(channel, /loadChannel\(channel, \{ updateUrl: false, focusWork: workIdFromHash\(\), pass: loadStashedChannelPass\(channel\) \|\| savedChannelPass\(channel\) \}\)/)
  assert.match(loadChannelBody, /state\.pass = savedChannelPass\(normalized\)/)
  assert.match(loadChannelBody, /ShareStore\.rememberPass\(normalized, state\.pass\)/)
  assert.match(loadChannelBody, /ShareStore\.rememberPass\(normalized, ""\)/)
  assert.match(loadChannelBody, /options\.pass != null/)
  assert.match(loadChannelBody, /ShareStore\.listChannel\(normalized, state\.pass\)/)
  assert.doesNotMatch(channel, /function submitGatePass/)
  assert.match(openInputChannelBody, /const pin = ShareStore[\s\S]*cleanPin/)
  assert.match(openInputChannelBody, /if \(!pin\)[\s\S]*setStatus\("", false\)[\s\S]*el\.codeInput\.focus\(\)/)
  assert.doesNotMatch(openInputChannelBody, /갤러리 코드를 넣어 주세요/)
  assert.match(openInputChannelBody, /channel === normalizeChannel\(state\.channel\)[\s\S]*loadChannel\(channel, \{ pass: pin \}\)[\s\S]*return/)
  assert.match(openInputChannelBody, /state\.pass = pin/)
  assert.match(openInputChannelBody, /loadChannel\(channel, \{ updateUrl: false, pass: pin \}\)/)
  assert.doesNotMatch(openInputChannelBody, /loadChannel\(channel\)/)
})
