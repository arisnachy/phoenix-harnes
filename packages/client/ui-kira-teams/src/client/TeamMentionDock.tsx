/** Active KIRA Team mention picker surfaced while the composer ends in an @token. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { TeamChatParticipant } from '@phoenix-ai/dsh-agent-team/chat-types'
import { KIRA_ROSTER } from './KiraTeamsDock.tsx'
import { ModelActivityAvatar } from './ModelActivityAvatar.tsx'
import { teamIdentityOf } from './TeamChatMessage.tsx'
import { NS } from './locales.ts'
import css from './TeamChatMessage.module.css'

const INACTIVE = new Set(['done', 'completed', 'failed', 'inactive', 'idle'])

interface MentionQuery {
  readonly start: number
  readonly text: string
}

interface MentionRow {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: string
  readonly avatar: (typeof KIRA_ROSTER)[number]['kind']
}

function mentionQueryOf(draft: string): MentionQuery | undefined {
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(draft)
  if (match === null) return undefined
  return {
    start: match.index + (match[1]?.length ?? 0),
    text: (match[2] ?? '').toLocaleLowerCase(),
  }
}

function activeParticipant(participant: TeamChatParticipant): boolean {
  return !INACTIVE.has(participant.status.trim().toLocaleLowerCase())
}

function mentionRowOf(participant: TeamChatParticipant): MentionRow {
  const identity = teamIdentityOf(participant.name, participant.id)
  return {
    id: participant.id,
    name: identity.name,
    role: participant.role || identity.role,
    status: participant.status,
    avatar: KIRA_ROSTER.find(persona => persona.kind === participant.avatar)?.kind ?? identity.kind,
  }
}

export interface TeamMentionDockInjected {
  readonly setDraft: (draft: string) => void
}

type Props = PropsRuntime<'conversation.input.dock'> & InjectFace<TeamMentionDockInjected> & PropsLocale<typeof NS>

/** Suggest Kira and currently active teammates for a trailing @ mention. */
export function TeamMentionDock({ input, sessionId, useProjection, setDraft, t }: Props) {
  const query = mentionQueryOf(input.draft)
  const participants = useProjection('teamChatParticipants') ?? {}
  if (query === undefined) return null

  const rows = Object.values(participants)
    .filter(activeParticipant)
    .map(mentionRowOf)
  if (!rows.some(row => row.name.toLocaleLowerCase() === 'kira')) {
    rows.unshift({
      id: String(sessionId),
      name: 'Kira',
      role: t('skill.orchestration'),
      status: 'running',
      avatar: 'kira',
    })
  }
  const filtered = rows
    .filter((row, index, all) => all.findIndex(candidate => candidate.name.toLocaleLowerCase() === row.name.toLocaleLowerCase()) === index)
    .filter(row => query.text === '' || row.name.toLocaleLowerCase().includes(query.text))
    .sort((left, right) => left.name === 'Kira' ? -1 : right.name === 'Kira' ? 1 : left.name.localeCompare(right.name))
    .slice(0, 8)
  if (filtered.length === 0) return null

  const choose = (name: string): void => {
    const token = name.includes(' ') ? `@"${name}"` : `@${name}`
    setDraft(`${input.draft.slice(0, query.start)}${token} `)
  }

  return (
    <div className={css.mentionMenu} data-team-mention-picker role="listbox" aria-label={t('dock.title')}>
      {filtered.map(row => (
        <button
          type="button"
          key={row.id}
          className={css.mentionRow}
          role="option"
          aria-label={`@${row.name}`}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={() => { choose(row.name) }}
        >
          <span className={css.mentionAvatar}>
            <ModelActivityAvatar kind={row.avatar} activity={undefined} running pending={false} ready />
          </span>
          <span className={css.mentionCopy}>
            <strong>{row.name}</strong>
            <span>{row.role}</span>
          </span>
          <span className={css.mentionStatus} title={row.status} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
