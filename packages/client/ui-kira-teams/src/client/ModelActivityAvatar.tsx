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

export function ModelActivityAvatar({ activity, running, pending }: {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
}) {
  const kind = modelAvatarKind(activity?.model)
  const phase = running ? activity?.phase ?? 'preparing' : 'idle'
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
