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

// Keep this order in lock-step with AGENT_NAMES in KiraTeamsDock.tsx and with
// the 5×4 portrait sheet. This is the exact order in the approved reference.
const AGENT_AVATAR_KINDS: readonly PortraitKey[] = [
  'vortice', 'aurora', 'atlas', 'nova', 'lumen',
  'helix', 'prisma', 'orion', 'vega', 'eclipse',
  'argo', 'solaria', 'nexo', 'astra', 'lyra',
  'zenith', 'cobalto', 'quasar', 'senda', 'orbita',
]

const PORTRAIT_ORDER: readonly PortraitKey[] = AGENT_AVATAR_KINDS

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

/** Locate one exact portrait within the approved 5×4 sheet. */
function portraitStyle(kind: ModelAvatarKind): CSSProperties {
  const portrait = PORTRAIT_ALIAS[kind]
  const index = PORTRAIT_ORDER.indexOf(portrait)
  const column = index % 5
  const row = Math.floor(index / 5)
  return {
    '--portrait-image': `url("${KIRA_PORTRAIT_SHEET}")`,
    '--portrait-x': `${column * 25}%`,
    '--portrait-y': `${row * (100 / 3)}%`,
  } as CSSProperties
}

export interface ModelActivityAvatarProps {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
  agentId?: string
}

/**
 * Render one compact KIRA portrait. The portrait itself is the exact approved
 * raster identity; restrained motion overlays communicate live work without
 * changing the KIRA Teams card layout or its 48px avatar footprint.
 */
export function ModelActivityAvatar({
  activity,
  running,
  pending,
  agentId,
}: ModelActivityAvatarProps) {
  const kind = agentId === undefined ? modelAvatarKind(activity?.model) : agentAvatarKind(agentId)
  const state = pending ? 'pending' : running ? 'running' : 'done'
  const phase = !running
    ? 'idle'
    : activity?.phase === 'running-tools' || activity?.phase === 'verifying'
      ? activity.phase
      : 'preparing'

  return (
    <span
      className={css.avatar}
      data-avatar={kind}
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
        style={portraitStyle(kind)}
      />
      <span className={css.lifeGlint} />
      <span className={css.scanLine} />
      <span className={css.energyRibbon} />
      <span className={css.phaseCue}><span className={css.phaseCueInner} /></span>
      <span className={css.badge} />
    </span>
  )
}
