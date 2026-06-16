/*
 * sample-maps.js — 현재 국악 음원의 Hz 분석 기반 샘플맵
 *
 * 각 항목은 한 음 구간을 나타냅니다.
 * - midi/note: 감지된 중심 음높이
 * - offset/duration: 원본 긴 음원에서 잘라 쓸 구간(초)
 * - detectedHz/confidence/cents: 분석 검증용 메타데이터
 */
;(function (root) {
  "use strict"

  const data = root.SDStudioData
  if (!data || !data.melodies) return

  const maps = {
    daegeum: [
      { midi: 61, note: "C#4", offset: 11.052, duration: 2.4, detectedHz: 274.21, confidence: 0.999, cents: -19 },
      { midi: 62, note: "D4", offset: 21.036, duration: 2.4, detectedHz: 293.96, confidence: 0.999, cents: 2 },
      { midi: 64, note: "E4", offset: 32.407, duration: 2.4, detectedHz: 323.62, confidence: 0.999, cents: -32 },
      { midi: 66, note: "F#4", offset: 46.124, duration: 2.4, detectedHz: 360.25, confidence: 0.999, cents: -46 },
      { midi: 67, note: "G4", offset: 56.876, duration: 2.4, detectedHz: 402.94, confidence: 0.999, cents: 48 },
      { midi: 69, note: "A4", offset: 68.481, duration: 2.4, detectedHz: 438.97, confidence: 0.999, cents: -4 },
      { midi: 71, note: "B4", offset: 80.407, duration: 2.4, detectedHz: 479.85, confidence: 0.998, cents: -50 },
      { midi: 77, note: "F5", offset: 132.183, duration: 2.4, detectedHz: 718.92, confidence: 0.999, cents: 50 },
      { midi: 78, note: "F#5", offset: 158.679, duration: 2.4, detectedHz: 728.61, confidence: 1, cents: -27 },
      { midi: 80, note: "G#5", offset: 145.9, duration: 2.4, detectedHz: 810.99, confidence: 0.999, cents: -41 },
      { midi: 83, note: "B5", offset: 170.284, duration: 2.4, detectedHz: 961.45, confidence: 0.999, cents: -47 },
    ],
    danso: [
      { midi: 68, note: "G#4", offset: 0.193, duration: 2.4, detectedHz: 414.87, confidence: 0.997, cents: -2 },
      { midi: 70, note: "A#4", offset: 6.615, duration: 2.4, detectedHz: 464.83, confidence: 0.998, cents: -5 },
      { midi: 73, note: "C#5", offset: 12.972, duration: 2.4, detectedHz: 554.64, confidence: 0.998, cents: 1 },
      { midi: 75, note: "D#5", offset: 19.372, duration: 2.4, detectedHz: 622.98, confidence: 0.997, cents: 2 },
      { midi: 77, note: "F5", offset: 25.772, duration: 2.4, detectedHz: 700.35, confidence: 0.998, cents: 5 },
    ],
    sogeum: [
      { midi: 67, note: "G4", offset: 13.996, duration: 2.4, detectedHz: 387.82, confidence: 0.996, cents: -19 },
      { midi: 68, note: "G#4", offset: 77.932, duration: 2.4, detectedHz: 415.77, confidence: 0.999, cents: 2 },
      { midi: 69, note: "A4", offset: 71.959, duration: 2.4, detectedHz: 428.8, confidence: 0.999, cents: -45 },
      { midi: 71, note: "B4", offset: 0.129, duration: 2.4, detectedHz: 484.74, confidence: 0.997, cents: -32 },
      { midi: 73, note: "C#5", offset: 94.892, duration: 2.4, detectedHz: 539.34, confidence: 0.999, cents: -48 },
      { midi: 76, note: "E5", offset: 47.937, duration: 2.4, detectedHz: 648.95, confidence: 0.994, cents: -27 },
      { midi: 78, note: "F#5", offset: 29.121, duration: 2.4, detectedHz: 726.4, confidence: 0.998, cents: -32 },
      { midi: 79, note: "G5", offset: 36.055, duration: 2.4, detectedHz: 801.45, confidence: 0.997, cents: 38 },
      { midi: 80, note: "G#5", offset: 83.905, duration: 2.4, detectedHz: 813.68, confidence: 1, cents: -36 },
      { midi: 81, note: "A5", offset: 88.833, duration: 2.4, detectedHz: 888.59, confidence: 1, cents: 17 },
      { midi: 82, note: "A#5", offset: 65.985, duration: 2.4, detectedHz: 951.42, confidence: 0.999, cents: 35 },
      { midi: 83, note: "B5", offset: 54.039, duration: 2.4, detectedHz: 975.18, confidence: 0.998, cents: -22 },
    ],
    nagak: [{ midi: 59, note: "B3", offset: 0.5, duration: 5.8, detectedHz: 246.15, confidence: 0.998, cents: -6 }],
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
      { midi: 58, note: "A#3", offset: 26.519, duration: 1.853, detectedHz: 233.07, confidence: 0.997, cents: 0 },
      { midi: 60, note: "C4", offset: 11.116, duration: 1.661, detectedHz: 256.77, confidence: 0.998, cents: -32 },
      { midi: 61, note: "C#4", offset: 8.257, duration: 2.195, detectedHz: 276, confidence: 0.997, cents: -7 },
      { midi: 65, note: "F4", offset: 13.719, duration: 2.4, detectedHz: 350.59, confidence: 0.998, cents: 7 },
      { midi: 68, note: "G#4", offset: 20.396, duration: 2.4, detectedHz: 414.62, confidence: 0.996, cents: -3 },
      { midi: 72, note: "C5", offset: 37.804, duration: 2.344, detectedHz: 521.3, confidence: 0.997, cents: -6 },
      { midi: 73, note: "C#5", offset: 29.1, duration: 1.725, detectedHz: 556.37, confidence: 0.997, cents: 6 },
      { midi: 77, note: "F5", offset: 34.753, duration: 2.173, detectedHz: 697.65, confidence: 0.995, cents: -2 },
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
