const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

test("index exposes optional Google login before the studio boot code", () => {
  const html = fs.readFileSync(path.join(projectDir, "index.html"), "utf8")

  assert.match(html, /<meta name="google-signin-client_id" content="" \/>/)
  assert.match(html, /https:\/\/accounts\.google\.com\/gsi\/client/)
  assert.match(html, /id="authBox"[\s\S]*data-auth="guest"/)
  assert.match(html, /id="googleButtonSlot"/)
  assert.match(html, /id="googleLogoutBtn"/)
  assert.match(html, /로그인 없이도 사용할 수 있어요\./)
  assert.ok(html.indexOf("./js/auth.js") < html.indexOf("./js/studio.js"), "auth.js must load before studio.js")
})

test("auth module uses Google Identity Services without making login required", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "auth.js"), "utf8")

  assert.doesNotThrow(() => new Function(source))
  assert.match(source, /google\.accounts\.id/)
  assert.match(source, /renderButton/)
  assert.match(source, /SETUP_STATUS = "Google 로그인 설정이 필요해요\. 로그인 없이 사용할 수 있어요\."/)
  assert.match(source, /SIGNED_OUT_STATUS = "로그인 없이도 사용할 수 있어요\."/)
  assert.doesNotMatch(source, /setItem\([^)]*credential/)
})
