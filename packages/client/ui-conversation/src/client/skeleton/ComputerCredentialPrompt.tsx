/**
 * Native-only credential card for Computer browser login requests. The card
 * is portaled by Modal and owns all secret state locally; it never uses the
 * composer, session projection, API client, or transcript renderer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button, Modal } from '@phoenix-ai/dsh-client-ui-primitives'
import type { Translate } from '@phoenix-ai/dsh-client-ui-slots'
import type { ConversationKey } from '../locales.ts'
import css from './ComputerCredentialPrompt.module.css'
import {
  postNativeCredentialCancellation, postNativeCredentialResponse, subscribeNativeCredentialRequests,
} from './native-credential-prompt.ts'
import type { NativeCredentialRequest } from './native-credential-prompt.ts'

interface PromptState {
  readonly request: NativeCredentialRequest
  readonly account: string
  readonly secret: string
  readonly remember: boolean
  readonly error: string | undefined
}

/** Props for the native credential prompt. */
export interface ComputerCredentialPromptProps {
  /** Conversation namespace translator supplied by the mounted client locale. */
  readonly t: Translate<ConversationKey>
}

/**
 * Render the temporary native credential prompt, when the WebView2 host asks
 * for one. Secret and request state are cleared on every dismissal path.
 * @returns the modal prompt or null when no native request is pending.
 */
export function ComputerCredentialPrompt({ t }: ComputerCredentialPromptProps): ReactNode {
  const [state, setState] = useState<PromptState | undefined>()
  const stateRef = useRef<PromptState | undefined>(undefined)

  const clear = useCallback(() => {
    stateRef.current = undefined
    setState(undefined)
  }, [])

  const cancel = useCallback(() => {
    const current = stateRef.current
    if (current === undefined) return
    try {
      postNativeCredentialCancellation({
        kind: 'computer-credential-cancelled',
        requestId: current.request.requestId,
        origin: current.request.origin,
      })
    } catch {
      // The native host also expires abandoned requests; cancellation stays silent when
      // the bridge is already unavailable.
    } finally {
      clear()
    }
  }, [clear])

  useEffect(() => subscribeNativeCredentialRequests((request) => {
    const next: PromptState = {
      request,
      account: '',
      secret: '',
      remember: true,
      error: undefined,
    }
    stateRef.current = next
    setState(next)
  }, (dismissal) => {
    const current = stateRef.current
    if (current !== undefined
      && current.request.requestId === dismissal.requestId
      && current.request.origin === dismissal.origin) {
      clear()
    }
  }), [clear])

  const update = useCallback((changes: Partial<Omit<PromptState, 'request'>>) => {
    const current = stateRef.current
    if (current === undefined) return
    const next = { ...current, ...changes }
    stateRef.current = next
    setState(next)
  }, [])

  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const current = stateRef.current
    if (current === undefined) return
    const account = current.account.trim()
    if (account === '' || current.secret === '') {
      update({ error: 'Enter the account and password to continue.' })
      return
    }
    try {
      postNativeCredentialResponse({
        kind: 'computer-credential-response',
        requestId: current.request.requestId,
        origin: current.request.origin,
        account,
        secret: current.secret,
        remember: current.remember,
      })
    } finally {
      // The secret is released even when the native bridge is unavailable or
      // throws while posting; it must not remain in React state after submit.
      clear()
    }
  }, [clear, update])

  const pending = state
  return (
    <Modal
      open={pending !== undefined}
      onClose={cancel}
      title={t('credential.title')}
      closeLabel={t('credential.close')}
      description={t('credential.description')}
      className={css.dialog ?? ''}
      footer={pending === undefined ? undefined : (
        <div className={css.footer}>
          <Button variant="outline" onClick={cancel}>{t('credential.cancel')}</Button>
          <Button variant="primary" type="submit" form="computer-credential-form">{t('credential.continue')}</Button>
        </div>
      )}
    >
      {pending !== undefined && (
        <form id="computer-credential-form" className={css.body} onSubmit={submit}>
          <div className={css.field}>
            <span className={css.label}>{t('credential.website')}</span>
            <code className={css.origin}>{pending.request.origin}</code>
          </div>
          <label className={css.field}>
            <span className={css.label}>{t('credential.account')}</span>
            <input
              className={css.input}
              type="text"
              name="phoenix-account"
              autoComplete="off"
              value={pending.account}
              onChange={(event) => { update({ account: event.currentTarget.value, error: undefined }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('credential.password')}</span>
            <input
              className={css.input}
              type="password"
              name="phoenix-password"
              autoComplete="off"
              value={pending.secret}
              onChange={(event) => { update({ secret: event.currentTarget.value, error: undefined }) }}
            />
          </label>
          <label className={css.remember}>
            <input
              type="checkbox"
              checked={pending.remember}
              onChange={(event) => { update({ remember: event.currentTarget.checked }) }}
            />
            <span>{t('credential.remember')}</span>
          </label>
          <p className={css.hint}>{t('credential.hint')}</p>
          {pending.error !== undefined && <p className={css.error} role="alert">{t('credential.required')}</p>}
        </form>
      )}
    </Modal>
  )
}
