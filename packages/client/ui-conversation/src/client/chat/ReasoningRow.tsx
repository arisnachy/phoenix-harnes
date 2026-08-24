/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text: _text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  // Auto choreography: the block opens while it streams and collapses when the
  // phase ends; a manual toggle wins until the next streaming transition.
  const [expanded, setExpanded] = useState(running)
  const prevRunningRef = useRef(running)
  useEffect(() => {
    if (prevRunningRef.current === running) return
    prevRunningRef.current = running
    setExpanded(running)
  }, [running])
  // Raw chain-of-thought is intentionally never rendered. It is not a reliable
  // user-facing language surface and exposing it would leak internal deliberation.
  const summary = running ? t('reasoning.running') : t('reasoning.hidden')

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('reasoning.runningA11y')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('reasoning.title')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{t('reasoning.body')}</div>
      </DisclosureRow>
    </div>
  )
}
