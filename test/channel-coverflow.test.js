const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectDir = path.join(__dirname, "..")

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
  assert.match(source, /channel-coverflow-counter/)
  assert.doesNotMatch(source, /channel-coverflow-caption/)

  assert.match(css, /\.channel-coverflow-stage/)
  assert.match(css, /\.channel-coverflow \.channel-flow-album/)
  assert.match(css, /\.channel-coverflow-counter/)
  assert.match(css, /\.channel-coverflow \.channel-album-overlay\s*\{[^}]*right:\s*0/)
  assert.match(css, /\.channel-coverflow \.channel-album-overlay\s*\{[^}]*bottom:\s*0/)
  assert.match(css, /\.channel-coverflow \.channel-album-overlay\s*\{[^}]*left:\s*0/)
  assert.match(css, /\.channel-coverflow \.channel-album-overlay\s*\{[^}]*border-radius:\s*0 0 6px 6px/)
  assert.doesNotMatch(css, /\.channel-coverflow \.channel-album-overlay\s*\{[^}]*display:\s*none/)
  assert.doesNotMatch(css, /\.channel-coverflow-caption/)
  assert.doesNotMatch(css, /-webkit-box-reflect/)
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

test("coverflow card clicks are not swallowed by drag pointer capture", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const body = functionBody(source, "bindFlowInteractions")
  const downStart = body.indexOf('stage.addEventListener("pointerdown"')
  const moveStart = body.indexOf('stage.addEventListener("pointermove"')

  assert.notEqual(downStart, -1)
  assert.notEqual(moveStart, -1)
  assert.doesNotMatch(body.slice(downStart, moveStart), /setPointerCapture/)
  assert.match(body, /if \(!state\.flowDragMoved\) \{[\s\S]*Math\.abs\(dx\) <= 4[\s\S]*return[\s\S]*state\.flowDragMoved = true[\s\S]*stage\.setPointerCapture\(pointerId\)/)
  assert.match(body, /if \(state\.flowDragMoved\) setFlowIndex\(Math\.round\(state\.flowPosition\)\)/)
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
  assert.match(css, /\.channel-topbar\s*\{[\s\S]*grid-template-columns:\s*56px\s*minmax\(260px,\s*1fr\)\s*auto\s*minmax\(412px,\s*1fr\)/)
  assert.match(css, /\.channel-top-actions\s*\{[^}]*display:\s*flex/)
  assert.match(css, /\.channel-top-actions\s*\{[^}]*flex-wrap:\s*nowrap/)
  assert.match(css, /\.channel-viewbar\s*\{[^}]*flex:\s*0 0 auto/)
  assert.doesNotMatch(css, /\.channel-viewbar\s*\{[^}]*position:\s*absolute/)
  assert.doesNotMatch(css, /\.channel-flow-controls\s*\{[^}]*position:\s*absolute/)
  assert.match(css, /body:not\(\[data-gallery-view="flow"\]\) \.channel-flow-controls\s*\{[^}]*visibility:\s*hidden/)
  assert.match(css, /\.channel-open-form\s*\{[\s\S]*grid-template-columns:\s*116px\s*92px\s*118px\s*62px/)
  assert.match(css, /\.channel-open-form #channelInput\s*\{[\s\S]*grid-column:\s*2/)
  assert.match(css, /\.channel-open-form \.channel-code-input\s*\{[\s\S]*grid-column:\s*3/)
  assert.match(css, /\.channel-open-form > \.channel-open-button\[type="submit"\]\s*\{[\s\S]*grid-column:\s*4/)
})

test("화음 갤러리는 갤러리 전체 공유 버튼을 쓰고 작품별 링크 복사를 숨긴다", () => {
  const html = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")

  assert.match(html, /id="channelShareBtn"[\s\S]*갤러리 공유/)
  assert.doesNotMatch(html, /id="viewerCopyBtn"/)
  assert.match(source, /shareBtn: \$\("channelShareBtn"\)/)
  assert.match(source, /function copyGalleryLink\(\)/)
  assert.match(source, /channelUrl\(state\.channel,\s*""\)/)
  assert.doesNotMatch(source, /function copyActiveLink\(\)/)
})

test("한눈에 보기 작품 카드는 드래그로 순서를 바꾸고 갤러리별로 저장한다", () => {
  const source = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(source, /const WORK_ORDER_STORAGE_PREFIX = "hwaeum\.channelWorkOrder\."/)
  assert.match(source, /function applyStoredWorkOrder\(works,\s*channel\)/)
  assert.match(source, /function saveWorkOrder\(\)/)
  assert.match(source, /function bindShelfReorder\(button,\s*work\)/)
  assert.match(source, /addEventListener\("dragstart"/)
  assert.match(source, /addEventListener\("drop"/)
  assert.match(source, /createAlbumCard\(work,\s*start \+ offset,\s*\{ draggable: true \}\)/)
  assert.match(css, /\.channel-album-reorderable/)
  assert.match(css, /\.channel-album\.is-drop-before::before/)
  assert.match(css, /\.channel-album\.is-drop-after::after/)
})

test("한눈에 보기는 작품 목록 안에서 스크롤되고 앨범은 선반에 더 가깝게 놓인다", () => {
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  assert.match(css, /\.channel-shell\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)[\s\S]*height:\s*100vh/)
  assert.match(css, /\.channel-library\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto/)
  assert.match(css, /\.channel-shelves\s*\{[\s\S]*align-content:\s*start/)
  assert.match(css, /\.channel-shelf\s*\{[\s\S]*padding:\s*18px\s*22px\s*56px/)
})
