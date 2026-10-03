// Optional real-browser regression check. Start npm run serve first.
// PLAYWRIGHT_MODULE / CHROME_PATH can use an existing Playwright / Chromium install.
// REFACTOR_BASELINE_DIR optionally serves a pre-change source snapshot for output comparison.
// Uses a fresh profile and intercepts share APIs so it only writes disposable local data.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

const origin = new URL(process.env.STUDIO_URL || "http://127.0.0.1:4173/studio.html").origin
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "Use a local HTTP server")
const out = path.resolve(process.argv[2] || path.join(__dirname, "../output/refactor-review"))
fs.mkdirSync(out, { recursive: true })
const report = { checks: [], errors: [] }
function passed(check, detail) {
  report.checks.push({ check, detail })
  console.log("PASS " + check)
}

async function makeContext(browser, baseline) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  context.on("page", (page) => page.on("pageerror", (error) => report.errors.push(error.message)))
  context.on("response", (response) => {
    const url = new URL(response.url())
    if (url.origin === origin && url.pathname.startsWith("/sound/") && !response.ok()) report.errors.push("Audio asset " + response.status() + ": " + url.pathname)
  })
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname.startsWith("/api/share/")) {
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Local verification"}' })
    }
    if (baseline && url.origin === origin && /\.(html|js|css)$/.test(url.pathname)) {
      const file = path.resolve(baseline, "." + decodeURIComponent(url.pathname))
      if (file.startsWith(path.resolve(baseline) + path.sep) && fs.existsSync(file)) {
        const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"
        return route.fulfill({ body: fs.readFileSync(file), contentType })
      }
    }
    return route.continue()
  })
  return context
}

async function openStudio(context) {
  const page = await context.newPage()
  await page.goto(origin + "/studio.html")
  await page.waitForFunction(() => window.SoundDrawing && SoundDrawing.getStateSummary().duration > 0)
  await page.evaluate(() => document.fonts.ready)
  return page
}

async function compareOutput(context, name) {
  const page = await openStudio(context)
  const result = await page.evaluate(async () => {
    const hash = async (data) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (n) => n.toString(16).padStart(2, "0")).join("")
    const recipe = {
      duration: 3, atmosphere: "none", instrument: "violin", style: "bright", version: "balanced", mode: "melody",
      strokes: [[{ x: .05, y: .9 }, { x: .32, y: .9 }, { x: .34, y: .63 }, { x: .68, y: .63 }, { x: .7, y: .37 }, { x: .95, y: .37 }]],
      strokeInstruments: ["violin"],
    }
    SoundDrawing.loadRecipe(recipe)
    SoundDrawing.setStep(2)
    SoundDrawing.setDrawingInputMode("picture")
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    SoundDrawing.draw.render()
    const canvas = SoundDrawing.draw.canvas
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
    const drawing = { width: canvas.width, height: canvas.height, hash: await hash(pixels) }
    // Keep comparison decoding independent of the wizard's asynchronous preview warmup.
    const engine = new AudioEngine()
    const audio = []
    for (const instrument of SDStudioData.instruments) {
      const sample = Object.assign({}, recipe, { instrument: instrument.id, style: instrument.group === "국악" ? "gugak" : "bright", strokeInstruments: [instrument.id] })
      const buffer = await engine.renderOffline(sample, [])
      const hashes = []
      let energy = 0, peak = 0
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const pcm = buffer.getChannelData(ch)
        hashes.push(await hash(pcm))
        for (const value of pcm) { energy += value * value; peak = Math.max(peak, Math.abs(value)) }
      }
      audio.push({ id: instrument.id, sampleRate: buffer.sampleRate, frames: buffer.length, hashes, rms: Math.sqrt(energy / buffer.length / buffer.numberOfChannels), peak })
    }
    const decodedSamples = Array.from(engine.decodedCache.values()).filter(Boolean).length
    await engine.ctx.close()
    return { drawing, audio, decodedSamples }
  })
  assert.equal(result.audio.length, 13)
  assert.ok(result.decodedSamples > 13, "Instrument MP3 samples were decoded")
  assert.ok(result.audio.every((item) => item.rms > .00001 && Number.isFinite(item.peak)), "All instruments render real audio")
  await page.screenshot({ path: path.join(out, name + "-drawing.png"), fullPage: true })
  await page.close()
  return result
}

async function studioFlow(context) {
  const page = await openStudio(context)
  const picture = await page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 480; canvas.height = 320
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#b9ded4"; ctx.fillRect(0, 0, 480, 320)
    ctx.fillStyle = "#426d5d"; ctx.fillRect(60, 160, 340, 110)
    return canvas.toDataURL("image/png").split(",")[1]
  })
  await page.locator("#picInput").setInputFiles({ name: "검증-그림.png", mimeType: "image/png", buffer: Buffer.from(picture, "base64") })
  await page.waitForFunction(() => SoundDrawing.getStateSummary().hasPicture)
  await page.locator('[data-step-jump="1"]').click()
  const memo = page.locator("[data-note-instrument]").first()
  await memo.fill("맑고 부드러운 소리가 떠올랐어요.")
  await page.locator('[data-step-jump="2"]').click()
  await page.locator(".compose-instrument").filter({ hasText: "바이올린" }).click()
  await page.evaluate(() => SoundDrawing.setDrawingInputMode("picture"))
  async function stroke(y) {
    const rect = await page.evaluate(() => {
      const draw = SoundDrawing.draw
      draw.canvas.scrollIntoView({ block: "center", inline: "start" })
      const r = draw.canvas.getBoundingClientRect()
      const clip = draw.scrollContainer ? draw.scrollContainer.getBoundingClientRect() : r
      const x = Math.max(r.x, clip.x, 0)
      return { x, y: r.y, width: Math.min(r.right, clip.right, innerWidth) - x, height: r.height }
    })
    await page.mouse.move(rect.x + rect.width * .1, rect.y + rect.height * y)
    await page.mouse.down()
    await page.waitForFunction(() => SoundDrawing.engine.livePreview && SoundDrawing.engine.livePreview.kind === "sample")
    await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height * (y - .15), { steps: 24 })
    await page.mouse.up()
  }
  await stroke(.8)
  await page.waitForFunction(() => SoundDrawing.buildRecipe().strokes.length === 1)
  await stroke(.55)
  assert.equal(await page.evaluate(() => SoundDrawing.buildRecipe().strokes.length), 2)
  await page.locator("#undoBtn").click()
  assert.equal(await page.evaluate(() => SoundDrawing.buildRecipe().strokes.length), 1)
  const stored = await page.evaluate(() => JSON.stringify(SoundDrawing.draw.strokes))
  await page.locator(".compose-instrument").filter({ hasText: "대금" }).click()
  assert.equal(await page.evaluate(() => DrawingCanvas.pitchRowsForStyle(SDStudioData.styles.find((s) => s.id === "gugak"), SDStudioData.melodies.daegeum).length), 10)
  assert.equal(await page.evaluate(() => JSON.stringify(SoundDrawing.draw.strokes)), stored)
  await page.locator(".compose-instrument").filter({ hasText: "바이올린" }).click()
  await page.locator('[data-step-jump="3"]').click()
  await page.locator("#titleInput").fill("리팩토링 검증 작품")
  await page.locator("#composerInput").fill("화음지기")
  await page.locator("#bgReasonInput").fill("선율을 또렷하게 들으려고 배경 없이 만들었어요.")
  await page.locator("#melodyIntentInput").fill("올라가는 선으로 밝은 느낌을 표현했어요.")
  await page.locator("#hashtagsInput").fill("밝음")
  await page.locator("#hashtagsInput").press("Enter")
  await page.locator("#saveTakeBtn").click()
  const saved = await page.evaluate(() => {
    window.checkRecipe = SoundDrawing.buildRecipe()
    return { recipe: checkRecipe, takes: SoundDrawing.takes.list().length }
  })
  assert.equal(saved.takes, 1)
  assert.equal(saved.recipe.strokeInstruments[0], "violin")
  assert.ok(saved.recipe.picture.startsWith("data:image/"))
  await page.evaluate(() => {
    SoundDrawing.loadRecipe(Object.assign({}, checkRecipe, { duration: 3 }))
    SoundDrawing.setStep(3)
  })
  assert.equal(await page.locator("#melodyIntentInput").inputValue(), saved.recipe.melodyIntent)
  await page.evaluate(() => SoundDrawing.play())
  await page.waitForFunction(() => SoundDrawing.engine.isPlaying)
  await page.evaluate(() => SoundDrawing.pause())
  await page.waitForFunction(() => SoundDrawing.engine.isPaused)
  await page.evaluate(() => SoundDrawing.resume())
  await page.waitForFunction(() => !SoundDrawing.engine.isPaused)
  await page.evaluate(() => SoundDrawing.stop())
  assert.equal(await page.evaluate(() => SoundDrawing.engine.isPlaying), false)
  passed("upload, draw, undo, switch pitch axis, reflect, save, restore, play/pause/resume/stop")
  const exports = {}
  for (const [method, file] of [["exportDrawingImage", "drawing.png"], ["exportAudio", "music.webm"], ["exportDrawingVideo", "drawing.webm"]]) {
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 })
    const value = await page.evaluate(async (method) => {
      const result = await SoundDrawing[method]()
      return result && { size: result.size, type: result.type || result.mimeType }
    }, method)
    const download = await downloadPromise
    await download.saveAs(path.join(out, file))
    exports[method] = { ...value, bytes: fs.statSync(path.join(out, file)).size }
    assert.ok(exports[method].bytes > 1000)
  }
  passed("PNG, WebM audio and drawing video downloads", exports)
  await page.screenshot({ path: path.join(out, "studio-complete.png"), fullPage: true })
  await page.reload()
  await page.waitForFunction(() => window.SoundDrawing)
  const recovered = await page.evaluate(() => SoundDrawing.takes.list())
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0].recipe.melodyIntent, saved.recipe.melodyIntent)
  passed("saved work survives reload")
  return { page, recipe: Object.assign(saved.recipe, { duration: 3 }) }
}

async function galleryFlow(context, studio, recipe) {
  const published = await studio.evaluate(async (recipe) => {
    const store = HwaeumShareStore
    for (const channel of ["9071", "9072"]) await store.claimChannel({ channel, pin: "1234", displayName: "검증 갤러리 " + channel, adminPin: "8624" })
    const images = await store.createImageBlobs({ pictureSrc: recipe.picture })
    const music = await SoundDrawing.engine.renderCompressedAudioBlob(recipe, [])
    const published = await store.publishWork({ channel: "9071", pass: "1234", recipe, title: recipe.title, metadata: { composerName: recipe.composerName, backgroundReason: recipe.backgroundReason, melodyIntent: recipe.melodyIntent, hashtags: recipe.hashtags, coverHasEmbeddedPlay: false }, coverBlob: images.cover, thumbBlob: images.thumb, musicBlob: music })
    const locked = await store.listChannel("9071", "9999")
    if (!locked.locked || locked.works.length) throw Error("Wrong gallery code was accepted")
    const copy = await store.copyWork(published.work, { channel: "9072", pass: "1234", sourcePass: "1234" })
    store.rememberPass("9071", "1234")
    return { work: published.work, copiedId: copy.work.id }
  }, recipe)
  const page = await context.newPage()
  await page.goto(origin + "/channel.html?channel=9071")
  await page.locator(".channel-album").first().click()
  await page.waitForFunction(() => !document.getElementById("channelViewer").hidden)
  assert.equal(await page.locator("#viewerTitle").textContent(), recipe.title)
  assert.equal(await page.locator("#viewerAudio").evaluate((audio) => audio.paused), true)
  await page.locator("#viewerStage").hover()
  await page.locator("#viewerPlayBtn").click()
  await page.waitForFunction(() => !document.getElementById("viewerAudio").paused)
  await page.screenshot({ path: path.join(out, "gallery-viewer.png"), fullPage: true })
  const popupPromise = context.waitForEvent("page")
  await page.locator("#viewerDrawingBtn").click()
  const copyPage = await popupPromise
  await copyPage.waitForFunction(() => window.SoundDrawing && SoundDrawing.getStateSummary().noteCount > 0)
  assert.deepEqual(await copyPage.evaluate(() => SoundDrawing.buildRecipe().strokes), recipe.strokes)
  await copyPage.close()
  await page.locator("#viewerCloseBtn").click()
  assert.equal(await page.locator("#viewerAudio").evaluate((audio) => audio.paused), true)
  const deleted = await studio.evaluate(async ({ work }) => {
    await HwaeumShareStore.deleteWork(work, "8624")
    const first = await HwaeumShareStore.listChannel("9071", "1234")
    const copy = await HwaeumShareStore.listChannel("9072", "1234")
    const second = await HwaeumShareStore.deleteChannel("9072", "8624")
    await HwaeumShareStore.deleteChannel("9071", "8624")
    return { remaining: first.works.length, copied: copy.works.length, deleted: second.deletedWorks }
  }, published)
  assert.deepEqual(deleted, { remaining: 0, copied: 1, deleted: 1 })
  passed("native IndexedDB gallery create, lock, publish, copy, viewer playback, studio copy, delete")
  await page.close()
}

async function galleryRace(context) {
  const page = await context.newPage()
  await page.goto(origin + "/channel.html")
  await page.waitForFunction(() => window.HwaeumShareStore)
  await page.evaluate(() => {
    window.galleryRequests = []
    HwaeumShareStore.listChannel = (channel) => new Promise((resolve, reject) => galleryRequests.push({ channel, resolve, reject }))
  })
  async function submit(channel) {
    await page.evaluate((channel) => {
      document.getElementById("channelInput").value = channel
      document.getElementById("channelCodeInput").value = "1234"
      document.getElementById("channelOpenForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    }, channel)
  }
  for (const rejected of [false, true]) {
    await page.evaluate(() => { galleryRequests.length = 0 })
    await submit("9081"); await submit("9082")
    await page.evaluate(() => galleryRequests[1].resolve({ meta: { displayName: "마지막 선택" }, works: [] }))
    await page.waitForFunction(() => document.getElementById("channelTitle").textContent.includes("마지막 선택"))
    await page.evaluate((rejected) => {
      if (rejected) galleryRequests[0].reject(new Error("오래된 요청 실패"))
      else galleryRequests[0].resolve({ meta: { displayName: "오래된 선택" }, works: [] })
    }, rejected)
    assert.match(await page.locator("#channelTitle").textContent(), /마지막 선택/)
    assert.equal(await page.locator("#channelStatus").textContent(), "")
  }
  passed("late gallery success/failure cannot replace the latest selection")
  await page.close()
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] })
  try {
    const context = await makeContext(browser)
    const landing = await context.newPage()
    await landing.goto(origin + "/")
    assert.ok(await landing.locator('a[href*="studio.html"]').count())
    await landing.close()
    passed("landing page loads and links to studio")
    report.output = await compareOutput(context, "after")
    passed("all 13 instrument samples render non-silent PCM", report.output.audio.map(({ id, rms }) => ({ id, rms })))
    if (process.env.REFACTOR_BASELINE_DIR) {
      const before = await makeContext(browser, process.env.REFACTOR_BASELINE_DIR)
      report.baseline = await compareOutput(before, "before")
      assert.deepEqual(report.output, report.baseline, "Drawing pixels and audio PCM must match the pre-refactor snapshot")
      await before.close()
      passed("13 instruments' PCM and drawing pixels exactly match the baseline")
    }
    const { page, recipe } = await studioFlow(context)
    await galleryFlow(context, page, recipe)
    await galleryRace(context)
    assert.deepEqual(report.errors, [], "No browser runtime errors")
    passed("no browser runtime errors")
    await context.close()
  } catch (error) {
    report.failure = error.stack
    for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
      await page.screenshot({ path: path.join(out, "failure-" + index + ".png"), fullPage: true }).catch(() => {})
    }
    throw error
  } finally {
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(report, null, 2))
    await browser.close()
  }
})().catch((error) => { console.error(error); process.exitCode = 1 })
