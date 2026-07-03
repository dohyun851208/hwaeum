# 화음 스튜디오 — 그림으로 30초 BGM 만들기

> **畵**(그림 화) + **音**(소리 음) · 만든 팀 **화음지기**(畵音지기). 학생이 그림을 올리고
> 배경 음악을 고른 뒤 어울리는 악기를 미리 들어보고 **선율 드로잉으로 30초 BGM을 직접 만드는** 교실용 사운드 드로잉 창작 도구.
> (이전 이름: Sound Drawing Atelier)

빌드·프레임워크 없이 동작하는 **단일 정적 웹앱**입니다. 브라우저에서 ES module을 그대로 로드합니다.

> 📄 **이 지침은 `CLAUDE.md`(Claude Code 읽음)와 `AGENTS.md`(Codex 읽음)에 동일 내용으로 둡니다** — 두 에이전트가 같은 규칙으로 협업하도록. **내용을 고칠 땐 반드시 두 파일을 함께** 수정하세요. (각 하위 폴더의 `CLAUDE.md`/`AGENTS.md`도 같은 원칙)

---

## ⚠️ 가장 중요한 제약 (먼저 읽기)

1. **빌드/번들러 없음.** 앱 본체 `studio.html`이 `js/*.js`를 `<script type="module">`로 직접 부릅니다.
   (`index.html`은 3D 히어로 **랜딩 페이지** — "그림으로 음악 만들기" 버튼이 `studio.html`로 보냅니다.)
   트랜스파일·번들 단계가 없으니 브라우저가 바로 이해하는 코드만 씁니다.
   (`package.json`의 `"type": "commonjs"`는 **Node 테스트 전용**입니다.)
2. **`file://`(파일 더블클릭)에서는 음원 fetch가 막힙니다.** 반드시 **로컬 서버로** 여세요.
   서버 없이 열면 실제 음원 대신 합성음만 납니다.
3. **`sound/`의 MP3(앱 음원)는 git에 포함됩니다.** 대용량 원본 WAV만 gitignore(`sound/**/*.wav`).
   `node_modules/`, `.omc/`도 gitignore. 다른 PC로 이동 시 `git clone`이면 음원도 함께 옵니다.
4. **오디오는 저장하지 않습니다.** 저장하는 건 "레시피"(설정+드로잉 선)뿐이고, 재생할 때마다 재합성합니다.

---

## 실행 / 명령어

```powershell
# 가장 쉬움: 이 폴더의 "웹으로 열기.bat" 더블클릭 (서버 + 브라우저 자동)

npm run serve     # python -m http.server 4173  → http://localhost:4173/ (랜딩) · /studio.html (앱)
npm test          # node --test, 순수 로직 단위 테스트 (의존성 없음)

npm i jsdom ; node tools/smoke.cjs   # 통합 스모크 (선택, 오디오/캔버스는 스텁)
npx vercel --prod # Vercel 프로덕션 배포 → https://hwaeum.vercel.app (공식 URL)
```

브라우저 콘솔에서 `window.SoundDrawing`으로 상태 확인:
`getStateSummary()` · `play()` · `stop()` · `exportWav()` · `buildRecipe()` · `loadRecipe(recipe)` · `setStep(n)`

---

## 폴더 위계

```
화음/  (sound-drawing-tool/)
├── CLAUDE.md / AGENTS.md  프로젝트 정체성·제약·전체 아키텍처 (Claude=CLAUDE.md · Codex=AGENTS.md, 동일 내용)
├── index.html           3D 히어로 랜딩 페이지(자족형 inline CSS+JS) → studio.html로 진입
├── studio.html          5단계 위저드 마크업 (앱 본체, js/*.js 로드)
├── channel.html         화음 갤러리 감상 페이지 (공유된 작품 목록·뷰어)
├── styles.css           갤러리·아틀리에 디자인 + 무드 틴팅(CSS 변수)
│
├── js/                  ◀ 코드 레이어. 모듈별 책임은 js/CLAUDE.md 참고
├── docs/                ◀ 설계 문서. 색인·작성 규칙은 docs/CLAUDE.md 참고
│   ├── specs/             설계 명세
│   ├── plans/             구현 계획
│   └── decisions/         의사결정 기록(ADR)
│
├── assets/              악기 이미지·기본 표지 (WebP, git 포함)
├── sound/               음원 MP3 — git 포함. 원본 WAV만 gitignore
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
- **`studio.js`**가 5단계 위저드를 묶는 오케스트레이터(업로드·무드 틴팅·재생·내보내기·공유). 기능별로 `studio-export.js`(내보내기)·`studio-share-ui.js`(공유 갤러리 카드)·`studio-setup-render.js`(설정 화면 렌더)·`studio-utils.js`(공통 유틸)·`share-store.js`(갤러리 서버 I/O)로 분리되어 있습니다.
- **`manifest.js`**는 데이터 주도 — **음원/악기/음계 추가·교체는 거의 여기만 수정**합니다.

자세한 모듈 책임과 "어디를 고치나"는 → **`js/CLAUDE.md`**

---

## 제작 흐름 (5단계 위저드)

1. **그림 선택하기** — 그림 업로드. 그림은 표지와 상단 썸네일로 계속 유지
2. **배경 음악 고르기** — 배경 없음/분위기/소리풍경/리듬장단/내가 찾은 음악을 고르고 미리듣기. 같은 화면의 악기 영역은 **"이 배경에 어울리는 악기 미리 듣기"** 역할이다. 여기서 고른 악기는 3단계의 첫 드로잉 악기 기본값이 된다.
3. **선율 그리기** — 가로=시간(속도 무관), 세로=음높이. 실제로 그릴 악기 선택·교체는 이 화면의 기존 악기 도구가 담당한다. 음계 자동 보정 + 4/4 리듬 자동완성
4. **작품 완성하기** — 표지·제목·창작 의도 확인, 시도 저장·비교, WebM 음악·커버 PNG 내보내기
5. **화음 갤러리에 공유하기** — 화음 갤러리 번호 입력 후 작품 공유. 교사는 갤러리 생성·관리

---

## 개발 규칙

- **새 음원/악기/분위기** → `js/manifest.js` (README "음원 추가/교체" 절 참고)
- **음악 로직 변경**(음계·보정·리듬·시김새·WAV) → `js/music-core.js` + `test/`에 단위 테스트
- **악기별 선율 음량 보정**은 바이올린 기준의 측정값을 따른다. 새 샘플을 넣은 뒤 `npm run measure:loudness`로 안정 구간 dB를 재고, `js/audio-engine.js`의 `INSTRUMENT_MELODY_OUTPUT_GAINS`와 테스트를 함께 갱신한다. 감으로 개별 gain만 바꾸지 않는다.
- **악기 내부 음별 선율 음량 보정**은 악기별 평균을 유지하되 각 음의 안정 구간 dB를 기준으로 최대 ±3 dB까지만 적용한다. 새 샘플을 넣은 뒤 `npm run measure:loudness -- --notes`로 `NOTE_MELODY_OUTPUT_GAINS` 후보를 확인하고, 보정 폭을 키우지 않는다. 단, **지속음 자동 루프 파일럿 악기**(`SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS`, 현재 더블베이스)는 샘플 간 녹음 강약 차가 커서 루프 구간 RMS 기준 ±12 dB(`AUTO_LOOP_NOTE_GAIN_LIMIT_DB`)까지 허용한다.
- **음계 기본값은 악기 그룹을 따른다.** 기본은 **C장조**(서양 악기 — 파(F)·시(B)도 난다), **국악기만 5음(펜타토닉)+시김새**(파·시 없음). 악기를 고르면 자동 적용 → `studio.js`의 `styleForInstrument()`.
- **2단계 악기 영역은 선택 강요가 아니라 맥락 미리듣기다.** UI 문구는 "이 배경에 어울리는 악기 미리 듣기"로 유지하고, 3단계에 새 악기 메뉴를 중복 추가하지 않는다. 2단계에서 고른 악기는 `state.instrument`로 이어져 3단계의 첫 드로잉 악기 기본값이 된다.
- **국악기 발음 가능 음은 악기마다 다르게 줄이지 않는다.** 소금·대금·단소·해금·가야금 모두 **G-A-C-D-E-G-A-C-D-E** 10음을 쓴다. 도화지 축은 **선택한 악기가 낼 수 있는 칸만** 보여준다 — 서양 악기는 15칸 전체, 국악기는 10칸이 화면을 채운다. `js/manifest.js`의 공통 `playableMidi`와 국악풍 스타일의 `draw*` 축 설정이 이 규칙을 관리한다.
- **저장 좌표(획·레시피)는 항상 서양 15칸 축 기준이다.** 국악 축(보이는 칸만)과의 상호 변환은 `music-core.js`의 `displayYFromStored()`/`storedYFromDisplay()`가 담당한다 — 그래서 악기를 오가도 그린 선의 음높이가 유지된다. 국악 축에서는 서양 악기 획·보정 음이 **숨겨질 뿐 지워지지 않고**(소리는 그대로), 지우개도 숨은 획은 건드리지 못한다. 서양 축으로 돌아오면 다시 보인다.
- 음높이 칸은 `music-core.js`의 `drawableScale()`(전체 축)·`playableScale()`(보이는 축)이 관리하고, 발음 가능 여부는 `isPitchPlayable()`/`quantizePitch()`가 관리한다. 음높이 축 라벨은 **옥타브 숫자 없이 한글 계이름만**(도·레·미…) 표시한다. 기본 도화지 축은 아래부터 **솔·라·시·도·레·미·파·솔·라·시·도·레·미·파·솔**이며, 국악기 축은 이 중 파·시 칸이 빠진 10칸만 표시한다. 단 **높은 음=위, 낮은 음=아래**는 항상 보장한다. 소리를 구현할 때도 라벨 숫자에 기대지 말고 악기별 음역(transpose·playableMidi)을 따른다 → `drawing.js`의 `soundingLabel()`/`noteLetter()`.
- **설계를 바꾸는 결정** → `docs/decisions/`에 ADR 기록 (docs/CLAUDE.md 규칙)
- **모바일 대응은 만들지 않는다.** 이 도구는 교실 데스크톱 사용 기준으로 설계한다. 사용자가 따로 요청하지 않는 한 모바일 전용 레이아웃·브레이크포인트·QA를 추가하지 않는다.
- **에셋 최적화는 기본값이다.** `assets/`에 이미지를 추가하거나 교체할 때는 **반드시 WebP**로 변환한다(`ffmpeg -i input.png -c:v libwebp -quality 82 -lossless 0 output.webp`). PNG·BMP는 올리지 않는다. 악기 카드 이미지는 긴 변 800px 이하로 리사이즈한다(`-vf scale=800:-1`). 기존 WebP도 800KB 이상이면 품질을 낮춰 재압축한다.
- **완료 주장 전** `npm test` 통과 확인. UI/오디오 변경은 서버로 띄워 실제 동작 확인.
- 사용자(교사·학생) 대상 문구는 **한국어**, 저학년도 이해 가능한 쉬운 표현.
