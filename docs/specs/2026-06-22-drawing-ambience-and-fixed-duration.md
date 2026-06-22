# 드로잉 중 배경음 + 곡 길이 30초 고정

작성일: 2026-06-22

## 무엇을

1. **드로잉 화면 배경음** — 5단계(드로잉)에서 선택한 분위기의 배경 패드가 잔잔히 루프로 깔리고, 그 위에 그리는 선율 라이브 프리뷰가 실시간으로 얹힌다. (이전엔 그릴 때 선율만 났고, 배경은 재생 버튼을 눌러야만 합쳐졌다.)
2. **곡 길이 30초 고정** — 1단계의 15/30/45초 선택을 없애고 30초로 고정한다. 팔레트는 항상 3칸(10초×3).

## 어떻게

### 드로잉 배경음 (audio-engine.js + studio.js)

- `AudioEngine.startAmbience(recipe)` / `stopAmbience(immediate)` 추가.
  - 분위기 **패드만** 무한 루프로 재생(효과음·천둥은 제외 — 그리는 데 방해). 실제 음원이 있으면 버퍼 루프, 없으면 합성 패드 화음.
  - 볼륨은 완성곡과 같은 `version.padGain`으로 페이드 인/아웃.
  - 라이브 선율 프리뷰(`liveDrawing*`)와 **독립**. `stop()`은 배경음을 끄지 않는다(악기 변경 등으로 `engine.stop()`이 불려도 배경음 유지).
  - 경쟁 상태는 `ambienceToken`으로 무효화(라이브 프리뷰의 `livePreviewToken`과 동일 패턴).
  - 시그니처(`atmosphere.id|version.id`)가 같으면 재시작하지 않아 끊김이 없다(악기만 바꾸면 배경음 유지, 분위기·믹스를 바꾸면 갱신).
- 트리거(studio.js):
  - `setStep`에서 5단계(`step===4`) 진입 시 `startAmbience`, 벗어나면 `stopAmbience`.
  - 완성곡 재생(`engine.play`)은 시작 시 `stopAmbience`로 배경음을 끄고, 재생이 끝나면 `onState(false)` 콜백에서 5단계면 배경음을 다시 깐다.
  - 믹스(버전) 변경 시 5단계면 `startAmbience` 재호출로 볼륨 갱신.

### 곡 길이 고정 (index.html + studio.js)

- index.html: 곡 길이 세그먼트 버튼·`paletteHint` 제거, 단계명 "그림·길이"→"그림", 1단계 제목/안내 문구 정리.
- studio.js: `data-duration` 클릭 핸들러와 레시피 길이 버튼 동기화 제거, `state.duration`은 30 고정. 옛 레시피를 불러와도 30초로 정규화.

## 검증

- `npm test`는 순수 로직 대상이라 영향 없음(통과 유지).
- 서버로 띄워 드로잉 중 배경음/선율 합주, 재생 전환, 길이 고정을 직접 확인(오디오는 청취 확인 필요).
