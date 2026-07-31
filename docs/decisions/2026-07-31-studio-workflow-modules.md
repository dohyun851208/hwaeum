# 스튜디오 시도·공유 워크플로 모듈 경계

확인일: 2026-07-31

## 결론

`studio.js`가 직접 맡던 시도 목록 UI와 공유 UI를 각각 콜백 주입형 classic-script 팩토리로 분리한다.

- `studio-takes-ui.js`: 시도 저장·다시 저장·선택·목록 카드·시도별 재생/내보내기
- `studio-share.js`: 공유 필수 항목 검사·번호/코드 모달·갤러리 입장/생성·작품 게시·레시피 링크
- `studio.js`: 위저드의 단일 `state`, 레시피 생성/복원, 단계 이동, 하위 팩토리 초기화, `window.SoundDrawing` 공개 API 연결

두 하위 모듈은 상태 저장소를 새로 만들지 않는다. `studio.js`가 같은 `state` 참조와 필요한 DOM·서비스·콜백만 주입하며, 하위 모듈은 `studio.js`를 역참조하거나 import하지 않는다. 기존 저장 레시피 형식과 `window.SoundDrawing` 공개 API는 유지한다.

## 비교

| 방식 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 모든 UI 워크플로를 `studio.js`에 유지 | 파일 수와 script 태그가 적음 | 서로 다른 변경 이유가 한 파일에 쌓이고 소스 기반 테스트가 오케스트레이터 내부 구현에 결합됨 | 미채택 |
| 전역 상태 저장소를 새로 만들고 각 모듈이 구독 | 모듈 사이 상태 전달이 표준화됨 | 현재 단일 정적 앱에 비해 상태 동기화·이벤트 수명 복잡도가 크게 늘어남 | 미채택 |
| 단일 상태 소유권은 유지하고 기능별 팩토리에 의존성을 주입 | 빌드 없는 실행과 기존 API를 유지하면서 워크플로 단위 행동 테스트 가능 | 주입 목록과 classic script 순서를 명시적으로 관리해야 함 | 채택 |

## 적용 방향

- `studio.html`과 `tools/smoke.cjs`는 기반 모듈 뒤, `studio.js` 앞에 `studio-takes-ui.js`와 `studio-share.js`를 같은 순서로 로드한다.
- 각 팩토리는 브라우저 전역(`HwaeumStudioTakesUI`, `HwaeumStudioShare`)과 CommonJS factory 계약을 함께 제공한다.
- 공유 서버 요청 자체는 계속 `share-store.js`가 맡고, `studio-share.js`는 입력 검사·진행 상태·화면 이동을 조율한다.
- 레시피 해시를 실제 앱 상태로 복원하는 일과 공개 QA API 노출은 최상위 오케스트레이터에 남긴다.
- 새 모듈의 핵심 분기에는 직접 행동 테스트를 두고, 전체 DOM 배선·레시피 링크·시도 카드는 jsdom 스모크로 함께 검증한다.
- 과거에 제거한 갤러리 뷰어용 `studio-share-ui.js`는 되살리지 않는다. 이번 `studio-share.js`는 스튜디오의 게시/입장 워크플로만 담당한다.
