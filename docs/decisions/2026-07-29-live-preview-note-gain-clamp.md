# 펜 소리의 음별 음량 보정은 기준 게인 천장에 다시 걸리지 않는다

확인일: 2026-07-29

## 결론

라이브 미리듣기(펜 소리)에서 **음별 보정(`NOTE_MELODY_OUTPUT_GAINS`)을 기준 게인과 같은 천장으로
다시 자르지 않는다.** 음별 상한을 따로 두고(`LIVE_PREVIEW_NOTE_MAX_GAIN = 2.2`),
`LIVE_PREVIEW_MAX_GAIN`(0.95)은 기준 게인에만 적용한다.

## 증상과 원인

3단계에서 **비올라로 그릴 때만** 펜 소리의 앞부분이 묻혀 들렸다. 첼로는 멀쩡했고,
그림으로 그리기·음악에 맞춰 그리기 **두 모드 모두** 같았으며, 전체 재생은 정상이었다.

```js
function livePreviewTargetGain(plan, noteEnvPeak) {
  ...
  return clamp(outputGain, 0.12, LIVE_PREVIEW_MAX_GAIN * boost)   // 0.95
}
function livePreviewNoteTargetGain(plan, noteEnvPeak, uiMidi) {
  const gain = livePreviewTargetGain(...) * noteMelodyOutputGainForUiMidi(...)
  return clamp(gain, 0.12, LIVE_PREVIEW_MAX_GAIN * boost)          // ← 같은 천장으로 또 자름
}
```

기준 게인이 이미 천장(0.95)에 닿아 있으면, 음별 보정(최대 1.413)을 곱한 뒤 같은 천장으로
다시 자르므로 결과가 0.95 그대로다 → `noteGainValue = 0.95 / 0.95 = 1.0`.
**보정이 통째로 사라진다.**

기준 게인은 `melodyGain × 1.5(서양) × 악기게인 × 0.595 × 0.56`이고, 악기게인이 클수록 천장에 닿는다.
악기별 실측(균형 버전):

| 악기 | 기준 게인 | 천장 도달 | 15칸 중 보정을 잃은 칸 |
| --- | --- | --- | --- |
| viola | 0.950 | **예** | **11** |
| frenchHorn | 0.950 | **예** | **10** |
| flute | 0.907 | 아니오 | 13 |
| oboe | 0.865 | 아니오 | 8 |
| clarinet | 0.764 | 아니오 | 3 |
| violin | 0.680 | 아니오 | 2 |
| doubleBass | 0.249 | 아니오 | 2 |
| cello | 0.613 | 아니오 | **0** |

비올라가 가장 심한 이유: `curate-western-samples.py`가 **비올라만 `piano`(여리게) 원본을 고른다**
(violin·cello는 `forte`, doubleBass는 `mezzo-forte`). 그래서 원본이 작고 → 악기 게인이 1.15로 가장 크고
→ 천장에 닿고 → 15칸 중 7칸이 보정 상한(+3 dB = 1.413)을 요구하는데 전부 버려졌다.
첼로는 기준 게인 0.613으로 여유가 있어 하나도 잃지 않았다 — 그래서 "비올라만" 이상하게 들렸다.

전체 재생 경로(`createNoteMelodyOutputGain`)에는 이 천장이 없다. 그래서 **펜 소리와 재생이 서로 달랐다.**

## 비교

| 방식 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 음별 상한을 따로 둠 (채택) | 기준 게인 천장은 그대로 → 전체 음량 변화 없음. 보정만 온전히 전달 | 상수가 하나 늘어남 | **채택** |
| `LIVE_PREVIEW_MAX_GAIN` 자체를 올림 | 상수 하나로 해결 | 기준 게인까지 올라가 비올라·프렌치호른 펜 소리가 전체적으로 커짐 | 미채택 |
| 천장에 맞춰 기준 게인을 낮춤(헤드룸 예약) | 천장 유지 | 보정이 필요한 음은 그대로고 **다른 음이 작아질 뿐** — 증상이 안 고쳐짐 | 미채택 |
| 음별 보정 표를 손으로 키움 | — | 측정 기반 보정 규칙 위반(루트 CLAUDE.md) | 금지 |

## 안전성 (실측)

천장을 아예 없앴다고 가정하고 15칸 × 8악기의 **실제 출력 최대**를 쟀다
(샘플 피크 × 기준 게인 × 음별 보정):

| 버전 | 보정을 온전히 전달하는 데 필요한 게인 | 그때 실제 출력 최대 | 클리핑까지 여유 |
| --- | --- | --- | --- |
| 균형(melodyGain 1.68) | 1.582 | 0.181 | 14.8 dB |
| 그림소리 강조(2.24) | **2.109** | **0.241** | **12.3 dB** |

음별 보정은 원본이 작은 음일수록 커지도록 측정된 값이라 **곱하면 서로 상쇄된다** —
그래서 게인이 2를 넘어도 출력은 0.25를 넘지 않는다. `LIVE_PREVIEW_NOTE_MAX_GAIN = 2.2`는
최악(2.109)을 통과시키면서 상한 자체는 남긴다.

## 적용 방향

- `js/audio-engine.js` — `LIVE_PREVIEW_NOTE_MAX_GAIN` 신설, `livePreviewNoteTargetGain`이 이 상한을 쓴다.
  `livePreviewTargetGain`(기준 게인)은 손대지 않는다.
- `test/audio-engine-live-note-gain.test.js` — 게인 표를 소스에서 읽어(재생성돼도 유효) 15칸 전부
  보정이 적용되는지, 가장 센 버전에서도 잘리지 않는지, 상한은 여전히 지켜지는지 검증.
  **고치기 전 코드에서 실패하는 것까지 확인했다.**
- 음별 보정 표(`NOTE_MELODY_OUTPUT_GAINS`)와 악기 게인은 **바꾸지 않았다** —
  `measure:loudness` 측정값 그대로가 이제 제대로 전달될 뿐이다.
