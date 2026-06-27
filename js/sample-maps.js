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
      { midi: 58, note: "A#3", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_As3.mp3", offset: 1.5, duration: 2.4, detectedHz: 239.9, confidence: 0.972, cents: 50 },
      { midi: 61, note: "C#4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs4.mp3", offset: 10.5, duration: 2.4, detectedHz: 272.34, confidence: 0.974, cents: -30 },
      { midi: 62, note: "D4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D4.mp3", offset: 20.25, duration: 2.4, detectedHz: 295.02, confidence: 0.976, cents: 8 },
      { midi: 64, note: "E4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E4.mp3", offset: 28.54, duration: 2.4, detectedHz: 324.52, confidence: 0.979, cents: -27 },
      { midi: 66, note: "F#4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Fs4.mp3", offset: 36.76, duration: 2.4, detectedHz: 359.53, confidence: 0.98, cents: -50 },
      { midi: 67, note: "G4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_G4.mp3", offset: 46.75, duration: 2.4, detectedHz: 402.99, confidence: 0.982, cents: 48 },
      { midi: 69, note: "A4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_A4.mp3", offset: 54.8, duration: 2.4, detectedHz: 438.75, confidence: 0.982, cents: -5 },
      { midi: 70, note: "A#4", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_As4.mp3", offset: 62.93, duration: 2.4, detectedHz: 479.07, confidence: 0.983, cents: 47 },
      { midi: 73, note: "C#5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs5.mp3", offset: 72.04, duration: 2.4, detectedHz: 544.96, confidence: 0.978, cents: -30 },
      { midi: 74, note: "D5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_D5.mp3", offset: 80.15, duration: 2.4, detectedHz: 584.98, confidence: 0.985, cents: -7 },
      { midi: 76, note: "E5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E5.mp3", offset: 88.36, duration: 2.4, detectedHz: 646.4, confidence: 0.987, cents: -34 },
      { midi: 77, note: "F5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_F5.mp3", offset: 95.69, duration: 2.4, detectedHz: 717.13, confidence: 0.985, cents: 46 },
      { midi: 79, note: "G5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_G5.mp3", offset: 106.87, duration: 2.4, detectedHz: 805.4, confidence: 0.979, cents: 47 },
      { midi: 81, note: "A5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_A5.mp3", offset: 111.81, duration: 2.4, detectedHz: 877.48, confidence: 0.988, cents: -5 },
      { midi: 82, note: "A#5", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_As5.mp3", offset: 119.9, duration: 2.4, detectedHz: 957.96, confidence: 0.989, cents: 47 },
      { midi: 84, note: "C6", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_C6.mp3", offset: 128.96, duration: 2.4, detectedHz: 1049.06, confidence: 0.99, cents: 4 },
      { midi: 85, note: "C#6", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_Cs6.mp3", offset: 137.97, duration: 2.4, detectedHz: 1139.57, confidence: 0.993, cents: 47 },
      { midi: 88, note: "E6", src: "sound/선율-국악(국립국악원)/관/daegeum/daegeum_E6.mp3", offset: 146.03, duration: 2.4, detectedHz: 1290.21, confidence: 0.994, cents: -38 },
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
      { midi: 71, note: "B4", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B4.mp3", offset: 0.28, duration: 2.4, detectedHz: 495.57, confidence: 0.98, cents: 6 },
      { midi: 73, note: "C#5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_Cs5.mp3", offset: 7.96, duration: 2.4, detectedHz: 549.85, confidence: 0.984, cents: -14 },
      { midi: 74, note: "D5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D5.mp3", offset: 15.41, duration: 2.4, detectedHz: 589.19, confidence: 0.985, cents: 5 },
      { midi: 76, note: "E5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E5.mp3", offset: 23.56, duration: 2.4, detectedHz: 650.48, confidence: 0.987, cents: -23 },
      { midi: 78, note: "F#5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_Fs5.mp3", offset: 32.04, duration: 2.4, detectedHz: 734.98, confidence: 0.988, cents: -12 },
      { midi: 80, note: "G#5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_Gs5.mp3", offset: 40.2, duration: 2.4, detectedHz: 837.45, confidence: 0.983, cents: 14 },
      { midi: 81, note: "A5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_A5.mp3", offset: 48.66, duration: 2.4, detectedHz: 885.56, confidence: 0.986, cents: 11 },
      { midi: 83, note: "B5", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B5.mp3", offset: 56.92, duration: 2.4, detectedHz: 982.64, confidence: 0.992, cents: -9 },
      { midi: 86, note: "D6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_D6.mp3", offset: 64.81, duration: 2.4, detectedHz: 1164.88, confidence: 0.993, cents: -14 },
      { midi: 88, note: "E6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_E6.mp3", offset: 72.38, duration: 2.4, detectedHz: 1284.04, confidence: 0.991, cents: -46 },
      { midi: 89, note: "F6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_F6.mp3", offset: 79.56, duration: 2.4, detectedHz: 1429.19, confidence: 0.994, cents: 40 },
      { midi: 91, note: "G6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_G6.mp3", offset: 86.18, duration: 2.4, detectedHz: 1604.19, confidence: 0.99, cents: 40 },
      { midi: 93, note: "A6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_A6.mp3", offset: 93.14, duration: 2.4, detectedHz: 1763.24, confidence: 0.995, cents: 3 },
      { midi: 95, note: "B6", src: "sound/선율-국악(국립국악원)/관/sogeum/sogeum_B6.mp3", offset: 100.31, duration: 2.4, detectedHz: 1923.41, confidence: 0.996, cents: -46 },
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
      { midi: 56, note: "G#3", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs3.mp3", offset: 0.1, duration: 2.4, detectedHz: 207.65, confidence: 0.99, cents: 0 },
      { midi: 58, note: "A#3", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_As3.mp3", offset: 3.29, duration: 2.33, detectedHz: 233.08, confidence: 0.99, cents: 0 },
      { midi: 60, note: "C4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C4.mp3", offset: 6, duration: 1.64, detectedHz: 261.63, confidence: 0.99, cents: 0 },
      { midi: 61, note: "C#4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs4.mp3", offset: 8.2, duration: 2.34, detectedHz: 277.18, confidence: 0.99, cents: 0 },
      { midi: 63, note: "D#4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Ds4.mp3", offset: 11.08, duration: 1.76, detectedHz: 311.13, confidence: 0.99, cents: 0 },
      { midi: 65, note: "F4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_F4.mp3", offset: 13.68, duration: 2.4, detectedHz: 349.23, confidence: 0.99, cents: 0 },
      { midi: 67, note: "G4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_G4.mp3", offset: 17.08, duration: 2.4, detectedHz: 392, confidence: 0.99, cents: 0 },
      { midi: 68, note: "G#4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Gs4.mp3", offset: 20.39, duration: 2.4, detectedHz: 415.3, confidence: 0.99, cents: 0 },
      { midi: 70, note: "A#4", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_As4.mp3", offset: 23.49, duration: 2.4, detectedHz: 466.16, confidence: 0.99, cents: 0 },
      { midi: 72, note: "C5", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_C5.mp3", offset: 26.5, duration: 1.92, detectedHz: 523.25, confidence: 0.99, cents: 0 },
      { midi: 73, note: "C#5", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Cs5.mp3", offset: 29.1, duration: 1.79, detectedHz: 554.37, confidence: 0.99, cents: 0 },
      { midi: 75, note: "D#5", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_Ds5.mp3", offset: 31.69, duration: 2.23, detectedHz: 622.25, confidence: 0.99, cents: 0 },
      { midi: 77, note: "F5", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_F5.mp3", offset: 34.69, duration: 2.33, detectedHz: 698.46, confidence: 0.99, cents: 0 },
      { midi: 79, note: "G5", src: "sound/선율-국악(국립국악원)/현/haegeum/haegeum_G5.mp3", offset: 37.8, duration: 2.35, detectedHz: 783.99, confidence: 0.99, cents: 0 },
    ],
  }

  Object.keys(maps).forEach((id) => {
    const asset = data.melodies[id]
    const sampleMap = maps[id]
    if (!asset || !sampleMap || !sampleMap.length) return
    asset.sampleMap = sampleMap
    asset.sampleMapMode = "detectedHz"
    if (sampleMap.some((item) => item.src)) asset.sampleMode = "multi"
    if (sampleMap.length >= 3) {
      asset.lowMidi = sampleMap[0].midi
      asset.highMidi = sampleMap[sampleMap.length - 1].midi
    }
    asset.baseMidi = sampleMap[Math.floor(sampleMap.length / 2)].midi
  })
})(typeof self !== "undefined" ? self : this)
