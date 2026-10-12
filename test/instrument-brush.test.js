const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadScripts(files) {
  const sandbox = {}
  sandbox.self = sandbox
  for (const file of files) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return sandbox
}

const { InstrumentBrush: Brush, SDStudioData: data } = loadScripts(["manifest.js", "instrument-brush.js"])
const instrumentIds = data.instruments.map((instrument) => instrument.id)
const styles = fs.readFileSync(path.join(projectDir, "styles.css"), "utf8")

// 브라우저의 XML 파서(DOMParser)가 받아들이도록 여닫는 태그 짝과 루트를 확인한다.
function assertWellFormedSvg(markup, label) {
  const stack = []
  let consumed = 0
  for (const match of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    assert.equal(markup.slice(consumed, match.index).trim(), "", label + ": text between tags")
    consumed = match.index + match[0].length
    const [, closing, name, , selfClosing] = match
    if (closing) assert.equal(stack.pop(), name, label + ": closing </" + name + ">")
    else if (!selfClosing) stack.push(name)
  }
  assert.equal(consumed, markup.length, label + ": every tag parsed")
  assert.deepEqual(stack, [], label + ": every tag closed")
  assert.match(markup, /^<svg viewBox="0 0 48 88" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, label + ": svg root")
}

test("every manifest instrument gets its own brush portrait", () => {
  const fallback = Brush.icon("unknown-instrument")
  const icons = instrumentIds.map((id) => Brush.icon(id))

  assert.deepEqual([...Brush.ids].sort(), [...instrumentIds].sort())
  icons.forEach((icon, i) => assert.notEqual(icon, fallback, instrumentIds[i] + " should not use the plain brush"))
  assert.equal(new Set(icons).size, icons.length, "no two instruments share one drawing")
  assert.match(fallback, /ib-brush-wood/)
})

test("brush portraits are well-formed SVG whose ids stay inside their instrument", () => {
  for (const id of instrumentIds.concat(["unknown-instrument"])) {
    const icon = Brush.icon(id)
    assertWellFormedSvg(icon, id)
    const ids = [...icon.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    const prefix = Brush.ids.includes(id) ? "ib-" + id + "-" : "ib-brush-"
    assert.ok(ids.length > 0, id + " defines its gradients")
    ids.forEach((defined) => assert.ok(defined.startsWith(prefix), id + " id " + defined))
    // 한 그림 안에서 정의하지 않은 그러데이션을 가리키지 않는다.
    for (const ref of icon.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref[1]), id + " references #" + ref[1])
  }
})

test("brush portraits show how each instrument is played while drawing", () => {
  const icon = (id) => Brush.icon(id)
  // 서양 현악기는 붓을 대는 동안에만 활이 나타나 줄을 긋는다.
  for (const id of ["violin", "viola", "cello", "doubleBass"]) {
    assert.match(icon(id), /<g class="ib-play"><g class="ib-bow">/, id + " bow appears while painting")
  }
  // 해금의 활은 두 줄 사이에 끼워져 늘 보이고, 그리는 동안 움직인다.
  assert.match(icon("haegeum"), /class="ib-bow"/)
  assert.doesNotMatch(icon("haegeum"), /class="ib-play"><g class="ib-bow"/)
  // 부는 악기는 취구·리드에서 숨결이 나간다.
  for (const id of ["flute", "oboe", "clarinet", "sogeum", "daegeum", "danso"]) {
    assert.equal((icon(id).match(/class="ib-play ib-puff"/g) || []).length, 3, id + " breath")
  }
  assert.match(icon("oboe"), /class="ib-reed"/)
  assert.match(icon("clarinet"), /class="ib-reed"/)
  assert.match(icon("daegeum"), /<g class="ib-shimmer">/, "대금 청이 떤다")
  assert.match(icon("gayageum"), /<g class="ib-shimmer">/, "가야금 열두 줄이 떤다")
  assert.equal((icon("gayageum").match(/ V 75/g) || []).length, 12, "가야금 열두 줄")
  assert.match(icon("frenchHorn"), /class="ib-play ib-pulse"/, "호른 나팔이 울린다")
  // 첼로·더블베이스는 엔드핀, 더블베이스는 금속 줄감개를 단다.
  assert.match(icon("cello"), /url\(#ib-cello-metal\)/)
  assert.match(icon("doubleBass"), /url\(#ib-doubleBass-brass\)/)
  assert.doesNotMatch(icon("violin"), /ib-violin-brass/)
})

test("wind instruments and the gayageum are held the way players hold them", () => {
  const angle = (id, state) => Brush.pose(id)[state][2]
  const turn = (deg, [x, y]) => {
    const t = (deg * Math.PI) / 180
    return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]
  }
  // 연주자는 붓 쪽(방금 그린 선 쪽)에 있고, 소리는 앞으로 그릴 쪽(바깥쪽)을 향한다.
  // 그림 위쪽(입 쪽)은 왼쪽으로, 아래쪽(나팔·끝)은 오른쪽으로 가도록 반시계로 돌리고,
  // 숨결(그림 속 오른쪽 방향)은 돌린 뒤 위쪽, 곧 선에서 멀어지는 쪽으로 흩어진다.
  for (const id of ["flute", "sogeum", "daegeum", "oboe", "clarinet", "danso", "frenchHorn"]) {
    for (const state of ["rest", "play"]) assert.ok(angle(id, state) < 0, id + " " + state + " turns counterclockwise")
    assert.ok(turn(angle(id, "play"), [0, 1])[0] > 0.6, id + " bell or far end faces ahead")
    assert.ok(turn(angle(id, "play"), [1, 0])[1] < -0.6, id + " breath drifts away from the line")
    assert.ok(Math.abs(angle(id, "play")) > Math.abs(angle(id, "rest")), id + " is raised to play")
    if (id !== "frenchHorn") assert.equal((Brush.icon(id).match(/ q 1\.6 -1\.3 3\.2 -\.2 t 3 \.1"/g) || []).length, 3, id + " breath goes out")
  }
  // 가로 피리는 연주하는 동안 수평이다. 소금·대금은 "늘 수평"(국립국악원 연주 자세)이다.
  for (const id of ["flute", "sogeum", "daegeum"]) assert.ok(Math.abs(angle(id, "play") + 90) <= 5, id + " is level while playing")
  assert.equal(angle("sogeum", "play"), -90)
  assert.equal(angle("daegeum", "play"), -90)
  // 리드 악기·단소는 40°, 호른은 거의 가로로 들어 나팔이 앞쪽으로 열린다.
  for (const id of ["oboe", "clarinet", "danso"]) assert.equal(angle(id, "play"), -40, id)
  assert.ok(angle("frenchHorn", "play") <= -75)
  // 가야금은 무릎에 눕혀 뜯는다(머리 쪽 현침이 오른쪽).
  assert.ok(angle("gayageum", "play") >= 80 && angle("gayageum", "play") <= 90)
  // 세워 드는 악기는 이전 자세를 그대로 쓰고, CSS 기본값과 같다.
  const upright = Brush.pose("violin")
  for (const id of ["viola", "cello", "doubleBass", "haegeum", "unknown-instrument"]) assert.equal(Brush.pose(id), upright, id)
  assert.match(styles, new RegExp("translate\\(var\\(--pose-x, " + upright.rest[0] + "px\\), var\\(--pose-y, " + upright.rest[1] + "px\\)\\) rotate\\(var\\(--pose-angle, " + upright.rest[2] + "deg\\)\\)"))
  assert.match(styles, new RegExp("translate\\(var\\(--pose-play-x, " + upright.play[0] + "px\\), var\\(--pose-play-y, " + upright.play[1] + "px\\)\\) rotate\\(var\\(--pose-play-angle, " + upright.play[2] + "deg\\)\\)"))
  assert.deepEqual({ ...Brush.poseStyle("daegeum") }, {
    "--pose-x": "50.1px",
    "--pose-y": "-15.5px",
    "--pose-angle": "-78deg",
    "--pose-play-x": "51px",
    "--pose-play-y": "-24px",
    "--pose-play-angle": "-90deg",
  })
})

test("each instrument motion has CSS, and reduced motion turns it off", () => {
  for (const name of ["ib-play", "ib-bow", "ib-puff", "ib-shimmer", "ib-reed", "ib-pulse"]) {
    assert.match(styles, new RegExp("\\.instrument-brush-cursor\\.is-painting \\." + name + "\\b"), name)
  }
  const reduced = styles.slice(styles.lastIndexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf(".instrument-brush-icon * {")))
  assert.match(reduced, /\.instrument-brush-icon \* \{ animation: none !important; \}/)
  assert.match(reduced, /\.instrument-brush-sparks \{ display: none; \}/)
})

test("brush traits follow how each instrument makes its sound", () => {
  const families = {
    bow: ["violin", "viola", "cello", "doubleBass", "haegeum"],
    breath: ["flute", "sogeum", "daegeum", "danso"],
    reed: ["oboe", "clarinet"],
    brass: ["frenchHorn"],
    pluck: ["gayageum"],
  }
  for (const [family, ids] of Object.entries(families)) {
    ids.forEach((id) => assert.equal(Brush.trait(id).family, family, id))
  }
  for (const id of instrumentIds) {
    const trait = Brush.trait(id)
    assert.match(styles, new RegExp("\\.instrument-brush-spark\\.is-" + trait.spark + "\\b"), id + " spark " + trait.spark)
    assert.match(trait.accent, /^#[0-9a-f]{6}$/)
    assert.ok(trait.every >= 40 && trait.life >= 600 && trait.life <= 1300, id + " stays light")
  }
  // 낮고 묵직한 더블베이스 물결과 애잔한 오보에 물방울은 가라앉고, 화려한 바이올린 별은 떠오른다.
  assert.ok(Brush.trait("doubleBass").rise[1] < 0)
  assert.ok(Brush.trait("oboe").rise[1] < 0)
  assert.ok(Brush.trait("violin").rise[0] > 0)
  assert.equal(Brush.trait("piri"), Brush.trait("violin"), "unknown instruments borrow a default character")
})

test("spark stays inside the trait ranges and mixes the accent every third time", () => {
  const trait = Brush.trait("clarinet")
  const low = Brush.spark(trait, 0, () => 0)
  const high = Brush.spark(trait, 1, () => 1)

  assert.equal(low.kind, "bubble")
  // trait 배열은 vm 쪽에서 만들어져 프로토타입이 다르므로 펼쳐서 비교한다.
  assert.deepEqual([low.size, high.size], [...trait.size])
  assert.deepEqual([low.x, high.x], [...trait.dx])
  assert.deepEqual([low.y, high.y], [-trait.rise[0], -trait.rise[1]], "rise is upward on screen")
  assert.equal(low.life, trait.life)
  assert.deepEqual([0, 1, 2, 3].map((i) => Brush.spark(trait, i, () => 0.5).accent), [true, false, false, true])
  assert.equal(typeof Brush.shouldSparkle(trait, { sinceLast: 1000, moved: 20, newNote: true }), "boolean")
})
