# 음악 라이브러리 선택 기록

확인일: 2026-06-16

## 결론

- 샘플 기반 브라우저 재생: Tone.js
- 음계/노트 이름/MIDI 계산: Tonal.js
- 국악 음원: 범용 라이브러리보다 프로젝트 전용 샘플맵 필요

## 비교

| 후보 | GitHub stars | 상태 | 판단 |
| --- | ---: | --- | --- |
| Tone.js | 14,645 | active | Web Audio, Sampler, 스케줄링에 가장 적합 |
| Tonal.js | 4,193 | active | 도레미/음계/노트 계산에 가장 적합 |
| music21 | 2,511 | active | Python 분석 도구라 브라우저 앱에는 부적합 |
| teoria | 1,372 | 오래됨 | 기능은 맞지만 마지막 push가 오래됨 |
| WebAudioFont | 975 | active | GM 악기용, 국악 샘플맵에는 직접적이지 않음 |
| tonejs-instruments | 530 | 제한적 | 서양 악기 샘플 참고용 |
| soundfont-player | 475 | archived | 새 적용 비추천 |
| smplr | 303 | active | 가볍지만 생태계/문서 규모가 작음 |

## 적용 방향

Tone.js의 `Sampler`는 `C4.wav`, `D4.wav`처럼 음이름별 샘플을 매핑하고 없는 음은 가까운 샘플에서 피치 보정한다. 국악 음계 연주 파일 하나를 쓰려면 `C4: { offset, duration }` 같은 프로젝트 전용 타임스탬프 샘플맵이 필요하다.

Tonal.js는 `Scale.get(...)`, `Note.midi(...)`, `Midi.toMidi(...)` 계열 API로 음계와 MIDI 번호를 계산한다. 현재 앱의 `music-core.js`가 기본 음계 계산을 갖고 있으므로, 실제 적용 단계에서는 필요한 기능만 가져오거나 번들링하는 방식이 적합하다.
