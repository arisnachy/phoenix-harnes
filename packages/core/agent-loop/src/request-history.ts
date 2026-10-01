/** Deterministic request history projection. @module */
import type { Message } from '@phoenix-ai/dsh-llm'
import type { SessionEventMap } from '@phoenix-ai/dsh-session'

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
  if (policy === undefined) return messages
  const selected: Message[] = []
  let chars = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
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
