import { memo } from 'react'
import { MarkdownText } from '@phoenix-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import {
  KIRA_ROSTER, kiraTeamSpecialistOf,
} from './KiraTeamsDock.tsx'
import {
  ModelActivityAvatar,
  type ModelAvatarKind,
} from './ModelActivityAvatar.tsx'
import type {
  KiraTeamMessageChatData,
} from '@phoenix-ai/dsh-client-ui-conversation/client'
import { NS, type KiraTeamsKey } from './locales.ts'
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

/** Resolve durable Team names to stable KIRA personas; model ids never become visible identities. */
export function teamIdentityOf(name: string, id: string): TeamIdentity {
  const key = slug(name)
  if (key === 'lead' || key === 'kira') return { name: 'Kira', role: 'Coordinación', kind: 'kira' }
  if (key === 'la-forja' || key === 'forja') return { name: 'La Forja', role: 'Programación', kind: 'atlas' }
  const roster = KIRA_ROSTER.find(agent => slug(agent.name) === key || slug(agent.kind) === key)
  if (roster !== undefined) {
    return {
      name: roster.name,
      role: roster.kind === 'argo' ? 'Verificación' : SKILL_ROLE[roster.skills[0] ?? 'general'] ?? 'Equipo Kira',
      kind: roster.kind,
    }
  }
  const stable = kiraTeamSpecialistOf(name === id || name.trim() === '' ? id : name)
  const kind = stable.kind
  return {
    name: name !== id && name.trim() !== '' && !/^(gpt|claude|gemini|deepseek|luna|sol|terra|mock)[-\d]/u.test(key) ? name : stable.name,
    role: SKILL_ROLE[stable.skills[0] ?? 'general'] ?? 'Equipo Kira',
    kind,
  }
}

const PURPOSE_LABEL: Readonly<Record<NonNullable<KiraTeamMessageChatData['purpose']>, string>> = {
  assignment: 'Asignación',
  question: 'Pregunta',
  blocker: 'Bloqueo',
  result: 'Resultado',
  review: 'Revisión',
  decision: 'Decisión',
  update: 'Actualización',
}

const STATUS_FALLBACK: Partial<Record<KiraTeamsKey, string>> = {
  'status.preparing': 'preparando',
  'status.running': 'trabajando',
  'status.waiting': 'en espera',
  'status.done': 'terminó',
  'status.failed': 'falló',
}

function assignmentStatusKey(status: string | undefined): KiraTeamsKey {
  switch (status?.toLocaleLowerCase()) {
    case 'working':
    case 'running':
    case 'active':
      return 'status.running'
    case 'waiting':
      return 'status.waiting'
    case 'done':
    case 'completed':
    case 'inactive':
    case 'idle':
      return 'status.done'
    case 'failed':
    case 'error':
      return 'status.failed'
    case 'provisioning':
    default:
      return 'status.preparing'
  }
}

function runningStatus(status: string | undefined): boolean {
  return status === 'working' || status === 'running' || status === 'active' || status === 'provisioning'
}

function textOf(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
}

/** Render one actual Agent Teams peer message inside Phoenix's existing chat column. */
type KiraTeamMessageViewProps = PropsRuntime<'conversation.chat.node', 'kira-team-message'> & Partial<PropsLocale<typeof NS>>

export const KiraTeamMessageView = memo(function KiraTeamMessageView({
  node, t, useProjection, messageActions,
}: KiraTeamMessageViewProps) {
  const data: KiraTeamMessageChatData = node.data
  const participants = useProjection('teamChatParticipants') ?? {}
  const identityFor = (name: string, id: string): TeamIdentity => {
    const base = teamIdentityOf(name, id)
    const participant = participants[id]
    return participant === undefined ? base : {
      ...base, name: participant.name,
      kind: KIRA_ROSTER.find(persona => persona.kind === participant.avatar)?.kind ?? base.kind,
    }
  }
  const identity = identityFor(data.senderName, data.senderId)
  const avatar = KIRA_ROSTER.find(persona => persona.kind === data.avatar)?.kind ?? identity.kind
  const sender = data.senderKind === 'user' ? { name: t?.('chat.user') ?? 'User', role: '', kind: 'aurora' as const } : { ...identity, name: data.senderKind === 'kira' ? 'Kira'
    : participants[data.senderId]?.name ?? (data.missionId === undefined ? identity.name : data.senderName), kind: avatar }
  const target = data.targetName === undefined
    ? undefined
    : identityFor(data.targetName, data.targetId)
  const senderStatus = participants[data.senderId]?.status
  const targetStatus = data.purpose === 'assignment'
    ? participants[data.targetId]?.status
    : undefined
  const targetStatusKey = data.purpose === 'assignment' && target !== undefined
    ? assignmentStatusKey(targetStatus)
    : undefined
  const text = textOf(data.content)
  if (text.trim() === '') return null

  return (
    <div className={css.row} data-kira-team-message={data.messageId} data-team-sender-id={data.senderId}>
      <div className={css.avatar}>
        {data.senderKind === 'user' ? <span aria-label="User">👤</span> : <ModelActivityAvatar
          kind={sender.kind}
          activity={undefined}
          running={data.senderKind === 'agent' && runningStatus(senderStatus)}
          pending={data.senderKind === 'agent' && senderStatus === 'provisioning'}
          ready={senderStatus !== 'provisioning'}
          variant="card"
        />}
      </div>
      <div className={css.column}>
        <div className={css.meta}>
          <strong>{sender.name}</strong>
          <span>{(data.role ?? participants[data.senderId]?.role) === undefined ? sender.role
            : t?.((data.role ?? participants[data.senderId]?.role) as import('./locales.ts').KiraTeamsKey) ?? sender.role}</span>
          {data.purpose !== undefined && data.purpose !== 'update' && (
            <span className={css.purpose} data-purpose={data.purpose}>{PURPOSE_LABEL[data.purpose]}</span>
          )}
          {target !== undefined && <span className={css.target}>→ {target.name}</span>}
          {targetStatusKey !== undefined && (
            <span
              className={css.assignmentStatus}
              data-team-target-status={targetStatus ?? 'provisioning'}
              role="status"
            >
              <span className={css.statusDot} aria-hidden="true" />
              {t?.(targetStatusKey) ?? STATUS_FALLBACK[targetStatusKey] ?? targetStatusKey}
            </span>
          )}
        </div>
        {data.pendingDelivery === true && <span role="status">{t?.('chat.pendingDelivery') ?? 'Delivery pending; retry on reconnect'}</span>}
        {data.replyQuote !== undefined && <blockquote>{data.replyQuote}</blockquote>}
        <div className={css.bubble}>
          <MarkdownText text={text} />
        </div>
        {messageActions !== undefined && <div className={css.messageActions}>{messageActions}</div>}
      </div>
    </div>
  )
})
