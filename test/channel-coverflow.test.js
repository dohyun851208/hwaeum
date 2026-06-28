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

test("커버플로우는 마우스 드래그와 휠로 부드럽게 움직인다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  // 드래그·휠 입력을 받아 소수 위치(flowPosition)로 자리만 갱신한다.
  assert.match(source, /function bindFlowInteractions\(stage\)/)
  assert.match(source, /function layoutFlowCards\(position\)/)
  assert.match(source, /pointerdown/)
  assert.match(source, /pointermove/)
  assert.match(source, /addEventListener\(\s*"wheel"/)
  assert.match(source, /state\.flowPosition/)

  // 드래그 중에는 전환을 꺼서 손가락을 1:1로 따라오게 한다.
  assert.match(css, /\.channel-coverflow-stage\.is-dragging[\s\S]*transition:\s*none/)
  assert.match(css, /cursor:\s*grab/)
})
