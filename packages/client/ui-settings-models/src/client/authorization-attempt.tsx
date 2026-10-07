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
 * Start the Host authorization attempt, then navigate a browser tab straight
 * to the consent URL returned by the Host. Reserving about:blank *inside the
 * click gesture* avoids popup blockers without shipping a waiting page, a
 * postMessage relay, or races between page load and URL delivery.
 */
export function useAuthorizationAttempt(
  api: AuthorizationClient | undefined,
  onAuthorized: () => void,
): {
  attempt: AuthorizationAttempt | undefined
  answer: string
  setAnswer: (value: string) => void
  failure: string | undefined
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
  const opened = useRef(new Set<string>())
  const popupRef = useRef<Window | null>(null)
  const navigatedRef = useRef(false)

  const closeReservedPopup = useCallback((): void => {
    const popup = popupRef.current
    popupRef.current = null
    navigatedRef.current = false
    if (popup === null) return
    try {
      if (!popup.closed) popup.close()
    } catch {
      // Cross-origin isolation can sever a window handle after consent loads.
    }
  }, [])

  const reserveOAuthPopup = useCallback((): void => {
    const current = popupRef.current
    try {
      if (current !== null && !current.closed) return
    } catch {
      // The browser may sever cross-origin WindowProxy references.
    }
    popupRef.current = null
    navigatedRef.current = false
    let popup: Window | null = null
    try { popup = window.open('about:blank', '_blank') } catch {
      // Embedded browsers can reject popups even inside a click gesture.
    }
    popupRef.current = popup
    if (popup === null) {
      setFailure('El navegador bloqueó la pestaña OAuth. Cuando aparezca el enlace, pulsa “Abrir página de autorización” en PHOENIX.')
    }
  }, [])

  const navigateOAuthPopup = useCallback((url: string): void => {
    const destination = safeOAuthConsentUrl(url)
    if (destination === undefined) {
      if (!navigatedRef.current) closeReservedPopup()
      setFailure('El proveedor no entregó una URL de autorización HTTPS válida. Se rechazó la navegación.')
      return
    }
    const popup = popupRef.current
    if (popup !== null) {
      try {
        if (!popup.closed) {
          popup.location.replace(destination)
          navigatedRef.current = true
          return
        }
      } catch {
        // The popup may have been closed or isolated by browser policy.
      }
    }

    // Browsers that block a delayed window.open still receive an explicit
    // hyperlink in the attempt card. Never lose or cancel the Host attempt.
    popupRef.current = null
    navigatedRef.current = false
    let fallback: Window | null = null
    try { fallback = window.open(destination, '_blank') } catch {
      // Manual consent is available on the card.
    }
    popupRef.current = fallback
    navigatedRef.current = fallback !== null
    if (fallback === null) {
      setFailure('No se abrió automáticamente la autorización. Pulsa “Abrir página de autorización” en PHOENIX para continuar.')
    }
  }, [closeReservedPopup])

  useEffect(() => () => { closeReservedPopup() }, [closeReservedPopup])

  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending') return
    let stale = false
    const timer = window.setTimeout(() => {
      // The Host, not the state of a cross-origin WindowProxy, decides success.
      void api.status({ attemptId: attempt.id, after: attempt.nextSeq }).then((response) => {
        if (stale) return
        if (!response.result.ok) {
          if (!navigatedRef.current) closeReservedPopup()
          setAttempt(undefined)
          setFailure(response.result.error.message)
          return
        }
        const view = response.result.value
        const latest = view.notices.at(-1)?.notice
        const consent = view.notices.findLast(item => item.notice.url !== undefined)?.notice
        if (consent?.url !== undefined && !opened.current.has(consent.url)) {
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
          closeReservedPopup()
          onAuthorizedRef.current()
        } else if (view.status === 'cancelled') {
          closeReservedPopup()
        } else if (view.status === 'failed') {
          if (!navigatedRef.current) closeReservedPopup()
          setFailure(view.error ?? 'El proveedor no pudo iniciar OAuth. Comprueba la configuración y vuelve a intentar.')
        }
      }, (error: unknown) => {
        if (stale) return
        if (!navigatedRef.current) closeReservedPopup()
        setAttempt(undefined)
        setFailure(String(error))
      })
    }, 650)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [api, attempt, closeReservedPopup, navigateOAuthPopup])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setFailure(undefined)
    setAttempt(undefined)
    opened.current.clear()
    // Reserve a tab synchronously, independent of which MCP vendor is used.
    if (method === 'oauth') reserveOAuthPopup()
    else closeReservedPopup()
    void api.begin({ key, method }).then((response) => {
      if (!response.result.ok) {
        if (!navigatedRef.current) closeReservedPopup()
        setFailure(response.result.error.message)
        return
      }
      setAttempt({ id: response.result.value.attemptId, key, status: 'pending', nextSeq: 0 })
    }, (error: unknown) => {
      if (!navigatedRef.current) closeReservedPopup()
      setFailure(String(error))
    })
  }

  useEffect(() => {
    if (attempt?.status !== 'authorized' && attempt?.status !== 'cancelled') return
    const timeoutMs = attempt.status === 'authorized' ? 4_500 : 2_500
    const timer = window.setTimeout(() => {
      setAttempt(current => current?.id === attempt.id ? undefined : current)
    }, timeoutMs)
    return () => { window.clearTimeout(timer) }
  }, [attempt?.id, attempt?.status])

  const submitAnswer = (): void => {
    if (api === undefined || attempt?.prompt === undefined) return
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
      {attempt.message === undefined ? null : <p role="status">{attempt.message}</p>}
      {attempt.url === undefined ? null : (
        <p><a href={attempt.url} target="_blank" rel="noreferrer">{props.t('openAuthorizationPage')}</a></p>
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
