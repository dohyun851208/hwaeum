/*
 * manifest.js — 음원·분위기·악기·음계 데이터 (브라우저 전역 window.SDStudioData)
 *
 * 선생님이 음원을 추가/교체할 때는 주로 이 파일만 수정하면 됩니다.
 * - 실제 파일이 있으면 src 경로를, 없으면 src: null (합성음 폴백).
 * - 선율 악기는 단일음 샘플의 기준음(baseMidi)을 기준으로 피치 시프트합니다.
 * - 분위기(atmosphere)는 backgroundId로 배경 음원과 1:1 매칭됩니다. padType은 배경 로드 실패 시 합성 패드 음색, color는 무드색입니다.
 */
;(function (root) {
  "use strict"

  // 배경음악 (sound/배경(freesound)) — 분위기(atmosphere)와 id로 1:1 매칭되는 배경 음원
  const backgrounds = {
    calm: { label: "고요한", src: "sound/배경(freesound)/고요한.wav", duration: 155 },
    tension: { label: "긴장되는", src: "sound/배경(freesound)/긴장되는.mp3", duration: 15 },
    bright: { label: "밝은", src: "sound/배경(freesound)/밝은.wav", duration: 44 },
    exotic: { label: "이국적인", src: "sound/배경(freesound)/이국적인.wav", duration: 32 },
    peaceful: { label: "평화로운", src: "sound/배경(freesound)/평화로운.mp3", duration: 269 },
    energetic: { label: "활기찬", src: "sound/배경(freesound)/활기찬.wav", duration: 19 },
  }

  // 패드 종류 — 선생님이 ambient/string/drone/choir/synth pad 음원을 추가하면 src를 채웁니다.
  // src가 null이면 장면의 backgroundId 배경음을, 그것도 없으면 합성 패드를 사용합니다.
  const pads = {
    ambient: { label: "Ambient Pad", src: null, fallbackWave: "sine" },
    string: { label: "String Pad", src: null, fallbackWave: "sawtooth" },
    drone: { label: "Drone", src: null, fallbackWave: "triangle" },
    choir: { label: "Choir Pad", src: null, fallbackWave: "sine" },
    synth: { label: "Synth Pad", src: null, fallbackWave: "square" },
  }

  // 선율 악기 (sound/선율-서양, sound/선율-국악) — 단일음/구절 샘플
  const melodies = {
    violin: { label: "바이올린", group: "서양", src: "sound/선율-서양(필하모니아)/현/violin_A3_1_forte_arco-normal.mp3", baseMidi: 57, lowMidi: 55, highMidi: 72, minRate: 0.72, maxRate: 1.9, waveform: "sawtooth" },
    viola: { label: "비올라", group: "서양", src: "sound/선율-서양(필하모니아)/현/viola_A3_15_forte_arco-normal.mp3", baseMidi: 57, lowMidi: 48, highMidi: 69, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    cello: { label: "첼로", group: "서양", src: "sound/선율-서양(필하모니아)/현/cello_A2_1_forte_arco-normal.mp3", baseMidi: 45, lowMidi: 36, highMidi: 60, minRate: 0.62, maxRate: 1.9, waveform: "triangle" },
    doubleBass: { label: "더블베이스", group: "서양", src: "sound/선율-서양(필하모니아)/현/double-bass_A1_1_forte_arco-normal.mp3", baseMidi: 33, lowMidi: 28, highMidi: 48, minRate: 0.72, maxRate: 1.9, waveform: "triangle" },
    flute: { label: "플루트", group: "서양", src: "sound/선율-서양(필하모니아)/관/flute_A4_1_forte_normal.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, minRate: 0.62, maxRate: 1.72, waveform: "sine" },
    oboe: { label: "오보에", group: "서양", src: "sound/선율-서양(필하모니아)/관/oboe_A4_1_forte_normal.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    frenchHorn: { label: "프렌치 호른", group: "서양", src: "sound/선율-서양(필하모니아)/관/french-horn_A3_very-long_cresc-decresc_normal.mp3", baseMidi: 57, lowMidi: 45, highMidi: 69, minRate: 0.55, maxRate: 1.72, waveform: "triangle" },
    daegeum: { label: "대금", group: "국악", src: "sound/선율-국악(국립국악원)/관/정악대금.wav", baseMidi: 69, lowMidi: 60, highMidi: 81, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    danso: { label: "단소", group: "국악", src: "sound/선율-국악(국립국악원)/관/단소.wav", baseMidi: 69, lowMidi: 60, highMidi: 81, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    sogeum: { label: "소금", group: "국악", src: "sound/선율-국악(국립국악원)/관/소금.wav", baseMidi: 72, lowMidi: 64, highMidi: 84, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    nagak: { label: "나각", group: "국악", src: "sound/선율-국악(국립국악원)/관/나각.wav", baseMidi: 57, lowMidi: 50, highMidi: 67, minRate: 0.66, maxRate: 1.62, waveform: "triangle", sampleMode: "phrase" },
    gayageum: { label: "가야금", group: "국악", src: "sound/선율-국악(국립국악원)/현/가야금.wav", baseMidi: 60, lowMidi: 48, highMidi: 72, minRate: 0.55, maxRate: 1.72, waveform: "triangle", sampleMode: "phrase" },
    ajaeng: { label: "산조아쟁", group: "국악", src: "sound/선율-국악(국립국악원)/현/산조아쟁.wav", baseMidi: 48, lowMidi: 40, highMidi: 60, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth", sampleMode: "phrase" },
    haegeum: { label: "해금", group: "국악", src: "sound/선율-국악(국립국악원)/현/해금.wav", baseMidi: 69, lowMidi: 60, highMidi: 81, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth", sampleMode: "phrase" },
    synth: { label: "신디", group: "전자", src: null, baseMidi: 60, waveform: "square" },
  }

  // 자연 효과음 (sound/효과-자연음(유자레코즈))
  const effects = {
    wind1: { label: "바람 1", src: "sound/효과-자연음(유자레코즈)/바람1.wav" },
    wind2: { label: "바람 2", src: "sound/효과-자연음(유자레코즈)/바람2.wav" },
    wind3: { label: "바람 3", src: "sound/효과-자연음(유자레코즈)/바람3.wav" },
    rain1: { label: "비 1", src: "sound/효과-자연음(유자레코즈)/비1.wav" },
    rain2: { label: "비 2", src: "sound/효과-자연음(유자레코즈)/비2.mp3" },
    rain3: { label: "비 3", src: "sound/효과-자연음(유자레코즈)/비3.wav" },
    rain4: { label: "비 4", src: "sound/효과-자연음(유자레코즈)/비4.wav" },
    forest1: { label: "숲 1", src: "sound/효과-자연음(유자레코즈)/숲1.mp3" },
    forest2: { label: "숲 2", src: "sound/효과-자연음(유자레코즈)/숲2.wav" },
    forest3: { label: "숲 3", src: "sound/효과-자연음(유자레코즈)/숲3.wav" },
    thunder1: { label: "천둥 1", src: "sound/효과-자연음(유자레코즈)/천둥1.mp3" },
    thunder2: { label: "천둥 2", src: "sound/효과-자연음(유자레코즈)/천둥2.wav" },
    thunder3: { label: "천둥 3", src: "sound/효과-자연음(유자레코즈)/천둥3.wav" },
    thunder4: { label: "천둥 4", src: "sound/효과-자연음(유자레코즈)/천둥4.wav" },
  }

  // 분위기 — 배경(freesound) 음원과 1:1로 직접 매칭. id가 곧 backgroundId.
  // 선생님이 추가로 올린 음원은 studio.js에서 이 배열에 동적으로 push 됩니다.
  const atmospheres = [
    { id: "calm", label: "고요한", padType: "ambient", detail: "잔잔하고 평온한 배경", color: "#7fa6a0", backgroundId: "calm", effectIds: [] },
    { id: "tension", label: "긴장되는", padType: "drone", detail: "조여드는 긴장감", color: "#9c6b7a", backgroundId: "tension", effectIds: [] },
    { id: "bright", label: "밝은", padType: "synth", detail: "환하고 경쾌한 느낌", color: "#c89a4e", backgroundId: "bright", effectIds: [] },
    { id: "exotic", label: "이국적인", padType: "choir", detail: "낯설고 신비로운 색채", color: "#8a6fb0", backgroundId: "exotic", effectIds: [] },
    { id: "peaceful", label: "평화로운", padType: "string", detail: "포근하고 안정된 분위기", color: "#6f9b6b", backgroundId: "peaceful", effectIds: [] },
    { id: "energetic", label: "활기찬", padType: "synth", detail: "밝고 힘찬 에너지", color: "#d3814f", backgroundId: "energetic", effectIds: [] },
  ]

  const instruments = [
    { id: "violin", group: "서양", label: "바이올린", detail: "밝고 선명한 선율", waveform: "sawtooth" },
    { id: "viola", group: "서양", label: "비올라", detail: "중음역의 안정된 현악", waveform: "sawtooth" },
    { id: "cello", group: "서양", label: "첼로", detail: "낮고 따뜻한 선율", waveform: "triangle" },
    { id: "doubleBass", group: "서양", label: "더블베이스", detail: "묵직한 저음 선율", waveform: "triangle" },
    { id: "flute", group: "서양", label: "플루트", detail: "가벼운 숨결감", waveform: "sine" },
    { id: "oboe", group: "서양", label: "오보에", detail: "뚜렷한 관악 선율", waveform: "sawtooth" },
    { id: "frenchHorn", group: "서양", label: "프렌치 호른", detail: "긴 호흡의 관악", waveform: "triangle" },
    {
      id: "daegeum",
      group: "국악",
      label: "대금",
      detail: "시김새가 잘 드러나는 관악",
      waveform: "sine",
      image: "./assets/instruments/daegeum.jpg",
    },
    {
      id: "danso",
      group: "국악",
      label: "단소",
      detail: "맑고 짧은 관악 선율",
      waveform: "sine",
      image: "./assets/instruments/danso.jpg",
    },
    {
      id: "sogeum",
      group: "국악",
      label: "소금",
      detail: "높고 가는 관악 선율",
      waveform: "sine",
      image: "./assets/instruments/sogeum.jpg",
    },
    {
      id: "nagak",
      group: "국악",
      label: "나각",
      detail: "의식음악 느낌의 낮은 관악",
      waveform: "triangle",
      image: "./assets/instruments/nagak.jpg",
    },
    {
      id: "gayageum",
      group: "국악",
      label: "가야금",
      detail: "뜯는 결이 살아있는 현악",
      waveform: "triangle",
      image: "./assets/instruments/gayageum.jpg",
    },
    {
      id: "ajaeng",
      group: "국악",
      label: "산조아쟁",
      detail: "거칠고 깊은 현악",
      waveform: "sawtooth",
      image: "./assets/instruments/ajaeng.jpg",
    },
    {
      id: "haegeum",
      group: "국악",
      label: "해금",
      detail: "흔들림이 강한 선율",
      waveform: "sawtooth",
      image: "./assets/instruments/haegeum.jpg",
    },
    { id: "synth", group: "전자", label: "신디", detail: "맑고 균일한 전자음", waveform: "square" },
  ]

  // 음계(선율 스타일). gugak: true 인 항목은 시김새를 적용.
  // 으뜸음을 도(C, 60)로 통일해 "음계의 성격(장/단/온음/펜타)"이 실제로 다르게 들리도록 한다.
  // (예전엔 C장조·A단조·D도리안이 모두 흰건반 같은 집합이라 동일하게 들렸음)
  const styles = [
    { id: "bright", label: "밝음", scaleName: "C Major", root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], detail: "장음계 — 밝고 안정적", gugak: false },
    { id: "calm", label: "차분함", scaleName: "C Minor", root: 60, intervals: [0, 2, 3, 5, 7, 8, 10], detail: "단음계 — 어둡고 차분", gugak: false },
    { id: "mystic", label: "신비로움", scaleName: "C Whole Tone", root: 60, intervals: [0, 2, 4, 6, 8, 10], detail: "온음음계 — 몽환적·붕 뜬 느낌", gugak: false },
    { id: "natural", label: "자연스러움", scaleName: "C Pentatonic", root: 60, intervals: [0, 2, 4, 7, 9], detail: "5음 음계 — 막힘 없는 울림", gugak: false },
    { id: "gugak", label: "국악풍", scaleName: "G Pentatonic + 시김새", root: 55, intervals: [0, 3, 5, 7, 10], detail: "꺾음·흘러내림·떠는음", gugak: true },
  ]

  // 믹스 변형 — 한 시도(테이크)를 다른 균형으로 들어보는 옵션
  // 선율이 배경보다 너무 크지 않도록 균형을 다시 잡음(레가토로 선율이 더 또렷해진 점 반영).
  const versions = [
    { id: "balanced", label: "균형", detail: "배경과 선율을 같은 비중으로", melodyGain: 0.2, padGain: 0.17, ornament: false },
    { id: "drawing", label: "선율 강조", detail: "그린 선의 윤곽을 더 또렷하게", melodyGain: 0.28, padGain: 0.12, ornament: false },
    { id: "scene", label: "공간 강조", detail: "분위기 음원을 더 넓게", melodyGain: 0.15, padGain: 0.22, ornament: false },
    { id: "ornament", label: "시김새 강조", detail: "흘러내림과 떠는음을 더하게", melodyGain: 0.2, padGain: 0.15, ornament: true },
  ]

  root.SDStudioData = { backgrounds, pads, melodies, effects, atmospheres, instruments, styles, versions }
})(typeof self !== "undefined" ? self : this)
