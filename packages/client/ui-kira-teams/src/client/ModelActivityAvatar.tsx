import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import type { KiraPortraitKey } from './KiraAgentPortraits.ts'
import { KIRA_MODERN_STILL_PORTRAITS } from './KiraModernStillPortraits.ts'
import css from './ModelActivityAvatar.module.css'
/** Deprecated animation props remain accepted for existing callers; portraits stay still. */
type AvatarExpression = 'neutral' | 'warm' | 'focused' | 'happy' | 'concerned' | 'confident'
type AvatarMotion = 'auto' | 'off'

/** Exact visible identities from the user-approved 20-avatar KIRA reference. */
export type ModelAvatarKind =
  | 'kira' | 'sol' | 'luna' | 'terra' | 'generic'
  | 'vortice' | 'aurora' | 'atlas' | 'nova' | 'lumen'
  | 'helix' | 'prisma' | 'orion' | 'vega' | 'eclipse'
  | 'argo' | 'solaria' | 'nexo' | 'astra' | 'lyra'
  | 'zenith' | 'cobalto' | 'quasar' | 'senda' | 'orbita'

type PortraitKey = KiraPortraitKey

/** Stable persona order shared with the approved 5×4 KIRA roster. */
const AGENT_AVATAR_KINDS: readonly PortraitKey[] = [
  'vortice', 'aurora', 'atlas', 'nova', 'lumen',
  'helix', 'prisma', 'orion', 'vega', 'eclipse',
  'argo', 'solaria', 'nexo', 'astra', 'lyra',
  'zenith', 'cobalto', 'quasar', 'senda', 'orbita',
]

const PORTRAIT_ALIAS: Record<Exclude<ModelAvatarKind, 'kira'>, PortraitKey> = {
  sol: 'solaria',
  luna: 'eclipse',
  terra: 'senda',
  generic: 'lyra',
  vortice: 'vortice',
  aurora: 'aurora',
  atlas: 'atlas',
  nova: 'nova',
  lumen: 'lumen',
  helix: 'helix',
  prisma: 'prisma',
  orion: 'orion',
  vega: 'vega',
  eclipse: 'eclipse',
  argo: 'argo',
  solaria: 'solaria',
  nexo: 'nexo',
  astra: 'astra',
  lyra: 'lyra',
  zenith: 'zenith',
  cobalto: 'cobalto',
  quasar: 'quasar',
  senda: 'senda',
  orbita: 'orbita',
}

/** Small deterministic index used to keep one agent's visual identity stable. */
export function stableAgentIndex(agentId: string, length: number): number {
  if (length <= 0) return 0
  let total = 0
  for (const character of agentId) total += character.codePointAt(0) ?? 0
  return total % length
}

/** Pick the portrait aligned with the stable visible KIRA codename roster. */
export function agentAvatarKind(agentId: string): ModelAvatarKind {
  return AGENT_AVATAR_KINDS[stableAgentIndex(agentId, AGENT_AVATAR_KINDS.length)] ?? 'generic'
}

/** Resolve the model-only fallback identity when no KIRA agent id is available. */
export function modelAvatarKind(model: string | undefined): ModelAvatarKind {
  const normalized = model?.toLowerCase() ?? ''
  if (normalized.includes('sol')) return 'sol'
  if (normalized.includes('luna')) return 'luna'
  if (normalized.includes('terra')) return 'terra'
  return 'generic'
}

/** Resolve one KIRA identity to its standalone public portrait asset. */
export function portraitSrcForKind(kind: ModelAvatarKind): string {
  if (kind === 'kira') return KIRA_MODERN_STILL_PORTRAITS.kira
  return KIRA_MODERN_STILL_PORTRAITS[PORTRAIT_ALIAS[kind]]
}

export interface ModelActivityAvatarProps {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
  agentId?: string
  /** Explicit board persona; wins over the agent-id/model fallbacks. */
  kind?: ModelAvatarKind
  /** A roster persona that is available but not currently occupied by a subagent. */
  ready?: boolean
  /** Compact is backward-compatible; card matches the approved board portrait scale. */
  variant?: 'compact' | 'card'
  /** Override for authored team events, never inferred from model names. */
  emotion?: AvatarExpression | undefined
  speaking?: boolean
  listening?: boolean
  motion?: AvatarMotion
  /** Face pose: optional explicit look direction, with subtle autonomous movement otherwise. */
  pose?: 'auto' | 'forward' | 'left' | 'right' | 'up' | 'down'
}

/** A single high-quality fixed portrait: no animated sprites, facial overlays or motion effects. */
export function ModelActivityAvatar({
  activity,
  running,
  pending,
  agentId,
  kind,
  ready = false,
  variant = 'compact',
  emotion,
}: ModelActivityAvatarProps) {
  const resolvedKind = kind
    ?? (agentId === undefined ? modelAvatarKind(activity?.model) : agentAvatarKind(agentId))
  const phase = running ? (activity?.phase ?? 'preparing') : 'idle'
  const state = pending
    ? 'pending'
    : ready || (running && phase === 'idle')
      ? 'ready'
      : running ? 'running' : 'done'

  return (
    <span
      className={`${css.avatar} ${variant === 'card' ? css.card : ''}`}
      data-avatar={resolvedKind}
      data-phase={phase}
      data-state={state}
      data-expression={emotion ?? (pending ? 'concerned' : running ? 'focused' : 'neutral')}
      aria-hidden="true"
    >
      <span className={css.ring} />
      <img
        className={css.portraitImage}
        src={portraitSrcForKind(resolvedKind)}
        alt=""
        draggable={false}
        decoding="async"
        data-agent-portrait-image={true}
      />
      <span className={css.badge} />
    </span>
  )
}
