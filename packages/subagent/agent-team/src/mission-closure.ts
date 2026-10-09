/** Durable Team admission boundary: a settled or tool-proven closed Lead mission is not a new assignment. */
import type { SessionEvent } from '@phoenix-ai/dsh-session'

// Closure language alone cannot close a mission. A model can say "done" too early;
// this narrow early-stop path additionally needs successful effect AND verification receipts.
// oxlint-disable-next-line @stylistic/max-len -- Bilingual explicit no-work-remaining patterns must stay auditable.
const NO_WORK_REMAINING = /\b(?:no (?:queda|hay) (?:m[aá]s )?(?:trabajo|tareas?|nada) pendiente|no (?:queda|hay) (?:trabajo|tareas?) (?:por hacer|que justifique delegar)|nothing (?:else )?(?:is )?left to do|no (?:further|more|additional) work (?:is )?(?:needed|required|remaining)|(?:tarea|misi[oó]n) (?:ya )?(?:completada|finalizada) y verificada)\b/iu
const EFFECT = /(?:^|__)(?:submit_form|fill_form|send_email|create_file|update_file|apply_patch|write|edit|submit|deploy|publish|save|send|execute|run_code|browser_submit|browser_fill_form|click_text|update_ref|merge_pull_request)$/iu
const VERIFY = /(?:^|__)(?:wait_for|read_page|verify|check|test|typecheck|build|read|inspect_form|inspect_page|browser_snapshot|browser_inspect|status)$/iu

/**
 * Return whether the current mission is terminal for automatic Team work.
 * A completed or aborted real turn is authoritative. While the turn is still
 * running, an explicit final "no work remaining" statement is accepted only
 * if distinct real successful action AND confirmation tools preceded it.
 * A new human request/turn reopens work; peer handoffs and narration do not.
 * @param events - Current Lead Session event log.
 * @returns Whether late reviewer spawn and queued wakeup must be refused.
 */
export function teamMissionClosed(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/end') {
      return event.data.reason.kind === 'completed' || event.data.reason.kind === 'aborted'
    }
    if (event?.type === 'user/message' && event.data.source.kind === 'user') break
    if (event?.type === 'turn/start') break
  }

  const boundary = events.findLastIndex(event =>
    event.type === 'turn/start' || (event.type === 'user/message' && event.data.source.kind === 'user'))
  const current = events.slice(boundary + 1)
  const statement = current.findLast(event => event.type === 'assistant/message')
  if (statement?.type !== 'assistant/message') return false
  const content = statement.data.message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join(' ')
  if (!NO_WORK_REMAINING.test(content)) return false

  const calls = new Map<string, string>()
  let action = false
  let verification = false
  for (const event of current) {
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), event.data.name)
    } else if (event.type === 'tool/result' && event.data.error === undefined
      && event.data.message.content.some(block => block.type === 'tool-result' && block.isError !== true)) {
      const tool = calls.get(String(event.data.message.source.callId))
      if (tool !== undefined) {
        action ||= EFFECT.test(tool)
        verification ||= VERIFY.test(tool)
      }
    }
  }
  return action && verification
}
