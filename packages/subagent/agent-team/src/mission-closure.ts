/** Durable Team admission boundary: a settled or tool-proven closed Lead mission is not a new assignment. */
import type { SessionEvent } from '@phoenix-ai/dsh-session'

// Closure language alone cannot close a mission. A model can say "done" too early;
// this narrow early-stop path additionally needs successful effect AND verification receipts.
// oxlint-disable-next-line @stylistic/max-len -- Bilingual explicit no-work-remaining patterns must stay auditable.
const NO_WORK_REMAINING = /\b(?:no (?:queda|hay) (?:m[aá]s )?(?:trabajo|tareas?|nada) pendiente|no (?:queda|hay) (?:trabajo|tareas?) (?:por hacer|que justifique delegar)|nothing (?:else )?(?:is )?left to do|no (?:further|more|additional) work (?:is )?(?:needed|required|remaining)|(?:tarea|misi[oó]n) (?:ya )?(?:completada|finalizada) y verificada)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed-mission action receipts are matched by exact tool operation.
const EFFECT = /(?:^|__)(?:submit_form|fill_form|send_email|create_file|update_file|apply_patch|write|edit|submit|deploy|publish|save|send|execute|run_code|browser_submit|browser_fill_form|click_text|update_ref|merge_pull_request)$/iu
// oxlint-disable-next-line @stylistic/max-len -- Closure needs a distinct actual verification tool receipt.
const VERIFY = /(?:^|__)(?:wait_for|read_page|verify|check|test|typecheck|build|read|inspect_form|inspect_page|browser_snapshot|browser_inspect|status)$/iu

/** The beginning of the current durable mission, even after a human steering message. */
function missionBoundary(events: readonly SessionEvent[]): number {
  const human = events.findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  const latest = events.findLast(event => event.type === 'team/mission')
  if (latest === undefined || !['running', 'verifying', 'blocked'].includes(latest.data.snapshot.phase)) {
    return human
  }
  const start = events.findIndex(event => event.type === 'team/mission'
    && event.data.snapshot.id === latest.data.snapshot.id && event.data.snapshot.revision === 1)
  if (start < 0) return human
  // Mission opening is asynchronous; the first checklist can precede its
  // revision-one checkpoint. Scope from the authentic founding human request.
  const founder = events.slice(0, start + 1).findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  return founder >= 0 ? founder : start
}

/**
 * Check the latest complete todo snapshot within the active mission.
 * A later human steering instruction does not erase outstanding work.
 * @param events - Lead session events.
 * @returns Whether any checklist item remains unfinished.
 */
export function unfinishedMissionTodos(events: readonly SessionEvent[]): boolean {
  const latest = events.slice(missionBoundary(events) + 1).findLast(event => event.type === 'todo/write')
  return latest !== undefined && latest.data.todos.some(todo => todo.status !== 'completed')
}

/**
 * Read the last durable Goal snapshot without depending on GoalService's
 * process-local activation or introducing a circular Team/Goal runtime seam.
 * @param events - Lead session events.
 * @returns Whether the persisted Goal is still active.
 */
export function unfinishedMissionGoal(events: readonly SessionEvent[]): boolean {
  // Goal is a sibling capability, not an Agent Teams compile dependency.
  // Inspect its persisted event boundary without assuming module augmentation.
  const latest = events.findLast(event => (event.type as string) === 'goal/change')
  const data: unknown = latest?.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const record = data as Record<string, unknown>
  const goal = record['goal']
  return record['operation'] !== 'clear' && typeof goal === 'object'
    && goal !== null && !Array.isArray(goal)
    && (goal as Record<string, unknown>)['phase'] === 'active'
}

/**
 * Check unfinished Team task snapshots created within this exact mission.
 * Each task has a revision-one creation receipt and later whole-state updates.
 * @param events - Lead session events.
 * @returns Whether a current Team task is pending or in progress.
 */
export function unfinishedMissionTeamTasks(events: readonly SessionEvent[]): boolean {
  const current = events.slice(missionBoundary(events) + 1)
  const created = new Set<string>()
  const statuses = new Map<string, string>()
  for (const event of current) {
    if (event.type !== 'team/task') continue
    const { id, revision, status } = event.data.task
    if (revision === 1) created.add(id)
    if (created.has(id)) statuses.set(id, status)
  }
  return [...statuses.values()].some(status => status === 'pending' || status === 'in_progress')
}

/**
 * Preserve automatic Team work while its goal, checklist or task board is
 * unfinished, even when the Lead model has simply completed a text turn.
 * @param events - Lead session events.
 * @returns Whether the current mission has remaining authorized work.
 */
export function unfinishedMissionWork(events: readonly SessionEvent[]): boolean {
  return unfinishedMissionGoal(events) || unfinishedMissionTodos(events) || unfinishedMissionTeamTasks(events)
}

/**
 * Return whether the current mission is terminal for automatic Team work.
 * A completed turn is terminal only with no unfinished work. An explicit user
 * cancellation remains authoritative even with outstanding tasks. Verified
 * action plus confirmation receipts cannot override active mission work.
 * @param events - Current Lead Session event log.
 * @returns Whether late reviewer spawn and queued wakeup must be refused.
 */
export function teamMissionClosed(events: readonly SessionEvent[]): boolean {
  const unfinished = unfinishedMissionWork(events)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/end') {
      if (event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user') return true
      return !unfinished && (event.data.reason.kind === 'completed' || event.data.reason.kind === 'aborted')
    }
    if (event?.type === 'user/message' && event.data.source.kind === 'user') break
  }

  if (unfinished) return false
  const boundary = events.findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  const current = events.slice(boundary + 1)
  const calls = new Map<string, string>()
  let action = false
  let verification = false
  for (const event of current) {
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), event.data.name)
    } else if (event.type === 'tool/result' && event.data.error === undefined
      && event.data.message.content.length > 0
      && event.data.message.content.every(block => block.isError !== true)) {
      const tool = calls.get(String(event.data.message.source.callId))
      if (tool !== undefined) {
        action ||= EFFECT.test(tool)
        verification ||= VERIFY.test(tool)
      }
    } else if (event.type === 'assistant/message' && action && verification) {
      const content = event.data.message.content
        .flatMap(block => block.type === 'text' ? [block.text] : [])
        .join(' ')
      // Closure is sticky in this user turn. A later model-produced "I'll review"
      // cannot undo Kira's evidenced final delivery or spawn an Aegis reviewer.
      if (NO_WORK_REMAINING.test(content)) return true
    }
  }
  return false
}
