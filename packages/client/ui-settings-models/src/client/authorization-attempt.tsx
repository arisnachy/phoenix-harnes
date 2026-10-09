import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

/**
 * A provider consent URL must be HTTPS, except for a loopback OAuth server.
 * Never navigate a reserved privileged popup to javascript:, file:, data:,
 * an insecure remote endpoint, or a URL containing embedded credentials.
 */
function safeOAuthConsentUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') return undefined
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')) return url.href
  } catch {
    // An authorization provider may return a malformed URL.
  }
  return undefined
}

/** Preserve only deterministic, secret-free failure categories in the popup tab. */
function safePopupFailure(message: string): string {
  if (/38 segundos|45 segundos|tiempo de espera|agot[oó] el tiempo|timeout/i.test(message)) {
    return 'El MCP agotó el tiempo de preparación y no abrió el inicio de sesión. Revisa el diagnóstico en PHOENIX.'
  }
  if (/client.id|client.secret|registro|registrar|DCR/i.test(message)) {
    return 'El MCP necesita configurar una aplicación cliente OAuth antes de iniciar sesión. Revisa el aviso en PHOENIX.'
  }
  if (/conexi[oó]n|network|ECONN|DNS|fetch failed/i.test(message)) {
    return 'PHOENIX no pudo contactar al proveedor MCP. Revisa la URL y el diagnóstico en la pestaña principal.'
  }
  return 'El servidor no proporcionó una URL de autorización válida. Regresa a PHOENIX para consultar el error y reintentar.'
}

/** One browser-visible authorization attempt, carrying its last notice forward. */
export interface AuthorizationAttempt {
  id: string
  key: string
  status: 'pending' | 'authorized' | 'cancelled' | 'failed'
  nextSeq: number
  message?: string
  url?: string
  code?: string
  prompt?: {
    promptId: string
    kind: 'text' | 'secret' | 'select'
    message: string
    placeholder?: string
    options?: Array<{ id: string; label: string; description?: string }>
  }
  error?: string
}

/**
 * Start Host authorization while keeping preparation and prompts in Phoenix.
 * Only real, validated provider consent URLs may open a browser tab. A manual
 * link remains available if the browser blocks the asynchronous popup.
 */
export function useAuthorizationAttempt(
  api: AuthorizationClient | undefined,
  onAuthorized: () => void,
): {
  attempt: AuthorizationAttempt | undefined
  answer: string
  setAnswer: (value: string) => void
  failure: string | undefined
  preparingKey: string | undefined
  reserveOAuthPopup: () => void
  closeOAuthPopup: () => void
  begin: (key: string, method?: string) => void
  submitAnswer: () => void
  cancel: () => void
} {
  const [attempt, setAttempt] = useState<AuthorizationAttempt | undefined>()
  const onAuthorizedRef = useRef(onAuthorized)
  useEffect(() => { onAuthorizedRef.current = onAuthorized }, [onAuthorized])
  const [answer, setAnswer] = useState('')
  const [failure, setFailure] = useState<string | undefined>()
  const [preparingKey, setPreparingKey] = useState<string | undefined>()
  const opened = useRef(new Set<string>())
  const popupRef = useRef<Window | null>(null)
  const navigatedRef = useRef(false)
  const popupTimeoutRef = useRef<(() => void) | undefined>(undefined)
  const oauthAttemptRef = useRef(false)
  const failedPopupRef = useRef(false)
  const activeAttemptIdRef = useRef<string | undefined>(undefined)
  const pendingBeginTimerRef = useRef<number | undefined>(undefined)

  // This is an active browser tab, not an inert splash screen. Only locally
  // authored messages are written: never render raw provider URLs or secrets.
  const showPopupStatus = useCallback((
    headingText: string,
    descriptionText: string,
    failed = false,
  ): void => {
    const popup = popupRef.current
    if (popup === null || navigatedRef.current) return
    popupStatusRef.current = { heading: headingText, detail: descriptionText, failed }
    try {
      if (popup.closed) return
      const doc = popup.document
      if (doc?.body === undefined || doc.body === null) return
      // Preserve the real waiting page, including its CSP-protected message
      // listener. Replacing the document body would detach that listener's UI.
      const realStatus = doc.getElementById('status')
      const realHeading = doc.querySelector('h1')
      if (realStatus !== null && realHeading !== null) {
        realHeading.textContent = headingText
        realStatus.textContent = failed ? safePopupFailure(descriptionText) : descriptionText
        doc.title = failed ? 'PHOENIX · Autorización no iniciada' : 'PHOENIX · Autorización segura'
        return
      }
      const heading = doc.getElementById('phoenix-oauth-heading') ?? doc.createElement('h2')
      heading.id = 'phoenix-oauth-heading'
      heading.textContent = headingText
      const description = doc.getElementById('phoenix-oauth-description') ?? doc.createElement('p')
      description.id = 'phoenix-oauth-description'
      description.textContent = failed ? safePopupFailure(descriptionText) : descriptionText
      const footer = doc.getElementById('phoenix-oauth-footer') ?? doc.createElement('p')
      footer.id = 'phoenix-oauth-footer'
      footer.textContent = failed
        ? 'Regresa a la pestaña de PHOENIX para reintentar o revisar la configuración del conector.'
        : 'PHOENIX mostrará un diagnóstico si el proveedor no responde.'
      doc.title = failed ? 'PHOENIX · Autorización no iniciada' : 'PHOENIX · Autorización segura'
      doc.body.replaceChildren(heading, description, footer)
    } catch {
      // The provider may already have taken over the tab or isolated it.
    }
  }, [])

  const closeReservedPopup = useCallback((): void => {
    popupTimeoutRef.current?.()
    popupTimeoutRef.current = undefined
    const popup = popupRef.current
    popupRef.current = null
    navigatedRef.current = false
    failedPopupRef.current = false
    popupStatusRef.current = undefined
    if (popup === null) return
    try {
      if (!popup.closed) popup.close()
    } catch {
      // Cross-origin isolation can sever a window handle after consent loads.
    }
  }, [])

  const failReservedPopup = useCallback((message: string): void => {
    popupTimeoutRef.current?.()
    popupTimeoutRef.current = undefined
    failedPopupRef.current = true
    showPopupStatus('No se pudo abrir la autorización', message, true)
    setFailure(message)
  }, [showPopupStatus])

  // OAuth discovery, client registration and API prompts run within PHOENIX.
  // Do NOT open oauth-waiting.html or about:blank: those tabs are misleading
  // when the MCP never supplies a provider consent URL.
  const reserveOAuthPopup = useCallback((): void => {
    if (!navigatedRef.current) closeReservedPopup()
    setFailure(undefined)
  }, [closeReservedPopup])

  const offerManualPopupConsent = useCallback((destination: string): boolean => {
    const popup = popupRef.current
    if (popup === null) return false
    try {
      if (popup.closed) return false
      const doc = popup.document
      if (doc?.body === undefined || doc.body === null) return false
      showPopupStatus(
        'Tu navegador bloqueó la redirección',
        'El MCP entregó el enlace de autorización. Pulsa el enlace de abajo para abrir la página oficial.',
      )
      const link = doc.querySelector<HTMLAnchorElement>('#phoenix-oauth-manual-link') ?? doc.createElement('a')
      link.id = 'phoenix-oauth-manual-link'
      link.textContent = 'Abrir página de autorización'
      link.href = destination
      link.target = '_self'
      link.rel = 'noreferrer'
      if (link.parentElement !== doc.body) doc.body.appendChild(link)
      return true
    } catch {
      // Cannot expose a manual link if the browser isolated this window.
      return false
    }
  }, [showPopupStatus])

  const navigateOAuthPopup = useCallback((url: string): void => {
    const destination = safeOAuthConsentUrl(url)
    if (destination === undefined) {
      failReservedPopup('El servidor MCP no proporcionó una URL HTTPS válida para autorizar.')
      return
    }
    popupTimeoutRef.current?.()
    popupTimeoutRef.current = undefined
    // Consent URLs are opened only once they exist. Never use a placeholder.
    // Chrome can block a window.open called after an async Host response; in
    // that case navigate the current tab (permitted after async user intent).
    let opened: Window | null = null
    try { opened = window.open(destination, '_blank') } catch {
      // Browser policy forbids a background popup: try current tab below.
    }
    popupRef.current = opened
    navigatedRef.current = opened !== null
    if (opened !== null) return
    setFailure('Chrome bloqueó la nueva pestaña. PHOENIX abrirá la autorización oficial en esta misma pestaña. Si no cambia, pulsa «Abrir página de autorización».')
    try {
      window.location.assign(destination)
      navigatedRef.current = true
    } catch {
      // Embedded browsers may disallow cross-origin top-level navigation.
      // The validated manual link remains in the authorization card.
      navigatedRef.current = false
      setFailure('El navegador impidió abrir el proveedor. Pulsa «Abrir página de autorización» en PHOENIX para continuar.')
    }
  }, [failReservedPopup])


  useEffect(() => () => {
    // Unmounting Settings must not close an already-open provider consent page.
    // Only discard the blank reservation when the user has not navigated yet.
    if (!navigatedRef.current) closeReservedPopup()
  }, [closeReservedPopup])

  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending') return
    let stale = false
    const poll = (): void => {
      // The Host, not the state of a cross-origin WindowProxy, decides success.
      void api.status({ attemptId: attempt.id, after: attempt.nextSeq }).then((response) => {
        if (stale) return
        if (!response.result.ok) {
          if (!navigatedRef.current) failReservedPopup(response.result.error.message)
          setAttempt(undefined)
          setFailure(response.result.error.message)
          return
        }
        const view = response.result.value
        const latest = view.notices.at(-1)?.notice
        const consent = view.notices.findLast(item => item.notice.url !== undefined)?.notice
        // Confidential OAuth clients may ask for their client ID/secret before
        // producing a consent URL. Close the temporary tab during that prompt.
        if (view.prompt !== undefined && consent?.url === undefined && !navigatedRef.current) {
          closeReservedPopup()
        } else if (view.status === 'pending' && consent?.url === undefined && latest !== undefined && !failedPopupRef.current) {
          showPopupStatus(
            'Esperando enlace de autorización…',
            'El servidor MCP está preparando el inicio de sesión. Si no entrega el enlace, PHOENIX mostrará el error.',
          )
        }
        if (consent?.url !== undefined && !failedPopupRef.current && !opened.current.has(consent.url)) {
          opened.current.add(consent.url)
          navigateOAuthPopup(consent.url)
        }
        const message = latest?.message ?? attempt.message
        const url = consent?.url ?? attempt.url
        const code = view.notices.findLast(item => item.notice.code !== undefined)?.notice.code ?? attempt.code
        setAttempt({
          id: view.attemptId,
          key: attempt.key,
          status: view.status,
          nextSeq: view.nextSeq,
          ...message === undefined ? {} : { message },
          ...url === undefined ? {} : { url },
          ...code === undefined ? {} : { code },
          ...view.prompt === undefined ? {} : { prompt: view.prompt },
          ...view.error === undefined ? {} : { error: view.error },
        })
        if (view.status === 'authorized') {
          activeAttemptIdRef.current = undefined
          closeReservedPopup()
          onAuthorizedRef.current()
        } else if (view.status === 'cancelled') {
          activeAttemptIdRef.current = undefined
          if (!failedPopupRef.current) closeReservedPopup()
        } else if (view.status === 'failed') {
          activeAttemptIdRef.current = undefined
          const reason = view.error ?? 'El proveedor no pudo iniciar OAuth. Comprueba la configuración y vuelve a intentar.'
          if (!navigatedRef.current) failReservedPopup(reason)
          setFailure(reason)
        }
      }, (error: unknown) => {
        if (stale) return
        const reason = String(error)
        if (!navigatedRef.current) failReservedPopup(reason)
        setAttempt(undefined)
        setFailure(reason)
      })
    }
    // When the authorization popup is the active tab, Chrome can throttle the
    // background PHOENIX page's timers to one minute or longer. Schedule the
    // consent URL status poll on the active popup clock until it navigates.
    // Once it becomes cross-origin, fall back to the regular app clock.
    let timerHost: Window = window
    if (!navigatedRef.current) {
      try {
        const popup = popupRef.current
        if (popup !== null && !popup.closed
          && typeof popup.setTimeout === 'function' && typeof popup.clearTimeout === 'function') {
          timerHost = popup
        }
      } catch {
        // COOP or a browser embedding may isolate the popup WindowProxy.
      }
    }
    let timer: number
    try {
      timer = timerHost.setTimeout(poll, 650)
    } catch {
      timerHost = window
      timer = window.setTimeout(poll, 650)
    }
    return () => {
      stale = true
      try { timerHost.clearTimeout(timer) } catch {
        // A just-navigated cross-origin popup may reject timer cleanup.
        window.clearTimeout(timer)
      }
    }
  }, [api, attempt, closeReservedPopup, failReservedPopup, navigateOAuthPopup, showPopupStatus])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setPreparingKey(key)
    // A hung RPC must not leave Conectando forever before it returns an id.
    if (pendingBeginTimerRef.current !== undefined) window.clearTimeout(pendingBeginTimerRef.current)
    pendingBeginTimerRef.current = window.setTimeout(() => {
      pendingBeginTimerRef.current = undefined
      setPreparingKey(undefined)
      setFailure('PHOENIX no recibió respuesta del Host de autorización en 15 segundos. Comprueba que el Host está activo y reintenta.')
    }, 15_000)
    setFailure(undefined)
    setAttempt(undefined)
    activeAttemptIdRef.current = undefined
    opened.current.clear()
    oauthAttemptRef.current = method === 'oauth'
    // Reset preparation without opening an empty tab.
    if (method === 'oauth') reserveOAuthPopup()
    else closeReservedPopup()
    void api.begin({ key, method }).then((response) => {
      if (pendingBeginTimerRef.current === undefined) return
      window.clearTimeout(pendingBeginTimerRef.current)
      pendingBeginTimerRef.current = undefined
      setPreparingKey(undefined)
      if (!response.result.ok) {
        if (!navigatedRef.current) failReservedPopup(response.result.error.message)
        setFailure(response.result.error.message)
        return
      }
      activeAttemptIdRef.current = response.result.value.attemptId
      setAttempt({ id: response.result.value.attemptId, key, status: 'pending', nextSeq: 0 })
    }, (error: unknown) => {
      if (pendingBeginTimerRef.current === undefined) return
      window.clearTimeout(pendingBeginTimerRef.current)
      pendingBeginTimerRef.current = undefined
      setPreparingKey(undefined)
      if (!navigatedRef.current) failReservedPopup(String(error))
      setFailure(String(error))
    })
  }

  const submitAnswer = (): void => {
    if (api === undefined || attempt?.prompt === undefined) return
    // Keep client configuration in Phoenix until the provider supplies a URL.
    if (oauthAttemptRef.current) reserveOAuthPopup()
    void api.answer({ attemptId: attempt.id, promptId: attempt.prompt.promptId, value: answer }).then((response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setAnswer('')
      setAttempt((current) => {
        if (current === undefined) return current
        const { prompt: _prompt, ...rest } = current
        return rest
      })
    }, (error: unknown) => { setFailure(String(error)) })
  }

  const cancel = (): void => {
    if (api === undefined || attempt === undefined) return
    setPreparingKey(undefined)
    activeAttemptIdRef.current = undefined
    closeReservedPopup()
    void api.cancel({ attemptId: attempt.id }).then((response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setAttempt((current) => {
        if (current === undefined) return current
        const { prompt: _prompt, ...rest } = current
        return { ...rest, status: 'cancelled' }
      })
    }, (error: unknown) => { setFailure(String(error)) })
  }

  return {
    attempt,
    answer,
    setAnswer,
    failure,
    preparingKey,
    reserveOAuthPopup,
    closeOAuthPopup: closeReservedPopup,
    begin,
    submitAnswer,
    cancel,
  }
}

/**
 * The live progress of one sign-in attempt — notices, consent link, device
 * code, the flow's prompt, and the outcome lines — rendered identically by
 * the account-connections panel and by a provider card mid-sign-in.
 */
export function AuthorizationAttemptProgress(props: {
  attempt: AuthorizationAttempt | undefined
  answer: string
  setAnswer: (value: string) => void
  submitAnswer: () => void
  cancel: () => void
  t: (key: keyof typeof en) => string
}): ReactNode {
  const { attempt } = props
  if (attempt === undefined) return null
  if (attempt.status === 'authorized') {
    return (
      <div
        className={`${styles['authorizationOutcome']} ${styles['authorizationOutcomeSuccess']}`}
        role="status"
        data-authorization-outcome="success"
      >
        <span className={styles['authorizationOutcomeIcon']} aria-hidden="true">✓</span>
        <div className={styles['authorizationOutcomeCopy']}>
          <strong>{props.t('accountConnected')}</strong>
          {attempt.message === undefined ? null : <span>{attempt.message}</span>}
        </div>
      </div>
    )
  }
  if (attempt.status === 'cancelled') {
    return (
      <div
        className={`${styles['authorizationOutcome']} ${styles['authorizationOutcomeNeutral']}`}
        role="status"
        data-authorization-outcome="cancelled"
      >
        <span className={styles['authorizationOutcomeIcon']} aria-hidden="true">×</span>
        <div className={styles['authorizationOutcomeCopy']}>
          <strong>{props.t('authorizationCancelled')}</strong>
        </div>
      </div>
    )
  }
  return (
    <>
      {attempt.message === undefined
        ? attempt.status === 'pending' ? <p role="status">{props.t('signingIn')}</p> : null
        : <p role="status">{attempt.message}</p>}
      {attempt.url === undefined || safeOAuthConsentUrl(attempt.url) === undefined ? null : (
        <p><a href={safeOAuthConsentUrl(attempt.url)} target="_blank" rel="noreferrer">{props.t('openAuthorizationPage')}</a></p>
      )}
      {attempt.code === undefined ? null : <p>{`${props.t('authorizationCode')}: ${attempt.code}`}</p>}
      {attempt.prompt === undefined ? null : (
        <div className={styles['authorizationPrompt']}>
          <label>
            <span>{attempt.prompt.message}</span>
            {attempt.prompt.kind === 'select'
              ? (
                <select
                  className={`${styles['input']} ${styles['selectInput']}`}
                  value={props.answer}
                  onChange={(event) => { props.setAnswer(event.target.value) }}
                >
                  <option value="">{props.t('chooseOption')}</option>
                  {attempt.prompt.options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              )
              : (
                <input
                  type={attempt.prompt.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  value={props.answer}
                  placeholder={attempt.prompt.placeholder}
                  onChange={(event) => { props.setAnswer(event.target.value) }}
                />
              )}
          </label>
          <button type="button" className={styles['secondaryButton']} onClick={props.submitAnswer}>{props.t('continueAuthorization')}</button>
        </div>
      )}
      {attempt.status === 'pending'
        ? <button type="button" className={styles['secondaryButton']} onClick={props.cancel}>{props.t('cancel')}</button>
        : null}
      {attempt.error === undefined ? null : <p className={styles['error']}>{attempt.error}</p>}
    </>
  )
}
