(function (root) {
  "use strict"

  const STORAGE_KEY = "hwaeum.googleUser"
  const CLIENT_ID_STORAGE_KEY = "hwaeum.googleClientId"
  const SIGNED_OUT_STATUS = "로그인 없이도 사용할 수 있어요."
  const SETUP_STATUS = "Google 로그인 설정이 필요해요. 로그인 없이 사용할 수 있어요."

  const doc = root.document
  let currentUser = null
  let initializedGoogle = false
  let clientId = ""

  function getStorage() {
    try {
      return root.localStorage || null
    } catch (err) {
      return null
    }
  }

  function readClientId() {
    const fromGlobal = typeof root.HWAEUM_GOOGLE_CLIENT_ID === "string" ? root.HWAEUM_GOOGLE_CLIENT_ID.trim() : ""
    if (fromGlobal) return fromGlobal

    const meta = doc && doc.querySelector('meta[name="google-signin-client_id"]')
    const fromMeta = meta && typeof meta.content === "string" ? meta.content.trim() : ""
    if (fromMeta) return fromMeta

    const storage = getStorage()
    const fromStorage = storage ? String(storage.getItem(CLIENT_ID_STORAGE_KEY) || "").trim() : ""
    return fromStorage
  }

  function getElements() {
    if (!doc) return {}
    return {
      box: doc.getElementById("authBox"),
      profile: doc.getElementById("authProfile"),
      avatar: doc.getElementById("authAvatar"),
      name: doc.getElementById("authName"),
      slot: doc.getElementById("googleButtonSlot"),
      logout: doc.getElementById("googleLogoutBtn"),
      status: doc.getElementById("authStatus"),
    }
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = !!hidden
  }

  function setStatus(text) {
    const els = getElements()
    if (els.status) els.status.textContent = text
  }

  function safeParse(json) {
    try {
      return JSON.parse(json)
    } catch (err) {
      return null
    }
  }

  function loadStoredUser() {
    const storage = getStorage()
    if (!storage) return null
    const stored = safeParse(storage.getItem(STORAGE_KEY) || "")
    if (!stored || !stored.sub) return null
    return {
      sub: String(stored.sub),
      name: String(stored.name || stored.email || "Google 사용자"),
      email: String(stored.email || ""),
      picture: String(stored.picture || ""),
    }
  }

  function saveStoredUser(user) {
    const storage = getStorage()
    if (!storage) return
    try {
      if (!user) {
        storage.removeItem(STORAGE_KEY)
        return
      }
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sub: user.sub,
          name: user.name,
          email: user.email,
          picture: user.picture,
        }),
      )
    } catch (err) {
      // Login is optional, so storage failures should not block the app.
    }
  }

  function base64UrlDecode(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    const binary = root.atob(padded)
    const bytes = Array.prototype.map.call(binary, (char) => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
    return decodeURIComponent(bytes.join(""))
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".")
    if (parts.length < 2) return null
    return safeParse(base64UrlDecode(parts[1]))
  }

  function profileFromPayload(payload) {
    if (!payload || !payload.sub) return null
    return {
      sub: String(payload.sub),
      name: String(payload.name || payload.given_name || payload.email || "Google 사용자"),
      email: String(payload.email || ""),
      picture: String(payload.picture || ""),
    }
  }

  function dispatchAuthChange() {
    if (!root.dispatchEvent || !root.CustomEvent) return
    root.dispatchEvent(new root.CustomEvent("hwaeum:auth", { detail: { user: getUser() } }))
  }

  function clearLoginSlot(slot) {
    if (!slot) return
    while (slot.firstChild) slot.removeChild(slot.firstChild)
  }

  function renderFallbackButton(disabled) {
    const els = getElements()
    if (!els.slot) return
    clearLoginSlot(els.slot)
    const button = doc.createElement("button")
    button.type = "button"
    button.className = "btn tiny auth-google-fallback"
    button.textContent = "Google 로그인"
    button.disabled = !!disabled
    button.addEventListener("click", function () {
      setStatus(clientId ? "Google 로그인 화면을 불러오지 못했어요." : SETUP_STATUS)
    })
    els.slot.appendChild(button)
  }

  function getGoogleIdApi() {
    return root.google && root.google.accounts && root.google.accounts.id ? root.google.accounts.id : null
  }

  function renderLoginControl() {
    const els = getElements()
    if (!els.slot || currentUser) return
    if (!clientId) {
      renderFallbackButton(true)
      setStatus(SETUP_STATUS)
      return
    }

    const googleId = getGoogleIdApi()
    if (!googleId || !initializedGoogle) {
      renderFallbackButton(true)
      return
    }

    clearLoginSlot(els.slot)
    googleId.renderButton(els.slot, {
      theme: "outline",
      size: "medium",
      shape: "pill",
      text: "signin_with",
      locale: "ko",
      width: 170,
    })
  }

  function render() {
    const els = getElements()
    if (!els.box) return

    els.box.dataset.auth = currentUser ? "signed-in" : "guest"
    setHidden(els.profile, !currentUser)
    setHidden(els.slot, !!currentUser)
    setHidden(els.logout, !currentUser)

    if (currentUser) {
      if (els.name) els.name.textContent = currentUser.name || currentUser.email || "Google 사용자"
      if (els.avatar) {
        els.avatar.src = currentUser.picture || ""
        els.avatar.alt = ""
        setHidden(els.avatar, !currentUser.picture)
      }
      setStatus("로그인됨")
      return
    }

    if (els.avatar) {
      els.avatar.removeAttribute("src")
      setHidden(els.avatar, true)
    }
    setStatus(clientId ? SIGNED_OUT_STATUS : SETUP_STATUS)
  }

  function handleCredentialResponse(response) {
    const payload = decodeJwtPayload(response && response.credential)
    const user = profileFromPayload(payload)
    if (!user) {
      setStatus("Google 로그인 정보를 읽지 못했어요.")
      return
    }
    currentUser = user
    saveStoredUser(user)
    render()
    dispatchAuthChange()
  }

  function initializeGoogle() {
    if (initializedGoogle || !clientId) return initializedGoogle
    const googleId = getGoogleIdApi()
    if (!googleId) return false

    googleId.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    })
    initializedGoogle = true
    renderLoginControl()
    return true
  }

  function waitForGoogle(tries) {
    if (currentUser) return
    if (initializeGoogle()) return
    if (!clientId) {
      renderLoginControl()
      return
    }
    if (tries >= 80) {
      renderFallbackButton(true)
      setStatus("Google 로그인 화면을 불러오지 못했어요.")
      return
    }
    root.setTimeout(function () {
      waitForGoogle(tries + 1)
    }, 100)
  }

  function bindLogout() {
    const els = getElements()
    if (!els.logout || els.logout.dataset.bound === "true") return
    els.logout.dataset.bound = "true"
    els.logout.addEventListener("click", signOut)
  }

  function signOut() {
    const googleId = getGoogleIdApi()
    if (googleId && googleId.disableAutoSelect) googleId.disableAutoSelect()
    currentUser = null
    saveStoredUser(null)
    render()
    waitForGoogle(0)
    setStatus("로그아웃했어요. 로그인 없이 계속 사용할 수 있어요.")
    dispatchAuthChange()
  }

  function getUser() {
    return currentUser
      ? {
          sub: currentUser.sub,
          name: currentUser.name,
          email: currentUser.email,
          picture: currentUser.picture,
        }
      : null
  }

  function init() {
    currentUser = loadStoredUser()
    clientId = readClientId()
    bindLogout()
    render()
    waitForGoogle(0)
  }

  root.HwaeumAuth = {
    init,
    getUser,
    signOut,
    hasGoogleClientId() {
      return !!readClientId()
    },
  }

  if (doc) {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", init, { once: true })
    } else {
      init()
    }
  }
})(window)
