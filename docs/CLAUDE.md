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

## 작성 규칙

- 파일명: `YYYY-MM-DD-짧은제목.md` (날짜 = 작성/결정일)
- ADR은 **결론 → 비교 → 적용 방향** 순서로 (decisions의 기존 문서 형식 따르기)
- 코드와 어긋나면 문서가 아니라 **현재 코드가 진실** — 결정이 바뀌면 새 ADR를 추가(기존 것 삭제 X)
