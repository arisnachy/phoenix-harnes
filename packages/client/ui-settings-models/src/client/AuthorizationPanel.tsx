import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import { AuthorizationAttemptProgress, useAuthorizationAttempt } from './authorization-attempt.tsx'
import styles from './ModelsSection.module.css'

type AuthorizationClient = IApiClient['authorization']
interface Entry {
  key: string
  label: string
  methods: Array<{ id: string; label: string }>
  inFlight: boolean
}

export interface AuthorizationPanelProps {
  api?: AuthorizationClient
  t: (key: keyof typeof en) => string
  onAuthorized: () => void
}

/** Account-based provider login. OAuth grants never pass through API-key inputs. */
export function AuthorizationPanel({ api, t, onAuthorized }: AuthorizationPanelProps): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([])
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()
  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } = useAuthorizationAttempt(api, onAuthorized)

  useEffect(() => {
    if (api === undefined) return
    let stale = false
    void api.list({}).then((response) => {
      if (stale) return
      if (!response.result.ok) {
        setCatalogFailure(response.result.error.message)
        return
      }
      setEntries(response.result.value.entries.filter(entry => entry.methods.some(method => method.id === 'oauth')))
    }, (error: unknown) => { if (!stale) setCatalogFailure(String(error)) })
    return () => { stale = true }
  }, [api])

  if (api === undefined || entries.length === 0) return null

  return (
    <section className={styles['authorizationPanel']} aria-label={t('accountConnections')}>
      <h3 className={styles['authorizationTitle']}>{t('accountConnections')}</h3>
      <p className={styles['advancedHint']}>{t('accountConnectionsHint')}</p>
      <div className={styles['authorizationActions']}>
        {entries.map(entry => (
          <button
            key={entry.key}
            type="button"
            className={styles['secondaryButton']}
            disabled={attempt?.status === 'pending' || entry.inFlight}
            onClick={() => { begin(entry.key, 'oauth') }}
          >
            {attempt?.status === 'pending' ? t('signingIn') : `${t('signInWith')} ${entry.label}`}
          </button>
        ))}
      </div>
      <AuthorizationAttemptProgress
        attempt={attempt}
        answer={answer}
        setAnswer={setAnswer}
        submitAnswer={submitAnswer}
        cancel={cancel}
        t={t}
      />
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      {catalogFailure === undefined ? null : <p className={styles['error']}>{catalogFailure}</p>}
    </section>
  )
}
