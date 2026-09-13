import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

export type ModelAvatarKind =
  | 'sol' | 'luna' | 'terra' | 'generic'
  | 'nova' | 'prism' | 'comet' | 'aurora'

const AGENT_AVATAR_KINDS: readonly ModelAvatarKind[] = [
  'generic', 'nova', 'prism', 'comet', 'aurora', 'luna', 'sol', 'terra',
]

/** Stable, lightweight hash for a subagent's visual identity. */
export function stableAgentIndex(identity: string, length: number): number {
  if (length <= 0) return 0
  let total = 0
  for (const character of identity) total += character.codePointAt(0) ?? 0
  return total % length
}

/** Pick a distinct avatar family without exposing the provider model. */
export function agentAvatarKind(identity: string): ModelAvatarKind {
  return AGENT_AVATAR_KINDS[stableAgentIndex(identity, AGENT_AVATAR_KINDS.length)] ?? 'generic'
}

/** Stable four-way palette fallback for callers that need a compact variant. */
export function avatarVariant(identity: string | undefined): number {
  if (identity === undefined || identity.length === 0) return 0
  return stableAgentIndex(identity, 4)
}

export function modelAvatarKind(model: string | undefined): ModelAvatarKind {
  const normalized = model?.toLowerCase() ?? ''
  if (normalized.includes('sol')) return 'sol'
  if (normalized.includes('luna')) return 'luna'
  if (normalized.includes('terra')) return 'terra'
  return 'generic'
}

export function ModelActivityAvatar({ activity, running, pending, identity }: {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
  /** Stable per-agent identity used for varied avatars. */
  identity?: string
}) {
  const kind = identity === undefined ? modelAvatarKind(activity?.model) : agentAvatarKind(identity)
  const phase = running
    ? activity?.phase === 'idle' ? 'preparing' : activity?.phase ?? 'preparing'
    : 'idle'
  const state = pending ? 'pending' : running ? 'running' : 'done'
  return (
    <span
      className={css.avatar}
      data-avatar={kind}
      data-variant={avatarVariant(identity)}
      data-phase={phase}
      data-state={state}
      aria-hidden="true"
    >
      <span className={css.core} />
      <span className={css.orbit} />
      <span className={css.badge} />
    </span>
  )
}
