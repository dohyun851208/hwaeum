/*
 * audio-node-scope.js — AudioScheduledSourceNode와 연결 노드의 수명 범위
 *
 * 브라우저: 클래식 <script>로 로드되어 window.SDAudioNodeScope 에 노출.
 * Node:     require("./js/audio-node-scope.js") 로 동일 생성자 사용.
 */
;(function (root, factory) {
  const AudioNodeScope = factory()
  if (typeof module !== "undefined" && module.exports) module.exports = AudioNodeScope
  else root.SDAudioNodeScope = AudioNodeScope
})(typeof self !== "undefined" ? self : this, function () {
  "use strict"

  function disconnectQuietly(node) {
    if (!node || typeof node.disconnect !== "function") return
    try {
      node.disconnect()
    } catch (e) {}
  }

  function addCleanupNodes(record, cleanupNodes) {
    const list = Array.isArray(cleanupNodes) ? cleanupNodes : [cleanupNodes]
    list.forEach(function (node) {
      if (node && node !== record.source) record.cleanupNodes.add(node)
    })
  }

  function AudioNodeScope(label) {
    this.label = label || "audio"
    this._records = new Map()
  }

  Object.defineProperty(AudioNodeScope.prototype, "size", {
    get: function () {
      return this._records.size
    },
  })

  AudioNodeScope.prototype.track = function (source, cleanupNodes) {
    if (!source) return source
    const existing = this._records.get(source)
    if (existing) {
      addCleanupNodes(existing, cleanupNodes)
      return source
    }

    const scope = this
    const record = {
      source: source,
      cleanupNodes: new Set(),
      released: false,
      eventHandler: null,
      previousOnended: null,
      wrappedOnended: null,
    }
    addCleanupNodes(record, cleanupNodes)
    this._records.set(source, record)

    if (typeof source.addEventListener === "function") {
      record.eventHandler = function () {
        scope._releaseRecord(record)
      }
      source.addEventListener("ended", record.eventHandler)
    } else {
      record.previousOnended = source.onended
      record.wrappedOnended = function (event) {
        try {
          if (typeof record.previousOnended === "function") return record.previousOnended.call(this, event)
        } finally {
          scope._releaseRecord(record)
        }
      }
      source.onended = record.wrappedOnended
    }
    return source
  }

  AudioNodeScope.prototype._detachEndedHandler = function (record) {
    const source = record.source
    if (record.eventHandler && source && typeof source.removeEventListener === "function") {
      try {
        source.removeEventListener("ended", record.eventHandler)
      } catch (e) {}
    } else if (source && source.onended === record.wrappedOnended) {
      source.onended = record.previousOnended
    }
  }

  AudioNodeScope.prototype._releaseRecord = function (record) {
    if (!record || record.released) return false
    record.released = true
    this._records.delete(record.source)
    this._detachEndedHandler(record)
    disconnectQuietly(record.source)
    record.cleanupNodes.forEach(disconnectQuietly)
    record.cleanupNodes.clear()
    return true
  }

  AudioNodeScope.prototype.release = function (source) {
    return this._releaseRecord(this._records.get(source))
  }

  AudioNodeScope.prototype.stopAll = function (when) {
    const stopAt = when == null ? 0 : when
    const records = Array.from(this._records.values())
    records.forEach((record) => {
      if (record.released) return
      try {
        if (record.source && typeof record.source.stop === "function") record.source.stop(stopAt)
      } catch (e) {}
      this._releaseRecord(record)
    })
  }

  return AudioNodeScope
})
