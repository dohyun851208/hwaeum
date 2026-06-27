# 화음 스튜디오 — 그림으로 30초 BGM 만들기

> **畵**(그림 화) + **音**(소리 음) · 만든 팀 **화음지기**(畵音지기). 학생이 그림을 올리고
> 분위기·악기·음계를 고른 뒤 **드로잉으로 30초 BGM을 직접 만드는** 교실용 사운드 드로잉 창작 도구.
> (이전 이름: Sound Drawing Atelier)

빌드·프레임워크 없이 동작하는 **단일 정적 웹앱**입니다. 브라우저에서 ES module을 그대로 로드합니다.

> 📄 **이 지침은 `CLAUDE.md`(Claude Code 읽음)와 `AGENTS.md`(Codex 읽음)에 동일 내용으로 둡니다** — 두 에이전트가 같은 규칙으로 협업하도록. **내용을 고칠 땐 반드시 두 파일을 함께** 수정하세요. (각 하위 폴더의 `CLAUDE.md`/`AGENTS.md`도 같은 원칙)

---

## ⚠️ 가장 중요한 제약 (먼저 읽기)

1. **빌드/번들러 없음.** `index.html`이 `js/*.js`를 `<script type="module">`로 직접 부릅니다.
   트랜스파일·번들 단계가 없으니 브라우저가 바로 이해하는 코드만 씁니다.
   (`package.json`의 `"type": "commonjs"`는 **Node 테스트 전용**입니다.)
2. **`file://`(파일 더블클릭)에서는 음원 fetch가 막힙니다.** 반드시 **로컬 서버로** 여세요.
   서버 없이 열면 실제 음원 대신 합성음만 납니다.
3. **`sound/`(대용량 음원)는 git에 넣지 않습니다.** 다른 PC로 옮길 땐 **폴더를 통째로 복사/zip**.
   `node_modules/`, `.omc/`도 gitignore — 이 repo는 **자족형 폴더**가 원칙입니다.
4. **오디오는 저장하지 않습니다.** 저장하는 건 "레시피"(설정+드로잉 선)뿐이고, 재생할 때마다 재합성합니다.

---

## 실행 / 명령어

```powershell
# 가장 쉬움: 이 폴더의 "웹으로 열기.bat" 더블클릭 (서버 + 브라우저 자동)

npm run serve     # python -m http.server 4173  → http://localhost:4173/index.html
npm test          # node --test, 순수 로직 단위 테스트 (의존성 없음)

npm i jsdom ; node tools/smoke.cjs   # 통합 스모크 (선택, 오디오/캔버스는 스텁)
```

브라우저 콘솔에서 `window.SoundDrawing`으로 상태 확인:
`getStateSummary()` · `play()` · `stop()` · `exportWav()` · `buildRecipe()` · `loadRecipe(recipe)` · `setStep(n)`

---

## 폴더 위계

```
화음/  (sound-drawing-tool/)
├── CLAUDE.md / AGENTS.md  프로젝트 정체성·제약·전체 아키텍처 (Claude=CLAUDE.md · Codex=AGENTS.md, 동일 내용)
├── index.html           4단계 위저드 마크업
├── styles.css           갤러리·아틀리에 디자인 + 무드 틴팅(CSS 변수)
│
├── js/                  ◀ 코드 레이어. 모듈별 책임은 js/CLAUDE.md 참고
├── docs/                ◀ 설계 문서. 색인·작성 규칙은 docs/CLAUDE.md 참고
│   ├── specs/             설계 명세
│   ├── plans/             구현 계획
│   └── decisions/         의사결정 기록(ADR)
│
├── assets/              악기 이미지·기본 표지 (git 포함)
├── sound/               음원 — ⚠ gitignore. 폴더 복사로만 이동
├── test/                node --test 단위 테스트 (주로 music-core 대상)
├── tools/               smoke.cjs (jsdom 통합 스모크)
├── vendor/              tone (브라우저용 벤더 자산)
└── node_modules/        ⚠ gitignore. npm install로 복원
```

---

## 아키텍처 — 데이터 흐름

```
사용자 입력 ──▶ drawing.js ──▶ music-core.js ──▶ audio-engine.js ──▶ 소리/WAV
 (그림·설정)    (캔버스 선)     (순수 로직)        (Web Audio 합주)
                    ▲               │
                    │               ├─ 레시피 코덱(저장/공유/복원)
              studio.js ────────────┘
            (위저드 흐름·UI 오케스트레이션)   manifest.js = 음원·악기·음계 데이터 공급
```

- **`music-core.js`는 순수 함수 계층** — DOM·Web Audio에 의존하지 않습니다. 그래서 단위 테스트가 쉽습니다. **이 순수성을 깨지 마세요.**
- **`audio-engine.js`**는 Web Audio(라이브 + 오프라인 렌더)·피치 시프트·시김새·합성 폴백 담당.
- **`studio.js`**가 4단계 위저드를 묶는 오케스트레이터(업로드·무드 틴팅·재생·내보내기·공유).
- **`manifest.js`**는 데이터 주도 — **음원/악기/음계 추가·교체는 거의 여기만 수정**합니다.

자세한 모듈 책임과 "어디를 고치나"는 → **`js/CLAUDE.md`**

---

## 제작 흐름 (4단계 위저드)

1. **그림** — 그림 업로드. 그림은 표지와 상단 썸네일로 계속 유지
2. **분위기·악기·선율** — 한 화면에서 스크롤하며 배경 분위기, 연주 악기, 음계/연주 형태를 이어서 선택하고 미리듣기
3. **드로잉** — 가로=시간(속도 무관), 세로=음높이. 음계 자동 보정 + 4/4 리듬 자동완성
4. **완성** — 표지·제목 확인, 시도 저장·비교, WAV·커버 PNG 내보내기, 공유 링크

---

## 개발 규칙

- **새 음원/악기/분위기** → `js/manifest.js` (README "음원 추가/교체" 절 참고)
- **음악 로직 변경**(음계·보정·리듬·시김새·WAV) → `js/music-core.js` + `test/`에 단위 테스트
- **음계 기본값은 악기 그룹을 따른다.** 기본은 **C장조**(서양 악기 — 파(F)·시(B)도 난다), **국악기만 5음(펜타토닉)+시김새**(파·시 없음). 악기를 고르면 자동 적용 → `studio.js`의 `styleForInstrument()`.
- **국악기 드로잉 팔레트는 악기마다 다르게 줄이지 않는다.** 소금·대금·단소·해금·가야금·산조아쟁 모두 **G-A-C-D-E-G-A-C-D-E** 10칸을 쓴다. `js/manifest.js`의 공통 `playableMidi`와 국악풍 스타일 음역이 이 규칙을 관리한다.
- 음높이 칸·들리는 음은 `music-core.js`의 `drawableScale()`이 한 목록으로 관리하고, 음높이 축 라벨은 **옥타브 숫자 없이 음 이름만**(C·D·E…) 표시한다. 단 **높은 음=위, 낮은 음=아래**는 항상 보장한다. 소리를 구현할 때도 라벨 숫자에 기대지 말고 악기별 음역(transpose·playableMidi)을 따른다 → `drawing.js`의 `soundingLabel()`/`noteLetter()`.
- **설계를 바꾸는 결정** → `docs/decisions/`에 ADR 기록 (docs/CLAUDE.md 규칙)
- **모바일 대응은 만들지 않는다.** 이 도구는 교실 데스크톱 사용 기준으로 설계한다. 사용자가 따로 요청하지 않는 한 모바일 전용 레이아웃·브레이크포인트·QA를 추가하지 않는다.
- **완료 주장 전** `npm test` 통과 확인. UI/오디오 변경은 서버로 띄워 실제 동작 확인.
- 사용자(교사·학생) 대상 문구는 **한국어**, 저학년도 이해 가능한 쉬운 표현.
