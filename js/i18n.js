;(function (root) {
  "use strict"
  const storageKey = "hwaeum.language"
  const dictionary = root.HwaeumPortuguese || {}
  const originals = Object.fromEntries(Object.entries(dictionary).map(function (entry) { return [entry[1], entry[0]] }))
  const textState = new WeakMap()
  const attrState = new WeakMap()
  const protectedContent = 'script,style,textarea,[translate="no"],[data-language-select],.sr-only,.take-name-text,.take-composer,.take-tags,.hashtag-chip,#placardMeta,#channelTitle,#viewerTitle,#viewerComposer,#viewerTags,.channel-album-overlay,.channel-viewer-text'
  let language = "ko"
  try { language = root.localStorage.getItem(storageKey) === "pt-BR" ? "pt-BR" : "ko" } catch (_) {}

  function t(source) {
    if (language !== "pt-BR" || typeof source !== "string") return source
    if (Object.prototype.hasOwnProperty.call(dictionary, source)) return dictionary[source]
    if (/^\d+(?:\.\d+)?초$/.test(source)) return source.slice(0, -1) + " s"
    if (/^\d+회$/.test(source)) return source.slice(0, -1) + " tentativas"
    if (/^\d+개 선$/.test(source)) return source.slice(0, -3) + " traços"
    if (/^\d+개$/.test(source)) return source.slice(0, -1) + " itens"
    if (/^\d+번$/.test(source)) return "Nº " + source.slice(0, -1)
    if (source.includes(" · ")) return source.split(" · ").map(t).join(" · ")
    return source
  }

  function original(value) {
    if (Object.prototype.hasOwnProperty.call(originals, value)) return originals[value]
    if (/^\d+(?:\.\d+)? s$/.test(value)) return value.slice(0, -2) + "초"
    if (/^\d+ tentativas$/.test(value)) return value.split(" ")[0] + "회"
    if (/^\d+ traços$/.test(value)) return value.split(" ")[0] + "개 선"
    if (/^\d+ itens$/.test(value)) return value.split(" ")[0] + "개"
    if (/^Nº \d+$/.test(value)) return value.slice(3) + "번"
    if (value.includes(" · ")) return value.split(" · ").map(original).join(" · ")
    return value
  }

  function translateText(node) {
    if (!node.parentElement || node.parentElement.closest(protectedContent)) return
    const current = node.nodeValue
    const previous = textState.get(node)
    const source = previous && current === previous.output ? previous.source : original(current.trim())
    const output = current.slice(0, current.indexOf(current.trim())) + t(source) + current.slice(current.indexOf(current.trim()) + current.trim().length)
    textState.set(node, { source: source, output: output })
    if (current !== output) node.nodeValue = output
  }

  function translateAttrs(element) {
    if (element.closest('[translate="no"],[data-language-select]')) return
    const states = attrState.get(element) || {}
    ;["title", "aria-label", "placeholder"].forEach(function (name) {
      const current = element.getAttribute(name)
      if (current === null) return
      const previous = states[name]
      const source = previous && current === previous.output ? previous.source : original(current)
      const output = t(source)
      states[name] = { source: source, output: output }
      if (current !== output) element.setAttribute(name, output)
    })
    attrState.set(element, states)
  }

  function translateTree(scope) {
    if (!scope || !document.createTreeWalker) return
    if (scope.nodeType === 3) { translateText(scope); return }
    if (scope.nodeType === 1) translateAttrs(scope)
    const walker = document.createTreeWalker(scope, 5)
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateText(node)
      else translateAttrs(node)
    }
  }

  function apply(scope) {
    ;(scope || document).querySelectorAll("[data-i18n]").forEach(function (element) {
      const source = element.getAttribute("data-i18n")
      // A gallery name or other runtime value may have replaced this initial label.
      if (element.textContent.trim() === source.trim() || element.textContent === dictionary[source]) element.textContent = t(source)
    })
    ;(scope || document).querySelectorAll("[data-i18n-attrs]").forEach(function (element) {
      const attributes = JSON.parse(element.getAttribute("data-i18n-attrs"))
      Object.keys(attributes).forEach(function (name) {
        const source = attributes[name]
        if (element.getAttribute(name) === source || element.getAttribute(name) === dictionary[source]) element.setAttribute(name, t(source))
      })
    })
    document.documentElement.lang = language
    document.querySelectorAll("[data-language-select]").forEach(function (select) { select.value = language })
    translateTree(scope || document.body)
  }

  function setLanguage(next) {
    if (next !== "ko" && next !== "pt-BR") return
    language = next
    try { root.localStorage.setItem(storageKey, language) } catch (_) {}
    apply()
    root.dispatchEvent(new CustomEvent("hwaeum:languagechange", { detail: language }))
  }

  function init() {
    document.querySelectorAll("[data-language-select]").forEach(function (select) {
      select.addEventListener("change", function () { setLanguage(select.value) })
    })
    apply()
    if (typeof MutationObserver !== "undefined" && document.body) {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.type === "characterData") translateText(record.target)
          else if (record.type === "attributes") translateAttrs(record.target)
          else record.addedNodes.forEach(translateTree)
        })
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label", "placeholder"] })
    }
  }
  root.HwaeumI18n = { t: t, apply: apply, setLanguage: setLanguage, getLanguage: function () { return language } }
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
  else init()
})(window)
