import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

/** Exact visible identities from the user-approved 20-avatar KIRA reference. */
export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'vortice' | 'aurora' | 'atlas' | 'nova' | 'lumen'
  | 'helix' | 'prisma' | 'orion' | 'vega' | 'eclipse'
  | 'argo' | 'solaria' | 'nexo' | 'astra' | 'lyra'
  | 'zenith' | 'cobalto' | 'quasar' | 'senda' | 'orbita'

type PortraitKey = Exclude<ModelAvatarKind, 'sol' | 'luna' | 'terra' | 'generic'>

/** Stable persona order shared with the KIRA Teams roster. */
const AGENT_AVATAR_KINDS: readonly PortraitKey[] = [
  'vortice', 'aurora', 'atlas', 'nova', 'lumen',
  'helix', 'prisma', 'orion', 'vega', 'eclipse',
  'argo', 'solaria', 'nexo', 'astra', 'lyra',
  'zenith', 'cobalto', 'quasar', 'senda', 'orbita',
]

const PORTRAIT_ALIAS: Record<ModelAvatarKind, PortraitKey> = {
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

/** Resolve the dedicated raster file for one visible persona. */
export function portraitSrcForKind(kind: ModelAvatarKind): string {
  return `/assets/kira-agents/${PORTRAIT_ALIAS[kind]}.webp`
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
}

/**
 * Render one KIRA portrait using the exact approved raster identity. Motion
 * communicates work state while the underlying face remains stable.
 */
export function ModelActivityAvatar({
  activity,
  running,
  pending,
  agentId,
  kind,
  ready = false,
  variant = 'compact',
}: ModelActivityAvatarProps) {
  const resolvedKind = kind
    ?? (agentId === undefined ? modelAvatarKind(activity?.model) : agentAvatarKind(agentId))
  const state = ready ? 'ready' : pending ? 'pending' : running ? 'running' : 'done'
  const phase = !running
    ? 'idle'
    : activity?.phase === 'running-tools' || activity?.phase === 'verifying'
      ? activity.phase
      : 'preparing'

  return (
    <span
      className={`${css.avatar} ${variant === 'card' ? css.card : ''}`}
      data-avatar={resolvedKind}
      data-phase={phase}
      data-state={state}
      aria-hidden="true"
    >
      <span className={css.aura} />
      <span className={css.ring} />
      <span className={css.core} />
      <img
        className={css.portraitImage}
        data-agent-portrait-image={true}
        src={portraitSrcForKind(resolvedKind)}
        alt=""
        draggable={false}
        decoding="async"
      />
      <span className={css.lifeGlint} />
      <span className={css.scanLine} />
      <span className={css.energyRibbon} />
      <span className={css.phaseCue}><span className={css.phaseCueInner} /></span>
      <span className={css.badge} />
    </span>
  )
}
