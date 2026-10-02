# js/ — 코드 레이어

브라우저가 classic `<script>`로 의존 순서대로 로드하고 `window` 전역으로 연결하는 모듈들. **번들·트랜스파일 없음.** 새 파일을 추가하면 `studio.html`·`tools/smoke.cjs`·테스트 로더의 순서를 함께 갱신합니다.
전체 제약·데이터 흐름은 루트 `../CLAUDE.md` 참고.

> 📄 이 파일은 `js/AGENTS.md`(Codex)와 **동일 내용** — 고칠 땐 둘 다.

## 모듈별 책임

| 파일 | 책임 | 의존 |
| --- | --- | --- |
| `music-core.js` | **순수 로직** — 음계·피치 보정·시간 재샘플링·리듬·시김새·레시피 코덱·WAV 인코딩 | 없음(DOM·오디오 X) |
| `manifest.js` | **데이터** — 음원·배경·악기·음계 카탈로그 | 없음 |
| `sample-maps.js` | 악기 샘플 매핑(음이름→샘플, 피치 보정 기준) | 없음 |
| `sample-calibration.js` | 체크인된 MP3의 실제 안정 구간 조율값. 기존 차용 cents와 별도로 적용 | manifest, sample-maps, sample-maps-western 뒤 |
| `audio-plan.js` | **순수 재생 계획** — 샘플 선택·악기별 음 변환·획/프레이즈·탐색 구간 계산 | 호출 시 music-core, manifest 주입 |
| `audio-node-scope.js` | transport/preview AudioScheduledSourceNode 수명·정리 범위 | 없음 |
| `audio-pad-graph.js` | 전체 재생·드로잉 ambience가 공유하는 합성 패드 음색 그래프 | Web Audio 인터페이스 |
| `audio-engine.js` | Web Audio 합주(라이브 + 오프라인 렌더)·피치 시프트·시김새·**합성 폴백** | music-core, manifest, sample-maps, audio-plan/node-scope/pad-graph |
| `drawing.js` | 캔버스 드로잉·가이드/팔레트 렌더·보정 음 오버레이 | Canvas, music-core |
| `takes.js` | 시도(테이크) 저장·비교(localStorage)·썸네일 | localStorage |
| `studio.js` | **오케스트레이터** — 5단계 위저드 흐름·업로드·무드 틴팅·하위 워크플로 연결 | 위 전부, DOM |
| `studio-export.js` | WebM 음악·커버 PNG·드로잉 PNG/WebM 내보내기 워크플로 | studio.js에서 호출 |
| `studio-setup-render.js` | 분위기·악기 선택 화면 렌더(2단계 악기 감상 노트·예시 답안 포함) | studio.js에서 호출 |
| `studio-transport.js` | 재생 버튼·플레이헤드·무배경 시계·배경 구간 플레이어의 시간 상태와 제어 | AudioEngine, DrawingCanvas |
| `studio-sound-layers.js` | 3단계 사용자 소리 업로드(최대 3개)·원본 구간/작품 시작점/음량·단독 미리듣기 UI | AudioEngine, studio.js에서 주입한 상태/콜백 |
| `studio-takes-ui.js` | 시도 저장·다시 저장·선택·목록 카드·시도별 재생/내보내기 UI | TakesStore, studio.js에서 주입한 콜백 |
| `studio-share.js` | 공유 필수 항목 검사·공유 모달·갤러리 입장/생성·작품 게시·레시피 링크 | share-store, studio.js에서 주입한 콜백 |
| `studio-utils.js` | 공통 유틸(duration 정규화·메타 sanitize·색 변환 등) | studio.js 전반 |
| `share-store.js` | 화음 갤러리 서버 I/O(publish·list·delete·claim) | studio-share.js, channel.js |

## 의존 방향 (지킬 것)

```
music-core (순수 음악 규칙) ─┬─ drawing (Canvas)
                             └─ audio-plan (순수 재생 계획) ─┐
manifest · sample-maps ───────────────────────────────────────┤
audio-node-scope · audio-pad-graph ───────────────────────────┴─ audio-engine (Web Audio)
takes · studio-utils · studio-export · studio-setup-render · studio-transport · studio-takes-ui · studio-share
                                      └───────────────────────── studio (DOM 최상위)
```

- **`music-core.js`에 DOM·Web Audio·localStorage를 들이지 마세요.** 순수해야 `test/`에서 검증됩니다.
- **`audio-plan.js`에도 DOM·Web Audio를 들이지 마세요.** 엔진에서 core/data를 호출 시 주입합니다.
- 하위 모듈이 `studio.js`를 거꾸로 import하지 않게(순환 의존 금지).

## 어디를 고치나

- 새 악기/음원/배경 추가 → `manifest.js` (+ 필요 시 `sample-maps.js`)
- 음 보정·리듬·시김새·음계 규칙 → `music-core.js` (테스트 동반)
- 샘플 선택·악기별 음 변환·탐색 계획 → `audio-plan.js`
- 안정 구간·접합·완만한 포락선 보정·자연 감쇠 끝 검출 → `music-core.js`
- 원음 조율 재측정 → `../tools/measure-sustain.cjs`, `../tools/calibrate-sustain.py` → `sample-calibration.js`
- 합성음/실제음 폴백·렌더 품질 → `audio-engine.js`
- 재생 노드 수명 → `audio-node-scope.js`, 합성 배경 패드 음색 그래프 → `audio-pad-graph.js`
- 캔버스 입력·가이드 표시 → `drawing.js`
- 위저드 단계·화면 연결·무드 틴팅·재생 → `studio.js`
- 음악·이미지·영상 내보내기 → `studio-export.js`
- 분위기·악기 선택 화면 렌더 → `studio-setup-render.js`
- 재생·일시정지·정지·플레이헤드·배경 구간 시간 상태 → `studio-transport.js`
- 사용자 소리 업로드·자르기·배치·미리듣기 UI → `studio-sound-layers.js`
- 시도 저장·선택·목록 카드·시도별 동작 → `studio-takes-ui.js`
- 공유 모달·화음 갤러리 입장/생성·작품 게시·레시피 링크 → `studio-share.js`
- 공통 유틸(duration·색·메타) → `studio-utils.js`
- 화음 갤러리 서버 통신 → `share-store.js`

## 테스트

`music-core.js`가 1차 테스트 대상(`../test/music-core.test.js` 등). 로직을 바꾸면 같은 PR에 테스트를 함께.
`window.SoundDrawing` 디버그 API는 `studio.js`가 노출.
