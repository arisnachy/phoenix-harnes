// Backward-compatible handoff for already-open Phoenix tabs that still
// request /oauth-waiting.html?v=20261007-1. New Phoenix code uses about:blank.
// This page never learns or stores tokens and accepts messages only from its
// same-origin opener. Provider URLs must be HTTPS or HTTP loopback.
(() => {
  'use strict'
  const origin = window.location.origin
  const opener = window.opener
  const status = document.getElementById('status')
  function say(message) {
    if (status !== null) status.textContent = message
  }
  function validConsentUrl(value) {
    if (typeof value !== 'string') return null
    try {
      const url = new URL(value)
      if (url.username !== '' || url.password !== '') return null
      if (url.protocol === 'https:') return url.href
      if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.href
    } catch {
      // Malformed or unsafe provider URL.
    }
    return null
  }
  if (opener === null) {
    say('Esta pestaña ya no está asociada a PHOENIX. Regresa a la aplicación y pulsa Autorizar nuevamente.')
    return
  }
  window.addEventListener('message', event => {
    if (event.source !== opener || event.origin !== origin) return
    const payload = event.data
    if (payload === null || typeof payload !== 'object') return
    if (payload.type === 'phoenix/oauth-navigate') {
      const next = validConsentUrl(payload.url)
      if (next === null) {
        say('El servidor no entregó una URL de autorización segura. Vuelve a PHOENIX para revisar el error.')
        return
      }
      window.location.replace(next)
    } else if (payload.type === 'phoenix/oauth-status') {
      const fallback = 'La autorización todavía está en preparación. Revisa PHOENIX si tarda demasiado.'
      say(typeof payload.message === 'string' ? payload.message.slice(0, 1200) : fallback)
    }
  })
  try {
    opener.postMessage({ type: 'phoenix/oauth-ready' }, origin)
  } catch {
    say('No fue posible comunicarse con PHOENIX. Regresa a la aplicación y reintenta Autorizar.')
  }
})()
