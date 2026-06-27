# 메인 히어로 회전 샘플 인수인계

작성일: 2026-06-27

## 현재 상태

- 실제 앱 메인에는 아직 적용하지 않았다.
- 샘플 페이지는 `samples/hero-3d-preview.html`에 있다.
- 로컬 확인 URL은 `http://localhost:4173/samples/hero-3d-preview.html`이다.
- 현재 샘플은 검은 배경 위에 중앙 텍스트 `화음`을 고정하고, 주변 앨범 자켓 6개가 타원 궤도로 천천히 회전한다.
- 마우스로 히어로 영역을 누르고 드래그하면 회전 방향과 속도가 바뀐다.
- CTA는 `시작하기` 버튼 하나만 남겨두었다.

## 참고한 원본

- 사용자가 처음 언급한 `C:\game\live`는 잘못된 경로였다.
- 실제 참고 경로는 `C:\Users\geunt\OneDrive\Desktop\평가도우미 수정중`이다.
- 참고 프로젝트의 상단 섹션은 `index.html`의 `heroSection`과 `landing.css`의 `.hero-partners`, `.orbit-ring`, `.orbit-char` 구조를 사용한다.
- 참고 프로젝트는 고정 CSS 회전이 아니라 JS에서 타원 트랙 좌표를 계산하고, pointer 이벤트로 회전 방향을 정한다.
- 관련 원본 로직은 참고 프로젝트 `index.html` 하단의 `Interactive 2D Orbit (desktop only)` 블록이다.

## 샘플 구현 요약

- `samples/hero-3d-preview.html`
  - `.world` 안에 `.orbit-ring`과 `.album-card` 6개를 배치했다.
  - JS가 각 카드에 `--o-left`, `--o-top`, `--o-scale`, `--o-z`를 계속 갱신한다.
  - `buildTrackSamples()`와 `getTrackPoint()`로 superellipse 계열 타원 궤도를 만든다.
  - `pointerdown`, `pointermove`, `pointerup`으로 드래그 방향을 계산한다.
  - 중앙 텍스트는 `.title-stack`으로 고정한다.

## 사용 중인 이미지 자산

- `assets/hero/hero-night.webp`
- `assets/hero/hero-sun.webp`
- `assets/hero/hero-forest.webp`
- `assets/hero/hero-dusk.webp`
- `assets/hero/hero-gugak.webp`
- `assets/hero/hero-harmony.webp`

`hero-playlist` 이미지는 숫자 `5`가 보여서 현재 샘플에서는 쓰지 않았다.

## 검증 기록

- `Invoke-WebRequest http://localhost:4173/samples/hero-3d-preview.html` 응답 `200` 확인.
- 위 6개 WebP 이미지 응답 `200` 확인.
- 삽입한 `<script>` 블록을 `new Function(...)`으로 문법 확인.
- Playwright로 1440x900에서 2.2초 후 렌더링 확인.
- Playwright에서 마우스 드래그 후 카드 좌표가 바뀌는 것 확인.
- `npm test` 통과: 119개 통과, 실패 0개.

## 다음 작업 제안

1. 이 샘플을 실제 `index.html` 첫 화면으로 옮길지 확정한다.
2. 옮긴다면 현재 4단계 위저드 진입 구조와 충돌하지 않도록 메인 진입 화면/앱 시작 흐름을 먼저 정한다.
3. `samples/hero-3d-preview.html`의 CSS/JS를 그대로 복사하지 말고, 실제 앱 구조에 맞춰 별도 섹션으로 정리한다.
4. 메인 적용 후에는 `npm test`와 로컬 서버 브라우저 확인을 다시 한다.
5. 배포 전에는 `assets/hero/` 이미지들이 git에 포함되는지 확인한다.

## 주의 사항

- 현재 작업 트리에는 이 샘플과 무관한 변경 파일들이 있다. 이어서 작업할 때 임의로 되돌리지 말 것.
- 이 문서는 샘플 인수인계용이며, 최종 제품 결정이 확정되면 `docs/decisions/`에 ADR을 따로 남기는 것이 좋다.
