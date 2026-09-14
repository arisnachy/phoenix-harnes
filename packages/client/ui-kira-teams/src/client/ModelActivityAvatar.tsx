import type { ReactNode } from 'react'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

/** Visual identities used by model fallbacks and stable KIRA personas. */
export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'vega' | 'nova' | 'prisma' | 'atlas' | 'orion' | 'nexo'
  | 'astra' | 'lumen' | 'pulsar' | 'cometa' | 'aurora' | 'cobalto'
  | 'helix' | 'vector' | 'quasar' | 'senda' | 'zenit' | 'eclipse'
  | 'fenix' | 'argo' | 'orbita' | 'vortice' | 'solaria' | 'orbe'

// Keep this order in lock-step with AGENT_NAMES in KiraTeamsDock.tsx. That
// makes the face the user sees belong to the same visible KIRA identity.
const AGENT_AVATAR_KINDS: readonly ModelAvatarKind[] = [
  'vega', 'nova', 'prisma', 'atlas', 'orion', 'nexo',
  'astra', 'lumen', 'pulsar', 'cometa', 'aurora', 'cobalto',
  'helix', 'vector', 'quasar', 'senda', 'zenit', 'eclipse',
  'fenix', 'argo', 'orbita', 'vortice', 'solaria', 'orbe',
]

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

/** Persona-specific hair, silhouette, and facial technology layered over one face rig. */
function personaDetails(kind: ModelAvatarKind): ReactNode {
  switch (kind) {
    case 'vega':
      return <><path className={css.hairFront} d="M10 20C12 7 26 5 37 13c-8-1-11 5-16 3-4-2-7 4-11 4Z" /><path className={css.detail} d="M33 12c3 4 4 8 3 13" /></>
    case 'nova':
      return <><path className={css.hairFront} d="M11 18C15 5 32 6 38 17c-7-3-10 0-14-3-4 5-8 5-13 4Z" /><path className={css.detail} d="m34 9 1.2 3 3 .9-3 .9-1.2 3-1-3-3.1-.9 3.1-.9 1-3Z" /></>
    case 'prisma':
      return <><path className={css.hairFront} d="M10 19 17 8l6 7 6-8 9 12c-7-3-9 0-14-3-5 4-8 1-14 3Z" /><path className={css.detail} d="m32 12 3 3-3 3-3-3 3-3Z" /></>
    case 'atlas':
      return <><path className={css.hairFront} d="M13 15c5-8 18-8 23 1l-4 1-2-5-5 4-6-4-3 5-3-2Z" /><path className={css.detail} d="M14 22h3m14 0h3M17 12l-3 8m17-8 3 8" /></>
    case 'orion':
      return <><path className={css.hairFront} d="M11 18c4-10 18-13 27-3-6-2-9 3-14 0-5 4-8 4-13 3Z" /><path className={css.detail} d="m14 12 5 3m13-5-4 4m7 6-3 2" /><circle className={css.detailDot} cx="34" cy="11" r="1" /></>
    case 'nexo':
      return <><path className={css.hairFront} d="M10 20c3-11 15-15 27-7-7 0-9 5-15 3-3-1-6 4-12 4Z" /><path className={css.detail} d="M12 27c-3-7 0-14 5-18m19 18c3-7 0-14-5-18" /></>
    case 'astra':
      return <><path className={css.hairFront} d="M10 19C14 6 31 5 38 16c-9-2-10 3-15-1-5 5-8 4-13 4Z" /><path className={css.detail} d="m35 10 .9 2.4 2.6.8-2.6.8-.9 2.5-.9-2.5-2.5-.8 2.5-.8.9-2.4Z" /></>
    case 'lumen':
      return <><path className={css.hairFront} d="M12 17c4-10 20-12 25 1-7-3-9-1-13-4-4 4-7 4-12 3Z" /><circle className={css.detailDot} cx="24" cy="11" r="1.5" /><path className={css.detail} d="M24 6v3m0 4v3" /></>
    case 'pulsar':
      return <><path className={css.hairFront} d="M10 18c5-9 17-14 28-4-6-1-9 5-14 1-5 5-9 2-14 3Z" /><path className={css.detail} d="M9 25c3-3 4-3 7 0m16 0c3-3 4-3 7 0" /></>
    case 'cometa':
      return <><path className={css.hairFront} d="M8 20C14 8 27 5 40 10c-8 3-10 7-17 6-6-1-8 3-15 4Z" /><path className={css.detail} d="M36 8 28 3m5 8-10-6" /></>
    case 'aurora':
      return <><path className={css.hairFront} d="M9 20C11 7 29 4 39 16c-8-3-10 3-15-1-6 6-9 1-15 5Z" /><path className={css.detail} d="M9 11c6 4 8-3 13 0s8-3 16 0" /></>
    case 'cobalto':
      return <><path className={css.hairFront} d="M12 15c6-9 18-8 24 0l-5 2-3-5-5 4-5-4-3 5-3-2Z" /><path className={css.detail} d="m13 16 4 3-2 4m20-7-4 3 2 4" /></>
    case 'helix':
      return <><path className={css.hairFront} d="M12 17c5-10 19-11 25 0-6-1-8 2-13-3-4 4-7 4-12 3Z" /><path className={css.detail} d="M10 17c-4 6-3 13 1 18m27-18c4 6 3 13-1 18" /><circle className={css.detailDot} cx="11" cy="27" r="2" /></>
    case 'vector':
      return <><path className={css.hairFront} d="M12 16 19 8l5 6 6-6 6 8c-5-2-8 2-12-2-4 4-7 1-12 2Z" /><path className={css.detail} d="m13 29 4-2m14 0 4 2" /></>
    case 'quasar':
      return <><path className={css.hairFront} d="M9 20c4-12 20-17 31-6-9-1-11 5-17 1-5 5-8 4-14 5Z" /><path className={css.detail} d="M37 8c-1 5-4 7-8 9" /><circle className={css.detailDot} cx="38" cy="8" r="1.4" /></>
    case 'senda':
      return <><path className={css.hairFront} d="M10 20c2-10 12-15 27-8-7 2-9 6-14 4-5-2-8 3-13 4Z" /><path className={css.detail} d="M35 10c-5 2-8 6-9 11m-13-8c4 1 6 4 7 8" /></>
    case 'zenit':
      return <><path className={css.hairFront} d="M11 18c5-11 20-12 27-2-8-2-10 3-15-2-4 5-7 3-12 4Z" /><path className={css.detail} d="M24 6v6m-4-3 4-3 4 3" /></>
    case 'eclipse':
      return <><path className={css.hairFront} d="M9 20C10 7 29 4 39 17c-8-4-11 1-15-2-6 5-9 2-15 5Z" /><path className={css.detail} d="M30 8a4 4 0 1 0 4 6 5 5 0 1 1-4-6Z" /></>
    case 'fenix':
      return <><path className={css.hairFront} d="m10 20 4-12 6 6 4-9 5 9 6-6 3 12c-6-4-9 0-14-4-5 4-8 1-14 4Z" /><path className={css.detail} d="m12 11 5 2m19-2-5 2" /></>
    case 'argo':
      return <><path className={css.hairFront} d="M13 15c5-8 17-8 23 0l-4 2-4-5-5 4-5-4-3 5-2-2Z" /><path className={css.detail} d="M11 24c0-7 3-13 8-16m18 16c0-7-3-13-8-16" /></>
    case 'orbita':
      return <><path className={css.hairFront} d="M11 18c4-10 19-13 27-2-7-2-9 3-14-2-4 5-8 3-13 4Z" /><ellipse className={css.detail} cx="24" cy="21" rx="17" ry="7" transform="rotate(-18 24 21)" /></>
    case 'vortice':
      return <><path className={css.hairFront} d="M8 21C11 7 29 2 40 14c-9-2-11 4-17 1-6 6-9 2-15 6Z" /><path className={css.detail} d="M7 13c7 4 12-6 20-4 6 1 9 5 12 9" /></>
    case 'solaria':
      return <><path className={css.hairFront} d="M9 19C13 5 31 5 39 17c-8-3-11 2-15-2-5 5-9 3-15 4Z" /><path className={css.detail} d="M24 5v4M13 9l3 3m19-3-3 3" /></>
    case 'orbe':
      return <><path className={css.hairFront} d="M11 18c5-11 19-12 27-2-7-2-10 3-14-2-4 5-8 3-13 4Z" /><circle className={css.detail} cx="24" cy="21" r="17" /></>
    case 'sol':
      return <><path className={css.hairFront} d="M11 18c5-10 19-11 27-1-7-2-9 2-14-3-5 5-8 3-13 4Z" /><path className={css.detail} d="M24 5v4M14 9l3 3m17-3-3 3" /></>
    case 'luna':
      return <><path className={css.hairFront} d="M9 20C10 7 28 5 39 16c-8-3-11 2-15-2-5 5-9 3-15 6Z" /><path className={css.detail} d="M31 8a4 4 0 1 0 4 6 5 5 0 1 1-4-6Z" /></>
    case 'terra':
      return <><path className={css.hairFront} d="M10 20c3-11 17-14 28-5-7-1-10 4-15 0-5 5-8 3-13 5Z" /><path className={css.detail} d="M12 12c5 0 8 3 9 7m15-7c-5 0-8 3-9 7" /></>
    default:
      return <path className={css.hairFront} d="M11 18c5-10 19-12 27-2-7-2-10 3-14-2-4 5-8 3-13 4Z" />
  }
}

/** Living portrait rig shared by every KIRA identity. */
function portrait(kind: ModelAvatarKind): ReactNode {
  return (
    <>
      <circle className={css.backdropOrb} cx="24" cy="23" r="20" />
      <ellipse className={css.orbit} cx="24" cy="23" rx="20" ry="14" />
      <g className={css.portraitBody}>
        <path className={css.hairBack} d="M8 27C7 12 14 5 24 5c11 0 18 8 16 23l-4 13H12L8 27Z" />
        <path className={css.shoulders} d="M5 48c2-9 9-14 19-14s17 5 19 14H5Z" />
        <path className={css.neck} d="M19 29h10l1 9H18l1-9Z" />
        <path className={css.face} d="M13 18C14 10 18 7 24 7s10 3 11 11c1 8-3 16-11 17-8-1-12-9-11-17Z" />
        <path className={css.faceShade} d="M29 9c5 3 7 9 5 16-1 5-4 8-9 10 3-4 4-8 3-12 1-6 0-10 1-14Z" />
        {personaDetails(kind)}
        <g className={css.brows}>
          <path d="M16 20c2-2 5-2 7-.5" />
          <path d="M25 19.5c2-1.5 5-1.5 7 .5" />
        </g>
        <g className={css.eyes}>
          <path d="M16 22c2 2 5 2 7 0-2-1.5-5-1.5-7 0Z" />
          <path d="M25 22c2 2 5 2 7 0-2-1.5-5-1.5-7 0Z" />
          <circle className={css.pupil} cx="20" cy="22" r="1" />
          <circle className={css.pupil} cx="28" cy="22" r="1" />
        </g>
        <path className={css.nose} d="M24 22c-.4 3-.7 5 .8 6" />
        <path className={css.mouth} d="M20 30c2.5 1.7 5.5 1.7 8 0" />
      </g>
      <path className={css.energy} d="M7 31c5 5 7-5 13-2s7 7 13 2 7-1 9 1" />
      <rect className={css.scanLine} x="9" y="9" width="30" height="1.4" rx=".7" />
      <path className={css.successSpark} d="m37 8 1 2.6 2.7 1-2.7 1-1 2.6-1-2.6-2.7-1 2.7-1 1-2.6Z" />
    </>
  )
}

/** Render one reactive KIRA portrait without changing the dock's 48px footprint. */
export function ModelActivityAvatar({ agentId, activity, running, pending }: {
  agentId?: string
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
}) {
  const kind = agentId === undefined ? modelAvatarKind(activity?.model) : agentAvatarKind(agentId)
  const phase = running
    ? activity?.phase === 'idle' ? 'preparing' : activity?.phase ?? 'preparing'
    : 'idle'
  const state = pending ? 'pending' : running ? 'running' : 'done'
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
      <svg
        className={css.portrait}
        data-agent-portrait={true}
        viewBox="0 0 48 48"
        focusable="false"
        aria-hidden="true"
      >
        {portrait(kind)}
      </svg>
      <span className={css.phaseCue}><span className={css.phaseCueInner} /></span>
      <span className={css.badge} />
    </span>
  )
}
