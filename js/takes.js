/*
 * takes.js — 학생의 여러 시도(테이크) 저장·비교 (window.TakesStore)
 *
 * 저장하는 것은 "레시피"(설정 + 드로잉 path + 그림)뿐 — 오디오는 저장하지 않는다. 재생 시 매번 재합성.
 * 그림(data URL)이 가장 크므로 같은 그림은 한 번만 저장하고 작품은 그 열쇠(pictureRef)만 가진다.
 * 브라우저 저장 공간이 가득 차거나 작품 수 한도에 닿으면 조용히 버리지 않고 실패를 알린다(lastError).
 */
;(function (root) {
  "use strict"
  const DrawingCanvas = root.DrawingCanvas
  const MAX_TAKES = 24

  function savedTime(take) {
    const n = Date.parse((take && (take.updatedAt || take.createdAt)) || "")
    return isFinite(n) ? n : 0
  }

  function newestFirst(items) {
    return items.slice().sort((a, b) => savedTime(b) - savedTime(a))
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value))
  }

  // 같은 그림인지 가리는 열쇠(FNV-1a + 길이). 글자 하나만 달라도 다른 열쇠가 된다.
  function pictureRefFor(dataUrl) {
    let hash = 2166136261
    for (let i = 0; i < dataUrl.length; i += 1) {
      hash ^= dataUrl.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return "p" + (hash >>> 0).toString(36) + "-" + dataUrl.length.toString(36)
  }

  function isQuotaError(error) {
    if (!error) return false
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22 || error.code === 1014
  }

  function TakesStore(key) {
    this.key = key || "sda.takes"
    this.pictureKey = this.key + ".pictures"
    this.maxTakes = MAX_TAKES
    this.lastError = "" // "" | "full" | "quota" | "storage"
    this.items = this._load()
  }

  TakesStore.prototype._readJson = function (key, fallback) {
    try {
      const raw = root.localStorage ? root.localStorage.getItem(key) : null
      return raw ? JSON.parse(raw) : fallback
    } catch (e) {
      return fallback
    }
  }

  TakesStore.prototype._load = function () {
    const parsed = this._readJson(this.key, [])
    if (!Array.isArray(parsed)) return []
    const pictures = this._readJson(this.pictureKey, {}) || {}
    parsed.forEach(function (take) {
      const recipe = take && take.recipe
      if (!recipe || !recipe.pictureRef) return
      recipe.picture = typeof pictures[recipe.pictureRef] === "string" ? pictures[recipe.pictureRef] : ""
      delete recipe.pictureRef
    })
    return newestFirst(parsed)
  }

  // 다른 탭에서 저장한 작품까지 보이도록 저장소에서 다시 읽는다.
  TakesStore.prototype.refresh = function () {
    this.items = this._load()
    return this.list()
  }

  // 그림은 따로 모아 한 번씩만 적는다. 먼저 옛 그림까지 합쳐 적어 두고(실패해도 옛 목록이 그림을 잃지 않게),
  // 목록을 적은 뒤에야 쓰지 않는 그림을 정리한다. 실패하면 false를 돌려주고 저장소는 그대로 둔다.
  TakesStore.prototype._save = function () {
    if (!root.localStorage) {
      this.lastError = "storage"
      return false
    }
    const pictures = {}
    const list = this.items.map(function (take) {
      const recipe = take && take.recipe
      if (!recipe || typeof recipe.picture !== "string" || !recipe.picture) return take
      const ref = pictureRefFor(recipe.picture)
      pictures[ref] = recipe.picture
      const stored = Object.assign({}, recipe, { pictureRef: ref })
      delete stored.picture
      return Object.assign({}, take, { recipe: stored })
    })
    try {
      const previous = this._readJson(this.pictureKey, {}) || {}
      root.localStorage.setItem(this.pictureKey, JSON.stringify(Object.assign({}, previous, pictures)))
      root.localStorage.setItem(this.key, JSON.stringify(list))
    } catch (e) {
      this.lastError = isQuotaError(e) ? "quota" : "storage"
      return false
    }
    try {
      root.localStorage.setItem(this.pictureKey, JSON.stringify(pictures))
    } catch (e) {
      // 정리는 실패해도 괜찮다 — 쓰지 않는 그림이 다음 저장까지 남을 뿐이다.
    }
    this.lastError = ""
    return true
  }

  TakesStore.prototype.list = function () {
    return this.items.slice()
  }

  // 새 작품을 맨 위에 더한다. 한도(24개)에 닿았거나 저장 공간이 모자라면 null을 돌려주고 lastError로 까닭을 남긴다.
  TakesStore.prototype.add = function (recipe, name) {
    this.items = this._load()
    if (this.items.length >= this.maxTakes) {
      this.lastError = "full"
      return null
    }
    const now = new Date().toISOString()
    const take = {
      id: "t" + Date.now() + Math.floor(Math.random() * 1000),
      name: name || "",
      createdAt: now,
      updatedAt: now,
      recipe: cloneJson(recipe),
    }
    this.items.unshift(take)
    if (!this._save()) {
      this.items = this.items.filter((t) => t !== take)
      return null
    }
    return take
  }

  // 있는 작품을 덮어쓴다. 없는 id면 lastError 없이 null, 저장에 실패하면 원래대로 되돌리고 null.
  TakesStore.prototype.update = function (id, recipe, name) {
    this.items = this._load()
    const index = this.items.findIndex((t) => t.id === id)
    this.lastError = ""
    if (index < 0) return null
    const before = this.items[index]
    this.items[index] = Object.assign({}, before, {
      name: name || "",
      updatedAt: new Date().toISOString(),
      recipe: cloneJson(recipe),
    })
    if (!this._save()) {
      this.items[index] = before
      return null
    }
    this.items = newestFirst(this.items)
    return this.get(id)
  }

  TakesStore.prototype.remove = function (id) {
    this.items = this._load()
    const before = this.items
    this.items = this.items.filter((t) => t.id !== id)
    if (!this._save()) {
      this.items = before
      return false
    }
    return true
  }

  TakesStore.prototype.rename = function (id, name) {
    const nextName = (name || "").trim()
    this.items = this._load()
    for (let i = 0; i < this.items.length; i += 1) {
      if (this.items[i].id !== id) continue
      const before = this.items[i]
      const recipe = before.recipe ? Object.assign({}, before.recipe, { title: nextName || "무제" }) : before.recipe
      this.items[i] = Object.assign({}, before, { name: nextName, recipe: recipe })
      if (!this._save()) {
        this.items[i] = before
        return false
      }
      return true
    }
    return false
  }

  // 이 작품을 어느 갤러리에 어떤 작품 번호로 공유했는지 남긴다 — 다시 공유하면 그 작품을 바꾸려고.
  TakesStore.prototype.markShared = function (id, channel, workId) {
    this.items = this._load()
    const index = this.items.findIndex((t) => t.id === id)
    if (index < 0 || !channel || !workId) return false
    const before = this.items[index]
    const shared = Object.assign({}, before.shared || {})
    shared[String(channel)] = String(workId)
    this.items[index] = Object.assign({}, before, { shared: shared })
    if (!this._save()) {
      this.items[index] = before
      return false
    }
    return true
  }

  TakesStore.prototype.sharedWorkId = function (id, channel) {
    const take = this.get(id)
    return (take && take.shared && take.shared[String(channel)]) || ""
  }

  TakesStore.prototype.setTitle = function (id, title) {
    return this.rename(id, title)
  }

  TakesStore.prototype.get = function (id) {
    return this.items.find((t) => t.id === id) || null
  }

  TakesStore.prototype.clearAll = function () {
    const before = this.items
    this.items = []
    if (!this._save()) {
      this.items = before
      return false
    }
    return true
  }

  // 테이크 썸네일: 드로잉 path를 분위기 색으로 작은 액자에 렌더
  TakesStore.renderThumbnail = function (canvas, recipe, accent) {
    const ctx = canvas.getContext("2d")
    if (DrawingCanvas && DrawingCanvas.drawStroke) {
      DrawingCanvas.drawStroke(ctx, canvas.width, canvas.height, recipe.path, accent, "#fbf6ec")
    }
  }

  TakesStore.MAX_TAKES = MAX_TAKES
  root.TakesStore = TakesStore
})(typeof self !== "undefined" ? self : this)
