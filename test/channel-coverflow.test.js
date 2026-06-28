const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectDir = path.join(__dirname, "..")

test("화음 갤러리는 한눈에 보기와 커버플로우 보기 모드를 제공한다", () => {
  const html = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(html, /id="channelShelfModeBtn"[\s\S]*한눈에 보기/)
  assert.match(html, /id="channelFlowModeBtn"[\s\S]*커버플로우/)
  assert.match(html, /id="channelFlowPrevBtn"/)
  assert.match(html, /id="channelFlowNextBtn"/)

  assert.match(source, /const VIEW_MODE_FLOW = "flow"/)
  assert.match(source, /function renderCoverFlow\(\)/)
  assert.match(source, /function setViewMode\(mode\)/)
  assert.match(source, /function shiftFlowIndex\(delta\)/)

  assert.match(css, /\.channel-coverflow-stage/)
  assert.match(css, /\.channel-coverflow \.channel-flow-album/)
  assert.match(css, /-webkit-box-reflect/)
})
