/** Deterministic request history projection. @module */
import type { Message } from '@phoenix-ai/dsh-llm'
import type { SessionEventMap } from '@phoenix-ai/dsh-session'

/** Keep only the newest identical Phoenix-owned continuation instruction.
 * Unlike tool results or user messages, these notices are stateless control text.
 * The durable journal remains intact; request reconstruction uses this same projection.
 */
function removeDuplicatePhoenixNotices(messages: Message[]): Message[] {
  const seen = new Set<string>()
  const selected: Message[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined) continue
    const plugin = message.source.kind === 'plugin' ? message.source.plugin : undefined
    const block = message.content.length === 1 ? message.content[0] : undefined
    if ((plugin === 'model-selection' || plugin === 'agent-loop'
      || plugin === 'agent-loop-auto-continue') && block?.type === 'text') {
      const key = plugin + ':' + block.text
      if (seen.has(key)) continue
      seen.add(key)
    }
    selected.push(message)
  }
  return selected.reverse()
}

/**
 * Keep only a tiny, tool-free conversational tail for social/meta reactions.
 * This prevents a one-line steering comment from replaying megabytes of tool
 * calls/results accumulated by the task it interrupted. The logged policy
 * makes request reconstruction deterministic.
 * @param messages - Durable session history.
 * @param policy - Optional projection recorded on the current step.
 * @returns the exact model-visible history for that step.
 */
export function projectRequestHistory(
  messages: Message[],
  policy: SessionEventMap['step/start']['historyProjection'],
): Message[] {
  const deduplicated = removeDuplicatePhoenixNotices(messages)
  if (policy === undefined) return deduplicated
  const selected: Message[] = []
  let chars = 0
  for (let index = deduplicated.length - 1; index >= 0; index -= 1) {
    const message = deduplicated[index]
    if (message === undefined) continue
    const safe = message.source.kind === 'user'
      || (message.source.kind === 'model'
        && message.content.length > 0
        && message.content.every(block => block.type === 'text'))
    if (!safe || !message.content.every(block => block.type === 'text')) continue
    const size = message.content.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0)
    if (selected.length > 0 && chars + size > policy.maxChars) continue
    selected.push(message)
    chars += size
    if (selected.length >= policy.maxMessages) break
  }
  return selected.reverse()
}
