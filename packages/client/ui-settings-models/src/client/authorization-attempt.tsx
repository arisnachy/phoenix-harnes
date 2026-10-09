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


/** Translate a failed Host-start transport into an actionable, local-safe message. */
function authorizationBeginFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError'
    || /(?:timed? out|timeout|operation was aborted due to timeout)/i.test(error.message))) {
    return 'El Host de PHOENIX no respondió a authorization.begin en 12 segundos. Comprueba que la actualización está activa y revisa el registro del Host; todavía no se ha llegado a Notion.'
  }
  if (error instanceof Error && /(?:failed to fetch|networkerror|econnrefused|connection refused)/i.test(error.message)) {
    return 'PHOENIX perdió la conexión con el Host al iniciar OAuth. Comprueba que el servidor local 127.0.0.1:3080 sigue funcionando.'
  }
  return String(error)
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
  lastAttemptKey: string | undefined
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
  const [lastAttemptKey, setLastAttemptKey] = useState<string | undefined>()
  const opened = useRef(new Set<string>())
  const popupRef = useRef<Window | null>(null)
  const navigatedRef = useRef(false)
  const popupTimeoutRef = useRef<(() => void) | undefined>(undefined)
  const oauthAttemptRef = useRef(false)
  const failedPopupRef = useRef(false)
  const activeAttemptIdRef = useRef<string | undefined>(undefined)
  const pendingBeginTimerRef = useRef<number | undefined>(undefined)
  const consentDeadlineRef = useRef<number | undefined>(undefined)
  const beginSequenceRef = useRef(0)

  const clearConsentDeadline = useCallback((): void => {
    if (consentDeadlineRef.current !== undefined) {
      window.clearTimeout(consentDeadlineRef.current)
      consentDeadlineRef.current = undefined
    }
  }, [])

  const closeReservedPopup = useCallback((): void => {
    popupTimeoutRef.current?.()
    popupTimeoutRef.current = undefined
    const popup = popupRef.current
    popupRef.current = null
    navigatedRef.current = false
    failedPopupRef.current = false
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
    clearConsentDeadline()
    setFailure(message)
  }, [clearConsentDeadline])

  // OAuth discovery, client registration and API prompts run within PHOENIX.
  // Do NOT open oauth-waiting.html or about:blank: those tabs are misleading
  // when the MCP never supplies a provider consent URL.
  const reserveOAuthPopup = useCallback((): void => {
    if (!navigatedRef.current) closeReservedPopup()
    setFailure(undefined)
  }, [closeReservedPopup])

  const navigateOAuthPopup = useCallback((url: string): void => {
    const destination = safeOAuthConsentUrl(url)
    if (destination === undefined) {
      failReservedPopup('El servidor MCP no proporcionó una URL HTTPS válida para autorizar.')
      return
    }
    popupTimeoutRef.current?.()
    popupTimeoutRef.current = undefined
    clearConsentDeadline()
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
  }, [clearConsentDeadline, failReservedPopup])


  useEffect(() => () => {
    if (pendingBeginTimerRef.current !== undefined) window.clearTimeout(pendingBeginTimerRef.current)
    clearConsentDeadline()
    // Unmounting Settings must not close an already-open provider consent page.
    // Only discard the blank reservation when the user has not navigated yet.
    if (!navigatedRef.current) closeReservedPopup()
  }, [clearConsentDeadline, closeReservedPopup])

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
          // Provider/client credentials can take minutes to enter. Do not
          // apply the OAuth discovery timeout while waiting for user input.
          clearConsentDeadline()
          closeReservedPopup()
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
          clearConsentDeadline()
          activeAttemptIdRef.current = undefined
          closeReservedPopup()
          onAuthorizedRef.current()
        } else if (view.status === 'cancelled') {
          clearConsentDeadline()
          activeAttemptIdRef.current = undefined
          if (!failedPopupRef.current) closeReservedPopup()
        } else if (view.status === 'failed') {
          clearConsentDeadline()
          activeAttemptIdRef.current = undefined
          const reason = view.error ?? (oauthAttemptRef.current
            ? 'El proveedor no pudo iniciar OAuth. Comprueba la configuración y vuelve a intentar.'
            : 'La configuración de credenciales falló. Comprueba la clave y vuelve a intentar.')
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
  }, [api, attempt, clearConsentDeadline, closeReservedPopup, failReservedPopup, navigateOAuthPopup])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setPreparingKey(key)
    setLastAttemptKey(key)
    const beginSequence = ++beginSequenceRef.current
    clearConsentDeadline()
    // A hung RPC must not leave Conectando forever before it returns an id.
    if (pendingBeginTimerRef.current !== undefined) window.clearTimeout(pendingBeginTimerRef.current)
    pendingBeginTimerRef.current = window.setTimeout(() => {
      if (beginSequenceRef.current !== beginSequence) return
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
    // Initial authorization has a dedicated network deadline in ApiClient.
    // User consent stays pending after this initial response.
    void api.begin({ key, method }).then((response) => {
      if (beginSequenceRef.current !== beginSequence || pendingBeginTimerRef.current === undefined) {
        if (response.result.ok) void api.cancel({ attemptId: response.result.value.attemptId }).catch(() => undefined)
        return
      }
      window.clearTimeout(pendingBeginTimerRef.current)
      pendingBeginTimerRef.current = undefined
      setPreparingKey(undefined)
      if (!response.result.ok) {
        if (!navigatedRef.current) failReservedPopup(response.result.error.message)
        setFailure(response.result.error.message)
        return
      }
      const attemptId = response.result.value.attemptId
      activeAttemptIdRef.current = attemptId
      // The Host normally returns a diagnostic after 38 s. A local deadline
      // also covers a lost/hung status RPC, never leaving a silent spinner.
      if (method === 'oauth') {
        consentDeadlineRef.current = window.setTimeout(() => {
          if (activeAttemptIdRef.current !== attemptId || navigatedRef.current) return
          const message = 'El MCP no entregó una URL OAuth en 45 segundos. Comprueba el estado de conexión y los requisitos de autenticación del proveedor.'
          activeAttemptIdRef.current = undefined
          failReservedPopup(message)
          setAttempt(current => current?.id === attemptId
            ? { ...current, status: 'failed', error: message }
            : current)
          void api.cancel({ attemptId }).catch(() => undefined)
        }, 45_000)
      }
      setAttempt({ id: attemptId, key, status: 'pending', nextSeq: 0 })
    }, (error: unknown) => {
      if (beginSequenceRef.current !== beginSequence || pendingBeginTimerRef.current === undefined) return
      window.clearTimeout(pendingBeginTimerRef.current)
      pendingBeginTimerRef.current = undefined
      setPreparingKey(undefined)
      const reason = authorizationBeginFailure(error)
      if (!navigatedRef.current) failReservedPopup(reason)
      setFailure(reason)
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
    clearConsentDeadline()
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
    lastAttemptKey,
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
