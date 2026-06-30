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

test("화음 갤러리 화면은 저장된 갤러리 이름을 주제목으로 보여주고 현재 번호를 입력칸에 보여 준다", () => {
  const html = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(html, /id="channelTitle">화음 갤러리/)
  assert.doesNotMatch(html, /그림 음악 전시실/)
  assert.match(html, /<label for="channelInput">현재 갤러리<\/label>/)
  assert.match(source, /function channelDisplayName/)
  assert.match(source, /meta\.displayName/)
  assert.match(source, /el\.title\.textContent = name \|\| "화음 갤러리"/)
  assert.match(source, /el\.input\.value = channel \|\| ""/)
  assert.doesNotMatch(source, /공유 음악 " \+ state\.works\.length/)
  assert.doesNotMatch(source, /개를 불러왔어요/)
  assert.match(css, /\.channel-title-block h1\s*\{[\s\S]*color:\s*var\(--channel-accent\)/)
  assert.match(css, /\.channel-title-block h1\s*\{[\s\S]*font-size:\s*2\.1rem/)
  assert.match(css, /\.channel-title-block p:last-child:empty\s*\{[\s\S]*display:\s*none/)
  assert.match(css, /\.channel-top-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto\s*minmax\(0,\s*1fr\)/)
  assert.match(css, /\.channel-viewbar\s*\{[\s\S]*left:\s*50%/)
  assert.match(css, /\.channel-viewbar\s*\{[\s\S]*transform:\s*translate\(-50%,\s*-50%\)/)
  assert.match(css, /\.channel-flow-controls\s*\{[\s\S]*position:\s*absolute/)
  assert.match(css, /\.channel-open-form\s*\{[\s\S]*grid-template-columns:\s*92px\s*118px\s*62px/)
})
