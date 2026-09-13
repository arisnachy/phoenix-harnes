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
      <span className={css.badge} />
    </span>
  )
}
