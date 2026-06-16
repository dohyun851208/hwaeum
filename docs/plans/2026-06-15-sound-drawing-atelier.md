# 그림 BGM 만들기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 그림→30초 BGM 교실용 웹앱을 갤러리·아틀리에 톤으로 재설계하고, 그림 우선 흐름·시도 저장·시김새·WAV+커버 내보내기를 갖춘 단일 정적 앱으로 완성한다.

**Architecture:** 빌드/프레임워크 없는 정적 앱. 순수 음악/인코딩 로직(`music-core.js`)은 브라우저 전역 + Node 모듈 이중 export로 `node --test` 단위 테스트. 데이터(`manifest.js`), 오디오 그래프(`audio-engine.js`), 캔버스(`drawing.js`), 테이크 저장(`takes.js`), 위저드 오케스트레이션(`studio.js`)으로 책임 분리. UI/오디오는 로컬 서버 + 브라우저로 검증.

**Tech Stack:** Vanilla JS(ES5+/클래식 스크립트, 순서 로드), Web Audio API, Canvas 2D, OfflineAudioContext, localStorage, `node --test`(순수 로직).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `index.html` | 갤러리 톤 5단계 위저드 마크업. `js/*` 순서 로드. |
| `styles.css` | 아틀리에 디자인 시스템 + 분위기 무드 틴팅(CSS 변수). 대폭 재작성. |
| `js/music-core.js` | **순수 함수**(이중 export): 음계·피치 보정·시간 재샘플링(속도 무관)·4/4 리듬 자동완성·시김새 파라미터·레시피 인코딩/디코딩·WAV 인코딩. |
| `js/manifest.js` | 데이터: backgrounds/pads(종류별)/melodies/effects, atmospheres(장면→패드종류+효과+색), instruments, styles, versions. |
| `js/audio-engine.js` | Web Audio 그래프(라이브+오프라인), 피치 시프트, phrase 모드, 시김새 적용, 합성 폴백, WAV 렌더. |
| `js/drawing.js` | 캔버스 드로잉, 가이드/팔레트 렌더, 원본 선+보정 음 오버레이, 음표 산출. |
| `js/takes.js` | 테이크(레시피) localStorage 저장/목록/삭제, 썸네일 렌더. |
| `js/studio.js` | 위저드 흐름·상태·UI 렌더·업로드·무드 틴팅·내보내기·공유 링크 연결. |
| `test/music-core.test.js` | 순수 로직 `node --test`. |
| `README.md` | 실행·구조·확인 지점 갱신. |

기존 `app.js`의 검증된 매핑/오디오 로직은 위 파일들로 분해·이식하고 `app.js`는 제거한다.

---

## Task 1: music-core 음계·피치·시간 재샘플링 (순수 + 테스트)

**Files:**
- Create: `js/music-core.js`
- Test: `test/music-core.test.js`

- [ ] **Step 1: 실패 테스트 작성** — `test/music-core.test.js`

```js
const test = require("node:test")
const assert = require("node:assert")
const core = require("../js/music-core.js")

const C_MAJOR = { root: 60, intervals: [0, 2, 4, 5, 7, 9, 11] }

test("buildScale: 범위 내 오름차순 음만 생성", () => {
  const scale = core.buildScale(C_MAJOR)
  assert.ok(scale.length > 0)
  assert.deepStrictEqual(scale, [...scale].sort((a, b) => a - b))
  assert.ok(scale.every((m) => m >= 48 && m <= 84))
})

test("quantizePitch: 정규화 y를 음계음으로 스냅(위=높은음)", () => {
  const top = core.quantizePitch(0, C_MAJOR)
  const bottom = core.quantizePitch(1, C_MAJOR)
  assert.ok(top > bottom)
  assert.ok(core.buildScale(C_MAJOR).includes(top))
})

test("resampleByTime: 그리는 속도와 무관 — 점 밀도가 달라도 같은 결과", () => {
  // 같은 모양(왼→오 직선 하강), 점 개수만 다름
  const sparse = [ {x:0,y:0}, {x:1,y:1} ]
  const dense = [ {x:0,y:0},{x:0.1,y:0.1},{x:0.5,y:0.5},{x:0.9,y:0.9},{x:1,y:1} ]
  const a = core.resampleByTime(sparse, 8)
  const b = core.resampleByTime(dense, 8)
  assert.strictEqual(a.length, b.length)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i].y - b[i].y) < 1e-6)
})
```

- [ ] **Step 2: 실패 확인** — Run: `node --test`  Expected: FAIL ("Cannot find module ../js/music-core.js")

- [ ] **Step 3: 최소 구현** — `js/music-core.js` (이중 export 골격 + 함수)

```js
;(function (root, factory) {
  const api = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = api
  else root.MusicCore = api
})(typeof self !== "undefined" ? self : this, function () {
  function buildScale(style, lo = 48, hi = 84) {
    const out = []
    for (let oct = -2; oct <= 3; oct++)
      for (const iv of style.intervals) out.push(style.root + iv + oct * 12)
    return out.filter((m) => m >= lo && m <= hi).sort((a, b) => a - b)
  }
  function quantizePitch(normY, style) {
    const scale = buildScale(style)
    const idx = Math.round((1 - normY) * (scale.length - 1))
    return scale[Math.max(0, Math.min(scale.length - 1, idx))]
  }
  // 속도 무관: x를 0..1로 정규화한 polyline을 균등 시간 격자에서 보간
  function resampleByTime(points, steps) {
    const pts = [...points].sort((a, b) => a.x - b.x)
    const minX = pts[0].x, maxX = pts[pts.length - 1].x
    const span = maxX - minX || 1
    const norm = pts.map((p) => ({ x: (p.x - minX) / span, y: p.y }))
    const out = []
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1)
      out.push({ t, y: interpY(norm, t) })
    }
    return out
  }
  function interpY(norm, t) {
    if (t <= norm[0].x) return norm[0].y
    if (t >= norm[norm.length - 1].x) return norm[norm.length - 1].y
    for (let i = 1; i < norm.length; i++) {
      if (t <= norm[i].x) {
        const a = norm[i - 1], b = norm[i]
        const r = (t - a.x) / (b.x - a.x || 1)
        return a.y + (b.y - a.y) * r
      }
    }
    return norm[norm.length - 1].y
  }
  return { buildScale, quantizePitch, resampleByTime, interpY }
})
```

- [ ] **Step 4: 통과 확인** — Run: `node --test`  Expected: PASS (3 tests)

- [ ] **Step 5: 커밋 생략(이 폴더는 OMC 저장소 내 untracked). 변경만 유지.**

---

## Task 2: 4/4 리듬 자동완성 + 시김새 파라미터 (순수 + 테스트)

**Files:**
- Modify: `js/music-core.js`
- Test: `test/music-core.test.js`

- [ ] **Step 1: 실패 테스트 추가**

```js
test("autocompleteMelody: 박자 격자에 음 생성, 모든 음은 음계 내", () => {
  const path = [ {x:0,y:0.6},{x:0.5,y:0.3},{x:1,y:0.5} ]
  const notes = core.autocompleteMelody(path, { durationSec: 30, style: C_MAJOR })
  assert.ok(notes.length > 0)
  const scale = core.buildScale(C_MAJOR)
  assert.ok(notes.every((n) => scale.includes(n.midi)))
  assert.ok(notes.every((n) => n.time >= 0 && n.time < 30))
})

test("autocompleteRhythm: 온셋이 4/4 8분음표 격자에 정렬", () => {
  const path = [ {x:0,y:0.2},{x:0.5,y:0.9},{x:1,y:0.3} ]
  const hits = core.autocompleteRhythm(path, { durationSec: 8, bpm: 100 })
  const step = 60 / 100 / 2 // 8분음표 초
  assert.ok(hits.length > 0)
  assert.ok(hits.every((h) => Math.abs(Math.round(h.time / step) * step - h.time) < 1e-6))
})

test("sigimsaeFor: 국악풍은 장식, 그 외는 빈 배열", () => {
  const orn = core.sigimsaeFor({ gugak: true, durationBeats: 1 })
  assert.ok(orn.length > 0)
  assert.deepStrictEqual(core.sigimsaeFor({ gugak: false, durationBeats: 1 }), [])
})
```

- [ ] **Step 2: 실패 확인** — Run: `node --test`  Expected: FAIL (함수 미정의)

- [ ] **Step 3: 구현** — `autocompleteMelody`, `autocompleteRhythm`, `sigimsaeFor`를 music-core에 추가하고 export.
  - `autocompleteMelody`: `resampleByTime(path, durationSec*2)`(8분음표) → 각 스텝 y를 `quantizePitch` → `{time, duration, midi, velocity}`. 큰 도약(>9반음) 완화, 희박 구간 쉼표.
  - `autocompleteRhythm`: 격자 스텝마다 y 기반 세기, 임계 초과 시 온셋. `time = step*i`.
  - `sigimsaeFor({gugak,durationBeats})`: gugak이면 꺾음(onset 짧은 상승→하강), 흘러내림(tail 하강), 떠는음(긴 음 비브라토) 세그먼트 배열 반환; 아니면 `[]`.

- [ ] **Step 4: 통과 확인** — Run: `node --test`  Expected: PASS

---

## Task 3: 레시피 코덱 + WAV 인코더 (순수 + 테스트)

**Files:**
- Modify: `js/music-core.js`
- Test: `test/music-core.test.js`

- [ ] **Step 1: 실패 테스트 추가**

```js
test("encodeRecipe/decodeRecipe 왕복", () => {
  const r = { duration: 30, atmosphere: "fog", instrument: "daegeum", style: "gugak", mode: "melody", path: [{x:0,y:0.5},{x:1,y:0.2}] }
  const s = core.encodeRecipe(r)
  assert.strictEqual(typeof s, "string")
  assert.deepStrictEqual(core.decodeRecipe(s), r)
})

test("encodeWav: 유효한 RIFF/WAVE 헤더", () => {
  const fake = { numberOfChannels: 1, sampleRate: 44100, length: 100, getChannelData: () => new Float32Array(100) }
  const buf = Buffer.from(core.encodeWav(fake))
  assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF")
  assert.strictEqual(buf.toString("ascii", 8, 12), "WAVE")
  assert.strictEqual(buf.readUInt32LE(24), 44100) // sampleRate
})
```

- [ ] **Step 2: 실패 확인** — Run: `node --test`  Expected: FAIL

- [ ] **Step 3: 구현** — `encodeRecipe`(JSON→base64url), `decodeRecipe`, `encodeWav(audioBuffer)→ArrayBuffer`(16-bit PCM, 채널 인터리브). base64는 브라우저 `btoa`/Node `Buffer` 양쪽 처리.

- [ ] **Step 4: 통과 확인** — Run: `node --test`  Expected: PASS (전체 통과)

---

## Task 4: manifest.js 데이터 모듈

**Files:**
- Create: `js/manifest.js`

- [ ] **Step 1:** 기존 `app.js`의 `audioLibrary`(backgrounds/melodies/effects), `atmospheres`, `instruments`, `styles`, `versions`를 이식.
- [ ] **Step 2:** 추가: `pads`(ambient/string/drone/choir/synth 종류별, 현재는 src=null 스탠드인+합성 폴백), `atmospheres[].padType`로 장면→패드종류 매핑, `atmospheres[].color` 무드색 유지.
- [ ] **Step 3:** 전역 `window.SDStudioData = { backgrounds, pads, melodies, effects, atmospheres, instruments, styles, versions }`로 노출.
- [ ] **Step 4: 검증** — 로컬 서버 후 콘솔에서 `SDStudioData.atmospheres.length === 6`, 각 atmosphere에 `color`,`padType`,`effectIds` 존재 확인.

---

## Task 5: audio-engine.js — 라이브 재생 + 시김새 + 합성 폴백

**Files:**
- Create: `js/audio-engine.js`

- [ ] **Step 1:** `AudioEngine` 작성: `loadBuffer(url)`(캐시+fetch+decode, 실패 시 null), `play({recipe, notes, assets})`.
- [ ] **Step 2:** 레이어 — 배경 패드(장면 패드/배경음, 길이 맞춰 loop/구간), 자연 효과음(간헐 배치), 선율(샘플 피치시프트 `2^((midi-baseMidi)/12)`, phrase 모드 구간 선택). app.js 검증 로직 이식.
- [ ] **Step 3:** 시김새 — `music-core.sigimsaeFor`로 받은 세그먼트를 샘플 `playbackRate`/합성 `detune` 자동화로 적용(국악기·국악풍·시김새강조 시).
- [ ] **Step 4:** 폴백 — 파일 로드 실패 층만 오실레이터/노이즈 합성. 사용 모드(실제/합성) 보고.
- [ ] **Step 5: 검증** — 로컬 서버에서 페이지 로드 → 콘솔 `window.SoundDrawing.play()` 호출 시 오류 없음, `AudioContext.state==='running'`, 30초 후 자동 정지.

---

## Task 6: audio-engine.js — 오프라인 렌더 + WAV 내보내기

**Files:**
- Modify: `js/audio-engine.js`

- [ ] **Step 1:** `renderOffline({recipe, notes, assets})` — `OfflineAudioContext(2, sampleRate*duration, sampleRate)`에 동일 그래프 구성 → `startRendering()` → AudioBuffer.
- [ ] **Step 2:** `exportWav(...)` — renderOffline → `music-core.encodeWav` → `Blob` → `<a download>`로 저장.
- [ ] **Step 3: 검증** — 브라우저에서 내보내기 트리거 시 nonzero 크기 WAV 다운로드, 재생 가능.

---

## Task 7: drawing.js — 캔버스 드로잉·렌더

**Files:**
- Create: `js/drawing.js`

- [ ] **Step 1:** `DrawingCanvas(canvas, getState, onChange)` — pointerdown/move/up로 정규화 path(0..1) 수집(속도 무관: 좌표만 저장).
- [ ] **Step 2:** 렌더 — 화첩 배경, **음계 가이드 가로선**, **팔레트 구간 분할선**(duration/10), 원본 선 + `music-core.autocompleteMelody/Rhythm` 보정 음 점선 오버레이.
- [ ] **Step 3:** `clear()`, `setMode('melody'|'rhythm')`, `getRecipePath()`.
- [ ] **Step 4: 검증** — 서버에서 마우스 드래그 시 보정 음 표시, 콘솔에서 noteCount>0, 스크린샷.

---

## Task 8: takes.js — 시도 저장·비교

**Files:**
- Create: `js/takes.js`

- [ ] **Step 1:** `TakesStore('sda.takes')` — `add(recipe)`(id+createdAt), `list()`, `remove(id)`, localStorage 직렬화(레시피만, 오디오 미저장).
- [ ] **Step 2:** `renderThumbnail(recipe, canvas)` — 드로잉 path를 분위기 색으로 작은 액자 썸네일 렌더.
- [ ] **Step 3: 검증** — 테이크 저장 → 새로고침 → 목록 유지(localStorage). 콘솔로 확인.

---

## Task 9: index.html + styles.css — 갤러리·아틀리에 재설계

**Files:**
- Rewrite: `index.html`, `styles.css`

- [ ] **Step 1:** 마크업 — 5단계(1 그림·길이 / 2 분위기 / 3 악기 / 4 선율 / 5 드로잉·완성). 상단 그림 썸네일 슬롯, 결과는 **액자+▶+명패**. `js/*` 순서 로드.
- [ ] **Step 2:** CSS — 따뜻한 종이 톤 토큰, 넓은 여백, 전시 라벨 세리프 헤드라인, 시스템 한글 산세리프. 데스크탑 레이아웃 우선.
- [ ] **Step 3:** **무드 틴팅** — `--accent`를 분위기 `color`로 런타임 주입, 카드/캔버스/액자에 반영.
- [ ] **Step 4: 검증** — 데스크탑 스크린샷으로 갤러리 톤·가독성·레이아웃 확인.

---

## Task 10: studio.js — 위저드 흐름·업로드·내보내기·공유 연결

**Files:**
- Create: `js/studio.js`

- [ ] **Step 1:** 상태/단계 네비게이션, 옵션 카드 렌더(분위기/악기/음계/버전), 단계 이동.
- [ ] **Step 2:** 1단계 그림 업로드(검증) + 썸네일 상단 고정, 분위기 선택 시 무드 틴팅 적용.
- [ ] **Step 3:** 드로잉·테이크·재생·WAV/커버 내보내기·(보너스)공유 링크(`encodeRecipe`→URL, 로드 시 `decodeRecipe` 복원) 연결.
- [ ] **Step 4:** `window.SoundDrawing` 테스트 API(getStateSummary/play/stop/exportWav) 노출.
- [ ] **Step 5: 검증** — 데스크탑에서 전 단계 워크스루 + 스크린샷.

---

## Task 11: 통합 검증 + README 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** `node --test` 전체 통과 확인.
- [ ] **Step 2:** 로컬 서버 풀 워크스루 — 완료 기준 10개(설계 §14) 하나씩 확인, 데스크탑 스크린샷 저장.
- [ ] **Step 3:** README 갱신 — 실행법, 파일 구조, 음원 추가/교체 방법, 확인 지점.

---

## Self-Review (작성 후 점검)

- **Spec coverage:** §4 흐름→T9/T10, §5 비주얼→T9, §6 엔진→T1/T2/T7, §7 오디오→T4/T5, §8 시김새→T2/T5, §9 저장→T8, §10 내보내기→T3/T6/T10, §11 구조→전체, §14 완료기준→T11. 누락 없음.
- **Placeholders:** 핵심 알고리즘은 코드/명령 제시. UI 태스크는 검증 명령 제시.
- **Type consistency:** `MusicCore`/`SDStudioData`/`window.SoundDrawing` 명칭 일관.
