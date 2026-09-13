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
 * Compact vector marks for stable KIRA identities. They intentionally suggest
 * distinct characters without depending on platform emoji fonts.
 */
function glyphMarks(kind: ModelAvatarKind): ReactNode {
  switch (kind) {
    case 'eagle':
      return <path d="M8 28c7-1 10-7 16-16 6 9 9 15 16 16-6 0-10-2-16-7-6 5-10 7-16 7Zm12 4 4 7 4-7" />
    case 'wolf':
      return <path d="M11 15 19 9l5 8 5-8 8 6-3 20-10 5-10-5-3-20Zm8 14 5 4 5-4M18 23h.1M30 23h.1" />
    case 'fox':
      return <path d="m10 14 10 4 4-7 4 7 10-4-4 20-10 6-10-6-4-20Zm9 10 5 3 5-3m-5 3v8" />
    case 'owl':
      return <><path d="M12 13c5 1 8 0 12-4 4 4 7 5 12 4v16c0 7-5 11-12 13-7-2-12-6-12-13V13Z" /><circle cx="19" cy="24" r="4" /><circle cx="29" cy="24" r="4" /><path d="m21 32 3 3 3-3" /></>
    case 'lynx':
      return <><path d="m13 15 5-6 4 8h4l4-8 5 6-2 20-9 6-9-6-2-20Z" /><path d="m18 27 6 4 6-4M24 31v5M17 23h.1M31 23h.1" /></>
    case 'dolphin':
      return <><path d="M8 27c7-12 20-15 31-6-7 1-9 5-12 10-6 8-14 7-19-4Zm24-7 4-7 4 8" /><circle cx="27" cy="23" r="1" /></>
    case 'forge':
      return <><path d="m13 34 20-20M17 13l5 5-6 6-5-5 6-6ZM28 28l8 8M31 25l6-6" /><path d="M28 12h10v5H28z" /></>
    case 'nova':
      return <path d="m24 7 4 12 12-4-9 9 9 9-12-4-4 12-4-12-12 4 9-9-9-9 12 4 4-12Z" />
    case 'comet':
      return <><circle cx="29" cy="21" r="9" /><path d="M22 16 8 10m13 12L6 21m17 7L9 35" /></>
    case 'prism':
      return <><path d="m24 8 15 28H9L24 8Z" /><path d="m16 29 8-14 8 14M13 32h22" /></>
    case 'aurora':
      return <><path d="M8 31c7-17 12 8 18-9s8 7 14-5" /><path d="M10 37c7-11 12 6 18-6s7 3 11-2" /></>
    case 'dragon':
      return <><path d="M12 33c0-12 7-21 19-22l-4 7 9 2-7 5 7 8-10-2-5 10-4-10-5 2Z" /><path d="M19 23h.1M25 35l5 5" /></>
    case 'sol':
      return <><circle cx="24" cy="24" r="9" /><path d="M24 6v6m0 24v6M6 24h6m24 0h6M11 11l5 5m16 16 5 5m0-26-5 5M16 32l-5 5" /></>
    case 'luna':
      return <path d="M33 36c-12 0-20-9-20-20 0-3 1-6 2-8 1 11 8 18 19 18 3 0 5 0 8-2-2 7-5 12-9 12Z" />
    case 'terra':
      return <><circle cx="24" cy="24" r="16" /><path d="M9 24h30M24 8c5 5 7 10 7 16s-2 11-7 16c-5-5-7-10-7-16s2-11 7-16Z" /></>
    default:
      return <path d="m24 8 4 12 12 4-12 4-4 12-4-12-12-4 12-4 4-12Z" />
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
      <span className={css.core} />
      <span className={css.orbit} />
      <svg
        className={css.glyph}
        data-agent-glyph={true}
        viewBox="0 0 48 48"
        focusable="false"
        aria-hidden="true"
      >
        {glyphMarks(kind)}
      </svg>
      <span className={css.badge} />
    </span>
  )
}
