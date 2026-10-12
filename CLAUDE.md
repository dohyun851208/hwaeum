# 화음 스튜디오 — 그림으로 30초 BGM 만들기

> **畵**(그림 화) + **音**(소리 음) · 만든 팀 **화음지기**(畵音지기). 학생이 그림을 올리고
> 배경 음악을 고른 뒤 어울리는 악기를 미리 들어보고 **선율 드로잉으로 30초 BGM을 직접 만드는** 교실용 사운드 드로잉 창작 도구.
> (이전 이름: Sound Drawing Atelier)

빌드·프레임워크 없이 동작하는 **단일 정적 웹앱**입니다. 브라우저가 의존 순서대로 classic `<script>`를 읽고 각 모듈을 `window` 전역에 노출합니다.

> 📄 **이 지침은 `CLAUDE.md`(Claude Code 읽음)와 `AGENTS.md`(Codex 읽음)에 동일 내용으로 둡니다** — 두 에이전트가 같은 규칙으로 협업하도록. **내용을 고칠 땐 반드시 두 파일을 함께** 수정하세요. (각 하위 폴더의 `CLAUDE.md`/`AGENTS.md`도 같은 원칙)

---

## ⚠️ 가장 중요한 제약 (먼저 읽기)

1. **빌드/번들러 없음.** 앱 본체 `studio.html`이 `js/*.js`를 classic `<script>`로 직접 부릅니다. 파일 순서가 곧 의존 순서이므로 새 모듈을 추가할 때 `studio.html`(갤러리 공통 모듈은 `channel.html`도)·의존 순서 테스트를 함께 갱신합니다. `tools/runtime-scripts.cjs`가 HTML에서 순서를 읽어 스모크·테스트·측정 로더에 공유합니다.
   (`index.html`은 **랜딩 페이지** — 산수화 위에 선율이 그어지는 연출 뒤 "내 그림에 선율 더하기" 버튼이 `studio.html`로 보냅니다.)
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
`getStateSummary()` · `play()` · `pause()` · `resume()` · `stop()` · `exportAudio()` · `exportDrawingImage()` · `exportDrawingVideo()` · `buildRecipe()` · `loadRecipe(recipe)` · `setStep(n)`

---

## 폴더 위계

```
화음/  (sound-drawing-tool/)
├── CLAUDE.md / AGENTS.md  프로젝트 정체성·제약·전체 아키텍처 (Claude=CLAUDE.md · Codex=AGENTS.md, 동일 내용)
├── index.html           선율 히어로 랜딩 페이지(자족형 inline CSS+JS+Canvas) → studio.html로 진입
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
사용자 입력 ──▶ drawing.js ──▶ music-core.js ──▶ audio-plan.js ──▶ audio-engine.js ──▶ 소리/WebM
 (그림·설정)    (캔버스 선)     (순수 음악 규칙)    (순수 재생 계획)    (Web Audio 합주)
                    ▲                  ▲                    │
                    │                  └── manifest/sample maps
              studio.js ──▶ studio-transport.js / studio-sound-layers.js / studio-export.js / studio-takes-ui.js / studio-share.js
            (위저드 오케스트레이션)      (재생 시간 상태 / 내보내기 / 시도 UI / 공유 UI)
```

- **`music-core.js`는 순수 함수 계층** — DOM·Web Audio에 의존하지 않습니다. 그래서 단위 테스트가 쉽습니다. **이 순수성을 깨지 마세요.**
- **`audio-plan.js`**는 샘플 선택·음 변환·획/탐색 계획을 계산하는 순수 계층입니다. **DOM·Web Audio에 의존시키지 마세요.**
- **`audio-samples.js`**는 지속음 루프·샘플 버퍼 가공과 캐시를 담당합니다. 실제 노드 설정·재생 수명과 측정 게인 표는 `audio-engine.js`에 둡니다.
- **`drawing-renderer.js`**는 피치 축·색·가이드·획 렌더를 맡고, `drawing.js`는 입력·좌표·실행 취소·붓 커서를 맡습니다.
- **`studio-recipe.js`**는 상태 스냅샷의 순수 레시피 변환을, **`studio-reflection.js`**는 감상 인계·성찰·태그 UI를 맡습니다. 저장 작품의 음은 그 작품의 악기로 계산하고 불러온 성찰을 이전 메모로 덮어쓰지 않습니다.
- **`share-local-store.js`**는 로컬 갤러리 IndexedDB·객체 URL 수명을 맡고, `share-store.js`는 서버 I/O·로컬 폴백 연결·표지 생성을 맡습니다.
- **`audio-node-scope.js` / `audio-pad-graph.js`**는 각각 재생 노드 수명과 공통 합성 패드 그래프를 담당합니다.
- **`audio-engine.js`**는 위 계산 결과를 Web Audio 라이브·오프라인 그래프에 스케줄하고 피치 시프트·시김새·합성 폴백을 적용합니다.
- **`studio.js`**가 5단계 위저드를 묶는 오케스트레이터(업로드·무드 틴팅·단계 연결). 기능별로 `studio-export.js`(내보내기)·`studio-setup-render.js`(설정 화면 렌더)·`studio-transport.js`(재생·플레이헤드·배경 구간 시간 상태)·`studio-sound-layers.js`(3단계 추가 소리 업로드·자르기·배치·미리듣기)·`studio-takes-ui.js`(시도 저장·선택·목록 UI)·`studio-share.js`(공유 모달·갤러리 입장/생성·작품 게시·레시피 링크)·`studio-utils.js`(공통 유틸)·`share-store.js`(갤러리 서버 I/O)로 분리되어 있습니다.
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
- **자연 효과음(바람·비·숲·천둥) 교체·다듬기** → `tools/build-nature-effects.py`의 `EFFECTS` 표(원본·구간·목표 LUFS)에 적고 실행한다. 도장 미리듣기는 **앞 1.2초만** 들려주므로 이름에 맞는 순간(천둥이 치는 순간 등)을 파일 맨 앞에 둔다. 물방울·번개처럼 순간 피크가 핵심인 소리는 리미터가 3 dB 넘게 깎지 않게 목표를 낮춘다. 픽사베이 원본은 배포 트리 밖에 두고 출처는 `sound/효과-자연음(픽사베이)/라이센스.txt`에 적는다. **앱 속 도장 크기는 새소리를 기준으로 이름의 세기만큼 더하고 뺀다**(`tools/measure-effect-loudness.cjs`의 `LEVEL_DB`: 번개 +6, 폭풍우·거센바람 +4, 회오리바람·흑동고래 +3, 가랑비·먼 천둥 −3 dB). 녹음을 고를 땐 노트북 대역(150 Hz 위)에 소리가 있는지 본다 — 저음뿐이거나 배경음악과 같은 대역에 몰린 녹음은 숫자가 같아도 작게 들렸다. 효과음 파일을 바꾸면 `node tools/measure-effect-loudness.cjs`로 재서 manifest `effects[].gain`을 추천값으로 고친다(`--check`로 확인). 도장은 **시작점만 정하고** 찍은 자리부터 파일 길이만큼 나며(겹치면 동시에 겹침), 그 길이(manifest `duration`, 같은 도구가 확인)를 3단계 도화지에 옅은 띠로 보인다(`docs/decisions/2026-10-06-effect-stamp-length-band.md`). 엔진은 `EFFECT_GAIN × gain`으로 재생하고 끝 0.3초에서만 줄이며, 마스터를 지난 재생 크기가 미리듣기(`EFFECT_PREVIEW_GAIN × gain`)와 같게 둔다 — **배경·선율 게인을 키울 때 효과음도 함께 본다**(따로 두면 묻힌다, `docs/decisions/2026-10-05-effect-stamp-loudness.md`).
- **2단계 악기 감상 연주곡(카드 ▶) 교체·다듬기** → `tools/build-instrument-examples.py`의 `EXAMPLES` 표(원본·구간·목표 LUFS)에 적고 실행한다. 연주곡은 엔진 음량 보정 없이 `Audio`로 그대로 나가므로 **파일 크기가 곧 앱 속 크기**다 — 같은 무리 카드 연주곡과 LUFS를 맞추고(모노 파일은 스테레오로 들으면 3 dB 크게 들림), 리미터로 깎지 않는다. 키우면 잡음까지 커지는 작은 녹음은 다른 녹음으로 바꾼다. 원본은 배포 트리 밖 `감상-연주곡-원본/`에 둔다. CC BY·CC BY-SA 녹음은 2단계 출처 줄(`studio.js` `AUDIO_MODE_CREDIT`·`#audioModeNote`)과 `sound/감상-연주곡(서양악기)/라이센스.txt`에 출처를 적는다(`docs/decisions/2026-10-03-instrument-example-pieces.md`).
- **음악 규칙 변경**(음계·보정·리듬·시김새·루프 검출) → `js/music-core.js` + `test/`에 단위 테스트
- **샘플 선택·재생 계획 변경** → `js/audio-plan.js`, **Web Audio 그래프·수명 변경** → `js/audio-engine.js`와 `js/audio-*.js` + 행동 테스트
- **악기별 선율 음량 보정**은 바이올린 기준의 측정값을 따른다. 악기끼리는 **A-가중 크기**(낮은 소리를 덜 세는 귀 기준, 음별 보정을 곱한 뒤의 안정 구간 에너지 평균)로 맞춘다 — 에너지(RMS)로 맞추면 첼로·더블베이스·호른·대금처럼 낮은 악기가 3~8 dB 작게 들렸다(`docs/decisions/2026-10-03-perceived-loudness-a-weighting.md`). 뜯는 가야금만 RMS로 맞춘다. 해금은 울림통 공명 깎기(`HAEGEUM_RESONANCE_CUTS`, 엔진과 측정 도구가 같은 표)를 거친 뒤를 잰다(`docs/decisions/2026-10-04-haegeum-resonance-cuts.md`). 새 샘플을 넣은 뒤 `npm run measure:loudness`로 재고, 추천값으로 `js/audio-engine.js`의 `INSTRUMENT_MELODY_OUTPUT_GAINS`와 테스트를 함께 갱신한다. 감으로 개별 gain만 바꾸지 않는다.
- **악기 내부 음별 선율 음량 보정**은 악기별 평균을 유지하되 각 음의 안정 구간 dB를 기준으로 최대 ±3 dB까지만 적용한다. 새 샘플을 넣은 뒤 `npm run measure:loudness -- --notes`로 `NOTE_MELODY_OUTPUT_GAINS` 후보를 확인하고, 보정 폭을 키우지 않는다(대금 값은 메인 `index.html`의 `TAKES`에도 복사되어 있으니 함께 갱신). 단, **더블베이스와 국악 4악기(소금·대금·단소·해금)만** 측정 근거로 루프 RMS 기준 ±12 dB(`AUTO_LOOP_NOTE_GAIN_LIMIT_DB`, 명단 `WIDE_NOTE_GAIN_LIMIT_IDS`)까지 허용한다 — 더블베이스는 샘플 간 녹음 강약 차, 국악기는 국립국악원 음계 녹음이 음마다 한 번뿐이라 바꿀 녹음이 없고 음 사이 차이가 9~21 dB이기 때문이다(`docs/decisions/2026-10-03-loudness-audit.md`). 이 예외는 자동 루프 적용 명단과 독립적이며, 다른 악기에 루프를 적용해도 ±3 dB 한도를 넓히지 않는다. 루프의 느린 감쇠 완화는 구간 평균 에너지를 보존하는 별도 PCM 처리다. 가야금의 음별 게인은 원음의 강약을 유지하도록 1로 둔다.
- **합성음 대체 크기**(음원을 못 받았을 때 나는 합성 선율)는 실제 음원과 같은 크기로 맞춘 `js/audio-engine.js`의 `SYNTH_MELODY_TRIM_DB`를 따른다. 합성음에는 음별 보정을 쓰지 않는다. `INSTRUMENT_MELODY_OUTPUT_GAINS`를 바꾸면 `node tools/measure-synth-fallback.cjs`(설치된 Chrome 사용)로 다시 재서 추천값으로 고치고 `--check`로 확인한다(`docs/decisions/2026-10-07-hands-on-audit-fixes.md`).
- **실제 원음 조율 보정**은 `js/sample-calibration.js`가 담당한다. `node tools/measure-sustain.cjs <임시 폴더> --uncalibrated` → `python tools/calibrate-sustain.py <임시 폴더> --write`로 체크인된 MP3에서 재생성한다(ffmpeg·numpy·scipy 필요). 이웃 파일 차용을 나타내는 기존 `cents`를 덮어쓰지 않는다. 음을 옮길 때 새 원음과 그 보정을 함께 선택하고, 같은 칸 유지 중에는 재발음하지 않는다.
- **음계 기본값은 악기 그룹을 따른다.** 기본은 **C장조**(서양 악기 — 파(F)·시(B)도 난다), **국악기만 5음(펜타토닉)+시김새**(파·시 없음). 악기를 고르면 자동 적용 → `studio.js`의 `styleForInstrument()`.
- **2단계 악기 영역은 선택 강요가 아니라 맥락 미리듣기다.** UI 문구는 "이 배경에 어울리는 악기 미리 듣기"로 유지하고, 3단계에 새 악기 메뉴를 중복 추가하지 않는다. 2단계에서 고른 악기는 `state.instrument`로 이어져 3단계의 첫 드로잉 악기 기본값이 된다.
- **2단계 악기 설명은 감상 활동의 "예시 답안"이다.** 학생이 먼저 듣고 느낌을 적도록, `manifest.js`의 악기 `detail`은 2단계 카드에서 기본으로 감추고 카드 안 `[예시 답안 보기]`를 눌렀을 때만 펼친다(3단계 악기 툴팁의 설명은 그대로 둔다). 학생이 적은 감상 메모는 `state.instrumentNotes`·`state.backgroundNotes`에 두고, **최종으로 고른 배경·악기의 메모만** 4단계 성찰 칸(`backgroundReason`·`melodyIntent`)으로 옮겨져 작품에 저장된다 — 학생이 4단계에서 그 칸을 손대면 그 뒤로는 덮어쓰지 않는다(`state.reflectionEdited`).
- **감상 칸은 공유 필수가 아니다.** 1단계 `그림을 보고 떠오르는 생각`(`state.pictureThought`, 1·4단계가 같은 값을 공유)과 2단계 배경·악기 메모는 화음 갤러리 공유 검사에 넣지 않는다. 필수는 기존 5개(제목·작곡가·배경음악을 고른 이유·선율을 표현한 의도·작품을 잘 나타내는 단어)뿐이다.
- **국악기 발음 가능 음은 악기마다 다르게 줄이지 않는다.** 소금·대금·단소·해금·가야금 모두 **G-A-C-D-E-G-A-C-D-E** 10음을 쓴다. 도화지 축은 **선택한 악기가 낼 수 있는 칸만** 보여준다 — 서양 악기는 15칸 전체, 국악기는 10칸이 화면을 채운다. `js/manifest.js`의 공통 `playableMidi`와 국악풍 스타일의 `draw*` 축 설정이 이 규칙을 관리한다.
- **저장 좌표(획·레시피)는 항상 서양 15칸 축 기준이다.** 국악 축(보이는 칸만)과의 상호 변환은 `music-core.js`의 `displayYFromStored()`/`storedYFromDisplay()`가 담당한다 — 그래서 악기를 오가도 그린 선의 음높이가 유지된다. 국악 축에서는 서양 악기 획·보정 음이 **숨겨질 뿐 지워지지 않고**(소리는 그대로), 지우개도 숨은 획은 건드리지 못한다. 서양 축으로 돌아오면 다시 보인다.
- 음높이 칸은 `music-core.js`의 `drawableScale()`(전체 축)·`playableScale()`(보이는 축)이 관리하고, 발음 가능 여부는 `isPitchPlayable()`/`quantizePitch()`가 관리한다. 음높이 축 라벨은 **옥타브 숫자 없이 한글 계이름만**(도·레·미…) 표시한다. 기본 도화지 축은 아래부터 **솔·라·시·도·레·미·파·솔·라·시·도·레·미·파·솔**이며, 국악기 축은 이 중 파·시 칸이 빠진 10칸만 표시한다. 단 **높은 음=위, 낮은 음=아래**는 항상 보장한다. 소리를 구현할 때도 라벨 숫자에 기대지 말고 악기별 음역(transpose·playableMidi)을 따른다 → `drawing-renderer.js`의 `soundingLabel()`/`noteLetter()`.
- **설계를 바꾸는 결정** → `docs/decisions/`에 ADR 기록 (docs/CLAUDE.md 규칙)
- **모바일 대응은 만들지 않는다.** 이 도구는 교실 데스크톱 사용 기준으로 설계한다. 사용자가 따로 요청하지 않는 한 모바일 전용 레이아웃·브레이크포인트·QA를 추가하지 않는다.
- **에셋 최적화는 기본값이다.** `assets/`에 이미지를 추가하거나 교체할 때는 **반드시 WebP**로 변환한다(`ffmpeg -i input.png -c:v libwebp -quality 82 -lossless 0 output.webp`). PNG·BMP는 올리지 않는다. 악기 카드 이미지는 긴 변 800px 이하로 리사이즈한다(`-vf scale=800:-1`). 기존 WebP도 800KB 이상이면 품질을 낮춰 재압축한다.
- **`js/*.js`를 고치면 그 파일을 부르는 HTML의 `?v=` 꼬리표를 올린다**(`studio.html`의 `manifest.js?v=20261005-effect-balance`처럼 날짜-주제). 주소가 그대로면 브라우저가 저장해 둔 옛 파일을 계속 써서, 고친 소리·화면이 사용자에게 보이지 않는다(2026-10-05 효과음 크기 수정 때 실제로 겪음).
- **완료 주장 전** `npm test` 통과 확인. UI/오디오 변경은 서버로 띄워 실제 동작 확인.
- 사용자(교사·학생) 대상 문구는 **한국어**, 저학년도 이해 가능한 쉬운 표현.
- **한글 줄바꿈은 낱말 단위다.** `styles.css`가 전역으로 `word-break: keep-all`(+ 긴 낱말만 `overflow-wrap: break-word`), 제목 `text-wrap: balance`, 문단 `text-wrap: pretty`를 건다. 새 화면에서 `break-all`이나 글자 단위 줄바꿈을 쓰지 않는다("만듭니 / 다." 같은 끊김 방지).
- **글자 크기 바닥**: 스튜디오에서 읽는 글자(설명·안내·도움말·칸 이름·단추 글자)는 14px 이상, 단계 번호·눈금·배지 같은 숫자·장식 표시만 12~13px. 새 화면을 만들 때도 이 바닥 아래로 내리지 않는다.
