import { memo } from 'react'
import { MarkdownText } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import {
  KIRA_ROSTER,
} from './KiraTeamsDock.tsx'
import {
  agentAvatarKind,
  ModelActivityAvatar,
  type ModelAvatarKind,
} from './ModelActivityAvatar.tsx'
import type {
  KiraTeamMessageChatData,
  KiraTeamReactionChatData,
} from './team-chat-node.ts'
import css from './TeamChatMessage.module.css'

interface TeamIdentity {
  readonly name: string
  readonly role: string
  readonly kind: ModelAvatarKind
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

const SKILL_ROLE: Readonly<Record<string, string>> = {
  design: 'Diseño',
  product: 'Producto / UX',
  engineering: 'Programación',
  research: 'Investigación',
  knowledge: 'Conocimiento',
  integration: 'Integración',
  data: 'Datos / análisis',
  testing: 'QA / pruebas',
  risk: 'Riesgo / revisión',
  recovery: 'Recuperación / soporte',
  automation: 'Automatización',
  orchestration: 'Coordinación',
  planning: 'Planificación',
  writing: 'Documentación',
  quality: 'Calidad / revisión',
  security: 'Seguridad',
  analysis: 'Análisis',
  browser: 'Navegación / búsqueda',
  performance: 'Rendimiento',
  runtime: 'Monitoreo',
}

function titleCase(value: string): string {
  return value.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

/** Resolve durable Team names to stable KIRA personas; model ids never become visible identities. */
export function teamIdentityOf(name: string, id: string): TeamIdentity {
  const key = slug(name)
  if (key === 'lead' || key === 'kira') return { name: 'Kira', role: 'Coordinación', kind: 'aurora' }
  if (key === 'la-forja' || key === 'forja') return { name: 'La Forja', role: 'Programación', kind: 'atlas' }
  const roster = KIRA_ROSTER.find(agent => slug(agent.name) === key || slug(agent.kind) === key)
  if (roster !== undefined) {
    return {
      name: roster.name,
      role: SKILL_ROLE[roster.skill] ?? 'Equipo Kira',
      kind: roster.kind,
    }
  }
  return {
    name: titleCase(key) || 'Equipo Kira',
    role: 'Equipo Kira',
    kind: agentAvatarKind(id),
  }
}

const REACTION_ICON: Readonly<Record<KiraTeamReactionChatData['reaction'], string>> = {
  ack: '👍',
  agree: '✓',
  insight: '💡',
  blocked: '⚠',
  done: '✅',
}

function textOf(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
}

function ReactionChip({ reaction }: { reaction: KiraTeamReactionChatData }) {
  const identity = teamIdentityOf(reaction.reactorName, reaction.reactorId)
  return (
    <span className={css.reaction} title={`${identity.name}: ${reaction.reaction}`}>
      <span className={css.reactionAvatar}>
        <ModelActivityAvatar
          kind={identity.kind}
          activity={undefined}
          running={false}
          pending={false}
          ready
        />
      </span>
      <span aria-hidden="true">{REACTION_ICON[reaction.reaction]}</span>
    </span>
  )
}

/** Render one actual Agent Teams peer message inside Phoenix's existing chat column. */
export const KiraTeamMessageView = memo(function KiraTeamMessageView({
  node,
}: ChatNodeViewProps<'kira-team-message'>) {
  const data: KiraTeamMessageChatData = node.data
  const sender = teamIdentityOf(data.senderName, data.senderId)
  const target = data.targetName === undefined
    ? undefined
    : teamIdentityOf(data.targetName, data.targetId)
  const text = textOf(data.content)
  if (text.trim() === '') return null

  return (
    <div className={css.row} data-kira-team-message={data.messageId}>
      <div className={css.avatar}>
        <ModelActivityAvatar
          kind={sender.kind}
          activity={undefined}
          running={false}
          pending={false}
          ready
          variant="card"
        />
      </div>
      <div className={css.column}>
        <div className={css.meta}>
          <strong>{sender.name}</strong>
          <span>{sender.role}</span>
          {target !== undefined && <span className={css.target}>→ {target.name}</span>}
        </div>
        <div className={css.bubble}>
          <MarkdownText text={text} />
        </div>
        {data.reactions.length > 0 && (
          <div className={css.reactions} aria-label="Reacciones del equipo">
            {data.reactions.map(item => (
              <ReactionChip key={`${item.reactorId}:${item.reaction}`} reaction={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
