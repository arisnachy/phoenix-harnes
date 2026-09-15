/** User-visible response hygiene for Phoenix conversation output. */

import type { Context } from '@phoenix-ai/cordis'
import type { GenerateOptions, Message, StreamChunk } from '@phoenix-ai/dsh-llm'

const INTERNAL_MARKER = /(?:AGENTS\.md|CLAUDE\.md|system prompt|developer prompt|prompt interno|instrucciones internas|\bMCP\b|\brouter\b|\bsubagente\b|\bsubagent\b|\bmemory id\b|\b(?:search|read|send|list|fetch|create|update|delete)_[a-z0-9_]+\b)/iu
const PRIVATE_CONTEXT_MARKER = /(?:contexto familiar|contenido privado|tu familia|tus hijos|tus hijas|tu esposa|tu esposo|tu salud|tu diagnóstico|tu direccion|tu dirección)/iu
const INTERNAL_DEBUG_REQUEST = /(?:phoenix|harness).*(?:debug|depur|intern|tool|herramient|mcp|prompt|regla|router|subagente|subagent|config|arquitect|c[oó]digo|code)|(?:debug|depur).*(?:phoenix|harness)/iu
const PERSONAL_CONTEXT_REQUEST = /(?:recuerd|memoria|familia|hij[oa]s?|espos[oa]|salud|diagn[oó]stico|direcci[oó]n|datos personales|privacidad)/iu
const ACTION_REQUEST = /(?:revisa|revisar|busca|buscar|lee|leer|env[ií]a|enviar|manda|mandar|resume|resumir|check|search|find|read|send|summari[sz]e)/iu
const CAPABILITY_QUESTION = /(?:tienes|tiene|puedes|puede|can you|do you have).*(?:acceso|access|usar|use|conectad|connect)/iu

function messageText(message: Message): string {
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
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
  return text.replace(/\s*\([^)]*(?:AGENTS\.md|CLAUDE\.md|\bMCP\b|system prompt|developer prompt|(?:search|read|send|list|fetch|create|update|delete)_[a-z0-9_]+)[^)]*\)/giu, '')
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
  return sentences(cleaned)[0]!
}

interface SanitizedTextBlocks {
  readonly raw: ReadonlyMap<number, string>
  readonly clean: ReadonlyMap<number, string>
}

function completeTextBlocks(chunks: readonly StreamChunk[], prompt: string): SanitizedTextBlocks {
  const raw = new Map<number, string>()
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      raw.set(chunk.index, `${raw.get(chunk.index) ?? ''}${chunk.text}`)
    } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      raw.set(chunk.index, chunk.block.text)
    }
  }
  return {
    raw,
    clean: new Map([...raw].map(([index, text]) => [index, sanitizePhoenixVisibleText(text, prompt)])),
  }
}

function textChanged(blocks: SanitizedTextBlocks): boolean {
  for (const [index, rawText] of blocks.raw) {
    if (blocks.clean.get(index) !== rawText) return true
  }
  return false
}

function appendPendingText(output: StreamChunk[], blocks: SanitizedTextBlocks, emitted: Set<number>): void {
  for (const [index, text] of blocks.clean) {
    if (emitted.has(index)) continue
    emitted.add(index)
    if (text.length > 0) output.push({ type: 'text-delta', index, text })
  }
}

/**
 * Rewrite complete model chunks so only sanitized text can reach the durable transcript or UI.
 * If visible text changes, provider replay state is dropped because it still represents the unsanitized response.
 * @param chunks - complete chunks from one ordinary conversation model call.
 * @param latestPrompt - latest direct human prompt.
 * @returns chunks carrying the same non-text behavior and sanitized text blocks.
 */
export function sanitizePhoenixChunks(chunks: readonly StreamChunk[], latestPrompt: string): StreamChunk[] {
  const blocks = completeTextBlocks(chunks, latestPrompt)
  const changed = textChanged(blocks)
  const emitted = new Set<number>()
  const output: StreamChunk[] = []

  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') continue
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      const text = blocks.clean.get(chunk.index) ?? chunk.block.text
      emitted.add(chunk.index)
      if (text.length > 0) output.push({ type: 'text-delta', index: chunk.index, text })
      output.push({ ...chunk, block: { ...chunk.block, text } })
      continue
    }
    if (chunk.type === 'finish') {
      appendPendingText(output, blocks, emitted)
      if (changed && chunk.replayState !== undefined) {
        const { replayState: _replayState, ...safeFinish } = chunk
        output.push(safeFinish)
      } else {
        output.push(chunk)
      }
      continue
    }
    output.push(chunk)
  }

  appendPendingText(output, blocks, emitted)
  return output
}

async function* sanitizeConversationStream(
  options: GenerateOptions,
  upstream: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const prompt = latestHumanPrompt(options.messages)
  if (options.purpose !== undefined || options.sessionId === undefined || INTERNAL_DEBUG_REQUEST.test(prompt)) {
    yield* upstream
    return
  }

  const buffered: StreamChunk[] = []
  for await (const chunk of upstream) buffered.push(chunk)
  yield* sanitizePhoenixChunks(buffered, prompt)
}

/**
 * Install the host-owned conversation output guard at the LLM stream seam.
 * @param ctx - host Cordis context.
 * @returns disposer for the stream interceptor.
 */
export function installResponseHygiene(ctx: Context): () => void {
  return ctx.on('llm/stream', (options, next) => sanitizeConversationStream(options, next()))
}
