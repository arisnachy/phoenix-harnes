// GenericCommandCard: the default command row — a stripped-down
// GenericToolCard rendering the command name and its settlement text.
// Supplied by the chat view as the keyed commandview slot's render-site
// fallback (an unregistered command name lands here); registrants may compose
// it as a base, feeding the same owner payload through.

import { useState, type ReactNode } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, IconApiOutline14, StateDot } from '@phoenix-ai/dsh-client-ui-primitives'
import a11yCss from './accessibility.module.css'
import { formatStructuredError } from './structured-error.ts'
import css from './GenericCommandCard.module.css'

type CommandRowState = 'running' | 'ok' | 'error'

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandRowState): ReactNode {
  return state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />
}

function structuredBody(text: string): { summary: string; body: string } | undefined {
  const error = formatStructuredError(text)
  if (error === undefined) return undefined
  const lines = [error.title]
  if (error.message !== undefined) lines.push(`Mensaje: ${error.message}`)
  if (error.code !== undefined) lines.push(`Código: ${error.code}`)
  for (const field of error.fields) lines.push(`${field.label}: ${field.value}`)
  if (error.action !== undefined) lines.push(`Qué puedes hacer: ${error.action}`)
  lines.push('', 'JSON original:', error.rawJson)
  return {
    summary: error.message ?? error.title,
    body: lines.join('\n'),
  }
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

export function GenericCommandCard({ node, t, runningSummary }: GenericCommandCardProps) {
  const [expanded, setExpanded] = useState(false)
  const text = node.outcome?.text
  const state = stateOf(node.outcome)
  const structured = state === 'error' && text !== undefined ? structuredBody(text) : undefined
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : structured?.summary ?? text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
  // Title is the bare command name: the row already reads `name · outcome`,
  // and the dispatched line's own `/` and arguments only restate what the
  // settlement text says (`permission · preset workspace-write`). A
  // cross-window node whose run page fell out of the window has no name.
  const title = node.name ?? t('command.title')
  const body = structured?.body ?? (text !== undefined && text.includes('\n') ? text : null)
  const open = expanded && body !== null
  return (
    <div className={css.root} data-variant="others" data-state={state}>
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('row.failed')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state)}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-error={state === 'error' || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.body} data-error={state === 'error' || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
}
