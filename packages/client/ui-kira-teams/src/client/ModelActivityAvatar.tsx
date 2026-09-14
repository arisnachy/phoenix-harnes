import type { ReactNode } from 'react'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'eagle' | 'wolf' | 'fox' | 'owl' | 'lynx' | 'dolphin'
  | 'forge' | 'nova' | 'comet' | 'prism' | 'aurora' | 'dragon'

const AGENT_AVATAR_KINDS: readonly ModelAvatarKind[] = [
  'eagle', 'wolf', 'fox', 'owl', 'lynx', 'dolphin',
  'forge', 'nova', 'comet', 'prism', 'aurora', 'dragon',
]

/** Small deterministic index used to keep one agent's visual identity stable. */
export function stableAgentIndex(agentId: string, length: number): number {
  if (length <= 0) return 0
  let total = 0
  for (const character of agentId) total += character.codePointAt(0) ?? 0
  return total % length
}

/** Pick a varied avatar from the agent roster instead of exposing the model family. */
export function agentAvatarKind(agentId: string): ModelAvatarKind {
  return AGENT_AVATAR_KINDS[stableAgentIndex(agentId, AGENT_AVATAR_KINDS.length)] ?? 'generic'
}

export function modelAvatarKind(model: string | undefined): ModelAvatarKind {
  const normalized = model?.toLowerCase() ?? ''
  if (normalized.includes('sol')) return 'sol'
  if (normalized.includes('luna')) return 'luna'
  if (normalized.includes('terra')) return 'terra'
  return 'generic'
}

/**
 * Quiet geometric sigils for stable KIRA identities. The previous literal
 * animal illustrations made the dock read like character cards; these marks
 * retain recognisable individuality while fitting Phoenix's restrained UI.
 */
function glyphMarks(kind: ModelAvatarKind): ReactNode {
  switch (kind) {
    case 'eagle':
      return <><path d="m13 29 11-12 11 12" /><path d="M18 32h12" /></>
    case 'wolf':
      return <><path d="m24 10 13 14-13 14-13-14 13-14Z" /><path d="M24 17v14M17 24h14" /></>
    case 'fox':
      return <><path d="m24 10 12 7v14l-12 7-12-7V17l12-7Z" /><path d="m17 22 7 8 7-8" /></>
    case 'owl':
      return <><circle cx="19" cy="24" r="6" /><circle cx="29" cy="24" r="6" /><path d="m21 33 3 3 3-3" /></>
    case 'lynx':
      return <><path d="m14 18 10 9 10-9" /><path d="m14 27 10 9 10-9" /></>
    case 'dolphin':
      return <><path d="M10 28c5-8 10-8 14 0s9 8 14 0" /><circle cx="24" cy="17" r="3" /></>
    case 'forge':
      return <><path d="M24 11v26M11 24h26" /><path d="m16 16 16 16M32 16 16 32" /></>
    case 'nova':
      return <path d="m24 8 4 12 12 4-12 4-4 12-4-12-12-4 12-4 4-12Z" />
    case 'comet':
      return <><circle cx="29" cy="20" r="7" /><path d="M23 24 10 35M21 19 8 26M27 27l-8 11" /></>
    case 'prism':
      return <><path d="m24 9 15 29H9L24 9Z" /><path d="m17 31 7-13 7 13" /></>
    case 'aurora':
      return <><path d="M9 20c5-7 9 7 14 0s9 7 16 0" /><path d="M9 29c5-7 9 7 14 0s9 7 16 0" /></>
    case 'dragon':
      return <><path d="M31 14c-10-5-19 3-19 13 0 8 7 13 14 10 6-2 8-9 4-13-3-4-10-3-11 2-1 4 4 7 7 4" /><circle cx="31" cy="14" r="2" /></>
    case 'sol':
      return <><circle cx="24" cy="24" r="8" /><path d="M24 8v5m0 22v5M8 24h5m22 0h5M13 13l4 4m14 14 4 4m0-22-4 4M17 31l-4 4" /></>
    case 'luna':
      return <path d="M34 35c-11 0-19-8-19-19 0-2 0-4 1-6 2 9 8 15 18 15 3 0 6-1 8-2-2 7-4 10-8 12Z" />
    case 'terra':
      return <><circle cx="24" cy="24" r="14" /><path d="M10 24h28M24 10c4 4 6 9 6 14s-2 10-6 14c-4-4-6-9-6-14s2-10 6-14Z" /></>
    default:
      return <><circle cx="24" cy="24" r="12" /><path d="M18 24h12M24 18v12" /></>
  }
}

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
        className={css.glyph}
        data-agent-glyph={true}
        viewBox="0 0 48 48"
        focusable="false"
        aria-hidden="true"
      >
        {glyphMarks(kind)}
      </svg>
      <span className={css.phaseCue}><span className={css.phaseCueInner} /></span>
      <span className={css.badge} />
    </span>
  )
}
