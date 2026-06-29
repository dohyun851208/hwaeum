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
      renderComposeInstruments,
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
    } = deps

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
      const detail = document.createElement("span")
      detail.textContent = sub
      copy.appendChild(title)
      copy.appendChild(detail)
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
      stopExamplePreview() // 악기 감상과 겹치지 않도록
      try {
        if (bgPreview.src !== src) bgPreview.src = src
        bgPreview.currentTime = 0
        const p = bgPreview.play()
        if (p && p.catch) p.catch((e) => console.warn("배경 미리듣기 실패", e))
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

    // 악기 연주곡 감상 미리듣기 (국악기 카드의 ▶ 버튼)
    function stopExamplePreview(announce) {
      const wasPlaying = !!state.examplePreviewId
      state.examplePreviewId = null
      try {
        examplePreview.pause()
        examplePreview.currentTime = 0
      } catch (e) {}
      if (announce && wasPlaying) el.exportStatus.textContent = "악기 소리를 멈췄습니다."
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
        el.exportStatus.textContent = instrument.label + " 소리를 듣는 중입니다. 정지하려면 같은 악기의 ■ 버튼을 누르세요."
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
        state.atmosphere = a
        state.bgOffset = 0 // 새 배경은 처음(0초)부터
        state.bgEndOffset = 0
        state.duration = DEFAULT_DURATION_SECONDS
        applyMoodTint()
        syncBgPlayerUI()
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
      el.atmosphereGrid.appendChild(b)
    }

    // 업로드한 "내가 찾은 음악" 삭제 — 목록·배경에서 빼고 Blob URL 도 해제한다.
    function removeCustomBackground(a) {
      const bg = D.backgrounds[a.id]
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
        window.alert(CUSTOM_BG_COPYRIGHT_NOTICE)
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
      const id = getNextCustomBgId()
      const label = (file.name || "내 배경").replace(/\.[^.]+$/, "") || "내 배경"
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
      state.bgOffset = 0
      state.bgEndOffset = 0
      state.duration = DEFAULT_DURATION_SECONDS
      applyMoodTint()
      syncBgPlayerUI()
      startBackgroundPreview(atmosphere)
      renderAtmospheres()
      engine.warmAmbience(buildRecipe()).catch(function () {}) // 업로드한 배경음 미리 로드
      updateReadouts()
      el.bgUploadStatus.classList.remove("error")
      el.bgUploadStatus.textContent = "'" + label + "' 배경을 추가했어요. 카드를 눌러 들어보세요."
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
        el.exportStatus.textContent = "이제부터 그리는 줄은 " + instrument.label + "로 연주됩니다. (이미 그린 줄은 그대로)"
      }
    }

    function renderInstruments() {
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
          const b = card(i, i.id === state.instrument.id, i.detail)
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
          list.appendChild(b)
        })
        section.appendChild(list)
        el.instrumentGrid.appendChild(section)
      })
    }

    // ── 버전 렌더링 ──────────────────────────────────────────────

    function renderVersions() {
      if (!el.versionList) return
      clearEl(el.versionList)
      D.versions.forEach((v) => {
        const b = document.createElement("button")
        b.type = "button"
        b.className = "version" + (v.id === state.version.id ? " active" : "")
        b.setAttribute("aria-pressed", v.id === state.version.id ? "true" : "false")
        const label = document.createElement("strong")
        label.textContent = v.label
        b.appendChild(label)
        b.title = v.detail
        b.addEventListener("click", () => {
          state.version = v
          engine.stop()
          renderVersions()
          el.exportStatus.textContent = v.label + " 믹스로 바꿨습니다."
        })
        el.versionList.appendChild(b)
      })
    }

    return {
      instrumentFamilies,
      card,
      bgSrcFor,
      backgroundFor,
      balanceParentheticalMoodTitle,
      stopBackgroundPreview,
      startBackgroundPreview,
      toggleBackgroundPreview,
      stopExamplePreview,
      toggleExamplePreview,
      appendAtmosphereCard,
      removeCustomBackground,
      renderAtmospheres,
      buildUploadCard,
      addCustomBackground,
      renderInstrumentGroups,
      selectInstrument,
      renderInstruments,
      renderVersions,
    }
  }
})(window)
