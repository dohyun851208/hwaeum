# docs/ — 설계 문서

세 갈래로 나눕니다. 새 문서는 해당 폴더에 `YYYY-MM-DD-제목.md`로 만듭니다.

> 📄 이 파일은 `docs/AGENTS.md`(Codex)와 **동일 내용** — 고칠 땐 둘 다.

| 폴더 | 용도 | 언제 쓰나 |
| --- | --- | --- |
| `specs/` | **설계 명세** — 무엇을 어떻게 만들지 | 기능/화면을 새로 설계할 때 |
| `plans/` | **구현 계획** — 단계·작업 분해 | 명세를 실제 작업으로 쪼갤 때 |
| `decisions/` | **의사결정 기록(ADR)** — 무엇을 왜 골랐는지 | 라이브러리·구조 등 되돌리기 어려운 선택을 할 때 |

## 현재 문서

- `specs/2026-06-15-sound-drawing-atelier-design.md` — 초기 설계 명세
- `plans/2026-06-15-sound-drawing-atelier.md` — 초기 구현 계획
- `decisions/2026-06-15-music-library-choice.md` — Tone.js + Tonal.js 채택 근거
- `decisions/2026-06-27-unified-gugak-palette.md` — 국악기 드로잉 팔레트 통일
- `decisions/2026-06-28-instrument-loudness-calibration.md` — 악기별/음별 선율 음량 보정 기준
- `decisions/2026-06-28-channel-secondary-password.md` — 채널 이원화(고유번호/채널 이름) + 갤러리 코드 점유
- `decisions/2026-06-29-fixed-drawing-pitch-grid.md` — 악기 변경 시 도화지 음높이 행 고정
- `decisions/2026-06-29-modern-gallery-frontdoor.md` — 메인·스튜디오 첫 화면 모던 갤러리 톤 적용
- `decisions/2026-07-01-channel-code-length.md` — 화음 갤러리 번호·코드 길이 축소
- `decisions/2026-07-02-sustain-loop-stable-region.md` — 지속음 루프 구간 포락선 기반 검출(파일럿: 더블베이스)
- `decisions/2026-07-03-instrument-scoped-pitch-axis.md` — 도화지 축을 선택 악기 기준으로 표시(국악 10칸, 저장/화면 좌표 분리)
- `decisions/2026-07-14-runtime-module-boundaries.md` — 빌드 없는 classic 스크립트의 오디오·transport 모듈 경계와 로드 순서
- `decisions/2026-07-26-instrument-listening-note.md` — 2단계 악기 설명을 예시 답안으로 감추고 감상 노트 입력칸 제공
- `decisions/2026-07-29-mis-cut-sample-head-trim.md` — 원본 테이크의 "그 음이 아닌 머리"를 큐레이션 단계에서 트림(첫 사례: 비올라 레)
- `decisions/2026-07-29-live-preview-note-gain-clamp.md` — 펜 소리의 음별 음량 보정이 기준 게인 천장에 다시 잘리던 문제(비올라·프렌치호른)
- `decisions/2026-07-29-pen-preview-stable-region-start.md` — 펜 소리는 샘플 어택 대신 안정 구간(loopStart)에서 시작(여린 세기 녹음의 느린 음정 온셋 해결)
- `decisions/2026-07-31-studio-workflow-modules.md` — `studio.js`의 시도 UI·공유 UI를 콜백 주입형 classic-script 팩토리로 분리

- `decisions/2026-10-02-sustain-source-calibration.md` — 지속음 접합·음별 소스 전환·조율·가야금 자연 감쇠 통일
- `decisions/2026-10-02-natural-melody-transitions.md` — 경계 떨림 억제·등전력 전환·자연 비브라토·첫 어택·해금 미끄러짐 복원
- `decisions/2026-10-02-preview-recipe-compaction.md` — 펜 경로의 전체 획 처리 제거·음 경계와 체류 판정을 보존하는 좌표 압축
- `decisions/2026-10-02-cello-lowest-g-take.md` — 첼로 맨 아래 솔을 고르게 유지되는 같은 음 fortissimo 테이크로 고정(`TAKE_OVERRIDES`)
- `decisions/2026-10-03-steady-sustain-takes.md` — 지속음 160칸 검사 후 고르지 않거나 작게 나는 서양 16칸(오보에 11칸)을 같은 음 다른 테이크·반음 옆 녹음으로 교체
- `decisions/2026-10-03-loudness-audit.md` — 170칸 음량 전수 점검: 측정 도구 스테레오·국악 필터 오차 수정, 펜 소리 상한 분리, 튀는 서양 녹음 17칸 교체, 국악 4악기 음별 보정 한도 ±12 dB
- `decisions/2026-10-03-perceived-loudness-a-weighting.md` — 악기끼리의 크기를 RMS 대신 귀 기준 A-가중(음별 보정 뒤)으로 맞춤: 비교 청취로 결정, 첼로 +3.9·더블베이스 +8.3·호른·대금 +3.2 dB, 가야금만 RMS, 음별 보정은 그대로
- `decisions/2026-10-04-haegeum-resonance-cuts.md` — 해금의 울림통 콧소리 공명(1.4~1.8 kHz)을 두 곳에서 −14 dB 깎고 미끄러짐을 0.12→0.05초로: 무료 출처 셋이 모두 같은 음색이라 녹음 교체 대신 음색 처리, 재생·펜·음 미리듣기 같은 필터, 해금 게인 0.29→2.00
- `decisions/2026-10-02-nature-effect-sound-match.md` — 자연 효과음을 이름에 맞게: 바람1↔2 맞바꿈, 이름의 순간을 맨 앞에, 없는 소리는 픽사베이 녹음(`build-nature-effects.py`)
- `decisions/2026-10-05-effect-stamp-loudness.md` — 효과음 도장이 배경·선율보다 9.5 dB 묻힌 것(배경·선율만 ×3 커짐)을 `EFFECT_GAIN` 0.15→0.45로 되돌리고, 도장끼리 24 dB 차이는 manifest `gain`으로 새소리 기준에 맞춤(`measure-effect-loudness.cjs` `LEVEL_DB`: 번개 +6·폭풍우·거센바람 +4·회오리바람·흑동고래 +3·가랑비·먼 천둥 −3), 찍은 뒤 끝까지 줄이던 페이드는 끝 0.3초만, 작게 들리던 바람 셋·번개·폭풍우·흑동고래는 노트북 대역에 소리가 있는 픽사베이 녹음으로 교체 · 2026-10-12 사용자 청취로 효과음 ×0.72(0.324)·배경 ×0.9, 배경 대비 경보선 −4 dB
- `decisions/2026-10-06-effect-stamp-length-band.md` — 도장은 시작점만 정하고 파일 길이만큼 나는 방식을 유지, 그 길이를 도화지에 옅은 띠로 보이고(manifest `duration`, 겹치면 진해짐) 재생 위치를 옮겨도 아직 울리는 도장을 이어서 냄(`seekPlan` `sourceOffset`)
- `decisions/2026-10-07-hands-on-audit-fixes.md` — 직접 써 보며 찾은 버그 전수조사 뒤 결정: 초기화·작품 열기·떠나기 보호(지문 비교), 내 작품 그림 한 번만 저장·저장 실패 알림, 길이는 `changeDuration` 한 길로, 오디오 대신 이름·설정을 남겨 다시 잇기, 내보내기 녹음 별도 컨텍스트, 합성음 크기 보정(`SYNTH_MELODY_TRIM_DB`), 로컬 갤러리는 API 없을 때만·목록에서 그림 빼기·다시 공유는 바꾸기, 보안 1번은 개방형이라 그대로
- `decisions/2026-10-03-instrument-example-pieces.md` — 2단계 악기 감상 연주곡을 같은 무리 카드와 같은 크기(LUFS)의 깨끗한 실제 녹음으로: 단소는 24 dB 작던 문덕곡 대신 국립국악원 청성곡, 먹먹하던 플루트·바이올린·더블베이스는 CC 실연 녹음(출처 줄·`라이센스.txt`)(`build-instrument-examples.py`)

- `decisions/2026-10-03-brush-to-melody-landing.md` — 붓질에서 그림·음표로 이어지는 메인 연출, 즉시 진입과 움직임 제어
- `specs/2026-10-03-landing-art-prompt.txt` — 메인 배경 생성 프롬프트
- `decisions/2026-10-03-instrument-brush-drawing.md` — 선율 보정 막대·획 겹침 제거, 악기 커서와 반짝임
- `decisions/2026-10-03-instrument-brush-portraits.md` — 13개 악기별 붓 그림·연주 자세(연주자는 붓 쪽·나팔과 숨결은 앞쪽, 가로 피리 수평·가야금 눕힘)·연주 몸짓(활·숨결·줄 떨림)·소리 성격을 옮긴 붓끝 효과(`instrument-brush.js`)
- `decisions/2026-10-03-magic-melody-line.md` — 도화지 선을 마법의 선율로: 빛무리·윤기·곡선 연결, 봉우리 음표, 자리가 정해진 금빛 반짝임(음마다 빛 구슬은 지저분해 제외)
- `decisions/2026-10-03-landing-intro-hierarchy.md` — 메인 연출 뒤 중앙 문구 표시, 붓글씨·입장하기 버튼, 상하단 보조 문구 제거
- `decisions/2026-10-03-flowing-landing-copy.md` — 연성체 제목과 겹쳐 이어지는 등장, 내부 도구 배치 유지
- `decisions/2026-10-03-picture-melody-landing.md` — 산수화 위에 선율을 긋는 메인: 손의 스프링 선·금박 음표·畵音 낙관·대금 선율 듣기(붓 연출 대체)
- `specs/2026-10-03-melody-landscape-prompt.txt` — 새 메인 배경·금박 음표 생성 프롬프트
- `decisions/2026-10-03-landing-sound-follows-line.md` — 선이 그어질 때 함께 들리는 소리: 자동 재생 시도, 막히면 첫 탭에 진행 중인 선으로 합류, 소리 스위치
- `decisions/2026-10-03-melody-colors-ink-painting.md` — 수묵으로 시작해 음마다 수채 번짐으로 채색되며 완성되는 메인, 음표는 금박처럼 가라앉음, 늦은 첫 클릭은 처음부터 연주
- `decisions/2026-10-03-landing-copy-into-button.md` — 메인 문구를 화음 + [내 그림에 선율 더하기] 버튼 두 요소로 축소
- `decisions/2026-10-03-two-stage-ink-reveal.md` — 어둠에서 음마다 먹 풍경이 드러나고 노래가 끝나면 선에서부터 채색되어 선명하게 완성
- `decisions/2026-10-03-landing-quick-enter.md` — 메인 우측 하단의 움직임 멈추기를 빼고 같은 모양의 → 바로 시작하기 링크로(다시 오는 사람용, 보이는 문구는 그대로)
- `decisions/2026-10-03-studio-ink-frame-renewal.md` — 스튜디오 내부를 먹 액자(머리띠·단계·낙관) + 한지 작업면으로, 판 안의 판·노란 채움·중복 소제목 정리(`styles.css` `@renewal-2026-10` 구간)
- `decisions/2026-10-03-studio-hanji-type-fields.md` — 먹색 머리띠 대신 한지 위 한 줄 머리·단계 줄, Pretendard 한 가족 4굵기(`assets/fonts/hwaeum-sans.css`), 모든 적는 칸 같은 모양, 낱말 단위 줄바꿈(keep-all), 2단계 카드+메모 한 장, 읽는 글자 14px 바닥·3단계 팔레트 정리
- `decisions/2026-10-03-ink-gallery-renewal.md` — 화음 갤러리를 메인의 먹빛 전시실로: 매트 액자+이름표, 입구·잠김은 가운데에서 맞이(`body[data-gallery-state]`), 크림 주 단추, Pretendard(`styles.css` `@gallery-renewal-2026-10` 구간)
- `decisions/2026-10-03-gallery-museum-walls.md` — 갤러리 작품 벽(한눈에 보기·커버플로우)을 예전 전시실(사진 벽·나무 선반·정사각 표지·얇은 금빛 선)로 되돌림, 머리줄·글꼴·먹빛 로비는 유지, 이름표 「제목 (작곡가)」 한 줄·단어 14px
- `decisions/2026-10-04-studio-night-wall.md` — 스튜디오를 밤의 벽에 건 한지 작업판으로: 바탕·로고·단계 줄은 메인·갤러리와 같은 먹빛(크림·금빛), 글이 많은 판 안은 밝은 한지 + 얇은 금선, 색 변수 두 겹(`body` 밤 / `.screen` 한지), 판 위 흐린 글자 보정. 같은 날 시도한 전체 밤은 가독성 때문에 되돌림(`styles.css` `@renewal-2026-10` 구간)

- `plans/2026-10-03-runtime-refactor.md` — 런타임 책임 분리 범위·단계·검증 결과
- `decisions/2026-10-03-runtime-responsibility-refactor.md` — 샘플·그림 렌더·레시피·감상·로컬 저장 모듈 분리와 HTML 기반 검증 로더

## 작성 규칙

- 파일명: `YYYY-MM-DD-짧은제목.md` (날짜 = 작성/결정일)
- ADR은 **결론 → 비교 → 적용 방향** 순서로 (decisions의 기존 문서 형식 따르기)
- 코드와 어긋나면 문서가 아니라 **현재 코드가 진실** — 결정이 바뀌면 새 ADR를 추가(기존 것 삭제 X)
