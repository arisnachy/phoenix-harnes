import type { CSSProperties } from 'react'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import { KIRA_PORTRAIT_SHEET } from './KiraPortraitSheet.ts'
import css from './ModelActivityAvatar.module.css'

/** Visual identities used by model fallbacks and stable KIRA personas. */
export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'vega' | 'nova' | 'prisma' | 'atlas' | 'orion' | 'nexo'
  | 'astra' | 'lumen' | 'pulsar' | 'cometa' | 'aurora' | 'cobalto'
  | 'helix' | 'vector' | 'quasar' | 'senda' | 'zenit' | 'eclipse'
  | 'fenix' | 'argo' | 'orbita' | 'vortice' | 'solaria' | 'orbe'

type PortraitKey =
  | 'vortice' | 'aurora' | 'atlas' | 'nova' | 'lumen'
  | 'helix' | 'prisma' | 'orion' | 'vega' | 'eclipse'
  | 'argo' | 'solaria' | 'nexo' | 'astra' | 'lyra'
  | 'zenit' | 'cobalto' | 'quasar' | 'senda' | 'orbita'

const AGENT_AVATAR_KINDS: readonly ModelAvatarKind[] = [
  'vega', 'nova', 'prisma', 'atlas', 'orion', 'nexo',
  'astra', 'lumen', 'pulsar', 'cometa', 'aurora', 'cobalto',
  'helix', 'vector', 'quasar', 'senda', 'zenit', 'eclipse',
  'fenix', 'argo', 'orbita', 'vortice', 'solaria', 'orbe',
]

const PORTRAIT_ORDER: readonly PortraitKey[] = [
  'vortice', 'aurora', 'atlas', 'nova', 'lumen',
  'helix', 'prisma', 'orion', 'vega', 'eclipse',
  'argo', 'solaria', 'nexo', 'astra', 'lyra',
  'zenit', 'cobalto', 'quasar', 'senda', 'orbita',
]

const PORTRAIT_ALIAS: Record<ModelAvatarKind, PortraitKey> = {
  sol: 'solaria',
  luna: 'eclipse',
  terra: 'senda',
  generic: 'vortice',
  vega: 'vega',
  nova: 'nova',
  prisma: 'prisma',
  atlas: 'atlas',
  orion: 'orion',
  nexo: 'nexo',
  astra: 'astra',
  lumen: 'lumen',
  pulsar: 'lyra',
  cometa: 'quasar',
  aurora: 'aurora',
  cobalto: 'cobalto',
  helix: 'helix',
  vector: 'atlas',
  quasar: 'quasar',
  senda: 'senda',
  zenit: 'zenit',
  eclipse: 'eclipse',
  fenix: 'solaria',
  argo: 'argo',
  orbita: 'orbita',
  vortice: 'vortice',
  solaria: 'solaria',
  orbe: 'lumen',
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
 * Render one compact KIRA portrait. The portrait itself is the approved raster
 * identity; motion overlays communicate live work without changing the dock.
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
