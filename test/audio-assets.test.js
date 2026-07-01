const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const projectDir = path.resolve(__dirname, "..")

function loadManifest() {
  const sandbox = {}
  const files = ["manifest.js", "sample-maps.js", "sample-maps-western.js"]
  sandbox.self = sandbox
  for (const file of files) {
    const code = fs.readFileSync(path.join(projectDir, "js", file), "utf8")
    vm.runInNewContext(code, sandbox, { filename: file })
  }
  return sandbox.SDStudioData
}

function collectAssets(data) {
  const entries = []
  for (const group of ["backgrounds", "pads", "melodies", "effects"]) {
    for (const [id, asset] of Object.entries(data[group])) {
      if (asset.src) entries.push({ group, id, src: asset.src })
    }
  }
  return entries
}

function collectInstrumentImages(data) {
  return Array.from(data.instruments).filter((instrument) => instrument.image)
}

function collectInstrumentExamples(data) {
  return Array.from(data.instruments).filter((instrument) => instrument.example)
}

function collectEffectImages(data) {
  return Object.entries(data.effects).filter(([, effect]) => effect.image)
}

test("manifest audio src entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectAssets(data)
    .map((asset) => ({ ...asset, filePath: path.resolve(projectDir, asset.src) }))
    .filter((asset) => !fs.existsSync(asset.filePath))

  assert.deepEqual(missing, [])
})

test("instrument image entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectInstrumentImages(data)
    .map((instrument) => ({ id: instrument.id, image: instrument.image, filePath: path.resolve(projectDir, instrument.image) }))
    .filter((instrument) => !fs.existsSync(instrument.filePath))

  assert.deepEqual(missing, [])
})

test("instrument example audio entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectInstrumentExamples(data)
    .map((instrument) => ({ id: instrument.id, example: instrument.example, filePath: path.resolve(projectDir, instrument.example) }))
    .filter((instrument) => !fs.existsSync(instrument.filePath))
  const unsupportedFormats = collectInstrumentExamples(data).filter((instrument) => !/\.(mp3|wav)$/i.test(instrument.example))
  const westernMissingExamples = Array.from(data.instruments)
    .filter((instrument) => instrument.group === "서양" && !instrument.example)
    .map((instrument) => instrument.id)
  const westernExamples = {
    flute: "sound/감상-연주곡(서양악기)/플루트.mp3",
    oboe: "sound/감상-연주곡(서양악기)/오보에.mp3",
    clarinet: "sound/감상-연주곡(서양악기)/클라리넷.mp3",
    frenchHorn: "sound/감상-연주곡(서양악기)/호른.mp3",
    violin: "sound/감상-연주곡(서양악기)/바이올린.mp3",
    viola: "sound/감상-연주곡(서양악기)/비올라.mp3",
    cello: "sound/감상-연주곡(서양악기)/첼로.mp3",
    doubleBass: "sound/감상-연주곡(서양악기)/더블베이스.mp3",
  }

  assert.deepEqual(missing, [])
  assert.equal(unsupportedFormats.length, 0, "악기 감상 예시곡은 브라우저 호환 형식(mp3/wav)을 사용한다")
  assert.equal(westernMissingExamples.length, 0)
  for (const [id, example] of Object.entries(westernExamples)) {
    assert.equal(data.instruments.find((instrument) => instrument.id === id).example, example)
  }
  assert.equal(data.instruments.find((instrument) => instrument.id === "sogeum").exampleLabel, "수제천025")
  assert.equal(data.instruments.find((instrument) => instrument.id === "danso").exampleLabel, "문덕곡 도드리(가사)")
  assert.equal(data.instruments.find((instrument) => instrument.id === "haegeum").exampleLabel, "해금")
  assert.equal(data.instruments.find((instrument) => instrument.id === "gayageum").exampleLabel, "가야금")
})

test("effect image entries point to existing project files", () => {
  const data = loadManifest()
  const missing = collectEffectImages(data)
    .map(([id, effect]) => ({ id, image: effect.image, filePath: path.resolve(projectDir, effect.image) }))
    .filter((effect) => !fs.existsSync(effect.filePath))

  assert.deepEqual(missing, [])
})

test("새 도장 효과음은 정리된 폴더의 음원과 이미지를 사용한다", () => {
  const data = loadManifest()
  const expected = {
    animalCricket: ["귀뚜라미", "sound/효과음-도장/동물/귀뚜라미.mp3", "./assets/effects/stamps/animal-cricket.webp"],
    animalCuckoo: ["뻐꾸기", "sound/효과음-도장/동물/뻐꾸기.mp3", "./assets/effects/stamps/animal-cuckoo.webp"],
    animalBird: ["새", "sound/효과음-도장/동물/새.mp3", "./assets/effects/stamps/animal-bird.webp"],
    animalWhale: ["흑동고래", "sound/효과음-도장/동물/흑동고래.mp3", "./assets/effects/stamps/animal-whale.webp"],
    sfxBubblePop: ["방울pop", "sound/효과음-도장/효과/방울pop.mp3", "./assets/effects/stamps/sfx-bubble-pop.webp"],
    sfxBell: ["벨", "sound/효과음-도장/효과/벨.mp3", "./assets/effects/stamps/sfx-bell.webp"],
    sfxTambourine: ["탬버린", "sound/효과음-도장/효과/탬버린.mp3", "./assets/effects/stamps/sfx-tambourine.webp"],
    sfxHarp: ["하프", "sound/효과음-도장/효과/하프.mp3", "./assets/effects/stamps/sfx-harp.webp"],
  }

  for (const [id, [label, src, image]] of Object.entries(expected)) {
    assert.equal(data.effects[id].label, label)
    assert.equal(data.effects[id].src, src)
    assert.equal(data.effects[id].image, image)
    assert.ok(fs.existsSync(path.resolve(projectDir, src)), id + " audio")
    assert.ok(fs.existsSync(path.resolve(projectDir, image)), id + " image")
  }
})

test("배경/악기 화면은 선별된 배경음과 새 하위 범주를 사용한다", () => {
  const data = loadManifest()
  const expectedGroups = ["분위기", "소리풍경", "리듬장단", "배경 없음"]
  const actualGroups = []
  for (const item of data.atmospheres) {
    if (!actualGroups.includes(item.group)) actualGroups.push(item.group)
  }

  assert.deepEqual(actualGroups, expectedGroups)
  assert.deepEqual(
    JSON.parse(JSON.stringify(data.atmospheres.map((item) => item.id))),
    [
      "calm",
      "tension",
      "bright",
      "cuteSchool",
      "soaringField",
      "sadDawn",
      "sereneLake",
      "energetic",
      "river",
      "city",
      "forest",
      "school",
      "rhythm",
      "jajinSamchae",
      "jungjungmori",
      "pungnyu",
      "none",
    ],
  )

  // 배경음악 없음 — 배경 음원·padType 없이 silent 플래그만 가진다(합성 패드/앰비언스 폴백 차단용).
  const none = data.atmospheres.find((item) => item.id === "none")
  assert.ok(none, "배경 없음 옵션이 있어야 한다")
  assert.equal(none.silent, true)
  assert.equal(none.backgroundId, null)
  assert.equal(none.padType, null)
  assert.equal(data.backgrounds.none, undefined, "배경 없음은 배경 음원을 추가하지 않는다")

  for (const id of ["exotic", "peaceful", "africanRhythm", "theme4"]) {
    assert.equal(data.backgrounds[id], undefined, id + " background removed")
    assert.equal(data.atmospheres.some((item) => item.id === id), false, id + " atmosphere removed")
  }

  for (const asset of Object.values(data.backgrounds)) {
    assert.match(asset.src, /^sound\/배경-(분위기|소리풍경|리듬장단)\//)
    assert.doesNotMatch(asset.src, /배경\(freesound\)|배경-환경음|배경-리듬반주|배경-테마루프/)
  }
})

test("자족형 구조: 음원 폴더가 앱 폴더 안에 있고 serve는 앱 폴더를 그대로 띄운다", () => {
  // 음원을 상대경로(sound/...)로 앱 폴더 안에 두어, 폴더 하나만 복사하면 어디서든 동작.
  assert.ok(fs.existsSync(path.join(projectDir, "sound")), "앱 폴더 안에 sound/ 가 없다")
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"))
  assert.match(pkg.scripts.serve, /http\.server/)
  assert.doesNotMatch(pkg.scripts.serve, /--directory/, "serve가 더 이상 상위 폴더를 띄우면 안 된다")
})

test("음원 src 경로는 상대경로(sound/...)여야 한다 — 상위(../) 참조 금지", () => {
  const data = loadManifest()
  const offenders = collectAssets(data).filter((a) => /^\.\.\//.test(a.src))
  assert.deepEqual(offenders, [], "src에 ../ 상위 참조가 남아있다")
})

test("detected sample maps provide playable note segments for gugak melody assets", () => {
  const data = loadManifest()
  const gugak = Object.entries(data.melodies).filter(([, asset]) => asset.group === "국악")
  const missing = gugak.filter(([, asset]) => !Array.isArray(asset.sampleMap) || asset.sampleMap.length === 0)

  assert.deepEqual(
    missing.map(([id]) => id),
    [],
  )

  for (const [id, asset] of gugak) {
    let prevMidi = -Infinity
    for (const item of asset.sampleMap) {
      assert.equal(typeof item.midi, "number", id + " midi")
      assert.equal(typeof item.offset, "number", id + " offset")
      assert.equal(typeof item.duration, "number", id + " duration")
      assert.ok(item.midi >= prevMidi, id + " sorted midi")
      assert.ok(item.offset >= 0, id + " offset non-negative")
      assert.ok(item.duration > 0.05, id + " duration")
      assert.ok(item.confidence >= 0.9, id + " confidence")
      prevMidi = item.midi
    }
  }
})

test("sustained wind sample maps avoid short repeated loop sources", () => {
  const data = loadManifest()
  const dansoLow = data.melodies.danso.sampleMap.find((item) => item.midi === 68)
  const oboeE6 = data.melodies.oboe.sampleMap.find((item) => item.midi === 88)

  assert.equal(dansoLow.duration, 2.4)
  assert.match(oboeE6.src, /oboe_F6\.mp3$/)
  assert.equal(oboeE6.cents, 100)
})

test("index loads detected sample maps before the audio engine", () => {
  const html = fs.readFileSync(path.join(projectDir, "studio.html"), "utf8")
  assert.ok(html.indexOf("./js/manifest.js") < html.indexOf("./js/sample-maps.js"))
  assert.ok(html.indexOf("./js/sample-maps.js") < html.indexOf("./js/sample-maps-western.js"))
  assert.ok(html.indexOf("./js/sample-maps-western.js") < html.indexOf("./js/audio-engine.js"))
})

test("서양 선율은 음마다 실제 녹음 멀티샘플 맵을 가지고, 그 파일들이 모두 존재한다", () => {
  const data = loadManifest()
  const western = Object.entries(data.melodies).filter(([, asset]) => asset.group === "서양")
  // 모든 서양 선율 악기는 멀티샘플(음마다 별도 파일)이어야 한다.
  const notMulti = western.filter(([, asset]) => asset.sampleMode !== "multi" || !Array.isArray(asset.sampleMap) || asset.sampleMap.length === 0)
  assert.deepEqual(
    notMulti.map(([id]) => id),
    [],
    "멀티샘플 맵이 비어있는 서양 악기",
  )

  const missing = []
  for (const [id, asset] of western) {
    let prevMidi = -Infinity
    for (const item of asset.sampleMap) {
      assert.equal(typeof item.midi, "number", id + " midi")
      assert.equal(typeof item.src, "string", id + " src")
      assert.ok(item.midi >= prevMidi, id + " sorted midi")
      prevMidi = item.midi
      if (/^\.\.\//.test(item.src)) missing.push(id + " ../ 참조: " + item.src)
      else if (!fs.existsSync(path.resolve(projectDir, item.src))) missing.push(id + " 없음: " + item.src)
    }
    // baseMidi 는 맵 범위 안에 있어야 폴백이 정상 음높이로 들린다.
    assert.ok(asset.baseMidi >= asset.sampleMap[0].midi && asset.baseMidi <= asset.sampleMap[asset.sampleMap.length - 1].midi, id + " baseMidi 범위")
  }
  assert.deepEqual(missing, [])
})

// 국악 음원은 한 곡(프레이즈)을 잘라 쓰므로, 검출된 구간이 목표 음에서 cents 만큼 어긋나 있다.
// audio-engine 의 segmentPlaybackRate 는 그 cents 를 보정해 정확한 음높이로 재생해야 한다.
// (보정 전엔 소금 삑사리·대금 윗옥타브·해금 전체 피치가 최대 ±50센트까지 어긋났다.)
test("국악 샘플맵은 cents 보정 후 연주 음을 정확한 음높이로 낸다", () => {
  const data = loadManifest()
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12)
  const nearest = (map, midi) => map.reduce((b, it) => (Math.abs(it.midi - midi) < Math.abs(b.midi - midi) ? it : b), map[0])
  // 프로덕션(segmentPlaybackRate)과 동일한 보정식.
  const compensatedRate = (seg, midi) => Math.pow(2, (midi - (seg.midi + (seg.cents || 0) / 100)) / 12)
  const centsOff = (a, b) => 1200 * Math.log2(a / b)

  // 각 악기의 드로잉 팔레트 음을 cents 보정해 음정 오차를 잰다.
  const targets = {
    sogeum: data.melodies.sogeum.playableMidi,
    daegeum: data.melodies.daegeum.playableMidi,
    haegeum: data.melodies.haegeum.playableMidi,
    gayageum: data.melodies.gayageum.playableMidi,
  }
  for (const [id, midis] of Object.entries(targets)) {
    const asset = data.melodies[id]
    for (const midi of midis) {
      const seg = nearest(asset.sampleMap, midi)
      const soundingHz = seg.detectedHz * compensatedRate(seg, midi)
      const off = Math.abs(centsOff(soundingHz, freq(midi)))
      assert.ok(off < 5, id + " draw " + midi + " 음정 오차 " + off.toFixed(1) + "c (보정 후 5센트 미만이어야 함)")
    }
  }
})

test("25현 가야금도 공통 국악 팔레트를 연주한다", () => {
  const data = loadManifest()
  assert.deepEqual(Array.from(data.melodies.gayageum.playableMidi), [55, 57, 60, 62, 64, 67, 69, 72, 74, 76])
})
