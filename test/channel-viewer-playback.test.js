const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

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

test("opening a channel work does not auto-play audio", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const openViewerBody = functionBody(channel, "openViewer")
  const createCardBody = functionBody(channel, "createAlbumCard")
  const renderFlowBody = functionBody(channel, "renderCoverFlow")

  assert.doesNotMatch(openViewerBody, /viewerAudio\.play\(\)/)
  assert.doesNotMatch(createCardBody, /play:\s*true/)
  assert.doesNotMatch(renderFlowBody, /play:\s*true/)
  assert.match(renderFlowBody, /openViewer\(work, \{ updateHash: true \}\)/)
})

test("channel viewer audio starts only from the play button handler", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const bindBody = functionBody(channel, "bind")

  assert.match(bindBody, /el\.viewerPlay\.addEventListener\("click"/)
  assert.match(bindBody, /el\.viewerAudio\.play\(\)/)
})

test("channel viewer fills the frame, sizes down, and shows the play control on hover only", () => {
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

  // 그림은 안 잘리게 통째로 보여주고, 여백은 같은 그림의 흐린 확대본으로 채운다.
  assert.match(css, /\.channel-viewer-cover\s*\{[\s\S]*?object-fit:\s*contain/)
  assert.match(css, /\.channel-viewer-backdrop\s*\{[\s\S]*?blur\(/)
  assert.match(channelHtml, /id="viewerBackdrop"/)
  assert.match(functionBody(channel, "openViewer"), /viewerBackdrop\.src/)
  // 그림 로드 전 폴백 크기 — 로드 후에는 프레임이 그림 비율을 따라간다.
  assert.match(css, /\.channel-viewer-panel\s*\{[\s\S]*?width:\s*min\(800px/)
  assert.match(css, /\.channel-viewer-panel\s*\{[\s\S]*?height:\s*min\(540px/)
  assert.match(channelHtml, /id="viewerPanel"/)
  assert.match(css, /\.channel-viewer-panel\.is-fitted\s*\{[\s\S]*?grid-template-columns:\s*var\(--viewer-stage-w\)/)
  assert.match(functionBody(channel, "fitViewerStage"), /naturalWidth/)
  assert.match(functionBody(channel, "fitViewerStage"), /--viewer-stage-w/)
  // 저화질 학생 그림이 뭉개지지 않게 계산 크기를 일정 비율로 줄여서 연다.
  assert.match(channel, /VIEWER_STAGE_SCALE = 0\.75/)
  assert.match(functionBody(channel, "fitViewerStage"), /\* VIEWER_STAGE_SCALE/)
  assert.match(functionBody(channel, "openViewer"), /fitViewerStage\(\)/)
  assert.match(functionBody(channel, "bind"), /viewerCover\.addEventListener\("load", fitViewerStage\)/)
  // 감상글이 길면 정보 칸 안에서만 스크롤 — 버튼이 패널 테두리를 뚫지 않는다.
  assert.match(css, /\.channel-viewer-info\s*\{[\s\S]*?overflow-y:\s*auto/)
  // 재생/일시정지는 SVG 아이콘으로 토글한다.
  assert.match(channelHtml, /class="channel-play-icon"/)
  assert.match(channelHtml, /class="channel-pause-icon"/)
  assert.match(functionBody(channel, "updateViewerPlayState"), /classList\.toggle\("is-playing"/)
  assert.doesNotMatch(functionBody(channel, "updateViewerPlayState"), /textContent/)
  assert.match(functionBody(channel, "createAlbumCard"), /playIconSvg\(\)/)
  // 버튼은 마우스가 그림 위에 있을 때만 보인다 — 그림을 가리지 않게. (타이머 로직 없음)
  assert.match(css, /\.channel-viewer-play\s*\{[\s\S]*?opacity:\s*0/)
  assert.match(css, /\.channel-viewer-stage:hover \.channel-viewer-play/)
  assert.doesNotMatch(channel, /scheduleViewerPlayFade|is-faded/)
})

test("shared gallery viewers separate composer, description, and attempt count", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")
  const css = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")

  assert.match(functionBody(channel, "workViewerMeta"), /composer:\s*workComposer\(work\) \|\| "작곡가 이름 없음"/)
  assert.match(functionBody(channel, "workViewerMeta"), /atmosphere:\s*cleanText\(meta\.atmosphereLabel,\s*32\)/)
  assert.match(functionBody(channel, "workViewerMeta"), /instrument:\s*cleanText\(meta\.instrumentLabel,\s*72\)/)
  assert.match(functionBody(channel, "workViewerMeta"), /actionCount:\s*actionCountLine\(work\)/)
  assert.doesNotMatch(functionBody(channel, "workViewerMeta"), /업로드|createdAt|formatDate/)
  assert.doesNotMatch(functionBody(channel, "workDescriptionLine"), /secondsLabel|duration/)
  assert.match(functionBody(channel, "openViewer"), /viewerTitle\.textContent = workTitle\(work\)/)
  assert.doesNotMatch(functionBody(channel, "openViewer"), /viewerTitle\.textContent = workDisplayTitle\(work\)/)
  assert.match(functionBody(channel, "openViewer"), /renderViewerMeta\(work\)/)
  assert.match(functionBody(channel, "renderViewerMeta"), /setViewerMetaItem\(el\.viewerComposerRow, el\.viewerComposer, meta\.composer\)/)
  assert.match(functionBody(channel, "renderViewerMeta"), /setViewerMetaItem\(el\.viewerAtmosphereRow, el\.viewerAtmosphere, meta\.atmosphere\)/)
  assert.match(functionBody(channel, "renderViewerMeta"), /setViewerMetaItem\(el\.viewerInstrumentRow, el\.viewerInstrument, meta\.instrument\)/)
  assert.match(channelHtml, /id="viewerTitle"[\s\S]*id="viewerComposerRow"[\s\S]*작곡가[\s\S]*id="viewerAtmosphereRow"[\s\S]*배경음악[\s\S]*id="viewerInstrumentRow"[\s\S]*악기/)
  assert.match(channelHtml, /id="viewerActionCount"/)
  // 확대 보기 글 라벨은 완성 화면의 질문과 같은 말을 쓰고, 본문은 카드 안에 따로 담는다.
  assert.match(channelHtml, /class="channel-viewer-note-card" id="viewerBackgroundCard"[\s\S]*배경음악을 고른 이유/)
  assert.match(channelHtml, /class="channel-viewer-note-card" id="viewerMelodyCard"[\s\S]*선율을 표현한 의도/)
  assert.match(functionBody(channel, "openViewer"), /setOptionalText\(el\.viewerBackgroundCard, el\.viewerBackground, meta\.backgroundReason\)/)
  assert.match(functionBody(channel, "openViewer"), /setOptionalText\(el\.viewerMelodyCard, el\.viewerMelody, meta\.melodyIntent\)/)
  assert.match(functionBody(channel, "renderViewerTags"), /className = "channel-viewer-tag"/)
  assert.doesNotMatch(channelHtml, /화음 갤러리 감상/)
  assert.match(functionBody(share, "sharedMetadata"), /actionCount:\s*deps\.normalizeActionCount\(recipe && recipe\.actionCount\)/)
  assert.match(css, /\.channel-viewer-meta-list\s*\{[\s\S]*display:\s*grid/)
  assert.match(css, /\.channel-viewer-note-card\s*\{[\s\S]*background:\s*rgba\(255,\s*247,\s*223,\s*0\.045\)/)
  assert.match(css, /\.channel-viewer-actions \.channel-action-button\.danger\s*\{[\s\S]*background:\s*transparent/)
})

test("channel viewer opens a studio copy instead of a drawing image", () => {
  const channelHtml = fs.readFileSync(path.join(projectDir, "channel.html"), "utf8")
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const openViewerBody = functionBody(channel, "openViewer")
  const bindBody = functionBody(channel, "bind")

  assert.match(channelHtml, /id="viewerDrawingBtn"[^>]*aria-label="스튜디오에서 보기"[\s\S]*스튜디오에서[\s\S]*class="channel-action-line"[\s\S]*보기[\s\S]*id="viewerCopyBtn"[^>]*aria-label="다른 갤러리에 복사하기"[\s\S]*다른 갤러리에[\s\S]*class="channel-action-line"[\s\S]*복사하기[\s\S]*id="viewerDeleteBtn"[^>]*>작품 삭제/)
  assert.doesNotMatch(channelHtml, />링크 복사</)
  assert.match(channelHtml, /id="viewerDeleteBtn"[^>]*>작품 삭제/)
  assert.doesNotMatch(channelHtml, /id="viewerDeleteBtn"[^>]*hidden/)
  assert.match(openViewerBody, /viewerDrawing\.disabled = !canOpenStudioCopy\(work\)/)
  assert.match(openViewerBody, /viewerCopy\.disabled = !canCopyActive\(\)/)
  assert.match(bindBody, /viewerDrawing[\s\S]*addEventListener\("click", openActiveStudioCopy\)/)
  assert.match(functionBody(channel, "openActiveStudioCopy"), /root\.open\("about:blank", "_blank"\)/)
  assert.match(functionBody(channel, "openActiveStudioCopy"), /studioCopyUrl\(storeStudioCopy\(state\.activeWork\)\)/)
  assert.match(functionBody(channel, "storeStudioCopy"), /STUDIO_COPY_STORAGE_PREFIX \+ token/)
  assert.match(functionBody(channel, "studioCopyRecipe"), /recipe\.atmosphere = "none"/)
})

test("channel viewer copies a work to another gallery with the target gallery code", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  const copyApi = fs.readFileSync(path.join(projectDir, "api", "share", "copy.js"), "utf8")
  const bindBody = functionBody(channel, "bind")
  const copyActiveBody = functionBody(channel, "copyActiveWork")
  const copyWorkBody = functionBody(store, "copyWork")

  assert.match(bindBody, /viewerCopy[\s\S]*addEventListener\("click", copyActiveWork\)/)
  assert.match(copyActiveBody, /promptTrimmed\("복사할 갤러리 번호를 입력하세요\."/)
  assert.match(copyActiveBody, /promptTrimmed\("복사할 갤러리 코드\(숫자\)를 입력하세요\."/)
  assert.match(copyActiveBody, /ShareStore\.copyWork\(state\.activeWork/)
  assert.match(copyActiveBody, /sourcePass: currentGalleryPass\(\)/)
  assert.doesNotMatch(copyActiveBody, /관리자 공통 코드/)

  assert.match(copyWorkBody, /postJson\("\/copy"/)
  assert.doesNotMatch(copyWorkBody, /adminPin/)
  assert.match(copyApi, /hashPass\(targetChannel, cleanPin\(body\.pass\)\)/)
  assert.match(copyApi, /hashPass\(sourceChannel, cleanPin\(body\.sourcePass\)\)/)
  assert.doesNotMatch(copyApi, /hashAdmin/)
  assert.match(copyApi, /await put\(base \+ "cover\.webp"/)
  assert.match(copyApi, /send\(res, 200, \{ work: sanitizeMeta\(meta\) \}\)/)
})

test("shared publish stores a drawing image file for channel viewers", () => {
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")
  const store = fs.readFileSync(path.join(projectDir, "js", "share-store.js"), "utf8")
  const publishApi = fs.readFileSync(path.join(projectDir, "api", "share", "publish.js"), "utf8")

  assert.match(functionBody(share, "publishSharedWork"), /deps\.renderDrawingSnapshotCanvas\(\)/)
  assert.match(functionBody(share, "publishSharedWork"), /drawingBlob: drawing/)
  assert.match(functionBody(store, "publishWork"), /drawing: drawing \? await encodeBlob\(drawing\) : null/)
  assert.match(functionBody(store, "localPublicWork"), /drawingUrl: objectUrlFor\(record\.id, "drawing", drawing\)/)
  assert.match(publishApi, /const drawing = files\.drawing \? decodeFile\(files\.drawing, "image\/webp"\) : null/)
  assert.match(publishApi, /base \+ "drawing\.webp"/)
  assert.match(publishApi, /drawingUrl: drawingBlob \? drawingBlob\.url : ""/)
})

test("shared publish uploads meta json once", () => {
  const publishApi = fs.readFileSync(path.join(projectDir, "api", "share", "publish.js"), "utf8")
  const metaPutCalls = publishApi.match(/await put\(base \+ "meta\.json"/g) || []

  assert.equal(metaPutCalls.length, 1)
  assert.match(publishApi, /metaUrl: ""/)
  assert.match(publishApi, /metaPathname: base \+ "meta\.json"/)
  assert.match(publishApi, /meta\.files\.metaUrl = metaBlob\.url/)
  assert.match(publishApi, /meta\.files\.metaPathname = metaBlob\.pathname/)
})

test("saved takes and shared works describe every used instrument", () => {
  const channel = fs.readFileSync(path.join(projectDir, "js", "channel.js"), "utf8")
  const share = fs.readFileSync(path.join(projectDir, "js", "studio-share.js"), "utf8")
  const takesUi = fs.readFileSync(path.join(projectDir, "js", "studio-takes-ui.js"), "utf8")

  assert.match(functionBody(takesUi, "renderTakes"), /deps\.usedInstrumentLabelsForRecipe\(take\.recipe\)/)
  assert.match(functionBody(share, "sharedMetadata"), /deps\.usedInstrumentLabelsForRecipe\(recipe\)/)
  assert.match(functionBody(share, "publishSharedWork"), /const metadata = sharedMetadata\(recipe\)/)
  assert.match(functionBody(channel, "workDescriptionLine"), /cleanText\(meta\.instrumentLabel,\s*72\)/)
})
