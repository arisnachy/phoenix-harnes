/** Active KIRA Team mention picker surfaced while the composer ends in an @token. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { TeamChatParticipant } from '@phoenix-ai/dsh-agent-team/chat-types'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import {
  activeTeamDesign,
  parseTeamDesignDocument,
  type TeamDesign,
  type TeamDesignSettingsEnvelope,
} from '@phoenix-ai/dsh-agent-team/design-types'
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

function mentionRowOf(participant: TeamChatParticipant, team: TeamDesign): MentionRow {
  const identity = teamIdentityOf(participant.name, participant.id)
  const designed = team.members.find(person => person.id === identity.kind)
  const lead = identity.kind === 'kira' ? team.lead : undefined
  const profile = designed ?? lead
  return {
    id: participant.id,
    name: profile?.displayName ?? identity.name,
    role: profile?.role || participant.role || identity.role,
    status: participant.status,
    avatar: profile?.avatar ?? KIRA_ROSTER.find(persona => persona.kind === participant.avatar)?.kind ?? identity.kind,
  }
}

export interface TeamMentionDockInjected {
  readonly setDraft: (draft: string) => void
  readonly hooks: { teamDesign: SettingsScope<TeamDesignSettingsEnvelope> }
}

type Props = PropsRuntime<'conversation.input.dock'> & InjectFace<TeamMentionDockInjected> & PropsLocale<typeof NS>

/** Suggest Kira and currently active teammates for a trailing @ mention. */
export function TeamMentionDock({ input, sessionId, useProjection, useTeamDesign, setDraft, t }: Props) {
  const designSnapshot = useTeamDesign(value => value)
  const team = activeTeamDesign(parseTeamDesignDocument(designSnapshot.value?.document))
  const query = mentionQueryOf(input.draft)
  const participants = useProjection('teamChatParticipants') ?? {}
  if (query === undefined) return null

  const leadId = String(sessionId)
  const rows = Object.values(participants)
    .filter(activeParticipant)
    .map(person => mentionRowOf(person, team))
  if (!rows.some(row => row.id === leadId || row.name.toLocaleLowerCase() === team.lead.displayName.toLocaleLowerCase())) {
    rows.unshift({
      id: leadId,
      name: team.lead.displayName,
      role: team.lead.role || t('skill.orchestration'),
      status: 'running',
      avatar: team.lead.avatar,
    })
  }
  const filtered = rows
    .filter((row, index, all) => all.findIndex(candidate => candidate.name.toLocaleLowerCase() === row.name.toLocaleLowerCase()) === index)
    .filter(row => query.text === '' || row.name.toLocaleLowerCase().includes(query.text))
    .sort((left, right) => left.id === leadId ? -1 : right.id === leadId ? 1 : left.name.localeCompare(right.name))
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
            <ModelActivityAvatar kind={row.avatar} activity={undefined} running={row.status === 'running'} pending={row.status === 'provisioning'} ready />
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
