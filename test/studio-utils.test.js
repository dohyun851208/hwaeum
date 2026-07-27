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

// 도화지는 2.5초마다 마디선과 시간 라벨을 찍는다. 배경 구간 길이가 2.5초 배수가 아니면
// 마지막이 토막 마디가 되고 끝 라벨이 앞 라벨과 겹친다 → 길이를 마디 단위로 붙인다.
test("studio utils snap background range length to whole 2.5s bars", () => {
  const snap = (value, max) => utils.snapDurationToSegments(value, 2.5, max)
  assert.equal(snap(15, 60), 15) // 이미 배수면 그대로
  assert.equal(snap(15.4, 60), 15) // 가까운 마디로 내림
  assert.equal(snap(14.6, 60), 15) // 가까운 마디로 올림
  assert.equal(snap(13.2, 60), 12.5)
  assert.equal(snap(3.4, 60), 2.5)
  assert.equal(snap(0.2, 60), 2.5) // 최소 한 마디
  // 배경 안에서만 잘라 쓴다 — 남은 길이를 넘겨선 안 된다.
  assert.equal(snap(30, 9), 7.5)
  assert.equal(snap(100, 15), 15)
  // 한 마디보다 짧은 배경은 있는 만큼 전부 쓴다.
  assert.equal(snap(5, 1.8), 1.8)
  // 값이 망가져도 최소 한 마디는 보장한다.
  assert.equal(snap("bad", 60), 2.5)
})

test("studio utils snapped lengths leave no stub bar and no colliding label", () => {
  const SEGMENT = 2.5
  for (const raw of [15, 15.4, 14.6, 13.2, 3.4, 29.9, 7.1]) {
    const duration = utils.snapDurationToSegments(raw, SEGMENT, 60)
    // 마지막 마디도 정확히 한 마디여야 한다.
    assert.equal(
      utils.round3(duration % SEGMENT),
      0,
      `${raw}초 -> ${duration}초 는 마디 배수가 아님`,
    )
    // studio.js 의 timelineLabelTimes 와 같은 규칙으로 라벨을 만든다.
    const times = []
    for (let t = SEGMENT; t < duration - 0.0001; t += SEGMENT) times.push(utils.round3(t))
    times.push(utils.round3(duration))
    for (let i = 1; i < times.length; i++) {
      assert.equal(
        utils.round3(times[i] - times[i - 1]),
        SEGMENT,
        `${duration}초 라벨 간격이 어긋남: ${times.join(", ")}`,
      )
    }
  }
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
