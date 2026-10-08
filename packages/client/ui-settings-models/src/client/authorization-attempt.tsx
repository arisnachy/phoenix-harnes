import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

/** Never navigate to unsafe URLs or provider URLs embedding credentials. */
function safeOAuthConsentUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') return undefined
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href
  } catch {
    // Malformed provider URLs are not navigable.
  }
  return undefined
}

/** A persistent, per-provider authorization attempt shown inside PHOENIX. */
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

const MCP_CONSENT_PREPARATION_WATCHDOG_MS = 50_000
const MCP_AUTHORIZATION_STATUS_POLL_MS = 650
const PREPARATION_FAILURE = 'El MCP no entregó la URL de autorización en 50 segundos. Revisa la configuración OAuth del proveedor y vuelve a intentar.'

/**
 * Run OAuth discovery inside Settings, not in an inert browser tab. Only open
 * an external window after the Host publishes the actual, validated consent URL.
 * If a browser blocks the delayed popup, the card retains a clickable link.
 * Neither a failed Host attempt nor a timeout may disappear silently.
 */
export function useAuthorizationAttempt(
  api: AuthorizationClient | undefined,
  onAuthorized: () => void,
): {
  attempt: AuthorizationAttempt | undefined
  answer: string
  setAnswer: (value: string) => void
  failure: string | undefined
  begin: (key: string, method?: string) => void
  submitAnswer: () => void
  cancel: () => void
} {
  const [attempt, setAttempt] = useState<AuthorizationAttempt | undefined>()
  const [answer, setAnswer] = useState('')
  const [failure, setFailure] = useState<string | undefined>()
  const opened = useRef(new Set<string>())
  const onAuthorizedRef = useRef(onAuthorized)
  useEffect(() => { onAuthorizedRef.current = onAuthorized }, [onAuthorized])

  const openConsent = useCallback((rawUrl: string): void => {
    const destination = safeOAuthConsentUrl(rawUrl)
    if (destination === undefined) {
      setFailure('El proveedor devolvió una URL de autorización inválida o insegura.')
      return
    }
    // A delayed window.open can be refused by popup blockers; never replace
    // the in-card link or cancel the Host attempt when that happens.
    try {
      const popup = window.open(destination, '_blank')
      if (popup === null) {
        setFailure('El navegador bloqueó la apertura automática. Pulsa “Abrir página de autorización” en PHOENIX.')
      } else {
        try { popup.opener = null } catch {
          // Cross-origin browsers may isolate the provider window immediately.
        }
      }
    } catch {
      setFailure('No se abrió automáticamente el proveedor. Pulsa “Abrir página de autorización” en PHOENIX.')
    }
  }, [])

  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending') return
    let stale = false
    const timer = window.setTimeout(() => {
      void api.status({ attemptId: attempt.id, after: attempt.nextSeq }).then((response) => {
        if (stale) return
        if (!response.result.ok) {
          const error = response.result.error.message
          setFailure(error)
          setAttempt(current => current?.id === attempt.id
            ? { ...current, status: 'failed', error } : current)
          return
        }
        const view = response.result.value
        const latest = view.notices.at(-1)?.notice
        const consent = view.notices.findLast(row => row.notice.url !== undefined)?.notice
        const url = consent?.url ?? attempt.url
        const message = latest?.message ?? attempt.message
        const code = view.notices.findLast(row => row.notice.code !== undefined)?.notice.code ?? attempt.code
        if (consent?.url !== undefined && !opened.current.has(consent.url)) {
          opened.current.add(consent.url)
          openConsent(consent.url)
        }
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
        if (view.status === 'authorized') onAuthorizedRef.current()
        if (view.status === 'failed') {
          setFailure(view.error ?? 'No se pudo obtener la autorización del proveedor.')
        }
      }, (error: unknown) => {
        if (stale) return
        const reason = String(error)
        setFailure(reason)
        setAttempt(current => current?.id === attempt.id
          ? { ...current, status: 'failed', error: reason } : current)
      })
    }, MCP_AUTHORIZATION_STATUS_POLL_MS)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [api, attempt, openConsent])

  // Independent of popup timers: when a provider never returns a login URL,
  // expose a persistent error on the connector card and cancel the Host attempt.
  // The watchdog stops for a provider prompt or once consent was published: the
  // person has unlimited time to complete their login at the external provider.
  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending'
      || attempt.url !== undefined || attempt.prompt !== undefined) return
    const id = attempt.id
    const timer = window.setTimeout(() => {
      setFailure(PREPARATION_FAILURE)
      setAttempt(current => current?.id === id && current.status === 'pending'
        ? { ...current, status: 'failed', error: PREPARATION_FAILURE } : current)
      void api.cancel({ attemptId: id }).catch(() => undefined)
    }, MCP_CONSENT_PREPARATION_WATCHDOG_MS)
    return () => { window.clearTimeout(timer) }
  }, [api, attempt?.id, attempt?.status, attempt?.url, attempt?.prompt])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setFailure(undefined)
    setAnswer('')
    opened.current.clear()
    // No about:blank reservation and no /oauth-waiting.html.
    // Keep the provider card visible while the Host prepares its link.
    setAttempt({ id: '', key, status: 'pending', nextSeq: 0,
      message: 'Preparando autorización del proveedor…' })
    void api.begin({ key, method }).then((response) => {
      if (!response.result.ok) {
        const error = response.result.error.message
        setFailure(error)
        setAttempt({ id: '', key, status: 'failed', nextSeq: 0, error })
        return
      }
      setAttempt({ id: response.result.value.attemptId, key, status: 'pending', nextSeq: 0,
        message: 'Preparando autorización del proveedor…' })
    }, (error: unknown) => {
      const reason = String(error)
      setFailure(reason)
      setAttempt({ id: '', key, status: 'failed', nextSeq: 0, error: reason })
    })
  }

  useEffect(() => {
    if (attempt?.status !== 'authorized' && attempt?.status !== 'cancelled') return
    const id = attempt.id
    const timer = window.setTimeout(() => {
      setAttempt(current => current?.id === id ? undefined : current)
    }, attempt.status === 'authorized' ? 4500 : 2500)
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
      setAttempt(current => {
        if (current === undefined) return current
        const { prompt: _prompt, ...rest } = current
        return rest
      })
    }, (error: unknown) => { setFailure(String(error)) })
  }

  const cancel = (): void => {
    if (api === undefined || attempt === undefined || !attempt.id) return
    void api.cancel({ attemptId: attempt.id }).then((response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setAttempt(current => current?.id === attempt.id
        ? { ...current, status: 'cancelled', prompt: undefined } : current)
    }, (error: unknown) => { setFailure(String(error)) })
  }

  return { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel }
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
