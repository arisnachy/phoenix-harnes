/** Map real direct-child work into its owning mission without treating agents as users. */
export interface LearningSessionIdentity {
  readonly id: { toString(): string } | string
  readonly header: {
    readonly origin?: string
    readonly parentSession?: { toString(): string } | string
  }
}

/**
 * Attribute direct-child usage to the owning root for end-to-end measurement.
 * @param session - Real session identity and direct-parent descriptor.
 * @returns Root mission session id for a direct subagent, otherwise its own id.
 */
export function learningOwnerSessionId(session: LearningSessionIdentity): string {
  const parent = session.header.origin === 'subagent' ? session.header.parentSession : undefined
  return parent === undefined ? String(session.id) : String(parent)
}

/**
 * Accept human root/fork messages but never subagent assignment text as user intent.
 * @param session - Session that received the message.
 * @param data - Untrusted user-message event payload.
 * @returns True only for a direct human instruction outside subagent sessions.
 */
export function isHumanTaskMessage(session: LearningSessionIdentity, data: unknown): boolean {
  if (session.header.origin === 'subagent') return false
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const source = (data as { readonly source?: unknown }).source
  return typeof source === 'object' && source !== null && !Array.isArray(source)
    && (source as { readonly kind?: unknown }).kind === 'user'
}

/**
 * Detect a durable Goal from its versioned session history even when this
 * optional learning package has not imported the Goal event-map augmentation.
 * Never mistake a verified Goal for an ordinary, unverified task attempt.
 * @param events - The session's append-only event history.
 * @returns Whether a Goal has been created and not subsequently cleared.
 */
export function hasUnclearedGoal(
  events: readonly { readonly type: string; readonly data: unknown }[],
): boolean {
  const latestGoal = events.findLast(event => event.type === 'goal/change')
  if (latestGoal === undefined) return false
  const change = latestGoal.data
  if (typeof change !== 'object' || change === null || Array.isArray(change)) return true
  return (change as { readonly operation?: unknown }).operation !== 'clear'
}
