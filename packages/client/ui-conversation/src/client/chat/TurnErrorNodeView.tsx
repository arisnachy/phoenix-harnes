import { memo } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { parseStructuredFailure } from './structured-error.ts'
import css from './TurnErrorNodeView.module.css'

/**
 * Terminal failure card: concise human explanation first, complete provider
 * JSON only on demand. The original payload remains visible for debugging and
 * support without dominating the conversation transcript.
 */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({
  node, t,
}: ChatNodeViewProps<'turn-error'>) {
  const failure = parseStructuredFailure(node.data.message, node.data.code)

  return (
    <section className={css.card} role="status" aria-live="polite">
      <header className={css.header}>
        <StateDot state="error" className={css.dot} />
        <strong className={css.title}>{t('message.turnError')}</strong>
        {failure.provider !== undefined && <span className={css.provider}>{failure.provider}</span>}
        {failure.code !== undefined && <code className={css.code}>{failure.code}</code>}
      </header>

      <div className={css.summary}>{failure.summary}</div>
      {failure.remedy !== undefined && <div className={css.remedy}>{failure.remedy}</div>}

      {failure.structured && failure.prettyJson !== undefined && (
        <details className={css.raw}>
          <summary className={css.rawSummary}>Ver JSON original</summary>
          <pre className={css.rawJson}>{failure.prettyJson}</pre>
        </details>
      )}
    </section>
  )
})
