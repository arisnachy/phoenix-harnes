import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

function oauthWaitingPageUrl(): string {
  const url = new URL('/oauth-waiting.html', window.location.href)
  // Cache-bust the tiny bridge page: an older cached copy has no navigation
  // listener and would strand the user on "Preparando autorización…".
  url.searchParams.set('v', '20261007-1')
  return url.href
}

type OAuthWaitingMessage =
  | { type: 'phoenix/oauth-navigate'; url: string }
  | { type: 'phoenix/oauth-status'; message: string; state?: 'waiting' | 'error' }

function postOAuthWaitingMessage(popup: Window, message: OAuthWaitingMessage): void {
  try {
    popup.postMessage(message, window.location.origin)
  } catch {
    // The reserved page may already be navigating cross-origin. The provider
    // page is then authoritative and must not be interrupted.
  }
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
 * The state machine behind one sign-in flow, shared by the account-connections
 * panel and the per-provider cards: begin an attempt, poll it while pending,
 * surface notices (auto-opening the consent page once), answer prompts, cancel.
 * Neither business rejections nor transport failures may reach the browser as
 * unhandled rejections — both land in `failure` for the caller to render.
 * @param api - the authorization wire face, absent when the deployment mounts none.
 * @param onAuthorized - called once when an attempt reaches `authorized`.
 * @returns the live attempt plus the actions that drive it.
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
  const pendingPopupNavigation = useRef<string | undefined>(undefined)
  const pendingPopupStatus = useRef<{ message: string; state: 'waiting' | 'error' } | undefined>(undefined)

  const closeReservedPopup = useCallback((): void => {
    const popup = popupRef.current
    popupRef.current = null
    pendingPopupNavigation.current = undefined
    pendingPopupStatus.current = undefined
    if (popup === null) return
    try {
      if (!popup.closed) popup.close()
    } catch {
      // Cross-origin isolation may revoke access to a provider window. The
      // authorization attempt itself remains authoritative.
    }
  }, [])

  const reserveOAuthPopup = useCallback((): void => {
    const current = popupRef.current
    try {
      if (current !== null && !current.closed) return
    } catch {
      popupRef.current = null
    }
    let popup: Window | null = null
    try { popup = window.open(oauthWaitingPageUrl(), '_blank') } catch {
      // Embedded browsers may throw instead of returning null for blocked windows.
    }
    popupRef.current = popup
    if (popup !== null) return
    setFailure('El navegador bloqueó la ventana de autorización. PHOENIX seguirá preparando el enlace; usa “Abrir página de autorización” cuando aparezca.')
  }, [])

  const showOAuthPopupStatus = useCallback((message: string, state: 'waiting' | 'error' = 'waiting'): void => {
    pendingPopupStatus.current = { message, state }
    const popup = popupRef.current
    if (popup === null) return
    try {
      if (popup.closed) return
      postOAuthWaitingMessage(popup, { type: 'phoenix/oauth-status', message, state })
    } catch {
      // The window can become cross-origin after provider navigation.
    }
  }, [])

  const navigateOAuthPopup = useCallback((url: string): void => {
    pendingPopupNavigation.current = url
    const popup = popupRef.current
    if (popup !== null) {
      try {
        if (!popup.closed) {
          // The same-origin waiting page can navigate itself even when the
          // opener is no longer allowed to assign popup.location because of
          // COOP/browser hardening. Send first, then keep location.replace as
          // a fast-path for browsers that permit it.
          postOAuthWaitingMessage(popup, { type: 'phoenix/oauth-navigate', url })
          try {
            popup.location.replace(url)
          } catch {
            // The message bridge is the primary recovery path.
          }
          // A consent URL can arrive before oauth-waiting.html finishes loading;
          // messages are not buffered. Retry briefly so the page's listener
          // cannot miss the hand-off.
          for (const delay of [80, 240, 700]) {
            window.setTimeout(() => {
              try {
                if (!popup.closed) postOAuthWaitingMessage(popup, { type: 'phoenix/oauth-navigate', url })
              } catch {
                // Already cross-origin/navigated or closed.
              }
            }, delay)
          }
          return
        }
      } catch {
        // COOP/cross-origin policies can sever the reserved Window handle.
      }
      popupRef.current = null
    }
    let fallback: Window | null = null
    try { fallback = window.open(url, '_blank') } catch {
      // Preserve the Host attempt and manual consent link when automatic opening fails.
    }
    popupRef.current = fallback
    if (fallback === null) {
      setFailure('No pude abrir automáticamente la página del proveedor. Pulsa “Abrir página de autorización” en esta tarjeta para continuar.')
    }
  }, [])

  useEffect(() => {
    const handleWaitingReady = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin) return
      const popup = popupRef.current
      if (popup === null || event.source !== popup) return
      const data = event.data
      if (data === null || typeof data !== 'object'
        || !('type' in data) || data.type !== 'phoenix/oauth-ready') return

      const status = pendingPopupStatus.current
      if (status !== undefined) {
        postOAuthWaitingMessage(popup, {
          type: 'phoenix/oauth-status',
          message: status.message,
          state: status.state,
        })
      }
      const url = pendingPopupNavigation.current
      if (url !== undefined) {
        postOAuthWaitingMessage(popup, { type: 'phoenix/oauth-navigate', url })
      }
    }
    window.addEventListener('message', handleWaitingReady)
    return () => { window.removeEventListener('message', handleWaitingReady) }
  }, [])

  useEffect(() => () => { closeReservedPopup() }, [closeReservedPopup])

  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending') return
    let stale = false
    const timer = window.setTimeout(() => {
      // Cross-origin isolation can report an open consent window as closed.
      // Only the provider outcome or explicit Cancel ends authorization.
      void api.status({ attemptId: attempt.id, after: attempt.nextSeq }).then((response) => {
        if (stale) return
        if (!response.result.ok) {
          showOAuthPopupStatus(response.result.error.message, 'error')
          setAttempt(undefined)
          setFailure(response.result.error.message)
          return
        }
        const view = response.result.value
        const latest = view.notices.at(-1)?.notice
        const consent = view.notices.findLast(item => item.notice.url !== undefined)?.notice
        if (latest?.message !== undefined && consent?.url === undefined && attempt.url === undefined) {
          showOAuthPopupStatus(latest.message)
        }
        if (view.prompt !== undefined && consent?.url === undefined && attempt.url === undefined) {
          showOAuthPopupStatus('Completa el dato solicitado en PHOENIX. Esta pestaña continuará automáticamente.')
        }
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
          showOAuthPopupStatus(view.error ?? 'La autorización no pudo iniciarse. Revisa PHOENIX para ver el error.', 'error')
        }
      }, (error: unknown) => {
        if (stale) return
        showOAuthPopupStatus(String(error), 'error')
        setAttempt(undefined)
        setFailure(String(error))
      })
    }, 650)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [api, attempt, closeReservedPopup, navigateOAuthPopup, showOAuthPopupStatus])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setFailure(undefined)
    setAttempt(undefined)
    opened.current.clear()
    pendingPopupNavigation.current = undefined
    pendingPopupStatus.current = undefined
    // Notion prepares in its Settings card and opens only the provider URL.
    // Other OAuth flows keep a real same-origin PHOENIX page opened synchronously inside
    // the click gesture so popup blockers allow the later provider navigation.
    // Never reserve about:blank: the user should always see a real PHOENIX URL
    // while discovery is still in progress.
    const isNotion = /^mcp-client\/notion(?:-|$)/u.test(key)
    if (method === 'oauth' && !isNotion) reserveOAuthPopup()
    else closeReservedPopup()
    void api.begin({ key, method }).then((response) => {
      if (!response.result.ok) {
        showOAuthPopupStatus(response.result.error.message, 'error')
        setFailure(response.result.error.message)
        return
      }
      setAttempt({ id: response.result.value.attemptId, key, status: 'pending', nextSeq: 0 })
    }, (error: unknown) => {
      showOAuthPopupStatus(String(error), 'error')
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
