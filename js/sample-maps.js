/*
 * sample-maps.js — 현재 국악 음원의 Hz 분석 기반 샘플맵
 *
 * 각 항목은 한 음 구간을 나타냅니다.
 * - midi/note: 감지된 중심 음높이
 * - offset/duration: 원본 긴 음원에서 잘라 쓸 구간(초)
 * - detectedHz/confidence/cents: 분석 검증용 메타데이터
 *
 * 새 음원의 맵 생성: `python tools/analyze-sample-map.py "<음계 녹음 wav>"`
 * (RMS 구간 검출 + 자기상관 피치, numpy 불필요. 예: piri 맵이 이 도구로 생성됨)
 */
;(function (root) {
  "use strict"

  const data = root.SDStudioData
  if (!data || !data.melodies) return

  const maps = {
    daegeum: [
      { midi: 61, note: "C#4", offset: 11.34, duration: 2.4, detectedHz: 274.27, confidence: 0.99, cents: -18 },
      { midi: 62, note: "D4", offset: 21.26, duration: 2.4, detectedHz: 293.97, confidence: 0.99, cents: 2 },
      { midi: 64, note: "E4", offset: 32.7, duration: 2.4, detectedHz: 323.92, confidence: 0.99, cents: -30 },
      { midi: 66, note: "F#4", offset: 46.38, duration: 2.4, detectedHz: 360.55, confidence: 0.99, cents: -45 },
      { midi: 68, note: "G#4", offset: 57.18, duration: 2.4, detectedHz: 403.63, confidence: 0.99, cents: -49 },
      { midi: 69, note: "A4", offset: 68.78, duration: 2.4, detectedHz: 439.92, confidence: 0.99, cents: 0 },
      { midi: 70, note: "A#4", offset: 80.7, duration: 2.4, detectedHz: 479.8, confidence: 0.99, cents: 50 },
      { midi: 73, note: "C#5", offset: 92.38, duration: 2.4, detectedHz: 542.45, confidence: 0.99, cents: -38 },
      { midi: 74, note: "D5", offset: 106.46, duration: 2.4, detectedHz: 581.75, confidence: 0.99, cents: -17 },
      { midi: 76, note: "E5", offset: 119.34, duration: 2.4, detectedHz: 649.93, confidence: 0.99, cents: -25 },
      { midi: 78, note: "F#5", offset: 132.46, duration: 2.4, detectedHz: 719.08, confidence: 0.99, cents: -50 },
      { midi: 80, note: "G#5", offset: 146.22, duration: 2.4, detectedHz: 810.89, confidence: 0.99, cents: -42 },
      { midi: 81, note: "A5", offset: 158.94, duration: 2.4, detectedHz: 874.38, confidence: 0.99, cents: -11 },
      { midi: 83, note: "B5", offset: 170.78, duration: 2.4, detectedHz: 962.98, confidence: 0.99, cents: -44 },
    ],
    danso: [
      { midi: 68, note: "G#4", offset: 0.56, duration: 1.2, detectedHz: 416.93, confidence: 0.982, cents: 7 },
      { midi: 70, note: "A#4", offset: 6.26, duration: 2.4, detectedHz: 472.72, confidence: 0.982, cents: 24 },
      { midi: 73, note: "C#5", offset: 12.01, duration: 2.4, detectedHz: 559.57, confidence: 0.984, cents: 16 },
      { midi: 75, note: "D#5", offset: 17.76, duration: 2.4, detectedHz: 632.44, confidence: 0.983, cents: 28 },
      { midi: 77, note: "F5", offset: 22.77, duration: 2.4, detectedHz: 694.44, confidence: 0.987, cents: -10 },
      { midi: 80, note: "G#5", offset: 28.48, duration: 2.4, detectedHz: 828.16, confidence: 0.986, cents: -5 },
      { midi: 82, note: "A#5", offset: 34.98, duration: 2.4, detectedHz: 930.8, confidence: 0.99, cents: -3 },
      { midi: 84, note: "C6", offset: 41.81, duration: 2.4, detectedHz: 1075.6, confidence: 0.99, cents: 47 },
      { midi: 87, note: "D#6", offset: 48.28, duration: 2.4, detectedHz: 1236.46, confidence: 0.991, cents: -11 },
      { midi: 89, note: "F6", offset: 54.57, duration: 2.4, detectedHz: 1377.66, confidence: 0.995, cents: -24 },
    ],
    sogeum: [
      { midi: 71, note: "B4", offset: 0.9, duration: 2.4, detectedHz: 484.63, confidence: 0.99, cents: -33 },
      { midi: 73, note: "C#5", offset: 7.4, duration: 2.4, detectedHz: 539.69, confidence: 0.99, cents: -46 },
      { midi: 74, note: "D5", offset: 14.4, duration: 2.4, detectedHz: 581.65, confidence: 0.99, cents: -17 },
      { midi: 76, note: "E5", offset: 22.9, duration: 2.4, detectedHz: 644.41, confidence: 0.99, cents: -39 },
      { midi: 78, note: "F#5", offset: 29.9, duration: 2.4, detectedHz: 726.01, confidence: 0.99, cents: -33 },
      { midi: 79, note: "G5", offset: 36.4, duration: 2.4, detectedHz: 800.22, confidence: 0.99, cents: 35 },
      { midi: 80, note: "G#5", offset: 42.4, duration: 2.4, detectedHz: 823.62, confidence: 0.99, cents: -15 },
      { midi: 81, note: "A5", offset: 48.4, duration: 2.4, detectedHz: 863.98, confidence: 0.99, cents: -32 },
      { midi: 83, note: "B5", offset: 54.4, duration: 2.4, detectedHz: 975.9, confidence: 0.99, cents: -21 },
      { midi: 85, note: "C#6", offset: 60.4, duration: 2.4, detectedHz: 1085.43, confidence: 0.99, cents: -37 },
      { midi: 86, note: "D6", offset: 66.4, duration: 2.4, detectedHz: 1142.19, confidence: 0.99, cents: -49 },
      { midi: 88, note: "E6", offset: 72.4, duration: 2.4, detectedHz: 1286.16, confidence: 0.99, cents: -43 },
      { midi: 90, note: "F#6", offset: 78.4, duration: 2.4, detectedHz: 1441.2, confidence: 0.99, cents: -46 },
    ],
    piri: [
      { midi: 59, note: "B3", offset: 0.05, duration: 2.4, detectedHz: 247.42, confidence: 0.972, cents: 3 },
      { midi: 61, note: "C#4", offset: 9.21, duration: 2.4, detectedHz: 277.2, confidence: 0.978, cents: 0 },
      { midi: 62, note: "D4", offset: 17.36, duration: 2.4, detectedHz: 300.77, confidence: 0.962, cents: 41 },
      { midi: 64, note: "E4", offset: 26.52, duration: 2.4, detectedHz: 334.77, confidence: 0.966, cents: 27 },
      { midi: 66, note: "F#4", offset: 35.68, duration: 2.4, detectedHz: 373.45, confidence: 0.982, cents: 16 },
      { midi: 68, note: "G#4", offset: 46.83, duration: 2.4, detectedHz: 411.78, confidence: 0.982, cents: -15 },
      { midi: 70, note: "A#4", offset: 56.99, duration: 2.4, detectedHz: 462.84, confidence: 0.971, cents: -12 },
      { midi: 71, note: "B4", offset: 66.14, duration: 2.4, detectedHz: 506.9, confidence: 0.957, cents: 45 },
      { midi: 74, note: "D5", offset: 76.95, duration: 2.4, detectedHz: 585.58, confidence: 0.958, cents: -5 },
      { midi: 75, note: "D#5", offset: 86.61, duration: 2.4, detectedHz: 619.2, confidence: 0.976, cents: -9 },
      { midi: 77, note: "F5", offset: 96.79, duration: 2.4, detectedHz: 693.58, confidence: 0.936, cents: -12 },
      { midi: 79, note: "G5", offset: 106.94, duration: 2.4, detectedHz: 766.44, confidence: 0.956, cents: -39 },
    ],
    gayageum: [
      { midi: 46, note: "A#2", offset: 39.788, duration: 1.043, detectedHz: 118.11, confidence: 0.993, cents: 23 },
      { midi: 48, note: "C3", offset: 50.476, duration: 1.021, detectedHz: 131.9, confidence: 0.99, cents: 14 },
      { midi: 50, note: "D3", offset: 60.78, duration: 0.936, detectedHz: 147.87, confidence: 0.987, cents: 12 },
      { midi: 51, note: "D#3", offset: 72.513, duration: 1.128, detectedHz: 156.97, confidence: 0.995, cents: 16 },
      { midi: 53, note: "F3", offset: 83.265, duration: 1.405, detectedHz: 176.35, confidence: 0.996, cents: 17 },
      { midi: 55, note: "G3", offset: 94.892, duration: 1.341, detectedHz: 197.46, confidence: 0.995, cents: 13 },
      { midi: 56, note: "G#3", offset: 105.601, duration: 1.235, detectedHz: 209.44, confidence: 0.996, cents: 15 },
      { midi: 58, note: "A#3", offset: 116.78, duration: 0.552, detectedHz: 234.96, confidence: 0.984, cents: 14 },
      { midi: 60, note: "C4", offset: 127.169, duration: 0.723, detectedHz: 263.99, confidence: 0.982, cents: 16 },
      { midi: 62, note: "D4", offset: 138.817, duration: 1.213, detectedHz: 295.03, confidence: 0.993, cents: 8 },
      { midi: 63, note: "D#4", offset: 148.716, duration: 1.064, detectedHz: 313.36, confidence: 0.989, cents: 12 },
      { midi: 65, note: "F4", offset: 160.641, duration: 0.659, detectedHz: 352.3, confidence: 0.996, cents: 15 },
      { midi: 67, note: "G4", offset: 170.988, duration: 0.467, detectedHz: 396.57, confidence: 0.977, cents: 20 },
      { midi: 68, note: "G#4", offset: 179.244, duration: 0.488, detectedHz: 420.03, confidence: 0.988, cents: 20 },
      { midi: 70, note: "A#4", offset: 187.713, duration: 0.68, detectedHz: 469.04, confidence: 0.996, cents: 11 },
      { midi: 72, note: "C5", offset: 195.393, duration: 0.531, detectedHz: 526.92, confidence: 0.976, cents: 12 },
      { midi: 74, note: "D5", offset: 202.753, duration: 0.659, detectedHz: 593.74, confidence: 0.993, cents: 19 },
      { midi: 75, note: "D#5", offset: 210.583, duration: 0.424, detectedHz: 626.13, confidence: 0.985, cents: 11 },
    ],
    ajaeng: [
      { midi: 43, note: "G2", offset: 0.172, duration: 2.4, detectedHz: 99.68, confidence: 0.979, cents: 29 },
      { midi: 48, note: "C3", offset: 6.103, duration: 2.4, detectedHz: 130.67, confidence: 0.96, cents: -2 },
      { midi: 50, note: "D3", offset: 12.844, duration: 2.4, detectedHz: 145.8, confidence: 0.986, cents: -12 },
      { midi: 55, note: "G3", offset: 19.735, duration: 2.4, detectedHz: 194.95, confidence: 0.976, cents: -9 },
      { midi: 60, note: "C4", offset: 27.009, duration: 2.4, detectedHz: 263.49, confidence: 0.986, cents: 12 },
      { midi: 62, note: "D4", offset: 35.223, duration: 2.4, detectedHz: 294.94, confidence: 0.989, cents: 8 },
    ],
    haegeum: [
      { midi: 56, note: "G#3", offset: 1.0, duration: 1.65, detectedHz: 207.47, confidence: 0.99, cents: -2 },
      { midi: 60, note: "C4", offset: 6.55, duration: 0.35, detectedHz: 261.11, confidence: 0.99, cents: -3 },
      { midi: 70, note: "A#4", offset: 23.9, duration: 1.95, detectedHz: 469.19, confidence: 0.99, cents: 11 },
      { midi: 73, note: "C#5", offset: 29.3, duration: 1.45, detectedHz: 556.42, confidence: 0.99, cents: 6 },
      { midi: 75, note: "D#5", offset: 32.0, duration: 1.55, detectedHz: 624.51, confidence: 0.99, cents: 6 },
      { midi: 77, note: "F5", offset: 35.0, duration: 2.05, detectedHz: 697.87, confidence: 0.99, cents: -1 },
      { midi: 79, note: "G5", offset: 17.4, duration: 2.25, detectedHz: 784.52, confidence: 0.99, cents: 1 },
      { midi: 80, note: "G#5", offset: 20.7, duration: 2.25, detectedHz: 829.49, confidence: 0.99, cents: -2 },
    ],
  }

  Object.keys(maps).forEach((id) => {
    const asset = data.melodies[id]
    const sampleMap = maps[id]
    if (!asset || !sampleMap || !sampleMap.length) return
    asset.sampleMap = sampleMap
    asset.sampleMapMode = "detectedHz"
    if (sampleMap.length >= 3) {
      asset.lowMidi = sampleMap[0].midi
      asset.highMidi = sampleMap[sampleMap.length - 1].midi
    }
    asset.baseMidi = sampleMap[Math.floor(sampleMap.length / 2)].midi
  })
})(typeof self !== "undefined" ? self : this)
