const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

test("studio shell does not expose Google login UI or scripts", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")

  assert.doesNotMatch(html, /google-signin-client_id/)
  assert.doesNotMatch(html, /accounts\.google\.com\/gsi\/client/)
  assert.doesNotMatch(html, /id="authBox"/)
  assert.doesNotMatch(html, /id="googleButtonSlot"/)
  assert.doesNotMatch(html, /id="googleLogoutBtn"/)
  assert.doesNotMatch(html, /\.\/js\/auth\.js/)
  assert.match(html, /\.\/js\/studio\.js/)
})

test("removed Google auth module is not present", () => {
  assert.equal(fs.existsSync(path.join(projectDir, "js", "auth.js")), false)
})

test("login-only CSS selectors are gone", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.doesNotMatch(css, /\.auth-/)
  assert.doesNotMatch(css, /\.google-button-slot/)
})
