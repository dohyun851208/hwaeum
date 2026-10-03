/*
 * audio-samples.js — 지속음 루프·자연 감쇠와 재사용할 샘플 버퍼 가공.
 * DOM/transport 상태를 소유하지 않는다. AudioContext는 버퍼 생성에만 사용한다.
 */
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory
  else root.SDAudioSamples = factory
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict"

  const Core = deps.core
  const audioBufferDuration = deps.audioPlan.audioBufferDuration
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function isGayageumPlan(plan) { return !!(plan && plan.instrument && plan.instrument.id === "gayageum") }

  function sampleSustainLoopRegion(offset, duration, loopHint) {
    const dur = Number(duration) || 0
    if (dur <= 0.25) return null
    const minLoop = Math.min(0.22, dur * 0.35)
    if (loopHint && loopHint.start != null && loopHint.end != null) {
      // 절대 초 힌트(포락선에서 검출한 안정 구간) — 세그먼트 경계 안쪽으로만 다듬는다.
      const relStart = clamp(loopHint.start - offset, 0.02, Math.max(0.02, dur - minLoop - 0.06))
      const relEnd = clamp(loopHint.end - offset, relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
      if (relEnd > relStart + 0.06) return { start: offset + relStart, end: offset + relEnd }
    }
    if (loopHint && loopHint.startRatio != null && loopHint.endRatio != null) {
      const relStart = clamp(dur * loopHint.startRatio, Math.min(0.18, Math.max(0, dur - minLoop)), Math.max(0, dur - minLoop - 0.06))
      const relEnd = clamp(dur * loopHint.endRatio, relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
      if (relEnd > relStart + 0.06) return { start: offset + relStart, end: offset + relEnd }
    }
    const relStart = clamp(dur * 0.28, Math.min(0.18, Math.max(0, dur - minLoop)), Math.max(0, dur - minLoop - 0.06))
    const relEnd = clamp(Math.max(relStart + minLoop, dur * 0.78), relStart + 0.08, Math.max(relStart + 0.08, dur - 0.06))
    if (relEnd <= relStart + 0.06) return null
    return { start: offset + relStart, end: offset + relEnd }
  }
  function nearestZeroCrossingTime(buffer, targetTime, minTime, maxTime) {
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate) return targetTime
    let channel = null
    try {
      channel = buffer.getChannelData(0)
    } catch (e) {
      return targetTime
    }
    if (!channel || !channel.length) return targetTime
    const sr = buffer.sampleRate
    const target = clamp(Math.round(targetTime * sr), 1, channel.length - 2)
    const lo = clamp(Math.floor(minTime * sr), 1, channel.length - 2)
    const hi = clamp(Math.ceil(maxTime * sr), lo, channel.length - 2)
    let best = target
    let bestScore = Infinity
    for (let i = lo; i <= hi; i++) {
      const a = channel[i - 1]
      const b = channel[i]
      if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) {
        const distance = Math.abs(i - target) / sr
        const amplitude = Math.abs(a) + Math.abs(b)
        const score = distance + amplitude * 0.002
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      }
    }
    return bestScore < Infinity ? best / sr : targetTime
  }
  function refineSustainLoopRegion(region, offset, duration, buffer, loopHint) {
    if (!region || !buffer) return region
    // 포락선에서 검출한 절대 초 힌트는 파형 정렬(상호상관)까지 끝난 값 — 제로크로싱 재스냅이 정렬을 깨뜨린다.
    if (loopHint && loopHint.start != null && loopHint.end != null) return region
    const dur = Number(duration) || 0
    const windowSec = Math.min(0.08, dur * 0.08)
    const absoluteEnd = offset + dur
    const start = nearestZeroCrossingTime(
      buffer,
      region.start,
      Math.max(offset, region.start - windowSec),
      Math.min(region.start + windowSec, absoluteEnd - 0.12),
    )
    const end = nearestZeroCrossingTime(
      buffer,
      region.end,
      Math.max(start + 0.08, region.end - windowSec),
      Math.min(region.end + windowSec, absoluteEnd - 0.02),
    )
    if (end <= start + 0.06) return region
    return { start: start, end: end }
  }
  function createCrossfadedSustainBuffer(ctx, buffer, offset, duration, loopHint) {
    if (!ctx || typeof ctx.createBuffer !== "function") return null
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate || !buffer.numberOfChannels) return null
    const total = audioBufferDuration(buffer)
    if (!(total > 0)) return null
    const safeOffset = clamp(Number(offset) || 0, 0, Math.max(0, total - 0.01))
    const safeDuration = Math.min(Math.max(0, Number(duration) || 0), Math.max(0, total - safeOffset))
    if (!(safeDuration > 0.08)) return null
    const region = loopHint && loopHint.start != null ? loopHint : sampleSustainLoopRegion(safeOffset, safeDuration, loopHint)
    if (!region) return null
    const sampleRate = buffer.sampleRate
    const sourceLength = buffer.length || Math.round(total * sampleRate)
    const startFrame = clamp(Math.floor(safeOffset * sampleRate), 0, Math.max(0, sourceLength - 1))
    const endFrame = clamp(Math.ceil((safeOffset + safeDuration) * sampleRate), startFrame + 1, sourceLength)
    const outLength = endFrame - startFrame
    const channels = []
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch).subarray(startFrame, endFrame))
    const support = {
      start: region.start - startFrame / sampleRate, end: region.end - startFrame / sampleRate,
    }
    const leveled = Core.levelSustainSupport(channels, sampleRate, support)
    const frames = Core.sustainLoopFrames(leveled, sampleRate, support)
    if (!frames) return null
    const out = ctx.createBuffer(buffer.numberOfChannels, outLength, sampleRate)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = out.getChannelData(ch)
      data.set(Core.crossfadeSustainLoop(leveled[ch], frames))
    }
    return {
      buffer: out,
      offset: 0,
      duration: outLength / sampleRate,
      loopStart: frames.start / sampleRate,
      loopEnd: frames.end / sampleRate,
    }
  }
  // 실제 source를 받지 않고 결과만 반환한다. 호출부가 source.buffer를 한 번만 설정한다.
  function preparePlaybackSustain(ctx, buffer, offset, duration, loopHint) {
    const total = audioBufferDuration(buffer)
    const safeOffset = total > 0 ? clamp(Number(offset) || 0, 0, Math.max(0, total - 0.01)) : 0
    const fallbackDuration = total > 0 ? Math.max(0, total - safeOffset) : 0
    const requestedDuration = Number(duration)
    const safeDuration = isFinite(requestedDuration) && requestedDuration > 0
      ? Math.min(requestedDuration, fallbackDuration)
      : fallbackDuration
    const baked = createCrossfadedSustainBuffer(ctx, buffer, safeOffset, safeDuration, loopHint)
    if (baked) return Object.assign({ loop: true }, baked)
    const region = safeDuration > 0.01
      ? refineSustainLoopRegion(sampleSustainLoopRegion(safeOffset, safeDuration, loopHint), safeOffset, safeDuration, buffer, loopHint)
      : null
    return {
      buffer, offset: safeOffset, duration: safeDuration, loop: !!region,
      loopStart: region ? region.start : undefined,
      loopEnd: region ? region.end : undefined,
    }
  }

  function sustainLoopHint(plan, segment) {
    const instrumentId = plan && plan.instrument && plan.instrument.id
    if (instrumentId === "violin" && segment && segment.midi === 55) {
      return { startRatio: 0.28, endRatio: 0.58 }
    }
    return null
  }
  // 관악·찰현 악기는 안정 구간과 페이드 재료를 함께 검출한다.
  // 음별 게인 한도는 이 목록과 독립적이다 (2026-10-02 ADR).
  const SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS = {
    violin: true, viola: true, cello: true, doubleBass: true, flute: true, oboe: true,
    clarinet: true, frenchHorn: true, sogeum: true, daegeum: true, danso: true, haegeum: true,
  }
  function autoSustainLoopHint(buffer, offset, usableSourceDur, plan) {
    const instrumentId = plan && plan.instrument && plan.instrument.id
    if (!instrumentId || !SUSTAIN_AUTO_LOOP_INSTRUMENT_IDS[instrumentId]) return null
    if (!Core || typeof Core.findStableLoopRegion !== "function") return null
    if (!buffer || typeof buffer.getChannelData !== "function" || !buffer.sampleRate) return null
    let channel = null
    try {
      channel = buffer.getChannelData(0)
    } catch (e) {
      return null
    }
    if (!channel || !channel.length) return null
    return Core.findStableLoopRegion(channel, buffer.sampleRate, offset, usableSourceDur, {
      targetLoopSec: 1.02, minLoopSec: 0.42, align: false,
    })
  }

  const samplePlanCache = new WeakMap()
  function pluckedSamplePlan(ctx, buffer, offset, duration, asset) {
    if (!buffer.getChannelData || !ctx.createBuffer || !buffer.sampleRate) return { buffer, offset, duration, loop: false }
    const next = (asset.sampleMap || []).filter((s) => s.offset > offset + 0.1).sort((a, b) => a.offset - b.offset)[0]
    const boundary = Math.min(buffer.duration, offset + 6, next ? next.offset - 0.05 : buffer.duration)
    const end = Core.pluckedSampleEnd(buffer.getChannelData(0), buffer.sampleRate, offset, duration, boundary)
    const first = Math.round(offset * buffer.sampleRate)
    const length = Math.max(1, Math.floor(end * buffer.sampleRate) - first)
    const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
    const fade = Math.min(length, Math.round(0.06 * buffer.sampleRate))
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = out.getChannelData(ch)
      data.set(buffer.getChannelData(ch).subarray(first, first + length))
      for (let i = 0; i < fade; i++) data[length - fade + i] *= (1 + Math.cos(Math.PI * i / Math.max(1, fade - 1))) / 2
    }
    return { buffer: out, offset: 0, duration: length / buffer.sampleRate, loop: false }
  }

  function continuousSustainPlan(ctx, buffer, offset, usableSourceDur, plan, segment) {
    let cache = samplePlanCache.get(buffer)
    if (!cache) { cache = new Map(); samplePlanCache.set(buffer, cache) }
    const key = [plan.instrument.id, offset, usableSourceDur].join("|")
    if (cache.has(key)) return cache.get(key)
    if (isGayageumPlan(plan)) {
      const pluck = pluckedSamplePlan(ctx, buffer, offset, usableSourceDur, plan.melodyAsset)
      cache.set(key, pluck)
      return pluck
    }
    const bufferDuration = audioBufferDuration(buffer)
    if (!(bufferDuration > 0.45 && usableSourceDur > 0.45)) {
      return { buffer: buffer, offset: offset, duration: usableSourceDur, loop: false }
    }
    const loopHint = autoSustainLoopHint(buffer, offset, usableSourceDur, plan) || sustainLoopHint(plan, segment)
    const result = preparePlaybackSustain(ctx, buffer, offset, usableSourceDur, loopHint)
    cache.set(key, result)
    return result
  }
  // 계산된 loop 계획을 source 에 적용한다(buffer 는 호출부가 한 번만 설정하므로 여기선 loop 파라미터만).
  function applySustainPlanToSource(source, plan) {
    if (plan && plan.loop) {
      source.loop = true
      source.loopStart = plan.loopStart
      source.loopEnd = plan.loopEnd
    }
  }

  return { continuousSustainPlan, applySustainPlanToSource }
})
