import type { CSSProperties } from 'react'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import { KIRA_PORTRAIT_SHEET } from './KiraPortraitSheet.ts'
import css from './ModelActivityAvatar.module.css'

/** Exact visible identities from the user-approved 20-avatar KIRA reference. */
export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'vortice' | 'aurora' | 'atlas' | 'nova' | 'lumen'
  | 'helix' | 'prisma' | 'orion' | 'vega' | 'eclipse'
  | 'argo' | 'solaria' | 'nexo' | 'astra' | 'lyra'
  | 'zenith' | 'cobalto' | 'quasar' | 'senda' | 'orbita'

type PortraitKey = Exclude<ModelAvatarKind, 'sol' | 'luna' | 'terra' | 'generic'>

/** Stable persona order shared with the approved 5×4 KIRA portrait sheet. */
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

/** Bust stale 404/image caches while keeping the public sheet contract stable. */
const KIRA_PORTRAIT_RENDER_SRC = `${KIRA_PORTRAIT_SHEET}?v=20260915-compact-avatar-2`

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

/** Public sheet path containing the exact 20 approved portrait cells. */
export function portraitSrcForKind(_kind: ModelAvatarKind): string {
  return KIRA_PORTRAIT_SHEET
}

/** Locate one persona within the 5×4 sheet without stretching its face. */
function portraitStyle(kind: ModelAvatarKind, variant: 'compact' | 'card'): CSSProperties {
  const portrait = PORTRAIT_ALIAS[kind]
  const index = AGENT_AVATAR_KINDS.indexOf(portrait)
  const column = index % 5
  const row = Math.floor(index / 5)
  const compactX = [0, 25, 50, 75, 100]
  const cardX = [2.889, 26.444, 50, 73.556, 97.111]
  return {
    '--portrait-image': `url("${KIRA_PORTRAIT_SHEET}")`,
    '--portrait-x': `${(variant === 'card' ? cardX : compactX)[column] ?? 0}%`,
    '--portrait-y': `${row * (100 / 3)}%`,
    '--portrait-column': String(column),
    '--portrait-row': String(row),
  } as CSSProperties
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

/** Render one exact KIRA portrait with restrained state-reactive motion. */
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
      aria-hidden="true"
    >
      <span className={css.aura} />
      <span className={css.ring} />
      <span className={css.core} />
      <span
        className={css.portraitImage}
        data-agent-portrait-image={true}
        style={portraitStyle(resolvedKind, variant)}
      >
        <img
          className={css.portraitSprite}
          src={KIRA_PORTRAIT_RENDER_SRC}
          alt=""
          draggable={false}
          data-agent-portrait-sprite={true}
        />
      </span>
      <span className={css.lifeGlint} />
      <span className={css.scanLine} />
      <span className={css.energyRibbon} />
      <span className={css.phaseCue}><span className={css.phaseCueInner} /></span>
      <span className={css.badge} />
    </span>
  )
}
