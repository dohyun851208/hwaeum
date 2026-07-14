# 브라우저 런타임 모듈 경계와 로드 순서

확인일: 2026-07-14

## 결론

빌드 단계는 도입하지 않고 `studio.html`의 classic `<script>` 순서와 브라우저 전역을 런타임 연결 규칙으로 유지한다. 대신 큰 오디오·스튜디오 파일의 계산과 상태 책임을 다음 경계로 분리한다.

- `music-core.js`: 음계·좌표·리듬·루프 검출 같은 순수 음악 규칙
- `audio-plan.js`: 샘플 선택, 악기별 음 변환, 획/프레이즈와 탐색 구간을 만드는 순수 재생 계획
- `audio-node-scope.js`: transport/preview source와 연결 노드의 수명 범위
- `audio-pad-graph.js`: 전체 재생과 드로잉 ambience가 공유하는 합성 패드 음색 그래프
- `audio-engine.js`: 위 결과를 Web Audio에 스케줄하는 facade와 transport 상태 머신
- `studio-transport.js`: UI 재생 버튼, 플레이헤드, 무배경 시계, 배경 구간 플레이어의 단일 시간 상태
- `studio-export.js`: WebM 음악과 PNG/WebM 시각물 내보내기 워크플로
- `studio.js`: 위저드 상태와 모듈 연결을 맡는 최상위 오케스트레이터

`AudioEngine`의 `isStarting`, `playGen`, pause/resume, 자동 종료 타이머와 `onState`는 facade에 남긴다. 저장 레시피 형식과 `window.SoundDrawing` 공개 API도 유지한다.

## 비교

| 방식 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 번들러·ES module로 전환 | 정적 import와 의존 분석이 쉬움 | 배포·교실 실행 방식과 테스트 환경을 한꺼번에 바꿈 | 이번에는 미채택 |
| 큰 파일을 기능별 클래스로 전면 재작성 | 최종 구조를 한 번에 정리 가능 | 오디오 시간 상태와 브라우저 비동기 회귀 범위가 큼 | 미채택 |
| classic 전역을 유지하고 순수 계산·노드 수명·UI 시간 상태만 추출 | 빌드 없는 실행을 유지하면서 작은 단위 행동 테스트 가능 | HTML·스모크·VM 로더 순서를 함께 관리해야 함 | 채택 |

## 로드 순서

`studio.html`과 모든 전체 로더는 아래 상대 순서를 지킨다.

```text
music-core
→ manifest
→ sample-maps / sample-maps-western
→ audio-plan
→ audio-node-scope
→ audio-pad-graph
→ audio-engine
→ drawing / takes / share-store
→ studio-utils / studio-export / studio-setup-render / studio-transport
→ studio
```

새 런타임 모듈을 추가하거나 순서를 바꿀 때는 다음을 같은 변경에서 갱신한다.

- `studio.html`
- `tools/smoke.cjs`
- VM으로 엔진·스튜디오를 읽는 테스트 로더
- `test/audio-assets.test.js`의 존재·순서 계약

## 적용 방향

- 순수 계층은 DOM과 Web Audio 객체를 캡처하지 않고 필요한 core/data를 호출 시 주입한다.
- transport와 preview source는 별도 scope에 등록한다. `stop()`은 두 범위를 모두 정리하고, 비동기 미리듣기는 세대 토큰으로 정지 뒤 재생을 막는다.
- pad graph 모듈은 노드 연결과 음색만 만든다. gain envelope, start/stop, loop 정책은 전체 재생과 ambience 호출부가 각각 소유한다.
- 스튜디오 transport는 공유 시간 상태를 한 팩토리에 모으되 엔진 내부 transport 상태 머신을 복제하지 않는다.
- 소스 위치를 정규식으로 확인하는 대신 가짜 시계·엔진·Audio와 모듈 계약을 이용한 행동 테스트를 우선한다.
