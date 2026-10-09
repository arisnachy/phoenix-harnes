/** Map real direct-child work into its owning mission without treating agents as users. */
export interface LearningSessionIdentity {
  readonly id: { toString(): string } | string
  readonly header: {
    readonly origin?: string
    readonly parentSession?: { toString(): string } | string
  }
}

/** Child tool/model usage belongs to the parent task's end-to-end cost. */
export function learningOwnerSessionId(session: LearningSessionIdentity): string {
  const parent = session.header.origin === 'subagent' ? session.header.parentSession : undefined
  return parent === undefined ? String(session.id) : String(parent)
}

/**
 * Only an actual user-authored root/fork message may begin an experience,
 * update task-reference history, or teach the autonomous memory curator.
 * Team assignments and continuations are untrusted work inputs, not user intent.
 */
export function isHumanTaskMessage(session: LearningSessionIdentity, data: unknown): boolean {
  if (session.header.origin === 'subagent') return false
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const source = (data as { readonly source?: unknown }).source
  return typeof source === 'object' && source !== null && !Array.isArray(source)
    && (source as { readonly kind?: unknown }).kind === 'user'
}
