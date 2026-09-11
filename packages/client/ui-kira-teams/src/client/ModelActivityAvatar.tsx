import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

export type ModelAvatarKind = 'sol' | 'luna' | 'terra' | 'generic'

export function modelAvatarKind(model: string | undefined): ModelAvatarKind {
  const normalized = model?.toLowerCase() ?? ''
  if (normalized.includes('sol')) return 'sol'
  if (normalized.includes('luna')) return 'luna'
  if (normalized.includes('terra')) return 'terra'
  return 'generic'
}

export function avatarVariant(identity: string | undefined): number {
  if (identity === undefined || identity.length === 0) return 0
  let hash = 0
  for (const character of identity) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % 4
}

export function ModelActivityAvatar({ activity, running, pending, identity }: {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
  /** Stable fallback identity when the provider model is not persona-labelled. */
  identity?: string
}) {
  const kind = modelAvatarKind(activity?.model)
  const phase = running ? activity?.phase ?? 'preparing' : 'idle'
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
