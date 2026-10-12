// 음원을 못 받았을 때 나는 합성 선율이 실제 음원과 같은 크기인지 잰다.
//   node tools/measure-synth-fallback.cjs          # 악기별 차이와 SYNTH_MELODY_TRIM_DB 추천값
//   node tools/measure-synth-fallback.cjs --check  # 평균 차이가 1.5 dB를 넘으면 실패(종료 코드 1)
//
// 합성음은 Web Audio로 렌더해야 들리는 소리가 나오므로 설치된 Chrome(헤드리스)을 쓴다(CHROME_PATH로 바꿀 수 있다).
// 같은 선율을 낮은·가운데·높은 음역에서 각각 실제 음원과 합성음(음원 읽기를 막은 엔진)으로 오프라인 렌더하고,
// 소리가 나는 구간의 RMS를 견준다. js/audio-engine.js 의 INSTRUMENT_MELODY_OUTPUT_GAINS 를 바꾼 뒤 다시 잰다.
"use strict"

const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const ROOT = path.join(__dirname, "..")
const CHECK_LIMIT_DB = 1.5
const MELODIES = {
  낮은: [{ x: 0.05, y: 0.85 }, { x: 0.3, y: 0.75 }, { x: 0.6, y: 0.9 }, { x: 0.9, y: 0.8 }],
  가운데: [{ x: 0.05, y: 0.55 }, { x: 0.25, y: 0.45 }, { x: 0.45, y: 0.6 }, { x: 0.7, y: 0.4 }, { x: 0.92, y: 0.5 }],
  높은: [{ x: 0.05, y: 0.15 }, { x: 0.3, y: 0.25 }, { x: 0.6, y: 0.1 }, { x: 0.9, y: 0.2 }],
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".mp3": "audio/mpeg", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean)
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error("Chrome을 찾지 못했어요. CHROME_PATH로 실행 파일 위치를 알려 주세요.")
  return found
}

// js/audio-engine.js 의 SYNTH_MELODY_TRIM_DB 표를 읽는다(코드 실행 없이 "이름: 숫자"만 뽑는다).
function currentTrims() {
  const source = fs.readFileSync(path.join(ROOT, "js", "audio-engine.js"), "utf8")
  const match = source.match(/const SYNTH_MELODY_TRIM_DB = \{([\s\S]*?)\n  \}/)
  if (!match) throw new Error("SYNTH_MELODY_TRIM_DB not found")
  const trims = {}
  for (const entry of match[1].matchAll(/(\w+):\s*(-?\d+(?:\.\d+)?)/g)) trims[entry[1]] = Number(entry[2])
  return trims
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
    const file = path.join(ROOT, urlPath === "/" ? "studio.html" : urlPath)
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404
      res.end("not found")
      return
    }
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream")
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)))
}

async function openPage(port, profileDir) {
  const chrome = spawn(chromePath(), [
    "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + profileDir,
    "--no-first-run", "--no-default-browser-check", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank",
  ], { stdio: "ignore" })
  let page = null
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json()
      page = targets.find((target) => target.type === "page") || null
    } catch (error) {}
    if (!page) await sleep(150)
  }
  if (!page) {
    chrome.kill()
    throw new Error("Chrome 디버깅 연결을 열지 못했어요.")
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  let seq = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (message) => (message.error ? reject(new Error(method + ": " + message.error.message)) : resolve(message.result)))
      ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception && result.exceptionDetails.exception.description) || result.exceptionDetails.text)
    return result.result.value
  }
  const close = () => {
    try { ws.close() } catch (error) {}
    try { chrome.kill() } catch (error) {}
  }
  return { send, evaluate, close }
}

// 브라우저 안에서 돌릴 측정 코드(Runtime.evaluate로 보낸다).
function measureExpression(melodies) {
  return `(async () => {
    const D = window.SDStudioData
    const model = window.HwaeumStudioRecipe({ core: window.MusicCore, data: D, audioPlan: window.SDAudioPlan, utils: window.HwaeumStudioUtils })
    const melodies = ${JSON.stringify(melodies)}
    function activeRmsDb(buffer) {
      const data = buffer.getChannelData(0)
      let sum = 0, count = 0
      for (let i = 0; i < data.length; i++) { const v = data[i]; if (Math.abs(v) > 1e-4) { sum += v * v; count++ } }
      return 20 * Math.log10(Math.max(1e-9, Math.sqrt(sum / Math.max(1, count))))
    }
    const rows = []
    for (const inst of D.instruments) {
      const gugak = inst.group === "국악"
      const diffs = {}
      for (const name of Object.keys(melodies)) {
        const recipe = { duration: 8, atmosphere: "none", instrument: inst.id, style: gugak ? "gugak" : "bright", version: "balanced", mode: "melody", strokes: [melodies[name]], strokeInstruments: [inst.id] }
        const notes = model.notesFor(recipe)
        const real = activeRmsDb(await new window.AudioEngine().renderOffline(recipe, notes))
        const synthEngine = new window.AudioEngine()
        synthEngine.loadBuffer = async () => null
        synthEngine.loadAssetBuffer = async () => null
        const synth = activeRmsDb(await synthEngine.renderOffline(recipe, notes))
        diffs[name] = synth - real
      }
      rows.push({ id: inst.id, diffs })
    }
    return rows
  })()`
}

async function main() {
  const check = process.argv.includes("--check")
  const server = await startServer()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwaeum-synth-"))
  const page = await openPage(9200 + Math.floor(Math.random() * 600), profileDir)
  let failed = false
  try {
    await page.send("Page.enable")
    await page.send("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/studio.html" })
    for (let i = 0; i < 60; i++) {
      if (await page.evaluate("!!(window.AudioEngine && window.SDStudioData && window.HwaeumStudioRecipe)").catch(() => false)) break
      await sleep(200)
    }
    const rows = await page.evaluate(measureExpression(MELODIES))
    const trims = currentTrims()
    console.log("악기         평균차이   낮은   가운데   높은   지금보정  추천보정 (dB, 합성음 − 실제 음원)")
    for (const row of rows) {
      const values = Object.values(row.diffs)
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const now = Number(trims[row.id]) || 0
      if (Math.abs(mean) > CHECK_LIMIT_DB) failed = true
      console.log(
        row.id.padEnd(12),
        mean.toFixed(1).padStart(7),
        ...values.map((value) => value.toFixed(1).padStart(7)),
        now.toFixed(1).padStart(9),
        (now - mean).toFixed(1).padStart(9),
      )
    }
    if (check) console.log(failed ? "평균 차이가 " + CHECK_LIMIT_DB + " dB를 넘는 악기가 있어요." : "모든 악기가 " + CHECK_LIMIT_DB + " dB 안이에요.")
  } finally {
    page.close()
    server.close()
    await sleep(300)
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch (error) {}
  }
  if (check && failed) process.exit(1)
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error)
  process.exit(1)
})
