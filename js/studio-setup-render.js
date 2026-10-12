;(function (root) {
  "use strict"

  // 분위기·악기 카드 렌더링·선택 팩토리.
  // studio.js에서 createStudioSetupRender(deps)로 호출하여 반환된 함수들을 destructure.
  root.HwaeumStudioSetupRender = function createStudioSetupRender(deps) {
    const {
      state,
      el,
      D,
      engine,
      draw,
      bgPreview,
      examplePreview,
      DEFAULT_DURATION_SECONDS,
      DEFAULT_INSTRUMENT_FAMILY,
      INSTRUMENT_GROUPS,
      STUDENT_MUSIC_GROUP,
      ATMOSPHERE_GROUP_ORDER,
      PIXABAY_MUSIC_URL,
      CUSTOM_BG_COPYRIGHT_NOTICE,
      CUSTOM_BG_MAX_BYTES,
      styleForInstrument,
      setEraser,
      renderEffects,
      renderEffectStamps,
      recordUserAction,
      renderOrchestraLegend,
      renderPitchAxisLabels,
      updateReadouts,
      warmSelectedInstrument,
      applyMoodTint,
      syncBgPlayerUI,
      buildRecipe,
      defaultAtmosphere,
      applyInstrumentTone,
      getNextCustomBgId,
      syncReflectionFromNotes,
    } = deps
    let customBgNoticeSeen = false // 저작권 안내는 처음 한 번 읽으면 된다
    const MAX_CUSTOM_BG_SECONDS = 10 * 60
    // 배경을 바꿀 때 길이·구간을 맞추는 길(studio.js → studio-transport.js). 없으면 예전처럼 구간 표시만 맞춘다.
    const startNewBackground = typeof deps.startNewBackground === "function" ? deps.startNewBackground : syncBgPlayerUI
    // 구간을 그대로 두고 배경 파일만 다시 불러온다(다시 올린 음악을 이어 붙일 때).
    const reloadBackground = typeof deps.reloadBackground === "function" ? deps.reloadBackground : syncBgPlayerUI
    // 안내 문구는 지금 보이는 단계의 안내 줄로 보낸다(studio.js의 say). 없으면 예전처럼 4단계 줄에 쓴다.
    const say = typeof deps.say === "function" ? deps.say : (message) => { if (el.exportStatus) el.exportStatus.textContent = message }

    // 요소 자식 노드를 모두 제거한다. innerHTML="" 대신 XSS-안전한 방법 사용.
    function clearEl(element) {
      element.textContent = ""
    }

    // ── 순수 유틸 ────────────────────────────────────────────────

    function instrumentFamilies(items) {
      const order = []
      const byFamily = {}
      ;(items || []).forEach(function (instrument) {
        const family = instrument.family || DEFAULT_INSTRUMENT_FAMILY
        if (!byFamily[family]) {
          byFamily[family] = []
          order.push(family)
        }
        byFamily[family].push(instrument)
      })
      return order.map((family) => ({ family: family, items: byFamily[family] }))
    }

    function card(item, active, sub) {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "card" + (active ? " active" : "")
      if (item.image) {
        b.classList.add("with-image")
        const art = document.createElement("span")
        art.className = "card-art"
        const img = document.createElement("img")
        img.src = item.image
        img.alt = ""
        img.loading = "lazy"
        art.appendChild(img)
        b.appendChild(art)
      }
      const copy = document.createElement("span")
      copy.className = "card-copy"
      const title = document.createElement("strong")
      title.textContent = item.label
      copy.appendChild(title)
      // 설명이 비어 있으면 칸 자체를 만들지 않는다 — 2단계 악기 카드는 설명을 감상 노트의 예시 답안으로 옮겼다.
      if (sub) {
        const detail = document.createElement("span")
        detail.textContent = sub
        copy.appendChild(detail)
      }
      b.appendChild(copy)
      return b
    }

    function bgSrcFor(atmosphere) {
      const bg = backgroundFor(atmosphere)
      return bg ? bg.src : null
    }

    function backgroundFor(atmosphere) {
      return atmosphere && atmosphere.backgroundId ? D.backgrounds[atmosphere.backgroundId] : null
    }

    function balanceParentheticalMoodTitle(button, label) {
      const match = (label || "").match(/^(.+?)(\(.+\))$/)
      if (!match) return
      const titleEl = button.querySelector(".card-copy strong")
      if (!titleEl) return
      titleEl.textContent = ""
      const main = document.createElement("span")
      main.textContent = match[1]
      const suffix = document.createElement("span")
      suffix.textContent = match[2]
      titleEl.appendChild(main)
      titleEl.appendChild(suffix)
    }

    // ── 배경 미리듣기 ─────────────────────────────────────────────

    function stopBackgroundPreview() {
      state.bgPreviewId = null
      try {
        bgPreview.pause()
        bgPreview.currentTime = 0
      } catch (e) {}
    }

    function startBackgroundPreview(atmosphere) {
      const src = bgSrcFor(atmosphere)
      if (!src) {
        stopBackgroundPreview()
        return
      }
      engine.stop() // 전체 재생과 미리듣기가 겹치지 않도록
      const exampleWasPlaying = !!state.examplePreviewId
      stopExamplePreview() // 악기 감상과 겹치지 않도록
      if (exampleWasPlaying) renderInstruments() // 멈춘 연주곡 카드의 ■ 표시를 지운다
      try {
        if (bgPreview.src !== src) bgPreview.src = src
        bgPreview.currentTime = 0
        const p = bgPreview.play()
        if (p && p.catch) {
          p.catch((e) => {
            console.warn("배경 미리듣기 실패", e)
            // 재생하지 못했으면 '재생 중(❚❚)'으로 두지 않는다.
            if (state.bgPreviewId === atmosphere.id) {
              state.bgPreviewId = null
              renderAtmospheres()
              showBgUploadStatus("‘" + atmosphere.label + "’ 음악을 재생하지 못했어요. 다른 파일을 골라 주세요.", true)
            }
          })
        }
        state.bgPreviewId = atmosphere.id
      } catch (e) {
        console.warn("배경 미리듣기 실패", e)
        state.bgPreviewId = null
      }
    }

    function toggleBackgroundPreview(atmosphere) {
      if (state.bgPreviewId === atmosphere.id) stopBackgroundPreview()
      else startBackgroundPreview(atmosphere)
    }

    // 악기 연주곡 감상 미리듣기 (악기 카드의 ▶ 버튼)
    function stopExamplePreview(announce) {
      const wasPlaying = !!state.examplePreviewId
      state.examplePreviewId = null
      try {
        examplePreview.pause()
        examplePreview.currentTime = 0
      } catch (e) {}
      if (announce && wasPlaying) say("악기 소리를 멈췄습니다.")
    }

    function toggleExamplePreview(instrument) {
      if (state.examplePreviewId === instrument.id) {
        stopExamplePreview(true)
        renderInstruments()
        return
      }
      const src = instrument.example
      if (!src) return
      stopBackgroundPreview()
      renderAtmospheres()
      engine.stop() // 전체 재생/배경 미리듣기와 겹치지 않도록
      try {
        if (examplePreview.src !== src) examplePreview.src = src
        examplePreview.currentTime = 0
        const p = examplePreview.play()
        if (p && p.catch) p.catch((e) => console.warn("연주곡 감상 실패", e))
        state.examplePreviewId = instrument.id
        say(instrument.label + " 소리를 듣는 중입니다. 정지하려면 같은 악기의 ■ 버튼을 누르세요.")
      } catch (e) {
        console.warn("연주곡 감상 실패", e)
        state.examplePreviewId = null
      }
      renderInstruments()
    }

    // ── 분위기 카드 렌더링 ────────────────────────────────────────

    // 카드 그룹 표시 순서. manifest 의 atmosphere.group 과 맞춘다. 새 group 은 이 뒤에 자동으로 붙는다.

    function appendAtmosphereCard(a) {
      const b = card(a, a.id === state.atmosphere.id, a.detail)
      balanceParentheticalMoodTitle(b, a.label)
      b.style.setProperty("--swatch", a.color)
      b.classList.add("with-swatch", "mood-card")
      // 배경음이 있는 카드에만 미리듣기(▶) 표식을 단다. "배경음악 없음"은 들을 게 없으므로 표식을 빼 혼란을 막는다.
      const hasPreview = !!bgSrcFor(a)
      if (hasPreview) {
        if (state.bgPreviewId === a.id) b.classList.add("playing")
        const play = document.createElement("span")
        play.className = "mood-play"
        play.setAttribute("aria-hidden", "true")
        play.textContent = state.bgPreviewId === a.id ? "❚❚" : "▶"
        b.appendChild(play)
        b.title = a.label + " 배경 미리듣기"
      } else {
        b.title = a.label
      }
      b.addEventListener("click", () => {
        if (a.missing) {
          // 저장된 작품의 '내가 찾은 음악' — 파일은 저장하지 않으므로 같은 파일을 다시 올려야 들을 수 있다.
          showBgUploadStatus("‘" + a.label + "’ 파일이 이 컴퓨터에 없어요. 아래 '내 배경 음원 추가'로 같은 파일을 다시 올려 주세요.", true)
          return
        }
        if (state.atmosphere && state.atmosphere.id === a.id) {
          // 이미 고른 배경은 다시 들어 보기만 한다 — 정해 둔 구간과 그린 선율은 그대로 둔다.
          toggleBackgroundPreview(a)
          renderAtmospheres()
          return
        }
        state.atmosphere = a
        // 새 배경은 처음(0초)부터. 길이는 그린 선율이 같은 초에 남도록 transport가 맞춘다.
        startNewBackground()
        applyMoodTint()
        toggleBackgroundPreview(a)
        renderAtmospheres()
        updateReadouts()
        engine.warmAmbience(buildRecipe()).catch(function () {}) // 고른 배경음 미리 로드
      })
      if (a.custom) {
        const del = document.createElement("button")
        del.type = "button"
        del.className = "mood-delete"
        del.textContent = "✕"
        del.title = a.label + " 삭제"
        del.setAttribute("aria-label", a.label + " 삭제")
        del.addEventListener("click", (e) => {
          e.stopPropagation()
          removeCustomBackground(a)
        })
        b.appendChild(del)
      }
      // 카드는 button 이라 입력칸을 그 안에 넣을 수 없다 — 슬롯으로 감싸 감상 노트를 형제로 붙인다.
      const slot = document.createElement("div")
      slot.className = "atmosphere-card-slot" + (a.id === state.atmosphere.id ? " active" : "")
      slot.appendChild(b)
      slot.appendChild(buildAtmosphereNote(a))
      el.atmosphereGrid.appendChild(slot)
    }

    // ── 배경음악 감상 노트 (2단계) ───────────────────────────────────
    // 악기 감상 노트와 같은 구조. 최종으로 고른 배경의 메모는 4단계 "배경음악을 고른 이유"로 옮겨진다.
    function buildAtmosphereNote(a) {
      const note = document.createElement("div")
      note.className = "atmosphere-note"

      const label = document.createElement("label")
      label.className = "atmosphere-note-label"
      label.setAttribute("for", "atmosphereNote-" + a.id)
      label.textContent = "내 느낌"
      note.appendChild(label)

      const field = document.createElement("textarea")
      field.className = "atmosphere-note-field"
      field.id = "atmosphereNote-" + a.id
      field.rows = 2
      field.maxLength = NOTE_MAX_LENGTH
      field.placeholder = "어떤 느낌인가요?"
      field.dataset.noteAtmosphere = a.id
      field.value = state.backgroundNotes[a.id] || ""
      field.addEventListener("input", () => {
        // 값을 바로 state 로 옮겨 둔다 — 카드를 눌러 그리드가 다시 그려져도 글이 남는다.
        state.backgroundNotes[a.id] = field.value
        if (typeof syncReflectionFromNotes === "function") syncReflectionFromNotes()
      })
      note.appendChild(field)
      return note
    }

    // 배경 그리드도 카드를 누를 때마다 통째로 다시 그리므로 커서를 기억했다 되돌린다.
    function captureAtmosphereNoteFocus() {
      const active = document.activeElement
      const id = active && active.dataset ? active.dataset.noteAtmosphere : null
      if (!id) return null
      return { id: id, start: active.selectionStart, end: active.selectionEnd }
    }

    function restoreAtmosphereNoteFocus(focus) {
      if (!focus || !el.atmosphereGrid || typeof el.atmosphereGrid.querySelector !== "function") return
      const field = el.atmosphereGrid.querySelector('[data-note-atmosphere="' + focus.id + '"]')
      if (!field || typeof field.focus !== "function") return
      field.focus()
      if (typeof field.setSelectionRange === "function" && focus.start != null) {
        field.setSelectionRange(focus.start, focus.end)
      }
    }

    // 업로드한 "내가 찾은 음악" 삭제 — 목록·배경에서 빼고 Blob URL 도 해제한다.
    function showBgUploadStatus(message, isError) {
      if (!el.bgUploadStatus) return
      el.bgUploadStatus.textContent = message
      el.bgUploadStatus.classList.toggle("error", !!isError)
    }

    // 저장된 작품을 불러왔는데 그 작품의 '내가 찾은 음악' 파일이 이 컴퓨터에 없을 때 쓰는 자리표시 카드.
    // 이름과 구간만 기억해 두고, 같은 이름의 파일을 다시 올리면 이 자리에 이어 붙인다(오디오는 저장하지 않는다).
    function missingCustomBackground(id, label, savedRange) {
      const existing = D.atmospheres.find((a) => a.id === id)
      if (existing) {
        if (existing.missing && savedRange) existing.savedRange = savedRange
        return existing
      }
      const atmosphere = {
        id: id,
        label: label || "내가 찾은 음악",
        group: STUDENT_MUSIC_GROUP,
        padType: "ambient",
        detail: "파일을 다시 올리면 들을 수 있어요",
        color: "#6b8f9c",
        backgroundId: id,
        effectIds: [],
        custom: true,
        missing: true,
        savedRange: savedRange || null,
      }
      D.atmospheres.push(atmosphere)
      return atmosphere
    }

    function removeCustomBackground(a) {
      const bg = D.backgrounds[a.id]
      if (bg && bg.src && typeof engine.releaseAsset === "function") engine.releaseAsset(bg.src) // 풀어 둔 소리를 메모리에서 비운다
      if (bg && typeof bg.src === "string" && bg.src.indexOf("blob:") === 0) {
        try {
          URL.revokeObjectURL(bg.src)
        } catch (e) {}
      }
      delete D.backgrounds[a.id]
      const idx = D.atmospheres.indexOf(a)
      if (idx !== -1) D.atmospheres.splice(idx, 1)
      if (state.bgPreviewId === a.id) stopBackgroundPreview()
      if (state.atmosphere && state.atmosphere.id === a.id) {
        state.atmosphere = defaultAtmosphere()
        state.bgOffset = 0
        state.bgEndOffset = 0
        applyMoodTint()
        syncBgPlayerUI()
      }
      renderAtmospheres()
      updateReadouts()
      if (el.bgUploadStatus) {
        el.bgUploadStatus.classList.remove("error")
        el.bgUploadStatus.textContent = "'" + a.label + "' 음악을 지웠어요."
      }
    }

    function renderAtmospheres() {
      const noteFocus = captureAtmosphereNoteFocus()
      clearEl(el.atmosphereGrid)
      // group 별로 묶고(미지정·업로드분은 "분위기"), 정해진 순서대로 소제목과 함께 그린다.
      const groups = {}
      D.atmospheres.forEach((a) => {
        const g = a.group || "분위기"
        ;(groups[g] || (groups[g] = [])).push(a)
      })
      const order = ATMOSPHERE_GROUP_ORDER.slice()
      Object.keys(groups).forEach((g) => {
        if (order.indexOf(g) === -1) order.push(g)
      })
      // 학생들이 찾은 음악 섹션은 비어 있어도 항상 보여 준다(여기에 올리도록 안내).
      const visibleGroups = order.filter((g) => g === STUDENT_MUSIC_GROUP || (groups[g] && groups[g].length))
      visibleGroups.forEach((g) => {
        if (visibleGroups.length > 1) {
          const label = document.createElement("p")
          label.className = "atmosphere-group-label"
          label.textContent = g
          el.atmosphereGrid.appendChild(label)
        }
        // "학생들이 찾은 음악"은 업로드 카드를 먼저 두고, 올린 음악이 그 오른쪽(뒤)으로 쌓이게 한다.
        if (g === STUDENT_MUSIC_GROUP) el.atmosphereGrid.appendChild(buildUploadCard())
        ;(groups[g] || []).forEach(appendAtmosphereCard)
      })
      restoreAtmosphereNoteFocus(noteFocus)
    }

    function buildUploadCard() {
      const uploadCard = document.createElement("div")
      uploadCard.className = "card upload-card"
      const plus = document.createElement("span")
      plus.className = "upload-plus"
      plus.setAttribute("aria-hidden", "true")
      plus.textContent = "＋"
      uploadCard.appendChild(plus)

      const title = document.createElement("strong")
      title.textContent = "여기에 음악 올리기"
      uploadCard.appendChild(title)

      const sub = document.createElement("span")
      sub.className = "upload-sub"
      ;["Pixabay에서 음악 찾기", "mp3 · wav 올리기", "50MB 이하"].forEach(function (text) {
        const line = document.createElement("span")
        line.textContent = text
        sub.appendChild(line)
      })
      uploadCard.appendChild(sub)

      const actions = document.createElement("span")
      actions.className = "upload-actions"
      const searchLink = document.createElement("a")
      searchLink.className = "upload-action upload-action-secondary"
      searchLink.href = PIXABAY_MUSIC_URL
      searchLink.target = "_blank"
      searchLink.rel = "noopener noreferrer"
      searchLink.textContent = "여기서 찾아보기"
      actions.appendChild(searchLink)

      const uploadButton = document.createElement("button")
      uploadButton.className = "upload-action upload-action-primary"
      uploadButton.type = "button"
      uploadButton.textContent = "내 배경 음원 추가"
      actions.appendChild(uploadButton)
      uploadCard.appendChild(actions)
      uploadButton.addEventListener("click", () => {
        if (!customBgNoticeSeen) {
          window.alert(CUSTOM_BG_COPYRIGHT_NOTICE)
          customBgNoticeSeen = true
          // 안내창을 오래 읽으면 '누른 순간'이 지나 파일 고르기 창이 열리지 않는다 — 그때는 한 번 더 누르게 알린다.
          const activation = window.navigator && window.navigator.userActivation
          if (activation && !activation.isActive) {
            showBgUploadStatus("저작권 안내를 읽었어요. '내 배경 음원 추가'를 한 번 더 누르면 파일을 고를 수 있어요.", false)
            return
          }
        }
        el.bgUploadInput.click()
      })
      return uploadCard
    }

    function addCustomBackground(file) {
      if (!file) return
      if (!file.type || file.type.indexOf("audio/") !== 0) {
        el.bgUploadStatus.textContent = "오디오 파일(mp3, wav 등)만 올릴 수 있어요."
        el.bgUploadStatus.classList.add("error")
        return
      }
      if (file.size > CUSTOM_BG_MAX_BYTES) {
        el.bgUploadStatus.textContent = "무료 저장 한도에 맞춰 50MB 이하 오디오 파일만 올릴 수 있어요."
        el.bgUploadStatus.classList.add("error")
        return
      }
      const url = URL.createObjectURL(file)
      // 바로 넣어 고르고 들을 수 있게 하고, 길이는 함께 잰다. 깨진 파일이면 '추가했어요'를 거두고, 아주 긴 파일은
      // 통째로 풀면 메모리를 많이 써(45분 → 약 1 GB) 탭이 멈출 수 있으니 빼낸다. 무거운 미리 풀기는 잰 뒤에만 한다.
      const added = addCheckedCustomBackground(file, url)
      return probeAudioDuration(url).then(function (seconds) {
        if (seconds >= 0 && seconds <= MAX_CUSTOM_BG_SECONDS) {
          if (state.atmosphere === added.atmosphere && typeof engine.warmAmbience === "function") {
            engine.warmAmbience(buildRecipe()).catch(function () {})
          }
          return
        }
        withdrawCustomBackground(added)
        showBgUploadStatus(
          seconds < 0 ? "이 파일은 음악으로 읽을 수 없어요. mp3나 wav 파일을 올려 주세요." : "너무 긴 음악이에요. 10분보다 짧은 음악을 올려 주세요.",
          true,
        )
      })
    }

    // 길이를 재 보니 쓸 수 없는 파일이었다 — 다시 이어 붙인 자리는 '다시 올려 주세요' 카드로 되돌리고, 새 카드는 뺀다.
    function withdrawCustomBackground(added) {
      const a = added && added.atmosphere
      if (!a) return
      if (!added.reconnected) {
        removeCustomBackground(a)
        return
      }
      const bg = D.backgrounds[a.id]
      if (bg && bg.src && typeof engine.releaseAsset === "function") engine.releaseAsset(bg.src)
      if (bg && typeof bg.src === "string" && bg.src.indexOf("blob:") === 0) {
        try {
          URL.revokeObjectURL(bg.src)
        } catch (e) {}
      }
      delete D.backgrounds[a.id]
      a.missing = true
      a.detail = "파일을 다시 올리면 들을 수 있어요"
      if (state.bgPreviewId === a.id) stopBackgroundPreview()
      if (state.atmosphere && state.atmosphere.id === a.id) reloadBackground()
      renderAtmospheres()
      updateReadouts()
    }

    function probeAudioDuration(url) {
      return new Promise(function (resolve) {
        let done = false
        const finish = function (value) {
          if (done) return
          done = true
          resolve(value)
        }
        if (typeof window.Audio !== "function") {
          finish(0)
          return
        }
        try {
          const probe = new window.Audio()
          probe.preload = "metadata"
          probe.addEventListener("loadedmetadata", function () {
            finish(Number(probe.duration) || 0)
          })
          probe.addEventListener("error", function () {
            finish(-1)
          })
          probe.src = url
          setTimeout(function () {
            finish(0) // 길이를 못 재면 막지 않는다
          }, 4000)
        } catch (e) {
          finish(0)
        }
      })
    }

    function addCheckedCustomBackground(file, url) {
      const label = (file.name || "내 배경").replace(/\.[^.]+$/, "") || "내 배경"
      const missing = D.atmospheres.find((a) => a.custom && a.missing && a.label === label)
      if (missing) {
        // 저장된 작품의 음악을 다시 올렸다 — 같은 자리(id)에 이어 붙이고, 그 작품이 쓰던 구간을 되살린다.
        D.backgrounds[missing.id] = { label: label, src: url, duration: 0, custom: true, file: file }
        missing.missing = false
        missing.detail = "내가 올린 배경 음원"
        if (state.atmosphere && state.atmosphere.id === missing.id) {
          const range = missing.savedRange || {}
          state.bgOffset = Math.max(0, Number(range.bgOffset) || 0)
          state.bgEndOffset = Math.max(0, Number(range.bgEndOffset) || 0)
          reloadBackground()
        }
        renderAtmospheres()
        updateReadouts()
        showBgUploadStatus("'" + label + "' 음악을 작품에 다시 이어 붙였어요.", false)
        return { atmosphere: missing, reconnected: true }
      }
      const id = getNextCustomBgId()
      D.backgrounds[id] = { label: label, src: url, duration: 0, custom: true, file: file }
      const atmosphere = {
        id: id,
        label: label,
        group: STUDENT_MUSIC_GROUP, // "학생들이 찾은 음악" 섹션에 그 자리로 쌓인다
        padType: "ambient",
        detail: "내가 올린 배경 음원",
        color: "#6b8f9c",
        backgroundId: id,
        effectIds: [],
        custom: true,
      }
      D.atmospheres.push(atmosphere)
      state.atmosphere = atmosphere
      startNewBackground() // 처음(0초)부터, 그린 선율은 같은 초에 남긴다
      applyMoodTint()
      startBackgroundPreview(atmosphere)
      renderAtmospheres()
      updateReadouts()
      el.bgUploadStatus.classList.remove("error")
      el.bgUploadStatus.textContent = "'" + label + "' 배경을 추가했어요. 카드를 눌러 들어보세요."
      return { atmosphere: atmosphere, reconnected: false }
    }

    // ── 악기 카드 렌더링 ─────────────────────────────────────────

    function renderInstrumentGroups() {
      const groups = INSTRUMENT_GROUPS.filter((group) => D.instruments.some((instrument) => instrument.group === group))
      clearEl(el.instrumentGroups)
      groups.forEach((g) => {
        const b = document.createElement("button")
        b.type = "button"
        b.className = "group-tab" + (g === state.group ? " active" : "")
        b.textContent = g
        b.addEventListener("click", () => {
          state.group = g
          renderInstrumentGroups()
          renderInstruments()
        })
        el.instrumentGroups.appendChild(b)
      })
    }

    function renderComposeInstruments() {
      clearEl(el.composeInstrumentList)
      INSTRUMENT_GROUPS.forEach((group) => {
        const groupItems = D.instruments.filter((instrument) => instrument.group === group)
        if (!groupItems.length) return

        const section = document.createElement("section")
        section.className = "compose-instrument-group" + (group === state.group ? " active" : "")
        section.setAttribute("aria-label", group + " 악기")
        section.dataset.group = group

        const head = document.createElement("div")
        head.className = "compose-instrument-group-head"
        const groupTitle = document.createElement("strong")
        groupTitle.textContent = group
        head.appendChild(groupTitle)
        section.appendChild(head)

        const list = document.createElement("div")
        list.className = "compose-instrument-group-list"
        instrumentFamilies(groupItems).forEach((familyGroup) => {
          const familySection = document.createElement("section")
          familySection.className = "compose-instrument-family"
          familySection.setAttribute("aria-label", group + " " + familyGroup.family)

          const familyHead = document.createElement("div")
          familyHead.className = "compose-instrument-family-head"
          familyHead.textContent = familyGroup.family
          familySection.appendChild(familyHead)

          const familyList = document.createElement("div")
          familyList.className = "compose-instrument-family-list"
          familyGroup.items.forEach((i) => {
            const b = document.createElement("button")
            b.type = "button"
            b.className = "compose-instrument" + (i.id === state.instrument.id ? " active" : "")
            applyInstrumentTone(b, i.id)
            b.setAttribute("aria-pressed", i.id === state.instrument.id ? "true" : "false")
            b.title = i.group + " · " + i.family + " · " + i.detail
            if (i.image) {
              const img = document.createElement("img")
              img.src = i.image
              img.alt = ""
              img.loading = "lazy"
              b.appendChild(img)
            }
            const label = document.createElement("span")
            label.className = "compose-instrument-text"
            const name = document.createElement("strong")
            name.textContent = i.label
            label.appendChild(name)
            b.appendChild(label)
            b.addEventListener("click", () => {
              recordUserAction({ update: false })
              selectInstrument(i, true) // 3단계에서는 미리듣기 없이 악기만 바꾼다
            })
            familyList.appendChild(b)
          })

          familySection.appendChild(familyList)
          list.appendChild(familySection)
        })

        section.appendChild(list)
        el.composeInstrumentList.appendChild(section)
      })
    }

    function selectInstrument(instrument, announce) {
      state.instrument = instrument
      state.group = instrument.group
      state.style = styleForInstrument(instrument) // 서양=C장조, 국악=5음+시김새
      setEraser(false)
      if (state.effectStampId) {
        state.effectStampId = null
        renderEffects()
        renderEffectStamps()
      }
      draw.setActiveInstrument(instrument.id) // 이제부터 그리는 줄의 악기(기존 줄은 그대로)
      engine.stop()
      renderInstrumentGroups()
      renderInstruments()
      renderComposeInstruments()
      renderOrchestraLegend()
      draw.compute()
      draw.render()
      renderPitchAxisLabels() // 악기에 따라 음계·라벨(들리는 음)이 바뀌므로 음높이 축을 다시 그린다
      updateReadouts()
      warmSelectedInstrument()
      if (announce) {
        say("이제부터 그리는 줄은 " + instrument.label + "로 연주됩니다. (이미 그린 줄은 그대로)")
      }
    }

    // ── 악기 감상 노트 (2단계) ───────────────────────────────────
    // 학생이 소리를 듣고 느낌을 직접 적는 칸. 악기 설명(detail)은 "예시 답안"으로 감춰 두고
    // 버튼을 눌렀을 때만 펼친다. 메모는 state 에만 남기고 작품·화음 갤러리에는 저장하지 않는다.

    const NOTE_MAX_LENGTH = 60

    function buildInstrumentNote(instrument) {
      const note = document.createElement("div")
      note.className = "instrument-note"

      const label = document.createElement("label")
      label.className = "instrument-note-label"
      label.setAttribute("for", "instrumentNote-" + instrument.id)
      label.textContent = "내 느낌"
      note.appendChild(label)

      const field = document.createElement("textarea")
      field.className = "instrument-note-field"
      field.id = "instrumentNote-" + instrument.id
      field.rows = 2
      field.maxLength = NOTE_MAX_LENGTH
      field.placeholder = "어떤 느낌인가요?"
      field.dataset.noteInstrument = instrument.id
      field.value = state.instrumentNotes[instrument.id] || ""
      field.addEventListener("input", () => {
        // 값을 바로 state 에 옮겨 둔다 — 연주곡이 끝나 그리드가 다시 그려져도 글이 남는다.
        state.instrumentNotes[instrument.id] = field.value
        if (typeof syncReflectionFromNotes === "function") syncReflectionFromNotes()
      })
      note.appendChild(field)

      const answer = document.createElement("p")
      answer.className = "instrument-answer"
      answer.id = "instrumentAnswer-" + instrument.id
      answer.textContent = instrument.detail || ""

      const reveal = document.createElement("button")
      reveal.type = "button"
      reveal.className = "instrument-answer-btn"
      reveal.textContent = "예시 답안 보기"
      reveal.setAttribute("aria-controls", answer.id)
      reveal.setAttribute("aria-label", instrument.label + " 예시 답안 보기")

      const shown = !!state.instrumentAnswerShown[instrument.id]
      answer.hidden = !shown
      reveal.hidden = shown
      reveal.setAttribute("aria-expanded", shown ? "true" : "false")
      reveal.addEventListener("click", () => {
        state.instrumentAnswerShown[instrument.id] = true
        answer.hidden = false
        reveal.hidden = true
        reveal.setAttribute("aria-expanded", "true")
      })

      note.appendChild(reveal)
      note.appendChild(answer)
      return note
    }

    // 그리드를 통째로 다시 그려도(연주곡 종료·악기 선택 등) 적던 자리를 잃지 않도록 커서를 기억했다 되돌린다.
    function captureNoteFocus() {
      const active = document.activeElement
      const id = active && active.dataset ? active.dataset.noteInstrument : null
      if (!id) return null
      return { id: id, start: active.selectionStart, end: active.selectionEnd }
    }

    function restoreNoteFocus(focus) {
      if (!focus || typeof el.instrumentGrid.querySelector !== "function") return
      const field = el.instrumentGrid.querySelector('[data-note-instrument="' + focus.id + '"]')
      if (!field || typeof field.focus !== "function") return
      field.focus()
      if (typeof field.setSelectionRange === "function" && focus.start != null) {
        field.setSelectionRange(focus.start, focus.end)
      }
    }

    function renderInstruments() {
      const noteFocus = captureNoteFocus()
      clearEl(el.instrumentGrid)
      const groupItems = D.instruments.filter((i) => i.group === state.group)
      instrumentFamilies(groupItems).forEach((familyGroup) => {
        const section = document.createElement("section")
        section.className = "instrument-family"
        section.setAttribute("aria-label", state.group + " " + familyGroup.family)

        const head = document.createElement("div")
        head.className = "instrument-family-head"
        const titleEl = document.createElement("strong")
        titleEl.textContent = familyGroup.family
        const count = document.createElement("small")
        count.textContent = familyGroup.items.length + "개"
        head.appendChild(titleEl)
        head.appendChild(count)
        section.appendChild(head)

        const list = document.createElement("div")
        list.className = "instrument-family-grid"
        familyGroup.items.forEach((i) => {
          // 카드는 button 이라 입력칸을 그 안에 넣을 수 없다 — 슬롯으로 감싸 감상 노트를 형제로 붙인다.
          const slot = document.createElement("div")
          slot.className = "instrument-card-slot" + (i.id === state.instrument.id ? " active" : "")
          applyInstrumentTone(slot, i.id) // 감상 노트도 카드와 같은 악기 톤 색을 쓰도록 슬롯에 심는다
          const b = card(i, i.id === state.instrument.id, "") // 설명은 감상 노트의 예시 답안으로 옮겼다
          b.classList.add("instrument-card")
          applyInstrumentTone(b, i.id)
          b.addEventListener("click", () => {
            selectInstrument(i, false)
          })
          if (i.example) {
            const playing = state.examplePreviewId === i.id
            if (playing) b.classList.add("playing")
            const ex = document.createElement("span")
            ex.className = "example-play"
            ex.setAttribute("role", "button")
            ex.setAttribute("tabindex", "0")
            ex.title = playing ? "연주곡 정지" : (i.exampleLabel ? i.exampleLabel + " — " : "") + "연주곡 감상"
            ex.setAttribute(
              "aria-label",
              playing ? i.label + " 연주곡 정지" : i.label + " 연주곡 감상" + (i.exampleLabel ? " (" + i.exampleLabel + ")" : ""),
            )
            ex.textContent = playing ? "■" : "▶"
            const onPreview = (ev) => {
              ev.stopPropagation()
              toggleExamplePreview(i)
            }
            ex.addEventListener("click", onPreview)
            ex.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault()
                onPreview(ev)
              }
            })
            b.appendChild(ex)
          }
          slot.appendChild(b)
          slot.appendChild(buildInstrumentNote(i))
          list.appendChild(slot)
        })
        section.appendChild(list)
        el.instrumentGrid.appendChild(section)
      })
      restoreNoteFocus(noteFocus)
    }

    return {
      bgSrcFor,
      backgroundFor,
      missingCustomBackground,
      stopBackgroundPreview,
      stopExamplePreview,
      renderAtmospheres,
      addCustomBackground,
      renderInstrumentGroups,
      renderInstruments,
      renderComposeInstruments,
    }
  }
})(window)
