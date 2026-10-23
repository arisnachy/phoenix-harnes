/** Verified execution evidence disclosure, kept separate from private model reasoning. */
import { useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

/** User-displayable metadata from a tool call; never contains arguments or results. */
export interface ReasoningEvidence {
  readonly name: string
  readonly state: 'running' | 'success' | 'error'
}

/** Exclude unexpected scripts from technical names in Latin-language interfaces. */
const NON_LATIN_SCRIPT = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u0400-\u052f\u0600-\u06ff]/u

/**
 * Render only observed tool execution metadata and localized status messages.
 * Provider reasoning blocks are not necessarily public summaries, so their raw
 * text must never be passed through to the user-facing DOM.
 * @param props - Logged evidence, running state and locale-resolved labels.
 * @returns A manual, opt-in execution-evidence disclosure.
 */
export function ReasoningRow({ running, t, evidence }: {
  running: boolean
  t: ChatViewSlotProps['t']
  evidence: readonly ReasoningEvidence[]
}) {
  const [expanded, setExpanded] = useState(false)
  const locale = t('reasoning.localeCode')
  const visible = evidence.map(item => ({
    ...item,
    name: locale !== 'zh' && NON_LATIN_SCRIPT.test(item.name)
      ? t('reasoning.toolUnnamed') : item.name,
  }))
  const summary = evidence.length > 0
    ? t('reasoning.toolCount', { count: evidence.length })
    : running ? t('reasoning.running') : t('reasoning.noEvents')

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
        collapsedContent={<><span className={css.separator} aria-hidden /><span className={css.summary}>{summary}</span></>}
      >
        <div className={css.thinkBody} data-reasoning-source="tool-events">
          {visible.length === 0
            ? t('reasoning.noEvents')
            : <ul className={css.evidenceList}>
                {visible.map((item, index) => (
                  <li key={index}>
                    {item.name} · {t(item.state === 'running'
                      ? 'reasoning.toolRunning'
                      : item.state === 'error' ? 'reasoning.toolFailed' : 'reasoning.toolDone')}
                  </li>
                ))}
              </ul>}
          <p className={css.evidenceNotice}>{t('reasoning.evidenceNotice')}</p>
        </div>
      </DisclosureRow>
    </div>
  )
}
