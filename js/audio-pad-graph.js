/*
 * audio-pad-graph.js — 합성 배경 패드의 Web Audio 노드 그래프 생성
 *
 * 브라우저: 클래식 <script>로 로드되어 window.SDAudioPadGraph 에 노출.
 * Node:     require("./js/audio-pad-graph.js") 로 동일 API 사용.
 *
 * 이 모듈은 음색 노드 생성과 연결만 담당한다. gain envelope와 source의
 * start/stop 시점은 전체 재생·드로잉 ambience 호출부가 각각 계속 소유한다.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = api
  else root.SDAudioPadGraph = api
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  function createSynthPadGraph(ctx, destination, plan, when) {
    const gain = ctx.createGain()
    gain.connect(destination)
    const base = plan.style.root - 12
    const intervals = plan.style.intervals
    const chord = [base, base + (intervals[2] || 4), base + (intervals[4] || 7)]
    const wave = (plan.padAsset && plan.padAsset.fallbackWave) || "sine"
    const sources = []
    const cleanupNodes = []

    chord.forEach(function (midi, index) {
      const oscillator = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      oscillator.type = index === 0 ? "triangle" : wave
      oscillator.frequency.setValueAtTime(midiToFreq(midi), when)
      oscillator.detune.setValueAtTime((index - 1) * 7, when)
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(plan.atmosphere.id === "rain" ? 560 : 950, when)
      oscillator.connect(filter)
      filter.connect(gain)
      sources.push(oscillator)
      cleanupNodes.push(filter)
    })

    return { gain: gain, sources: sources, cleanupNodes: cleanupNodes }
  }

  return { createSynthPadGraph: createSynthPadGraph }
})
