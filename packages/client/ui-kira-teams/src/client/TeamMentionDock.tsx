/** Active KIRA Team mention picker surfaced while the composer ends in an @token. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { TeamChatParticipant } from '@phoenix-ai/dsh-agent-team/chat-types'
import { KIRA_ROSTER } from './KiraTeamsDock.tsx'
import { ModelActivityAvatar } from './ModelActivityAvatar.tsx'
import { teamIdentityOf } from './TeamChatMessage.tsx'
import { NS } from './locales.ts'
import css from './TeamChatMessage.module.css'
import { useLivingTeamNames, teamVisibleName } from './team-customization-react.ts'

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
  const names = useLivingTeamNames()
  const query = mentionQueryOf(input.draft)
  const participants = useProjection('teamChatParticipants') ?? {}
  if (query === undefined) return null

  const rows = Object.values(participants)
    .filter(activeParticipant)
    .map(mentionRowOf)
    .map(row => ({ ...row, name: teamVisibleName(names, row.avatar, row.name) }))
  if (!rows.some(row => row.avatar === 'kira')) {
    rows.unshift({
      id: String(sessionId),
      name: teamVisibleName(names, 'kira', 'Kira'),
      role: t('skill.orchestration'),
      status: 'running',
      avatar: 'kira',
    })
  }
  const companionName = 'Finix'
  const showFinix = input.draft.slice(0, query.start).trim() === '' && (query.text === '' || [companionName, 'finix', 'fénix', 'phoenix'].some(name => name.toLocaleLowerCase().includes(query.text)))
  const filtered = rows
    .filter((row, index, all) => all.findIndex(candidate => candidate.name.toLocaleLowerCase() === row.name.toLocaleLowerCase()) === index)
    .filter(row => query.text === '' || row.name.toLocaleLowerCase().includes(query.text))
    .sort((left, right) => left.avatar === 'kira' ? -1 : right.avatar === 'kira' ? 1 : left.name.localeCompare(right.name))
    .slice(0, 8)
  if (filtered.length === 0 && !showFinix) return null

  const choose = (name: string): void => {
    const token = name.includes(' ') ? `@"${name}"` : `@${name}`
    setDraft(`${input.draft.slice(0, query.start)}${token} `)
  }

  return (
    <div className={css.mentionMenu} data-team-mention-picker role="listbox" aria-label={t('dock.title')}>
      {showFinix && <button type="button" className={css.mentionRow} role="option" aria-label="@Finix" onMouseDown={event => event.preventDefault()} onClick={() => choose('finix')}>
        <span className={css.mentionAvatar}><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path fill="#f68b2c" d="M9 10Q3 4 8 3L13 7Q13 0 18 2L19 7Q25 2 26 5L24 11Q30 17 25 24Q16 32 7 24Q1 19 9 10Z"/><ellipse cx="16" cy="19" rx="10" ry="9" fill="#ffe7bd"/><circle cx="12" cy="15" r="3" fill="#67412c"/><circle cx="20" cy="15" r="3" fill="#67412c"/><path fill="#f69b27" d="m12 21 4 4 4-4-4-2Z"/></svg></span><span className={css.mentionCopy}><strong>{companionName}</strong><span>Compañero autónomo local</span></span>
      </button>}
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
