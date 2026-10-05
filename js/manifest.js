/*
 * manifest.js — 음원·배경·악기·음계 데이터 (브라우저 전역 window.SDStudioData)
 *
 * 선생님이 음원을 추가/교체할 때는 주로 이 파일만 수정하면 됩니다.
 * - 실제 파일이 있으면 src 경로를, 없으면 src: null (합성음 폴백).
 * - 선율 악기는 단일음 샘플의 기준음(baseMidi)을 기준으로 피치 시프트합니다.
 * - 배경(atmosphere)은 backgroundId로 배경 음원과 1:1 매칭됩니다. padType은 배경 로드 실패 시 합성 패드 음색, color는 무드색입니다.
 */
;(function (root) {
  "use strict"

  // 배경음악 — 배경(atmosphere)과 id로 1:1 매칭되는 앱용 MP3
  const backgrounds = {
    calm: { label: "고요한", src: "sound/배경-분위기/고요한(우주).mp3", duration: 155 },
    tension: { label: "긴장되는", src: "sound/배경-분위기/긴장되는(4음테마).mp3", duration: 94 },
    bright: { label: "밝은", src: "sound/배경-분위기/밝은(아침).mp3", duration: 44 },
    cuteSchool: { label: "귀여운", src: "sound/배경-분위기/귀여운(학교).mp3", duration: 104 },
    soaringField: { label: "벅차오르는", src: "sound/배경-분위기/벅차오르는(초원).mp3", duration: 168 },
    sadDawn: { label: "슬픈", src: "sound/배경-분위기/슬픈(새벽).mp3", duration: 132 },
    sereneLake: { label: "잔잔한", src: "sound/배경-분위기/잔잔한(호수).mp3", duration: 154 },
    energetic: { label: "활기찬", src: "sound/배경-분위기/활기찬(도시).mp3", duration: 140 },
    // 소리풍경 — 강·도시·숲·학교 환경 소리. 앞 60초 mono 96k 압축(원본 wav/flac은 deploy 트리 밖 보관).
    river: { label: "강", src: "sound/배경-소리풍경/강.mp3", duration: 60 },
    city: { label: "도시", src: "sound/배경-소리풍경/도시.mp3", duration: 47 },
    forest: { label: "숲", src: "sound/배경-소리풍경/숲.mp3", duration: 60 },
    school: { label: "학교", src: "sound/배경-소리풍경/학교.mp3", duration: 60 },
    // 리듬장단 — 곡 아래 깔리는 장단형 배경. 짧은 장단은 자동 루프됨.
    rhythm: { label: "리듬", src: "sound/배경-리듬장단/리듬-교체본.mp3", duration: 429 },
    jajinSamchae: { label: "자진삼채", src: "sound/배경-리듬장단/자진삼채-연결.mp3", duration: 77 },
    jungjungmori: { label: "중중모리", src: "sound/배경-리듬장단/중중모리-연결.mp3", duration: 62 },
    pungnyu: { label: "풍류", src: "sound/배경-리듬장단/풍류-연결.mp3", duration: 71 },
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

  // 국악 드로잉 팔레트는 악기마다 다르게 줄이지 않고 10칸으로 통일한다.
  // 화면 라벨: G-A-C-D-E-G-A-C-D-E
  const GUGAK_PALETTE_MIDI = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76]

  // 선율 악기 (sound/선율-서양, sound/선율-국악) — 단일음/구절 샘플
  const melodies = {
    // 서양 선율 — 음마다 실제 녹음(멀티샘플). baseMidi/lowMidi/highMidi/sampleMap 은 sample-maps-western.js 가 채운다.
    // 아래 src 는 그 맵 로드 실패 시 쓰는 대표(중간음역) 폴백이며 baseMidi 와 음높이를 맞춰 둔다.
    violin: { label: "바이올린", group: "서양", src: "sound/선율-서양(필하모니아)/현/violin/violin_G5.mp3", sampleMode: "multi", baseMidi: 79, lowMidi: 55, highMidi: 103, playbackTranspose: 0, minRate: 0.72, maxRate: 1.9, waveform: "sawtooth" },
    viola: { label: "비올라", group: "서양", src: "sound/선율-서양(필하모니아)/현/viola/viola_Cs5.mp3", sampleMode: "multi", baseMidi: 73, lowMidi: 48, highMidi: 98, playbackTranspose: 0, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    cello: { label: "첼로", group: "서양", src: "sound/선율-서양(필하모니아)/현/cello/cello_C4.mp3", sampleMode: "multi", baseMidi: 60, lowMidi: 36, highMidi: 84, playbackTranspose: -12, minRate: 0.62, maxRate: 1.9, waveform: "triangle" },
    doubleBass: { label: "더블베이스", group: "서양", src: "sound/선율-서양(필하모니아)/현/doubleBass/doubleBass_As2.mp3", sampleMode: "multi", baseMidi: 46, lowMidi: 24, highMidi: 67, playbackTranspose: -24, minRate: 0.72, maxRate: 1.9, waveform: "triangle" },
    clarinet: { label: "클라리넷", group: "서양", src: "sound/선율-서양(필하모니아)/관/clarinet/clarinet_Cs5.mp3", sampleMode: "multi", baseMidi: 73, lowMidi: 50, highMidi: 96, playbackTranspose: 0, minRate: 0.55, maxRate: 1.9, waveform: "square" },
    oboe: { label: "오보에", group: "서양", src: "sound/선율-서양(필하모니아)/관/oboe/oboe_E5.mp3", sampleMode: "multi", baseMidi: 76, lowMidi: 58, highMidi: 94, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth" },
    flute: { label: "플루트", group: "서양", src: "sound/선율-서양(필하모니아)/관/flute/flute_A5.mp3", sampleMode: "multi", baseMidi: 81, lowMidi: 60, highMidi: 101, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sine" },
    frenchHorn: { label: "호른", group: "서양", src: "sound/선율-서양(필하모니아)/관/frenchHorn/frenchHorn_Gs3.mp3", sampleMode: "multi", baseMidi: 56, lowMidi: 34, highMidi: 77, playbackTranspose: -12, minRate: 0.55, maxRate: 1.72, waveform: "triangle" },
    sogeum: { label: "소금", group: "국악", src: "sound/선율-국악(국립국악원)/관/소금.mp3", baseMidi: 72, lowMidi: 64, highMidi: 84, playableMidi: GUGAK_PALETTE_MIDI, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    daegeum: { label: "대금", group: "국악", src: "sound/선율-국악(국립국악원)/관/정악대금.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, playableMidi: GUGAK_PALETTE_MIDI, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    danso: { label: "단소", group: "국악", src: "sound/선율-국악(국립국악원)/관/단소.mp3", baseMidi: 80, lowMidi: 68, highMidi: 89, playableMidi: GUGAK_PALETTE_MIDI, playbackTranspose: 12, minRate: 0.62, maxRate: 1.72, waveform: "sine", sampleMode: "phrase" },
    haegeum: { label: "해금", group: "국악", src: "sound/선율-국악(국립국악원)/현/해금.mp3", baseMidi: 69, lowMidi: 60, highMidi: 81, playableMidi: GUGAK_PALETTE_MIDI, minRate: 0.62, maxRate: 1.72, waveform: "sawtooth", sampleMode: "phrase" },
    gayageum: { label: "가야금", group: "국악", src: "sound/선율-국악(국립국악원)/현/가야금.mp3", baseMidi: 60, lowMidi: 48, highMidi: 72, playableMidi: GUGAK_PALETTE_MIDI, minRate: 0.55, maxRate: 1.72, waveform: "triangle", sampleMode: "phrase" },
  }

  // 자연 효과음 (sound/효과-자연음(유자레코즈), 그 소리가 없던 것은 sound/효과-자연음(픽사베이)) + 도장 효과음 (sound/효과음-도장)
  // 라벨 이름의 파일(산들바람.mp3 등)은 tools/build-nature-effects.py 가 원본을 다듬어 만든다 —
  // 미리듣기가 앞 1.2초만 들려주므로 이름에 맞는 순간을 맨 앞에 두었다.
  // gain: 앱 속 크기를 새소리에 맞추는 배율. 이름이 센 소리는 더 크게, 약한 소리는 조금 작게(measure-effect-loudness.cjs LEVEL_DB).
  // 파일 크기가 −14~−38 LUFS로 제각각이라 같은 게인으로 틀면 빗소리가 묻혔다(2026-10-05).
  // 값은 node tools/measure-effect-loudness.cjs 가 추천한 그대로 쓴다 — 파일을 바꾸면 다시 잰다.
  const effects = {
    // 바람 셋·번개·폭풍우·흑동고래는 노트북 스피커에서 작게 들려 픽사베이 녹음으로 바꿨다(2026-10-05, 그 전엔 유자레코즈 바람1~3·천둥2·3).
    wind1: { label: "산들바람", src: "sound/효과-자연음(픽사베이)/산들바람.mp3", gain: 1.29, image: "./assets/effects/wind-breeze.webp" },
    wind2: { label: "거센바람", src: "sound/효과-자연음(픽사베이)/거센바람.mp3", gain: 2.04, image: "./assets/effects/wind-gust.webp" },
    wind3: { label: "회오리바람", src: "sound/효과-자연음(픽사베이)/회오리바람.mp3", gain: 1.82, image: "./assets/effects/wind-whirl.webp" },
    // 비1↔비2 는 원본 파일 이름과 실제 소리가 반대였다(비1이 비2보다 14 dB 크고 굵다).
    // 학생이 고른 이름대로 들리도록 음원을 맞바꿨다 — 라벨·그림은 그대로 둔다.
    rain1: { label: "가랑비", src: "sound/효과-자연음(유자레코즈)/비2.mp3", gain: 11.35, image: "./assets/effects/rain-drizzle.webp" },
    rain2: { label: "소나기", src: "sound/효과-자연음(유자레코즈)/비1.mp3", gain: 3.55, image: "./assets/effects/rain-shower.webp" },
    // 비3 은 고른 빗소리라 굵은 물방울이 따로 들리지 않았다 → 똑똑 떨어지는 픽사베이 녹음으로 바꿨다.
    rain3: { label: "큰 빗방울", src: "sound/효과-자연음(픽사베이)/큰빗방울.mp3", gain: 4.29, image: "./assets/effects/rain-drops.webp" },
    // 새소리 숲(forest1)은 뺐다 — 동물 도장의 새·뻐꾸기와 구별되지 않았다.
    // 숲2 는 새 울음 두 번 뒤 11초가 거의 무음(잎 소리 없음), 숲3 은 가까운 새들의 지저귐이라 픽사베이 녹음으로 바꿨다.
    forest2: { label: "흔들리는 잎", src: "sound/효과-자연음(픽사베이)/흔들리는잎.mp3", gain: 3.27, image: "./assets/effects/forest-leaves.webp" },
    forest3: { label: "깊은 숲", src: "sound/효과-자연음(픽사베이)/깊은숲.mp3", gain: 2.88, image: "./assets/effects/forest-deep.webp" },
    // 천둥1 은 번개만큼 커서 '먼' 느낌이 약했다 → 높은 소리가 없는 먼 천둥 녹음으로 바꿨다(크기는 gain 으로 3 dB 작게).
    thunder1: { label: "먼 천둥", src: "sound/효과-자연음(픽사베이)/먼천둥.mp3", gain: 2.57, image: "./assets/effects/thunder-distant.webp" },
    thunder2: { label: "번개", src: "sound/효과-자연음(픽사베이)/번개.mp3", gain: 3.67, image: "./assets/effects/thunder-lightning.webp" },
    thunder3: { label: "폭풍우", src: "sound/효과-자연음(픽사베이)/폭풍우.mp3", gain: 3.31, image: "./assets/effects/thunder-storm.webp" },
    // 천둥4 는 '쿵' 한 번 뒤 2.6초에 끝나 굴러가는 느낌이 짧았다 → 길게 굴러가는 픽사베이 녹음으로 바꿨다.
    thunder4: { label: "우르릉", src: "sound/효과-자연음(픽사베이)/우르릉.mp3", gain: 1.82, image: "./assets/effects/thunder-rumble.webp" },
    animalCricket: { label: "귀뚜라미", group: "동물", src: "sound/효과음-도장/동물/귀뚜라미.mp3", gain: 3.02, image: "./assets/effects/stamps/animal-cricket.webp" },
    animalCuckoo: { label: "뻐꾸기", group: "동물", src: "sound/효과음-도장/동물/뻐꾸기.mp3", gain: 1.43, image: "./assets/effects/stamps/animal-cuckoo.webp" },
    animalBird: { label: "새", group: "동물", src: "sound/효과음-도장/동물/새.mp3", gain: 1, image: "./assets/effects/stamps/animal-bird.webp" },
    animalWhale: { label: "흑동고래", group: "동물", src: "sound/효과음-도장/동물/흑동고래.mp3", gain: 1.84, image: "./assets/effects/stamps/animal-whale.webp" },
    sfxBubblePop: { label: "방울pop", group: "효과", src: "sound/효과음-도장/효과/방울pop.mp3", gain: 1.32, image: "./assets/effects/stamps/sfx-bubble-pop.webp" },
    sfxBell: { label: "벨", group: "효과", src: "sound/효과음-도장/효과/벨.mp3", gain: 1.26, image: "./assets/effects/stamps/sfx-bell.webp" },
    sfxTambourine: { label: "탬버린", group: "효과", src: "sound/효과음-도장/효과/탬버린.mp3", gain: 3.16, image: "./assets/effects/stamps/sfx-tambourine.webp" },
    sfxHarp: { label: "하프", group: "효과", src: "sound/효과음-도장/효과/하프.mp3", gain: 2.75, image: "./assets/effects/stamps/sfx-harp.webp" },
  }

  // 배경 — 배경 음원과 1:1로 직접 매칭. id가 곧 backgroundId.
  // 선생님이 추가로 올린 음원은 studio.js에서 이 배열에 동적으로 push 됩니다.
  // group: 2단계 카드 묶음 라벨. studio.js renderAtmospheres 가 group 순서대로 소제목을 붙여 보여 준다.
  const atmospheres = [
    { id: "calm", label: "고요한", group: "분위기", padType: "ambient", detail: "넓고 고요한 우주 배경", color: "#7fa6a0", backgroundId: "calm", effectIds: [] },
    { id: "tension", label: "긴장되는", group: "분위기", padType: "drone", detail: "짧은 4음 동기의 긴장감", color: "#9c6b7a", backgroundId: "tension", effectIds: [] },
    { id: "bright", label: "밝은", group: "분위기", padType: "synth", detail: "아침처럼 맑고 밝은 배경", color: "#c89a4e", backgroundId: "bright", effectIds: [] },
    { id: "cuteSchool", label: "귀여운", group: "분위기", padType: "synth", detail: "귀여운 학교 색감", color: "#d09b61", backgroundId: "cuteSchool", effectIds: [] },
    { id: "soaringField", label: "벅차오르는", group: "분위기", padType: "string", detail: "초원처럼 넓게 차오르는 느낌", color: "#7d9f5f", backgroundId: "soaringField", effectIds: [] },
    { id: "sadDawn", label: "슬픈", group: "분위기", padType: "string", detail: "새벽빛의 차분한 슬픔", color: "#687b9e", backgroundId: "sadDawn", effectIds: [] },
    { id: "sereneLake", label: "잔잔한", group: "분위기", padType: "ambient", detail: "호수처럼 잔잔한 흐름", color: "#5f98a0", backgroundId: "sereneLake", effectIds: [] },
    { id: "energetic", label: "활기찬", group: "분위기", padType: "synth", detail: "도시의 활기와 움직임", color: "#d3814f", backgroundId: "energetic", effectIds: [] },
    // 소리풍경 — 강·도시·숲·학교 (연속 배경 앰비언스)
    { id: "river", label: "강", group: "소리풍경", padType: "ambient", detail: "흐르는 강물 소리", color: "#5a86a8", backgroundId: "river", effectIds: [] },
    { id: "city", label: "도시", group: "소리풍경", padType: "synth", detail: "도시의 거리 소음", color: "#7d7a86", backgroundId: "city", effectIds: [] },
    { id: "forest", label: "숲", group: "소리풍경", padType: "ambient", detail: "새소리 가득한 숲", color: "#5f8a55", backgroundId: "forest", effectIds: [] },
    { id: "school", label: "학교", group: "소리풍경", padType: "ambient", detail: "운동장·교실의 학교 소리", color: "#b08a4e", backgroundId: "school", effectIds: [] },
    // 리듬장단 — 곡 아래 깔리는 장단형 배경
    { id: "rhythm", label: "리듬", group: "리듬장단", padType: "synth", detail: "신나고 재밌는 리듬", color: "#c2683f", backgroundId: "rhythm", effectIds: [] },
    { id: "jajinSamchae", label: "자진삼채", group: "리듬장단", padType: "synth", detail: "빠르고 흥겨운 장단", color: "#b5532f", backgroundId: "jajinSamchae", effectIds: [] },
    { id: "jungjungmori", label: "중중모리", group: "리듬장단", padType: "synth", detail: "여유롭고 경쾌한 장단", color: "#a8623f", backgroundId: "jungjungmori", effectIds: [] },
    { id: "pungnyu", label: "풍류", group: "리듬장단", padType: "string", detail: "멋스러운 장단", color: "#8a6b4e", backgroundId: "pungnyu", effectIds: [] },
    // 배경 없음 — 배경음악·합성 패드 없이 악기 소리만. silent:true 가 엔진의 합성 패드/앰비언스 폴백을 끈다.
    // (backgroundId·padType 이 없어 배경 음원도, 합성 패드도 깔리지 않는다. 배열 끝에 둬 기본값(고요한, index 0)은 유지.)
    { id: "none", label: "배경음악 없음", group: "배경 없음", padType: null, detail: "배경음악 없이 악기 소리만", color: "#8c9196", backgroundId: null, effectIds: [], silent: true },
  ]

  const instruments = [
    {
      id: "flute",
      group: "서양",
      family: "관악기",
      label: "플루트",
      detail: "가볍고 투명한 소리",
      waveform: "sine",
      image: "./assets/instruments/flute.webp",
      // 플루트·바이올린·더블베이스 연주곡은 출처 표시가 필요한 CC 녹음 — 2단계 아래 출처 줄(studio.js AUDIO_MODE_CREDIT)과
      // sound/감상-연주곡(서양악기)/라이센스.txt. 예전 파일은 작고(-34·-29·-25 LUFS) 10 kHz 위가 비어 먹먹했다.
      example: "sound/감상-연주곡(서양악기)/플루트-슈타미츠.mp3",
      exampleLabel: "슈타미츠 카프리치오",
    },
    {
      id: "oboe",
      group: "서양",
      family: "관악기",
      label: "오보에",
      detail: "애잔하고 맑은 소리",
      waveform: "sawtooth",
      image: "./assets/instruments/oboe.webp",
      example: "sound/감상-연주곡(서양악기)/오보에.mp3",
    },
    {
      id: "clarinet",
      group: "서양",
      family: "관악기",
      label: "클라리넷",
      detail: "둥글고 부드러운 소리",
      waveform: "square",
      image: "./assets/instruments/clarinet.webp",
      example: "sound/감상-연주곡(서양악기)/클라리넷.mp3",
    },
    {
      id: "frenchHorn",
      group: "서양",
      family: "관악기",
      label: "호른",
      detail: "웅장하고 포근한 소리",
      waveform: "triangle",
      image: "./assets/instruments/french-horn.webp",
      example: "sound/감상-연주곡(서양악기)/호른.mp3",
    },
    {
      id: "violin",
      group: "서양",
      family: "현악기",
      label: "바이올린",
      detail: "선명하고 화려한 소리",
      waveform: "sawtooth",
      image: "./assets/instruments/violin.webp",
      example: "sound/감상-연주곡(서양악기)/바이올린-보케리니.mp3",
      exampleLabel: "보케리니 미뉴에트",
    },
    {
      id: "viola",
      group: "서양",
      family: "현악기",
      label: "비올라",
      detail: "차분하고 은은한 소리",
      waveform: "sawtooth",
      image: "./assets/instruments/viola.webp",
      example: "sound/감상-연주곡(서양악기)/비올라.mp3",
    },
    {
      id: "cello",
      group: "서양",
      family: "현악기",
      label: "첼로",
      detail: "깊고 풍부한 소리",
      waveform: "triangle",
      image: "./assets/instruments/cello.webp",
      example: "sound/감상-연주곡(서양악기)/첼로.mp3",
    },
    {
      id: "doubleBass",
      group: "서양",
      family: "현악기",
      label: "더블베이스",
      detail: "낮고 묵직한 소리",
      waveform: "triangle",
      image: "./assets/instruments/double-bass.webp",
      example: "sound/감상-연주곡(서양악기)/더블베이스-보테시니.mp3",
      exampleLabel: "보테시니 '몽유병의 여인'",
    },
    {
      id: "sogeum",
      group: "국악",
      family: "관악기",
      label: "소금",
      detail: "청아한 소리",
      waveform: "sine",
      image: "./assets/instruments/sogeum.jpg",
      example: "sound/감상-연주곡(국립국악원)/소금-수제천025.mp3",
      exampleLabel: "수제천025",
    },
    {
      id: "daegeum",
      group: "국악",
      family: "관악기",
      label: "대금",
      detail: "깊게 울리는 소리",
      waveform: "sine",
      image: "./assets/instruments/daegeum.jpg",
      example: "sound/감상-연주곡(국립국악원)/대금-아리랑.mp3",
      exampleLabel: "아리랑",
    },
    {
      id: "danso",
      group: "국악",
      family: "관악기",
      label: "단소",
      detail: "고요한 소리",
      waveform: "sine",
      image: "./assets/instruments/danso.jpg",
      // 단소 독주 대표곡의 첫 장단. 예전 '문덕곡 도드리'는 소금·대금보다 24 dB 작게 녹음돼 있었다(tools/build-instrument-examples.py).
      example: "sound/감상-연주곡(국립국악원)/단소-청성곡.mp3",
      exampleLabel: "청성곡",
    },
    {
      id: "haegeum",
      group: "국악",
      family: "현악기",
      label: "해금",
      detail: "애절한 소리",
      waveform: "sawtooth",
      image: "./assets/instruments/haegeum.jpg",
      example: "sound/감상-연주곡(국립국악원)/해금.mp3",
      exampleLabel: "해금",
    },
    {
      id: "gayageum",
      group: "국악",
      family: "현악기",
      label: "가야금",
      detail: "맑게 뜯는 소리",
      waveform: "triangle",
      image: "./assets/instruments/gayageum.jpg",
      example: "sound/감상-연주곡(국립국악원)/가야금.mp3",
      exampleLabel: "가야금",
    },
  ]

  // 음계(선율 스타일). gugak: true 인 항목은 시김새를 적용.
  // 으뜸음을 도(C, 60)로 통일해 "음계의 성격(장/단/온음/펜타)"이 실제로 다르게 들리도록 한다.
  // (예전엔 C장조·A단조·D도리안이 모두 흰건반 같은 집합이라 동일하게 들렸음)
  // 서양 팔레트 기본 음역은 G3..G5로 통일한다.
  // 국악풍도 화면 도화지는 서양 기본 축 15칸을 함께 쓰고, 실제 발음 가능한 10음만 켠다.
  // 음 간격이 넓어져, 자유롭게 그려도 "연결된" 선율로 들린다.
  // 기본값(맨 앞)은 펜타토닉 — 반음이 없어 어떤 순서로 그려도 어울려 "틀린 음"이 안 난다(칸딘스키 뮤직랩 방식).
  const styles = [
    { id: "natural", label: "자연스러움", scaleName: "C Pentatonic", root: 60, intervals: [0, 2, 4, 7, 9], lowMidi: 55, highMidi: 79, detail: "5음 음계 — 막힘 없는 울림", gugak: false },
    { id: "bright", label: "밝음", scaleName: "C Major", root: 60, intervals: [0, 2, 4, 5, 7, 9, 11], lowMidi: 55, highMidi: 79, detail: "장음계 — 밝고 안정적", gugak: false },
    { id: "calm", label: "차분함", scaleName: "C Minor", root: 60, intervals: [0, 2, 3, 5, 7, 8, 10], lowMidi: 55, highMidi: 79, detail: "단음계 — 어둡고 차분", gugak: false },
    { id: "mystic", label: "신비로움", scaleName: "C Whole Tone", root: 60, intervals: [0, 2, 4, 6, 8, 10], lowMidi: 55, highMidi: 79, detail: "온음음계 — 몽환적·붕 뜬 느낌", gugak: false },
    {
      id: "gugak",
      label: "국악풍",
      scaleName: "G Pentatonic + 시김새",
      root: 55,
      intervals: [0, 2, 5, 7, 9],
      lowMidi: 55,
      highMidi: 76,
      drawRoot: 60,
      drawIntervals: [0, 2, 4, 5, 7, 9, 11],
      drawLowMidi: 55,
      drawHighMidi: 79,
      detail: "전통 5음계 — 꺾음·흘러내림·떠는음",
      gugak: true,
    },
  ]

  // 믹스 변형 — 한 시도(테이크)를 다른 균형으로 들어보는 옵션
  // 선율이 배경에 묻힌다는 피드백을 거듭 반영 → 선율 비중을 키움(배경 padGain 은 그대로 유지).
  // 2026-06-23 사용자 요청: 선율(배경 제외)을 한 번 더 ×2 로 키움(아래 melodyGain). 배경/효과음은 불변.
  // 2026-06-27 사용자 요청: 배경음·선율음 크기를 현재보다 ×2 로(둘 다). 클리핑은 마스터 리미터(audio-engine.js)가 막음.
  // (믹스 간 상대 순서·균형 한계는 test/audio-balance.test.js 가 지켜 줌)
  const versions = [
    { id: "balanced", label: "균형", detail: "배경과 그린 소리를 같은 비중으로", melodyGain: 1.68, padGain: 0.34, ornament: false },
    { id: "drawing", label: "그림소리 강조", detail: "그린 선의 소리를 더 또렷하게", melodyGain: 2.24, padGain: 0.24, ornament: false },
    { id: "scene", label: "공간 강조", detail: "분위기 음원을 더 넓게", melodyGain: 1.2, padGain: 0.44, ornament: false },
    { id: "ornament", label: "표현 강조", detail: "소리의 흔들림을 더하게", melodyGain: 1.68, padGain: 0.3, ornament: true },
  ]

  root.SDStudioData = { backgrounds, pads, melodies, effects, atmospheres, instruments, styles, versions }
})(typeof self !== "undefined" ? self : this)
