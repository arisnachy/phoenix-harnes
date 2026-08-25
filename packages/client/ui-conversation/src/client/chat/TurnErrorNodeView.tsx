import { memo } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { StructuredErrorView } from './StructuredErrorView.tsx'
import css from './MessageItem.module.css'

/** Terminal turn failures: human explanation first, provider JSON only on demand. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({
  node,
  t,
}: ChatNodeViewProps<'turn-error'>) {
  const data = node.data
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <StructuredErrorView
          message={data.message}
          {...data.code === undefined ? {} : { code: data.code }}
          fallbackClassName={css.turnErrorMessage}
        />
      </div>
      {data.code !== undefined && <code className={css.turnErrorCode}>{data.code}</code>}
    </div>
  )
})
