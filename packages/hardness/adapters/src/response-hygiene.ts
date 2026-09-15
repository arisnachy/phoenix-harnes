/** User-visible response hygiene for Phoenix conversation output. */

import type { Context } from '@phoenix-ai/cordis'
import type { GenerateOptions, Message, StreamChunk } from '@phoenix-ai/dsh-llm'

const INTERNAL_MARKER = /(?:AGENTS\.md|CLAUDE\.md|system prompt|developer prompt|prompt interno|instrucciones internas|\bMCP\b|\brouter\b|\bsubagente\b|\bsubagent\b|\bmemory id\b|`?[a-z][a-z0-9]+_[a-z0-9_]+`?)/iu
const PRIVATE_CONTEXT_MARKER = /(?:contexto familiar|contenido privado|tu familia|tus hijos|tus hijas|tu esposa|tu esposo|tu salud|tu diagnóstico|tu direccion|tu dirección)/iu
const INTERNAL_DEBUG_REQUEST = /(?:phoenix|harness).*(?:debug|depur|intern|tool|herramient|mcp|prompt|regla|router|subagente|subagent|config|arquitect|c[oó]digo|code)|(?:debug|depur).*(?:phoenix|harness)/iu
const PERSONAL_CONTEXT_REQUEST = /(?:recuerd|memoria|familia|hij[oa]s?|espos[oa]|salud|diagn[oó]stico|direcci[oó]n|datos personales|privacidad)/iu
const ACTION_REQUEST = /(?:revisa|revisar|busca|buscar|lee|leer|env[ií]a|enviar|manda|mandar|resume|resumir|check|search|find|read|send|summari[sz]e)/iu
const CAPABILITY_QUESTION = /(?:tienes|tiene|puedes|puede|can you|do you have).*(?:acceso|access|usar|use|conectad|connect)/iu

function messageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function latestHumanPrompt(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user' && message.source.kind === 'user') return messageText(message)
  }
  return ''
}

function capabilityOnly(prompt: string): boolean {
  return prompt.trim().length <= 160 && CAPABILITY_QUESTION.test(prompt) && !ACTION_REQUEST.test(prompt)
}

function stripParentheticalInternalDetails(text: string): string {
  return text.replace(/\s*\([^)]*(?:AGENTS\.md|CLAUDE\.md|\bMCP\b|system prompt|developer prompt|[a-z][a-z0-9]+_[a-z0-9_]+)[^)]*\)/giu, '')
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/u).map(part => part.trim()).filter(Boolean)
}

/**
 * Remove internal implementation disclosure and irrelevant private-context boilerplate from visible prose.
 * Explicit Phoenix debugging and explicit personal-memory questions remain transparent to the user.
 * @param text - complete user-visible text block.
 * @param latestPrompt - latest direct human prompt for relevance decisions.
 * @returns cleaned user-visible prose.
 */
export function sanitizePhoenixVisibleText(text: string, latestPrompt: string): string {
  const internalRequested = INTERNAL_DEBUG_REQUEST.test(latestPrompt)
  const personalRequested = PERSONAL_CONTEXT_REQUEST.test(latestPrompt)
  if (internalRequested) return text

  const withoutInternalParentheticals = stripParentheticalInternalDetails(text)
  const kept = sentences(withoutInternalParentheticals).filter((sentence) => {
    if (INTERNAL_MARKER.test(sentence)) return false
    if (!personalRequested && PRIVATE_CONTEXT_MARKER.test(sentence)) return false
    return true
  })
  const cleaned = kept.join(' ').replace(/\s+([,.;:!?])/gu, '$1').replace(/\s{2,}/gu, ' ').trim()
  if (!capabilityOnly(latestPrompt) || cleaned.length === 0) return cleaned
  return sentences(cleaned)[0] ?? cleaned
}

async function* sanitizeConversationStream(
  options: GenerateOptions,
  upstream: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  if (options.purpose !== undefined || options.sessionId === undefined) {
    yield* upstream
    return
  }

  const buffered: StreamChunk[] = []
  for await (const chunk of upstream) buffered.push(chunk)

  const prompt = latestHumanPrompt(options.messages)
  const sanitized = new Map<number, string>()
  for (const chunk of buffered) {
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      sanitized.set(chunk.index, sanitizePhoenixVisibleText(chunk.block.text, prompt))
    }
  }

  const emitted = new Set<number>()
  for (const chunk of buffered) {
    if (chunk.type === 'text-delta' && sanitized.has(chunk.index)) {
      if (emitted.has(chunk.index)) continue
      emitted.add(chunk.index)
      const text = sanitized.get(chunk.index) ?? ''
      if (text.length > 0) yield { ...chunk, text }
      continue
    }
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      const text = sanitized.get(chunk.index) ?? chunk.block.text
      if (!emitted.has(chunk.index) && text.length > 0) {
        emitted.add(chunk.index)
        yield { type: 'text-delta', index: chunk.index, text }
      }
      yield { ...chunk, block: { ...chunk.block, text } }
      continue
    }
    yield chunk
  }
}

/**
 * Install the host-owned conversation output guard at the LLM stream seam.
 * @param ctx - host Cordis context.
 * @returns disposer for the stream interceptor.
 */
export function installResponseHygiene(ctx: Context): () => void {
  return ctx.on('llm/stream', (options, next) => sanitizeConversationStream(options, next()))
}
