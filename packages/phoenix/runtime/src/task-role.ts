import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { PhoenixRole } from './model-ladder.ts'

function messageText(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content)
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .toLowerCase()
}

/**
 * Deterministic, zero-token first-pass task classifier.
 * @param messages - current user-message context whose plain text should be classified.
 * @returns PHOENIX role selected by stable lexical intent rules.
 */
export function classifyTaskRole(messages: readonly UserMessage[]): PhoenixRole {
  const text = messageText(messages)
  if (/security|vulnerab|exploit|threat|attack|secret|credential|permission|sandbox/.test(text)) return 'security'
  if (/review|judge|verify|validate|audit|regression|prove|proof/.test(text)) return 'verifier'
  if (/research|investig|search the web|find sources|literature|evidence/.test(text)) return 'researcher'
  if (/debug|bug|error|failing|failure|stack trace|exception|fix/.test(text)) return 'builder'
  if (/implement|build|code|refactor|typescript|python|rust|function|class|package/.test(text)) return 'builder'
  if (/architect|plan|orchestrat|decompose|roadmap|strategy|multi-agent|parallel/.test(text)) return 'orchestrator'
  if (/critic|challenge|adversarial|weakness|counterexample/.test(text)) return 'critic'
  if (/analy|compare|explain|reason|diagnos/.test(text)) return 'analyst'
  return 'routine'
}

/**
 * Decide whether delegation is too small to justify starting another model process.
 * @param task - delegated objective text.
 * @param maxChars - maximum length still eligible for the cheap lexical triviality rule.
 * @returns True for empty or short lookup-style objectives that should use deterministic tools directly.
 */
export function isTrivialDelegation(task: string, maxChars: number = 220): boolean {
  const normalized = task.trim().toLowerCase()
  if (normalized.length === 0) return true
  if (normalized.length > maxChars) return false
  return /^(find|locate|search|show|read|grep|which file|where is|list|cat|check)\b/.test(normalized)
}
