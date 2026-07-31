const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const projectDir = path.resolve(__dirname, "..")

function read(...parts) {
  return fs.readFileSync(path.join(projectDir, ...parts), "utf8")
}

test("1단계 그림 감상 칸이 있고 4단계 칸과 같은 생각을 나눠 쓴다", () => {
  const html = read("studio.html")
  assert.match(html, /id="pictureThoughtInput"/)
  assert.match(html, /id="pictureThoughtCompletionInput"/)
  // 두 칸의 라벨은 같은 문구여야 학생이 "같은 칸"으로 읽는다.
  const labels = html.match(/그림을 보고 떠오르는 생각/g) || []
  assert.equal(labels.length, 2, "1단계와 4단계에 같은 라벨이 하나씩")

  const studio = read("js", "studio.js")
  assert.match(studio, /pictureThought: cleanText\(state\.pictureThought, 180\)/, "레시피에 저장")
  assert.match(studio, /state\.pictureThought = recipe\.pictureThought \|\| ""/, "레시피에서 복원")
})

test("2단계 배경 카드마다 감상 노트를 붙인다", () => {
  const render = read("js", "studio-setup-render.js")
  assert.match(render, /function buildAtmosphereNote\(a\)/)
  assert.match(render, /state\.backgroundNotes\[a\.id\] = field\.value/)
  assert.match(render, /class="atmosphere-card-slot"|atmosphere-card-slot/)
  // 카드를 누를 때마다 그리드를 다시 그리므로 커서 보존이 없으면 타이핑 중 글자가 튄다.
  assert.match(render, /captureAtmosphereNoteFocus\(\)/)
  assert.match(render, /restoreAtmosphereNoteFocus\(noteFocus\)/)
})

test("고른 배경·악기 메모만 4단계로 옮기고 학생이 고친 칸은 덮지 않는다", () => {
  const studio = read("js", "studio.js")
  const start = studio.indexOf("function syncReflectionFromNotes()")
  assert.ok(start > -1, "syncReflectionFromNotes 가 있어야 함")
  const body = studio.slice(start, studio.indexOf("function syncReflectionInputs()"))

  // 여러 카드에 적어도 지금 고른 것 하나만 넘어간다.
  assert.match(body, /state\.backgroundNotes\[state\.atmosphere && state\.atmosphere\.id\]/)
  assert.match(body, /state\.instrumentNotes\[state\.instrument && state\.instrument\.id\]/)
  // 학생이 4단계에서 손댄 칸은 건너뛴다.
  assert.match(body, /if \(state\.reflectionEdited\[item\.key\]\) return/)

  // 손댄 사실은 입력 순간에 기록한다.
  assert.match(studio, /state\.reflectionEdited\.backgroundReason = true/)
  assert.match(studio, /state\.reflectionEdited\.melodyIntent = true/)
})

test("새 감상 칸은 화음 갤러리 공유 필수 항목이 아니다", () => {
  const share = read("js", "studio-share.js")
  const start = share.indexOf("function publishTake(t)")
  const body = share.slice(start, share.indexOf("if (missing.length > 0)", start))
  // 기존 5개 그대로 — 새 칸을 필수로 만들지 않는다.
  assert.match(body, /label: "제목"/)
  assert.match(body, /label: "작곡가"/)
  assert.match(body, /label: "배경음악을 고른 이유"/)
  assert.match(body, /label: "선율을 표현한 의도"/)
  assert.match(body, /label: "작품을 잘 나타내는 단어"/)
  assert.doesNotMatch(body, /pictureThought/, "그림 감상은 필수가 아님")
  assert.equal((body.match(/missing\.push/g) || []).length, 5, "필수 항목은 5개 그대로")
})

test("4단계는 좌(표지·듣기) 중(설명) 우(내 작품) 세 칸이다", () => {
  const html = read("studio.html")
  const preview = html.indexOf("completion-preview-column")
  const detail = html.indexOf("completion-detail-panel")
  const works = html.indexOf("completion-work-list")
  assert.ok(preview > -1 && detail > -1 && works > -1)
  assert.ok(preview < detail, "표지·듣기 칸이 가장 왼쪽")
  assert.ok(detail < works, "내 작품 목록이 가장 오른쪽")

  const css = read("styles.css")
  assert.match(css, /grid-template-columns: minmax\(260px, 0\.78fr\) minmax\(460px, 1\.34fr\) minmax\(300px, 0\.88fr\)/)
  // 표지 미리보기는 예전에 display:none 이라 아예 안 보였다.
  assert.doesNotMatch(css, /\.completion-current-preview \{\s*display: none;/)
})

test("1단계 그림 액자는 명화 비율(4:3)을 쓴다", () => {
  const css = read("styles.css")
  const start = css.indexOf(".setup-grid.picture-only .dropframe {")
  const body = css.slice(start, css.indexOf("}", start))
  assert.match(body, /aspect-ratio: 4 \/ 3/)
  // 예전엔 width:100% + 고정 height 가 aspect-ratio 를 눌러 납작한 상자가 됐다.
  // 높이로 크기를 정하고 너비가 따라와야 비율이 산다(max-width 는 넘침 방지라 그대로 둔다).
  assert.doesNotMatch(body, /^\s*width: 100%/m)
  assert.match(body, /^\s*width: auto/m)
})

test("관리자 번호는 관리자 공통 코드로 부른다", () => {
  const files = [
    ["studio.html"],
    ["channel.html"],
    ["js", "studio.js"],
    ["js", "studio-takes-ui.js"],
    ["js", "studio-share.js"],
    ["js", "channel.js"],
    ["js", "share-store.js"],
    ["api", "share", "channel-claim.js"],
    ["api", "share", "channel-delete.js"],
    ["api", "share", "delete.js"],
  ]
  for (const parts of files) {
    const text = read(...parts)
    assert.doesNotMatch(text, /관리자 번호/, parts.join("/") + " 에 옛 명칭이 남음")
  }
})
