# 화음 스튜디오 — 그림으로 만드는 30초 BGM

> **畵**(그림 화) + **音**(소리 음) · 만든 팀 **화음지기**

학생이 그림을 올리고, 배경/악기·음계를 고른 뒤 **드로잉으로 30초 BGM을 만드는** 교실용 웹 창작 도구입니다.
Song Maker(음계·박자 자동 보정) + Paint with Music(드로잉→소리, 장면 캔버스) + BandLab(레이어 합주)의 장점을 결합했습니다.

빌드/프레임워크 없이 동작하는 **단일 정적 웹앱**입니다.

## 실행

이 폴더는 **자족형**입니다. 음원(`sound/`)·이미지·코드가 모두 안에 있어, 폴더를 통째로 복사/zip해서 어느 컴퓨터로 옮겨도 그대로 동작합니다. 단, `file://`(파일 더블클릭)에서는 브라우저 보안상 음원 fetch가 막혀 합성음만 나오므로 **로컬 서버로** 여세요.

가장 쉬운 방법: 이 폴더의 **`웹으로 열기.bat`** 더블클릭 (서버 + 브라우저 자동 실행). 또는 직접:

```text
python -m http.server 4173      # 이 폴더(sound-drawing-tool)에서 실행
```

브라우저에서(데스크탑·마우스 환경 기준):

```text
http://localhost:4173/            # 선율 히어로 랜딩 ("내 그림에 선율 더하기" 클릭)
http://localhost:4173/studio.html # 앱(위저드) 바로 열기
```

> 끄려면 서버 창에서 Ctrl+C. 2단계 화면 하단에는 국악 음원 출처가 표시됩니다.
> 앱에서 쓰는 `sound/` MP3는 git에 포함됩니다. 원본 WAV만 제외되므로 다른 컴퓨터에서는 `git clone`으로 실행 자산까지 받을 수 있습니다.

## 제작 흐름 (5단계)

1. **그림 선택하기** — 그림을 올리면 표지와 작곡 화면 참고 그림으로 계속 유지됩니다.
2. **배경 음악 고르기** — 배경 없음/분위기/소리풍경/리듬장단/내가 찾은 음악을 고르고, 어울리는 악기도 미리 듣습니다. 여기서 고른 악기는 첫 드로잉 악기가 됩니다.
3. **선율 그리기** — 가로=시간, 세로=음높이입니다. 여러 악기로 나눠 그리고 지우개·Undo를 쓰며, 음계 자동 보정과 4/4 리듬 자동완성을 적용합니다.
4. **작품 완성하기** — 제목·창작 의도와 표지를 확인하고 시도를 저장·비교합니다. WebM 음악, 커버 PNG, 드로잉 PNG/WebM을 내보낼 수 있습니다.
5. **화음 갤러리에 공유하기** — 갤러리 번호와 코드를 입력해 작품을 게시합니다. 교사는 갤러리를 생성·관리할 수 있습니다.

## 핵심 동작

- **드로잉→음악**: 그린 선을 가로 위치 기준으로 박자 격자에 재샘플링하므로 **그리는 속도와 무관**. 음높이는 선택 음계의 가장 가까운 음으로 자동 보정.
- **시김새(국악)**: 국악기·국악풍 선택 시 꺾음·흘러내림·떠는음을 피치 곡선으로 적용.
- **시도(테이크) 저장·비교**: 저장하는 것은 "레시피"(설정+드로잉 선)뿐 — 오디오는 저장하지 않으므로 용량 부담이 없습니다(localStorage). 재생 시 매번 재합성.
- **내보내기**: 완성곡을 **WebM 음악**으로, 표지와 드로잉을 **PNG**로 다운로드. 드로잉 과정은 **WebM 영상**으로도 저장할 수 있습니다.
- **공유 링크**: 레시피를 URL에 담아(오디오 없이, 수 KB) 같은 사이트에서 열면 그대로 복원.
- **실제 음원 우선, 합성음 대체**: 파일을 못 불러온 층만 자동으로 합성음으로 대체합니다.

## 파일 구조

```
index.html         선율 히어로 랜딩 페이지(자족형 inline CSS+JS+Canvas) → studio.html로 진입
studio.html        5단계 위저드 마크업 (앱 본체)
channel.html       화음 갤러리 목록·작품 감상 페이지
styles.css         갤러리·아틀리에 디자인 + 무드 틴팅(CSS 변수)
js/music-core.js   순수 로직: 음계·피치 보정·시간 재샘플링·리듬·시김새·레시피 코덱·WAV 인코딩
js/manifest.js     음원·배경·악기·음계 데이터  ← 음원 추가/교체는 주로 여기만 수정
js/audio-plan.js   순수 재생 계획: 샘플 선택·악기별 음 변환·획/탐색 구간
js/audio-node-scope.js transport/preview 오디오 노드 수명 관리
js/audio-samples.js 지속음 루프·샘플 버퍼 가공과 캐시
js/audio-pad-graph.js 전체 재생·드로잉 배경이 공유하는 합성 패드 그래프
js/audio-engine.js Web Audio 합주(라이브+오프라인 렌더)·피치 시프트·시김새·합성 폴백
js/drawing-renderer.js 피치 축·가이드·선율 렌더
js/drawing.js      캔버스 입력·좌표·실행 취소·악기 붓 커서
js/takes.js        시도 저장·비교(localStorage)·썸네일
js/studio.js       위저드 흐름·업로드·무드 틴팅·테이크·공유 오케스트레이션
js/studio-recipe.js 순수 레시피 직렬화·저장 작품의 음과 사용 악기 계산
js/studio-reflection.js 감상 메모 인계·성찰·태그 입력
js/studio-export.js WebM 음악·커버/드로잉 PNG·드로잉 WebM 내보내기
js/studio-setup-render.js 배경·악기 선택 화면 렌더
js/studio-transport.js 재생·플레이헤드·무배경 시계·배경 구간 시간 상태
js/studio-sound-layers.js 추가 소리 업로드·자르기·배치·미리듣기
js/studio-takes-ui.js 시도 저장·선택·목록 UI
js/studio-share.js 공유 모달·갤러리 입장·작품 게시
js/share-local-store.js 로컬 갤러리 IndexedDB·객체 URL 수명
js/share-store.js  갤러리 서버 통신·로컬 폴백·표지 생성
tools/runtime-scripts.cjs HTML의 실제 로드 순서를 읽는 공통 검증 로더
```

## 음원 추가/교체

`js/manifest.js`에서 수정합니다.

- **배경 음원**: `backgrounds.<id>`에 `label`과 `src`(예: `sound/배경-분위기/고요한(우주).mp3`)를 넣고, `atmospheres`에 같은 `id`로 항목을 추가하면 배경 카드와 1:1로 매칭됩니다. 카드 클릭 시 그 `src`가 미리듣기로 재생됩니다. (선생님이 화면에서 직접 올린 음원은 그 세션에만 유지됩니다.)
- **선율 악기**: `melodies.<악기>`에 `src`와 기준음 `baseMidi`를 지정합니다(단일음 샘플은 피치 시프트, 긴 구절은 `sampleMode: "phrase"`).
- **효과음**: `effects`에 추가하고 장면의 `effectIds`에 연결합니다. 자연 효과음(바람·비·숲·천둥)은 `tools/build-nature-effects.py`로 다듬어 넣습니다 — 도장 미리듣기가 앞 1.2초만 들려주므로 이름에 맞는 순간을 파일 맨 앞에 두고, 이름의 세기에 맞춰 음량(LUFS)을 정합니다.

## 테스트

```powershell
npm test          # 순수 로직·모듈 계약·행동 테스트 (node --test)
```

통합 스모크(선택, jsdom 필요 — 오디오/캔버스는 스텁):

```powershell
npm install --no-save --package-lock=false jsdom
npm run test:smoke
```

실제 브라우저 검증(선택, Playwright·Chromium 필요):

```powershell
npm install --no-save --package-lock=false jsdom playwright
npx playwright install chromium
# 다른 터미널에서 npm run serve 실행 후
npm run test:browser
```

이 검증은 새 브라우저 프로필에서 그림 업로드·그리기·실행 취소·저장·복원·재생, PNG/WebM 내보내기, 실제 IndexedDB 갤러리의 게시·복사·삭제와 늦은 응답 처리를 확인합니다. 공유 API는 로컬 응답으로 대체하므로 배포된 갤러리에 쓰지 않습니다. 스크린샷·다운로드·결과 JSON은 `output/refactor-review/`에 저장됩니다.

이미 설치한 도구는 `$env:PLAYWRIGHT_MODULE`(모듈 경로)과 `$env:CHROME_PATH`(실행 파일 경로)로 지정할 수 있습니다. `$env:STUDIO_URL`은 로컬 서버 주소만 허용합니다. 작업 전 소스 복사본이 있으면 `$env:REFACTOR_BASELINE_DIR`를 지정해 같은 음원으로 13개 악기의 PCM과 도화지 픽셀을 정확히 비교할 수 있습니다. 이 옵션을 생략하면 현재 동작만 검증합니다.

로드 순서의 기준은 `studio.html`·`channel.html`입니다. 스모크·오디오 테스트·측정 도구가 공통 로더로 이 순서를 읽으며, `test/runtime-scripts.test.js`가 파일 존재·중복·의존 순서를 검사합니다.

브라우저 콘솔에서 `window.SoundDrawing` 으로 상태 확인이 가능합니다:
`getStateSummary()`, `play()`, `pause()`, `resume()`, `stop()`, `exportAudio()`, `exportDrawingImage()`, `exportDrawingVideo()`, `buildRecipe()`, `loadRecipe(recipe)`, `setStep(n)`.

## 설계 문서

`docs/specs/2026-06-15-sound-drawing-atelier-design.md`, `docs/plans/2026-06-15-sound-drawing-atelier.md`

런타임 구조와 검증 근거: [책임 분리 결정](docs/decisions/2026-10-03-runtime-responsibility-refactor.md), [리팩토링 작업·검증 기록](docs/plans/2026-10-03-runtime-refactor.md).
