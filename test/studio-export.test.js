const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function createExportHarness(options) {
  options = options || {}
  const calls = {
    canvasBlobTypes: [],
    downloads: [],
    engineExports: [],
    operations: [],
    renderCount: 0,
    revokedUrls: [],
    stoppedTracks: 0,
  }

  function createContext() {
    const ctx = {}
    const methods = [
      "arc",
      "arcTo",
      "beginPath",
      "clearRect",
      "closePath",
      "drawImage",
      "fill",
      "fillRect",
      "fillText",
      "lineTo",
      "moveTo",
      "restore",
      "rotate",
      "save",
      "stroke",
      "translate",
    ]
    methods.forEach((name) => {
      ctx[name] = (...args) => calls.operations.push({ name, args })
    })
    ctx.measureText = (value) => ({ width: String(value || "").length * 10 })
    return ctx
  }

  function createCanvas() {
    const canvas = {
      width: 640,
      height: 360,
      getContext() {
        if (!this._context) this._context = createContext()
        return this._context
      },
      toBlob(callback, type) {
        calls.canvasBlobTypes.push(type)
        callback(new Blob(["canvas"], { type: type || "image/png" }))
      },
    }
    if (options.captureStream) {
      canvas.captureStream = () => ({
        getTracks: () => [
          {
            stop() {
              calls.stoppedTracks += 1
            },
          },
        ],
      })
    }
    return canvas
  }

  const document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tagName) {
      if (tagName === "canvas") return createCanvas()
      if (tagName === "a") {
        return {
          click() {
            calls.downloads.push({ filename: this.download, href: this.href })
          },
        }
      }
      return {}
    },
  }

  class FakeImage {
    constructor() {
      this.width = 1200
      this.height = 800
      this.complete = false
    }

    set src(value) {
      this._src = value
      if (options.imageError) {
        if (this.onerror) this.onerror(new Error("image failed"))
      } else if (this.onload) {
        this.complete = true
        this.onload()
      }
    }

    get src() {
      return this._src
    }
  }

  class FakeMediaRecorder {
    constructor(stream, config) {
      this.stream = stream
      this.config = config
      this.state = "inactive"
    }

    start() {
      this.state = "recording"
    }

    stop() {
      this.state = "inactive"
      this.ondataavailable({ data: new Blob(["video"], { type: this.config.mimeType }) })
      this.onstop()
    }

    static isTypeSupported(type) {
      return type.indexOf("video/webm") === 0
    }
  }

  const fakeUrl = {
    createObjectURL() {
      return "blob:test-" + (calls.downloads.length + 1)
    },
    revokeObjectURL(url) {
      calls.revokedUrls.push(url)
    },
  }
  const requestAnimationFrame = (callback) => {
    callback(1000)
    return 1
  }
  const window = {
    document,
    MediaRecorder: options.mediaRecorder ? FakeMediaRecorder : undefined,
  }
  const sandbox = {
    window,
    document,
    Image: FakeImage,
    URL: fakeUrl,
    Blob,
    console,
    performance: { now: () => 0 },
    requestAnimationFrame,
    cancelAnimationFrame() {},
    setTimeout(callback) {
      callback()
      return 1
    },
  }
  const source = fs.readFileSync(path.join(projectDir, "js", "studio-export.js"), "utf8")
  vm.runInNewContext(source, sandbox, { filename: "studio-export.js" })

  const state = {
    title: "봄 노래",
    atmosphere: { label: "고요한" },
    duration: 1,
    effectStamps: [],
    hashtags: ["봄"],
    pic: "data:image/png;base64,dGVzdA==",
  }
  const recipe = { duration: 1, strokes: [[{ x: 0, y: 0.5 }]] }
  const notes = [{ time: 0, duration: 1 }]
  const el = {
    canvas: createCanvas(),
    frameCanvas: createCanvas(),
    exportStatus: { textContent: "" },
  }
  const engine = {
    async exportCompressedAudio(receivedRecipe, receivedNotes, filename) {
      calls.engineExports.push({ recipe: receivedRecipe, notes: receivedNotes, filename })
      return { size: 2048, mimeType: "audio/webm" }
    },
  }
  const api = window.HwaeumStudioExport({
    state,
    el,
    D: { effects: {} },
    draw: {
      render() {
        calls.renderCount += 1
      },
      _timelineLeft() {
        return 0
      },
    },
    engine,
    StudioUtils: {
      clampUnit(value) {
        return Math.max(0, Math.min(1, Number(value) || 0))
      },
      secondsLabel(value) {
        return value + "초"
      },
    },
    timelineLabelTimes() {
      return []
    },
    getDuration() {
      return state.duration
    },
    buildRecipe() {
      return recipe
    },
    notesFor() {
      return notes
    },
    requireDrawn() {
      return options.drawn !== false
    },
    drawProceduralFrameFallback() {},
    defaultCoverSrc: "./assets/default-cover.webp",
    hashtagText(value) {
      return value.length ? "#" + value.join(" #") : ""
    },
  })

  return { api, calls, el, notes, recipe }
}

test("export factory exposes the four studio workflows", () => {
  const { api } = createExportHarness()

  for (const name of ["exportAudio", "exportCover", "exportDrawingImage", "exportDrawingVideo"]) {
    assert.equal(typeof api[name], "function", name)
  }
})

test("audio export sends the current recipe and notes to a WebM download", async () => {
  const { api, calls, el, notes, recipe } = createExportHarness()

  const result = await api.exportAudio()

  assert.deepEqual(calls.engineExports, [{ recipe, notes, filename: "봄 노래_고요한_music.webm" }])
  assert.equal(result.size, 2048)
  assert.equal(el.exportStatus.textContent, "음악 저장 완료 (2 KB, WebM)")
})

test("cover export downloads a PNG without drawing a play glyph", () => {
  const { api, calls, el } = createExportHarness()

  api.exportCover()

  assert.deepEqual(calls.downloads, [{ filename: "봄 노래_고요한_cover.png", href: "blob:test-1" }])
  assert.equal(calls.canvasBlobTypes.at(-1), "image/png")
  assert.equal(el.exportStatus.textContent, "커버 이미지를 내보냈어요.")
  assert.equal(calls.operations.some((operation) => operation.name === "arc" || operation.name === "lineTo"), false)
})

test("drawing image export renders the drawing and downloads a PNG blob", async () => {
  const { api, calls, el } = createExportHarness()

  const blob = await api.exportDrawingImage()

  assert.equal(calls.renderCount, 1)
  assert.equal(blob.type, "image/png")
  assert.deepEqual(calls.downloads, [{ filename: "봄 노래_고요한_drawing.png", href: "blob:test-1" }])
  assert.equal(el.exportStatus.textContent, "드로잉 이미지를 저장했어요.")
})

test("drawing video export reports unsupported browsers without starting a recorder", async () => {
  const { api, calls, el } = createExportHarness()

  const result = await api.exportDrawingVideo()

  assert.equal(result, undefined)
  assert.equal(calls.downloads.length, 0)
  assert.match(el.exportStatus.textContent, /드로잉 영상 저장을 지원하지 않아요/)
})

test("drawing video export records, downloads, and closes its capture track", async () => {
  const { api, calls, el } = createExportHarness({ captureStream: true, mediaRecorder: true })

  const blob = await api.exportDrawingVideo()

  assert.equal(blob.type, "video/webm;codecs=vp9")
  assert.deepEqual(calls.downloads, [{ filename: "봄 노래_고요한_drawing.webm", href: "blob:test-1" }])
  assert.equal(calls.stoppedTracks, 1)
  assert.equal(el.exportStatus.textContent, "드로잉 영상을 저장했어요. 소리는 음악 저장(WebM)으로 따로 저장할 수 있어요.")
})
