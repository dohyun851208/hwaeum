# js/ — 코드 레이어

브라우저가 `<script type="module">`로 직접 로드하는 ES module들. **번들·트랜스파일 없음.**
전체 제약·데이터 흐름은 루트 `../CLAUDE.md` 참고.

> 📄 이 파일은 `js/AGENTS.md`(Codex)와 **동일 내용** — 고칠 땐 둘 다.

## 모듈별 책임

| 파일 | 책임 | 의존 |
| --- | --- | --- |
| `music-core.js` | **순수 로직** — 음계·피치 보정·시간 재샘플링·리듬·시김새·레시피 코덱·WAV 인코딩 | 없음(DOM·오디오 X) |
| `manifest.js` | **데이터** — 음원·배경·악기·음계 카탈로그 | 없음 |
| `sample-maps.js` | 악기 샘플 매핑(음이름→샘플, 피치 보정 기준) | 없음 |
| `audio-engine.js` | Web Audio 합주(라이브 + 오프라인 렌더)·피치 시프트·시김새·**합성 폴백** | Web Audio, music-core, manifest, sample-maps |
| `drawing.js` | 캔버스 드로잉·가이드/팔레트 렌더·보정 음 오버레이 | Canvas, music-core |
| `takes.js` | 시도(테이크) 저장·비교(localStorage)·썸네일 | localStorage |
| `studio.js` | **오케스트레이터** — 5단계 위저드 흐름·업로드·무드 틴팅·재생·내보내기·공유 | 위 전부, DOM |

## 의존 방향 (지킬 것)

```
manifest · sample-maps (데이터, 무의존)
        └─ music-core (순수 로직, DOM/오디오 무의존)  ← 테스트 가능 핵심
              ├─ audio-engine (Web Audio)
              ├─ drawing      (Canvas)
              └─ takes        (localStorage)
                    └─ studio  (DOM 오케스트레이터, 최상위)
```

- **`music-core.js`에 DOM·Web Audio·localStorage를 들이지 마세요.** 순수해야 `test/`에서 검증됩니다.
- 하위 모듈이 `studio.js`를 거꾸로 import하지 않게(순환 의존 금지).

## 어디를 고치나

- 새 악기/음원/배경 추가 → `manifest.js` (+ 필요 시 `sample-maps.js`)
- 음 보정·리듬·시김새·음계 규칙 → `music-core.js` (테스트 동반)
- 합성음/실제음 폴백, 렌더 품질 → `audio-engine.js`
- 캔버스 입력·가이드 표시 → `drawing.js`
- 위저드 단계·화면 연결·내보내기·공유 → `studio.js`

## 테스트

`music-core.js`가 1차 테스트 대상(`../test/music-core.test.js` 등). 로직을 바꾸면 같은 PR에 테스트를 함께.
`window.SoundDrawing` 디버그 API는 `studio.js`가 노출.
