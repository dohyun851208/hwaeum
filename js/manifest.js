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
    calm: { label: "고요한", src: "sound/배경(freesound)/고요한.mp3", duration: 155 },
    tension: { label: "긴장되는", src: "sound/배경(freesound)/긴장되는.mp3", duration: 15 },
    bright: { label: "밝은", src: "sound/배경(freesound)/밝은.mp3", duration: 44 },
    exotic: { label: "이국적인", src: "sound/배경(freesound)/이국적인.mp3", duration: 32 },
    peaceful: { label: "평화로운", src: "sound/배경(freesound)/평화로운.mp3", duration: 269 },
    energetic: { label: "활기찬", src: "sound/배경(freesound)/활기찬.mp3", duration: 19 },
    // 사운드스케이프-환경음 (sound/배경-환경음) — 강·도시·숲·학교 환경 소리. 앞 60초 mono 96k 압축(원본 wav/flac은 deploy 트리 밖 보관).
    river: { label: "강", src: "sound/배경-환경음/강.mp3", duration: 60 },
    city: { label: "도시", src: "sound/배경-환경음/도시.mp3", duration: 47 },
    forest: { label: "숲", src: "sound/배경-환경음/숲.mp3", duration: 60 },
    school: { label: "학교", src: "sound/배경-환경음/학교.mp3", duration: 60 },
    // 리듬반주 (sound/배경-리듬반주) — 곡 아래 깔리는 리듬 배경. 아프리카 리듬(15초)은 짧아 자동 루프됨.
    rhythm: { label: "리듬", src: "sound/배경-리듬반주/리듬.mp3", duration: 60 },
    africanRhythm: { label: "아프리카 리듬", src: "sound/배경-리듬반주/아프리카리듬.mp3", duration: 15 },
    // 테마 루프 (sound/배경-테마루프) — 4음 동기의 오케스트라 루프
    theme4: { label: "4음 테마", src: "sound/배경-테마루프/4음테마.mp3", duration: 60 },
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
    // 서양 선율 — 음마다 실제 녹음(멀티샘플). baseMidi/lowMidi/highMidi/sampleMap 은 sample-maps-western.js 가 채운다.
    // 아래 src 는 그 맵 로드 실패 시 쓰는 대표(중간음역) 폴백이며 baseMidi 와 음높이를 맞춰 둔다.
    violin: { label: "바이올린", group: "서양", src: "sound/선율-서양(필하모니아)/현/violin/violin_G5.mp3", sampleMode: "multi", baseMidi: 79, lowMidi: 55, highMidi: 103, playbackTranspose: 0, minRate: 0.72, maxRate: 1.9, waveform: "sawtooth" },
    viola: { label: "비올라", group: "서양", src: "sound/선율-서양(필하모니아)/현/viola/viola_Cs5.mp3", sampleMode: "multi", baseMidi: 73, lowMidi: 48, highMidi: 98, playbackTranspose: 0, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    cello: { label: "첼로", group: "서양", src: "sound/선율-서양(필하모니아)/현/cello/cello_C4.mp3", sampleMode: "multi", baseMidi: 60, lowMidi: 36, highMidi: 84, playbackTranspose: -12, minRate: 0.62, maxRate: 1.9, waveform: "triangle" },
    doubleBass: { label: "더블베이스", group: "서양", src: "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_As2.mp3", sampleMode: "multi", baseMidi: 46, lowMidi: 24, highMidi: 67, playbackTranspose: -24, minRate: 0.72, maxRate: 1.9, waveform: "triangle" },
    mandolin: { label: "만돌린", group: "서양", src: "sound/선율-서양(필하모니아)/현/mandolin/mandolin_D5.mp3", sampleMode: "multi", baseMidi: 74, lowMidi: 55, highMidi: 93, playbackTranspose: 0, tremoloAfter: 1, minRate: 0.55, maxRate: 1.9, waveform: "triangle" },
    clarinet: { label: "클라리넷", group: "서양", src: "sound/선율-서양(필하모니아)/관/clarinet/clarinet_Cs5.mp3", sampleMode: "multi", baseMidi: 73, lowMidi: 50, highMidi: 96, playbackTranspose: 0, minRate: 0.55, maxRate: 1.9, waveform: "square" },
    oboe: { label: "오보에", group: "서양", src: "sound/선율-서양(필하모니아)/관/oboe/oboe_E5.mp3", sampleMode: "multi", baseMidi: 76, lowMidi: 58, highMidi: 94, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    flute: { label: "플루트", group: "서양", src: "sound/선율-서양(필하모니아)/관/flute/flute_A5.mp3", sampleMode: "multi", baseMidi: 81, lowMidi: 60, highMidi: 101, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sine" },
    frenchHorn: { label: "호른", group: "서양", src: "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_Gs3.mp3", sampleMode: "multi", baseMidi: 56, lowMidi: 34, highMidi: 77, playbackTranspose: -12, minRate: 0.55, maxRate: 1.72, waveform: "triangle" },
    sogeum: { label: "소금", group: "국악", src: "sound/선율-국악(국립국악원)/관/소금.mp3", baseMidi: 72, lowMidi: 64, highMidi: 84, playableMidi: [67, 69, 72, 74, 76, 79], minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    daegeum: { label: "대금", group: "국악", src: "sound/선율-국악(국립국악원)/관/정악대금.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, playableMidi: [60, 62, 64, 67, 69, 72, 74, 76, 79], minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    haegeum: { label: "해금", group: "국악", src: "sound/선율-국악(국립국악원)/현/해금.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, playableMidi: [57, 60, 62, 64, 67, 69, 72, 74, 76, 79], minRate: 0.62, maxRate: 1.72, waveform: "sawtooth", sampleMode: "phrase" },
    // 25현 가야금: 팔레트(G3~G5) 전체를 연주 — playableMidi 제한 없음(어느 줄에 그려도 소리남).
    gayageum: { label: "가야금", group: "국악", src: "sound/선율-국악(국립국악원)/현/가야금.mp3", baseMidi: 60, lowMidi: 48, highMidi: 72, minRate: 0.55, maxRate: 1.72, waveform: "triangle", sampleMode: "phrase" },
    ajaeng: { label: "산조아쟁", group: "국악", src: "sound/선율-국악(국립국악원)/현/산조아쟁.mp3", baseMidi: 48, lowMidi: 40, highMidi: 60, playableMidi: [55, 57, 60, 62, 64, 67, 69], minRate: 0.62, maxRate: 1.72, waveform: "sawtooth", sampleMode: "phrase" },
  }

  // 자연 효과음 (sound/효과-자연음(유자레코즈)) + 도장 효과음 (sound/효과음-도장)
  const effects = {
    wind1: { label: "산들바람", src: "sound/효과-자연음(유자레코즈)/바람1.mp3", image: "./assets/effects/wind-breeze.png" },
    wind2: { label: "거센바람", src: "sound/효과-자연음(유자레코즈)/바람2.mp3", image: "./assets/effects/wind-gust.png" },
    wind3: { label: "회오리바람", src: "sound/효과-자연음(유자레코즈)/바람3.mp3", image: "./assets/effects/wind-whirl.png" },
    rain1: { label: "가랑비", src: "sound/효과-자연음(유자레코즈)/비1.mp3", image: "./assets/effects/rain-drizzle.png" },
    rain2: { label: "소나기", src: "sound/효과-자연음(유자레코즈)/비2.mp3", image: "./assets/effects/rain-shower.png" },
    rain3: { label: "큰 빗방울", src: "sound/효과-자연음(유자레코즈)/비3.mp3", image: "./assets/effects/rain-drops.png" },
    rain4: { label: "장대비", src: "sound/효과-자연음(유자레코즈)/비4.mp3", image: "./assets/effects/rain-heavy.png" },
    forest1: { label: "새소리 숲", src: "sound/효과-자연음(유자레코즈)/숲1.mp3", image: "./assets/effects/forest-birds.png" },
    forest2: { label: "흔들리는 잎", src: "sound/효과-자연음(유자레코즈)/숲2.mp3", image: "./assets/effects/forest-leaves.png" },
    forest3: { label: "깊은 숲", src: "sound/효과-자연음(유자레코즈)/숲3.mp3", image: "./assets/effects/forest-deep.png" },
    thunder1: { label: "먼 천둥", src: "sound/효과-자연음(유자레코즈)/천둥1.mp3", image: "./assets/effects/thunder-distant.png" },
    thunder2: { label: "번개", src: "sound/효과-자연음(유자레코즈)/천둥2.mp3", image: "./assets/effects/thunder-lightning.png" },
    thunder3: { label: "폭풍우", src: "sound/효과-자연음(유자레코즈)/천둥3.mp3", image: "./assets/effects/thunder-storm.png" },
    thunder4: { label: "우르릉", src: "sound/효과-자연음(유자레코즈)/천둥4.mp3", image: "./assets/effects/thunder-rumble.png" },
    animalCricket: { label: "귀뚜라미", group: "동물", src: "sound/효과음-도장/동물/귀뚜라미.mp3", image: "./assets/effects/stamps/animal-cricket.svg" },
    animalCuckoo: { label: "뻐꾸기", group: "동물", src: "sound/효과음-도장/동물/뻐꾸기.mp3", image: "./assets/effects/stamps/animal-cuckoo.svg" },
    animalBird: { label: "새", group: "동물", src: "sound/효과음-도장/동물/새.mp3", image: "./assets/effects/stamps/animal-bird.svg" },
    animalWhale: { label: "흑동고래", group: "동물", src: "sound/효과음-도장/동물/흑동고래.mp3", image: "./assets/effects/stamps/animal-whale.svg" },
    sfxBubblePop: { label: "방울pop", group: "효과", src: "sound/효과음-도장/효과/방울pop.mp3", image: "./assets/effects/stamps/sfx-bubble-pop.svg" },
    sfxBell: { label: "벨", group: "효과", src: "sound/효과음-도장/효과/벨.mp3", image: "./assets/effects/stamps/sfx-bell.svg" },
    sfxTambourine: { label: "탬버린", group: "효과", src: "sound/효과음-도장/효과/탬버린.mp3", image: "./assets/effects/stamps/sfx-tambourine.svg" },
    sfxHarp: { label: "하프", group: "효과", src: "sound/효과음-도장/효과/하프.mp3", image: "./assets/effects/stamps/sfx-harp.svg" },
  }

  // 분위기 — 배경(freesound) 음원과 1:1로 직접 매칭. id가 곧 backgroundId.
  // 선생님이 추가로 올린 음원은 studio.js에서 이 배열에 동적으로 push 됩니다.
  // group: 2단계 카드 묶음 라벨. studio.js renderAtmospheres 가 group 순서대로 소제목을 붙여 보여 준다.
  const atmospheres = [
    { id: "calm", label: "고요한", group: "분위기", padType: "ambient", detail: "잔잔하고 평온한 배경", color: "#7fa6a0", backgroundId: "calm", effectIds: [] },
    { id: "tension", label: "긴장되는", group: "분위기", padType: "drone", detail: "조여드는 긴장감", color: "#9c6b7a", backgroundId: "tension", effectIds: [] },
    { id: "bright", label: "밝은", group: "분위기", padType: "synth", detail: "환하고 경쾌한 느낌", color: "#c89a4e", backgroundId: "bright", effectIds: [] },
    { id: "exotic", label: "이국적인", group: "분위기", padType: "choir", detail: "낯설고 신비로운 색채", color: "#8a6fb0", backgroundId: "exotic", effectIds: [] },
    { id: "peaceful", label: "평화로운", group: "분위기", padType: "string", detail: "포근하고 안정된 분위기", color: "#6f9b6b", backgroundId: "peaceful", effectIds: [] },
    { id: "energetic", label: "활기찬", group: "분위기", padType: "synth", detail: "밝고 힘찬 에너지", color: "#d3814f", backgroundId: "energetic", effectIds: [] },
    // 사운드스케이프-환경음 — 강·도시·숲·학교 (연속 배경 앰비언스)
    { id: "river", label: "강", group: "환경 소리", padType: "ambient", detail: "흐르는 강물 소리", color: "#5a86a8", backgroundId: "river", effectIds: [] },
    { id: "city", label: "도시", group: "환경 소리", padType: "synth", detail: "도시의 거리 소음", color: "#7d7a86", backgroundId: "city", effectIds: [] },
    { id: "forest", label: "숲", group: "환경 소리", padType: "ambient", detail: "새소리 가득한 숲", color: "#5f8a55", backgroundId: "forest", effectIds: [] },
    { id: "school", label: "학교", group: "환경 소리", padType: "ambient", detail: "운동장·교실의 학교 소리", color: "#b08a4e", backgroundId: "school", effectIds: [] },
    // 리듬반주 — 곡 아래 깔리는 리듬 배경
    { id: "rhythm", label: "리듬", group: "리듬 반주", padType: "synth", detail: "기본 리듬 반주", color: "#c2683f", backgroundId: "rhythm", effectIds: [] },
    { id: "africanRhythm", label: "아프리카 리듬", group: "리듬 반주", padType: "synth", detail: "타악 중심의 아프리카 리듬", color: "#b5532f", backgroundId: "africanRhythm", effectIds: [] },
    // 테마 루프 — 4음 동기의 오케스트라 루프
    { id: "theme4", label: "4음 테마", group: "테마 루프", padType: "string", detail: "4음 동기의 오케스트라 루프", color: "#6f7fb0", backgroundId: "theme4", effectIds: [] },
  ]

  const instruments = [
    { id: "flute", group: "서양", label: "플루트", detail: "가벼운 숨결감", waveform: "sine", image: "./assets/instruments/flute.png" },
    { id: "oboe", group: "서양", label: "오보에", detail: "뚜렷한 관악 소리", waveform: "sawtooth", image: "./assets/instruments/oboe.png" },
    { id: "clarinet", group: "서양", label: "클라리넷", detail: "둥글고 부드러운 목관 소리", waveform: "square", image: "./assets/instruments/clarinet.png" },
    { id: "frenchHorn", group: "서양", label: "호른", detail: "긴 호흡의 관악", waveform: "triangle", image: "./assets/instruments/french-horn.png" },
    { id: "mandolin", group: "서양", label: "만돌린", detail: "통통 튕기는 발현 현악", waveform: "triangle", image: "./assets/instruments/mandolin.png" },
    { id: "violin", group: "서양", label: "바이올린", detail: "밝고 선명한 소리", waveform: "sawtooth", image: "./assets/instruments/violin.png" },
    { id: "viola", group: "서양", label: "비올라", detail: "중음역의 안정된 현악", waveform: "sawtooth", image: "./assets/instruments/viola.png" },
    { id: "cello", group: "서양", label: "첼로", detail: "낮고 따뜻한 소리", waveform: "triangle", image: "./assets/instruments/cello.png" },
    { id: "doubleBass", group: "서양", label: "더블베이스", detail: "묵직한 저음 소리", waveform: "triangle", image: "./assets/instruments/double-bass.png" },
    {
      id: "sogeum",
      group: "국악",
      label: "소금",
      detail: "높고 가는 관악 소리",
      waveform: "sine",
      image: "./assets/instruments/sogeum.jpg",
      example: "sound/감상-연주곡(국립국악원)/소금-경풍년.mp3",
      exampleLabel: "경풍년",
    },
    {
      id: "daegeum",
      group: "국악",
      label: "대금",
      detail: "시김새가 잘 드러나는 관악",
      waveform: "sine",
      image: "./assets/instruments/daegeum.jpg",
      example: "sound/감상-연주곡(국립국악원)/대금-아리랑.mp3",
      exampleLabel: "아리랑",
    },
    {
      id: "haegeum",
      group: "국악",
      label: "해금",
      detail: "흔들림이 강한 소리",
      waveform: "sawtooth",
      image: "./assets/instruments/haegeum.jpg",
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
  ]

  // 음계(선율 스타일). gugak: true 인 항목은 시김새를 적용.
  // 으뜸음을 도(C, 60)로 통일해 "음계의 성격(장/단/온음/펜타)"이 실제로 다르게 들리도록 한다.
  // (예전엔 C장조·A단조·D도리안이 모두 흰건반 같은 집합이라 동일하게 들렸음)
  // 팔레트 기본 음역은 G3..G5로 통일한다.
  // 맨 아래와 맨 위에는 silentEdgeRows 만큼 소리 나지 않는 빈 줄을 둔다.
  // 음 간격이 넓어져, 자유롭게 그려도 "연결된" 선율로 들린다(캔버스 맨 아래=낮은 으뜸음).
  // 기본값(맨 앞)은 펜타토닉 — 반음이 없어 어떤 순서로 그려도 어울려 "틀린 음"이 안 난다(칸딘스키 뮤직랩 방식).
  const styles = [
    { id: "natural", label: "자연스러움", scaleName: "C Pentatonic", root: 60, intervals: [0, 2, 4, 7, 9], lowMidi: 55, highMidi: 79, silentEdgeRows: 1, detail: "5음 음계 — 막힘 없는 울림", gugak: false },
    { id: "bright", label: "밝음", scaleName: "C Major", root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], lowMidi: 55, highMidi: 79, silentEdgeRows: 1, detail: "장음계 — 밝고 안정적", gugak: false },
    { id: "calm", label: "차분함", scaleName: "C Minor", root: 60, intervals: [0, 2, 3, 5, 7, 8, 10], lowMidi: 55, highMidi: 79, silentEdgeRows: 1, detail: "단음계 — 어둡고 차분", gugak: false },
    { id: "mystic", label: "신비로움", scaleName: "C Whole Tone", root: 60, intervals: [0, 2, 4, 6, 8, 10], lowMidi: 55, highMidi: 79, silentEdgeRows: 1, detail: "온음음계 — 몽환적·붕 뜬 느낌", gugak: false },
    { id: "gugak", label: "국악풍", scaleName: "G Pentatonic + 시김새", root: 55, intervals: [0, 2, 5, 7, 9], lowMidi: 55, highMidi: 79, silentEdgeRows: 1, detail: "전통 5음계 — 꺾음·흘러내림·떠는음", gugak: true },
  ]

  // 믹스 변형 — 한 시도(테이크)를 다른 균형으로 들어보는 옵션
  // 선율이 배경에 묻힌다는 피드백을 거듭 반영 → 선율 비중을 키움(배경 padGain 은 그대로 유지).
  // 2026-06-23 사용자 요청: 선율(배경 제외)을 한 번 더 ×2 로 키움(아래 melodyGain). 배경/효과음은 불변.
  // (믹스 간 상대 순서·균형 한계는 test/audio-balance.test.js 가 지켜 줌)
  const versions = [
    { id: "balanced", label: "균형", detail: "배경과 그린 소리를 같은 비중으로", melodyGain: 0.84, padGain: 0.17, ornament: false },
    { id: "drawing", label: "그림소리 강조", detail: "그린 선의 소리를 더 또렷하게", melodyGain: 1.12, padGain: 0.12, ornament: false },
    { id: "scene", label: "공간 강조", detail: "분위기 음원을 더 넓게", melodyGain: 0.6, padGain: 0.22, ornament: false },
    { id: "ornament", label: "표현 강조", detail: "소리의 흔들림을 더하게", melodyGain: 0.84, padGain: 0.15, ornament: true },
  ]

  root.SDStudioData = { backgrounds, pads, melodies, effects, atmospheres, instruments, styles, versions }
})(typeof self !== "undefined" ? self : this)
