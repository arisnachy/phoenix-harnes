import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']

/** One browser-visible authorization attempt, carrying its last notice forward. */
export interface AuthorizationAttempt {
  id: string
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
  begin: (key: string, method?: string) => void
  submitAnswer: () => void
  cancel: () => void
} {
  const [attempt, setAttempt] = useState<AuthorizationAttempt | undefined>()
  const [answer, setAnswer] = useState('')
  const [failure, setFailure] = useState<string | undefined>()
  const opened = useRef(new Set<string>())

  useEffect(() => {
    if (api === undefined || attempt?.status !== 'pending') return
    let stale = false
    const timer = window.setTimeout(() => {
      void api.status({ attemptId: attempt.id, after: attempt.nextSeq }).then((response) => {
        if (stale) return
        if (!response.result.ok) {
          setFailure(response.result.error.message)
          return
        }
        const view = response.result.value
        const latest = view.notices.at(-1)?.notice
        if (latest?.url !== undefined && !opened.current.has(latest.url)) {
          opened.current.add(latest.url)
          window.open(latest.url, '_blank', 'noopener,noreferrer')
        }
        const message = latest?.message ?? attempt.message
        const url = latest?.url ?? attempt.url
        const code = latest?.code ?? attempt.code
        setAttempt({
          id: view.attemptId,
          status: view.status,
          nextSeq: view.nextSeq,
          ...message === undefined ? {} : { message },
          ...url === undefined ? {} : { url },
          ...code === undefined ? {} : { code },
          ...view.prompt === undefined ? {} : { prompt: view.prompt },
          ...view.error === undefined ? {} : { error: view.error },
        })
        if (view.status === 'authorized') onAuthorized()
      }, (error: unknown) => { if (!stale) setFailure(String(error)) })
    }, 650)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [api, attempt, onAuthorized])

  const begin = (key: string, method = 'oauth'): void => {
    if (api === undefined) return
    setFailure(undefined)
    setAttempt(undefined)
    void api.begin({ key, method }).then((response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setAttempt({ id: response.result.value.attemptId, status: 'pending', nextSeq: 0 })
    }, (error: unknown) => { setFailure(String(error)) })
  }

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
    void api.cancel({ attemptId: attempt.id }).finally(() => {
      setAttempt((current) => {
        if (current === undefined) return current
        const { prompt: _prompt, ...rest } = current
        return { ...rest, status: 'cancelled' }
      })
    })
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
      {attempt.status === 'authorized' ? <p role="status">{props.t('accountConnected')}</p> : null}
      {attempt.status === 'cancelled' ? <p role="status">{props.t('authorizationCancelled')}</p> : null}
      {attempt.error === undefined ? null : <p className={styles['error']}>{attempt.error}</p>}
    </>
  )
}
