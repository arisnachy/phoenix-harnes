/** Read-only mission continuation fence for the durable Goal round driver.
 *
 * Agent Teams owns UME writes. This projection consumes only public Session
 * events, so Goals does not acquire a circular runtime dependency on Teams.
 */
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled'])

/**
 * Bootstrap durable Goal continuation only after a human-authorized turn
 * ended with a genuinely unfinished todo checklist and no existing Goal.
 * @param events - Current Lead session history.
 * @returns Exact human objective, or undefined when continuation is unjustified.
 */
export function unfinishedTodoRecoveryObjective(events: readonly SessionEvent[]): string | undefined {
  const humanIndex = events.findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  if (humanIndex < 0) return undefined
  const human = events[humanIndex]
  if (human?.type !== 'user/message') return undefined
  const current = events.slice(humanIndex + 1)
  const lastEnd = current.findLast(event => event.type === 'turn/end')
  if (lastEnd === undefined || lastEnd.data.reason.kind !== 'completed') return undefined
  const lastTodo = current.findLast(event => event.type === 'todo/write')
  if (lastTodo === undefined || !lastTodo.data.todos.some(todo => todo.status !== 'completed')) return undefined
  const objective = human.data.content.flatMap(block =>
    block.type === 'text' ? [block.text] : []).join(' ').trim().slice(0, 2_000)
  return objective.length > 0 ? objective : undefined
}

/**
 * Recover any unfinished *structured* delegation. The model's words are not
 * evidence of completion: the durable checklist and team task states are.
 * Optional Team events are interpreted structurally to avoid runtime coupling.
 *
 * A genuine user's most recent turn owns the work; historical tasks from an
 * earlier human turn cannot silently re-arm themselves.
 */
export function unfinishedStructuredWorkRecoveryObjective(events: readonly SessionEvent[]): string | undefined {
  const todo = unfinishedTodoRecoveryObjective(events)
  if (todo !== undefined) return todo

  const humanIndex = events.findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  if (humanIndex < 0) return undefined
  const human = events[humanIndex]
  if (human?.type !== 'user/message') return undefined
  const since = events.slice(humanIndex + 1)
  const lastEnd = since.findLast(event => event.type === 'turn/end')
  if (lastEnd?.data.reason.kind !== 'completed') return undefined

  const currentTasks = new Map<string, string>()
  for (const event of since) {
    if ((event.type as string) !== 'team/task') continue
    const payload: unknown = event.data
    if (!isRecord(payload) || !isRecord(payload['task'])) continue
    const task = payload['task']
    if (typeof task['id'] !== 'string' || typeof task['status'] !== 'string') continue
    currentTasks.set(task['id'], task['status'])
  }
  if (![...currentTasks.values()].some(status => status !== 'completed' && status !== 'cancelled')) {
    return undefined
  }
  const objective = human.data.content.flatMap(block =>
    block.type === 'text' ? [block.text] : []).join(' ').trim().slice(0, 2_000)
  return objective || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True when the owning Team mission is terminal and no later real human input
 * has authorized a new mission. Plugin notices, recovery and goal followups
 * cannot lift the fence, including after a Host restart.
 * @param session - canonical Lead Session and its append-only event log.
 * @returns whether automatic Goal continuation must be disarmed or rejected.
 */
export function goalBlockedByClosedUniversalMission(
  session: Pick<Session, 'id' | 'events'>,
): boolean {
  // The latest matching checkpoint owns the fence. A NEW mission's active
  // checkpoint supersedes a previous terminal one without reviving old Goals.
  const validPhase = (data: unknown): string | undefined => {
    if (!isRecord(data) || data.version !== 1 || data.teamId !== session.id
      || !isRecord(data.snapshot) || data.snapshot.teamId !== session.id) return undefined
    return typeof data.snapshot.phase === 'string' ? data.snapshot.phase : undefined
  }
  const latest = session.events.findLast(event =>
    (event.type as string) === 'team/mission' && validPhase(event.data) !== undefined)
  if (latest === undefined) return false
  const lastHuman = session.events.findLast(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  if (latest.seq <= (lastHuman?.seq ?? -1)) return false
  const phase = validPhase(latest.data)
  if (!TERMINAL.has(phase ?? '')) return false
  if (phase === 'partial') {
    // Older Team runtimes incorrectly marked an in-progress Goal as partial
    // merely because Kira ended one model turn. Allow the ordinary Goal driver
    // to resume this *specific* legacy case on Host restart. UME remains
    // terminal (no old teammate delegation is revived).
    const turn = session.events.findLast(event => event.type === 'turn/end')
    const goalChange = session.events.findLast(event => (event.type as string) === 'goal/change')
    const data: unknown = goalChange?.data
    const goal = typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)['goal']
      : undefined
    const active = typeof goal === 'object' && goal !== null && !Array.isArray(goal)
      && (goal as Record<string, unknown>)['phase'] === 'active'
    if (turn?.data.reason.kind === 'completed' && active) return false
  }
  return true
}
