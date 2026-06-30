/*
 * takes.js — 학생의 여러 시도(테이크) 저장·비교 (window.TakesStore)
 *
 * 저장하는 것은 "레시피"(설정 + 드로잉 path)뿐 — 오디오는 저장하지 않는다.
 * 따라서 시도를 많이 저장해도 용량 문제가 없다(수 KB). 재생 시 매번 재합성.
 */
;(function (root) {
  "use strict"
  const DrawingCanvas = root.DrawingCanvas

  function createdTime(take) {
    const n = Date.parse((take && take.createdAt) || "")
    return isFinite(n) ? n : 0
  }

  function oldestFirst(items) {
    return items.slice().sort((a, b) => createdTime(a) - createdTime(b))
  }

  function TakesStore(key) {
    this.key = key || "sda.takes"
    this.items = this._load()
  }

  TakesStore.prototype._load = function () {
    try {
      const raw = root.localStorage ? root.localStorage.getItem(this.key) : null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? oldestFirst(parsed) : []
    } catch (e) {
      return []
    }
  }

  TakesStore.prototype._save = function () {
    try {
      if (root.localStorage) root.localStorage.setItem(this.key, JSON.stringify(this.items))
    } catch (e) {}
  }

  TakesStore.prototype.list = function () {
    return this.items.slice()
  }

  TakesStore.prototype.add = function (recipe, name) {
    const take = {
      id: "t" + Date.now() + Math.floor(Math.random() * 1000),
      name: name || "",
      createdAt: new Date().toISOString(),
      recipe: JSON.parse(JSON.stringify(recipe)),
    }
    this.items.push(take)
    if (this.items.length > 24) this.items = this.items.slice(-24)
    this._save()
    return take
  }

  TakesStore.prototype.update = function (id, recipe, name) {
    for (let i = 0; i < this.items.length; i += 1) {
      if (this.items[i].id !== id) continue
      this.items[i].name = name || ""
      this.items[i].recipe = JSON.parse(JSON.stringify(recipe))
      this._save()
      return this.items[i]
    }
    return null
  }

  TakesStore.prototype.remove = function (id) {
    this.items = this.items.filter((t) => t.id !== id)
    this._save()
  }

  TakesStore.prototype.rename = function (id, name) {
    const nextName = (name || "").trim()
    for (let i = 0; i < this.items.length; i += 1) {
      if (this.items[i].id !== id) continue
      this.items[i].name = nextName
      if (this.items[i].recipe) this.items[i].recipe.title = nextName || "무제"
      this._save()
      return true
    }
    return false
  }

  TakesStore.prototype.setTitle = function (id, title) {
    return this.rename(id, title)
  }

  TakesStore.prototype.get = function (id) {
    return this.items.find((t) => t.id === id) || null
  }

  TakesStore.prototype.clearAll = function () {
    this.items = []
    this._save()
  }

  // 테이크 썸네일: 드로잉 path를 분위기 색으로 작은 액자에 렌더
  TakesStore.renderThumbnail = function (canvas, recipe, accent) {
    const ctx = canvas.getContext("2d")
    if (DrawingCanvas && DrawingCanvas.drawStroke) {
      DrawingCanvas.drawStroke(ctx, canvas.width, canvas.height, recipe.path, accent, "#fbf6ec")
    }
  }

  root.TakesStore = TakesStore
})(typeof self !== "undefined" ? self : this)
