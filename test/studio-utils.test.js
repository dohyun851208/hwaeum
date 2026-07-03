const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const utils = require("../js/studio-utils.js")

const projectDir = path.resolve(__dirname, "..")

test("studio utils normalize duration and labels deterministically", () => {
  assert.equal(utils.normalizeDuration("12.3456", { min: 1, fallback: 30 }), 12.346)
  assert.equal(utils.normalizeDuration("bad", { min: 1, fallback: 30 }), 30)
  assert.equal(utils.normalizeDuration("-4", { min: 1, fallback: 30 }), 1)
  assert.equal(utils.secondsLabel(2), "2\uCD08")
  assert.equal(utils.secondsLabel(2.25), "2.3\uCD08")
})

test("studio utils sanitize share metadata without losing Korean tags", () => {
  assert.equal(utils.cleanText("  봄\t  음악\n", 20), "봄 음악")
  // 태그는 쉼표로만 나뉜다 — "감정적인 노래"처럼 띄어쓰기가 든 말도 태그 1개.
  assert.deepEqual(utils.normalizeHashtags("#봄, BGM!, 감정적인 노래, 넷째"), ["봄", "BGM", "감정적인 노래"])
  assert.deepEqual(utils.normalizeHashtags("봄, 봄, 여름"), ["봄", "여름"])
  assert.deepEqual(utils.normalizeHashtags(["봄", "BGM", "긴장-장면"]), ["봄", "BGM", "긴장-장면"])
  assert.equal(utils.hashtagText(["봄", "BGM", "감정적인 노래"]), "#봄 #BGM #감정적인 노래")
  assert.equal(utils.keywordText(["봄", "BGM", "감정적인 노래"]), "봄, BGM, 감정적인 노래")
  assert.equal(utils.normalizePictureData("javascript:alert(1)"), "")
  assert.equal(utils.normalizePictureData("data:image/png;base64,abc"), "data:image/png;base64,abc")
})

test("studio utils simplify drawings and stamps for recipes", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.11119 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.75 },
    { x: 1, y: 1 },
  ]

  assert.deepEqual(utils.simplifyPoints(points, 2), [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ])
  assert.deepEqual(utils.simplifyStrokes([[], points]).length, 1)
  assert.deepEqual(
    utils.simplifyEffectStamps(
      [
        { id: "bell", x: -0.2, y: 2 },
        { id: "missing", x: 0.5, y: 0.5 },
        { id: "harp" },
      ],
      { bell: {}, harp: {} }
    ),
    [
      { id: "bell", x: 0, y: 1 },
      { id: "harp", x: 0, y: 0.5 },
    ]
  )
})

test("studio utils color conversion keeps current rgba format", () => {
  assert.equal(utils.hexToRgba("#5f8f63", 0.14), "rgba(95,143,99,0.14)")
  assert.equal(utils.hexToRgba("not-a-color", 0.14), "not-a-color")
})

test("studio html loads studio-utils before studio", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  const utilsAt = html.indexOf("./js/studio-utils.js")
  const studioAt = html.indexOf("./js/studio.js")
  assert.notEqual(utilsAt, -1)
  assert.notEqual(studioAt, -1)
  assert.ok(utilsAt < studioAt)
})
