/** Root-owned language selection for natural, consistent Team dialogue. */
import type { SessionEvent } from '@phoenix-ai/dsh-session'

/** Supported high-confidence language hints; other languages stay user-led. */
export type TeamUserLanguage = 'es' | 'en' | 'auto'

const SPANISH = new Set([
  'de', 'del', 'el', 'la', 'las', 'los', 'que', 'qué', 'como', 'cómo',
  'para', 'por', 'con', 'una', 'uno', 'este', 'esta', 'esto', 'es',
  'hay', 'pero', 'quiero', 'puedes', 'puede', 'haces', 'hacer',
  'haz', 'hazlo', 'arreglar', 'arregla', 'dejar', 'dejalo', 'déjalo',
  'gracias', 'mira', 'hablar', 'habla', 'idioma', 'español', 'usuario',
  'equipo', 'conversación', 'tarea', 'revisar', 'necesito', 'también',
  'tiene', 'tienen', 'cuando', 'donde', 'dónde', 'está', 'están',
])
const ENGLISH = new Set([
  'the', 'and', 'that', 'this', 'what', 'why', 'how', 'when',
  'with', 'from', 'for', 'you', 'your', 'please', 'could', 'should',
  'would', 'want', 'make', 'fix', 'check', 'show', 'need',
  'task', 'user', 'team', 'conversation', 'language', 'english',
  'done', 'review', 'can', 'are', 'have', 'does', 'there',
])

/**
 * Classify only natural-language user text, not quoted logs or technical code.
 * @param text - One genuine human message.
 * @returns High-confidence language or auto when it cannot be inferred.
 */
export function classifyTeamUserLanguage(text: string): TeamUserLanguage {
  const prose = text
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/https?:\/\/[^\s]+/giu, ' ')
    .replace(/\b[\w.-]+\.(?:ts|tsx|js|json|md|log|yaml)\b/giu, ' ')
  const tokens = prose.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? []
  let spanish = 0
  let english = 0
  for (const token of tokens.slice(0, 350)) {
    if (SPANISH.has(token)) spanish += 1
    if (ENGLISH.has(token)) english += 1
    if (/[áéíóúñ¿¡]/u.test(token)) spanish += 2
  }
  if (spanish >= 2 && spanish >= english * 1.35) return 'es'
  if (english >= 2 && english >= spanish * 1.35) return 'en'
  return 'auto'
}

/**
 * Read the last language-bearing human message of the root Team conversation.
 * Do not learn a language from model output, tool results or system messages.
 * @param events - Durable root Session events.
 * @returns Current user's language, or auto if ambiguous or unsupported.
 */
export function teamUserLanguage(events: readonly SessionEvent[]): TeamUserLanguage {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined) continue
    let text: string | undefined
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    } else if (event.type === 'team/chat-message' && event.data.message.senderKind === 'user'
      && event.data.update !== true) {
      text = event.data.message.text
    }
    if (text === undefined) continue
    const language = classifyTeamUserLanguage(text)
    if (language !== 'auto') return language
  }
  return 'auto'
}

/**
 * A root-owned conversational constraint for the Lead and every child worker.
 * @param events - Current root Session events.
 * @returns Model-facing instruction, with no private message content copied.
 */
export function teamLanguageInstruction(events: readonly SessionEvent[]): string {
  const language = teamUserLanguage(events)
  const target = language === 'es' ? 'Spanish (es)'
    : language === 'en' ? 'English (en)' : 'the language of the latest genuine user message'
  return `Team conversational language: ${target}. Every user-visible utterance from Kira and each specialist MUST be written naturally in ${target}: work updates, questions, blockers, peer send_message/followup_task handoffs, team_chat_answer, and the final answer. Tool outputs, English system/tool instructions, and source documents must not silently switch the conversation to English. Preserve exact technical identifiers, error strings, filenames, URLs, citations and verbatim quotations; explain their meaning in the user's language. On a later actual user language change, follow the new language. Do not run a separate translation task or create extra status messages.`
}
