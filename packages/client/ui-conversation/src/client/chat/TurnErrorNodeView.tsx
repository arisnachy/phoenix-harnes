import { memo, useEffect, useState } from 'react'
import { StateDot } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { CodexAuthRecovery, isCodexAuthFailure } from './CodexAuthRecovery.tsx'
import { StructuredErrorView } from './StructuredErrorView.tsx'
import css from './MessageItem.module.css'

/** Terminal turn failures: offer actual native ChatGPT sign-in for Codex auth loss. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({
  node,
  t,
  getCodexAuthorization,
}: ChatNodeViewProps<'turn-error'>) {
  const data = node.data
  const codexFailure = isCodexAuthFailure(data.code, data.message)
  const [authOpen, setAuthOpen] = useState(false)
  // Only credential failures launch a recovery dialog; ordinary provider errors
  // remain visible in the transcript without an intrusive modal.
  useEffect(() => {
    if (codexFailure) setAuthOpen(true)
  }, [codexFailure, node.key])

  return (
    <>
      <div className={css.turnErrorRow} role="status">
        <StateDot state="error" className={css.turnErrorDot} />
        <div className={css.turnErrorCopy}>
          <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
          <StructuredErrorView
            message={data.message}
            {...data.code === undefined ? {} : { code: data.code }}
            fallbackClassName={css.turnErrorMessage}
          />
          {codexFailure ? (
            <button type="button" className={css['codexAuthButton']} onClick={() => { setAuthOpen(true) }}>
              Autenticar Codex
            </button>
          ) : null}
        </div>
        {data.code !== undefined && <code className={css.turnErrorCode}>{data.code}</code>}
      </div>
      {codexFailure ? (
        <CodexAuthRecovery
          api={getCodexAuthorization?.()}
          open={authOpen}
          onClose={() => { setAuthOpen(false) }}
        />
      ) : null}
    </>
  )
})
