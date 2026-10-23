/** Provider-emitted reasoning disclosure, independent of tool-call presentation. */
import { useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

// Do not leak an unexpected writing system through a streaming partial: wait
// for the provider to produce a localized explanation instead of pretending to
// translate a private chain of thought. Code/identifiers remain unmodified.
const FOREIGN_SCRIPT = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u0400-\u052f\u0600-\u06ff]/u

/**
 * A model's emitted explanation is displayable only in a supported script.
 * This is a presentation guard, not translation or a language classifier.
 * @param text - Model-emitted content, never a canned explanation.
 * @param locale - Active user-selected locale.
 * @returns Whether the client can display this content without foreign scripts.
 */
export function reasoningMatchesLocale(text: string, locale: string): boolean {
  return locale === 'zh' || !FOREIGN_SCRIPT.test(text)
}

/**
 * Render one provider-emitted reasoning block behind an explicit user toggle.
 * The text is rendered verbatim, never invented or paraphrased by this view.
 * @param props.text - Complete or streaming provider-emitted reasoning content.
 * @param props.running - Whether the block is still streaming.
 * @param props.t - User-selected conversation language.
 * @returns An opt-in reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const [expanded, setExpanded] = useState(false)
  const locale = t('reasoning.localeCode')
  const safeToDisplay = reasoningMatchesLocale(text, locale)
  const visibleText = safeToDisplay ? text.trim() : ''
  const status = !safeToDisplay ? t('reasoning.unavailableLanguage')
    : visibleText === '' ? t('reasoning.pending')
      : running ? t('reasoning.running') : t('reasoning.available')

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
            <span className={css.summary}>{status}</span>
          </>
        )}
      >
        <div className={css.thinkBody} data-reasoning-source="provider">
          {safeToDisplay ? (visibleText || t('reasoning.pending')) : t('reasoning.unavailableLanguage')}
        </div>
      </DisclosureRow>
    </div>
  )
}
