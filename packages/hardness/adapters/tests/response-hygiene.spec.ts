import type { Context } from '@phoenix-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@phoenix-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  installResponseHygiene,
  sanitizePhoenixChunks,
  sanitizePhoenixVisibleText,
} from '../src/response-hygiene.ts'

const sessionId = 'session-response-hygiene' as NonNullable<GenerateOptions['sessionId']>

function request(prompt: string, patch: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'test',
    model: 'test',
    sessionId,
    messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    ...patch,
  }
}

async function* stream(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const output: StreamChunk[] = []
  for await (const chunk of chunks) output.push(chunk)
  return output
}

describe('Phoenix response hygiene', () => {
  it('removes internal implementation and irrelevant private-context leakage from a simple capability answer', () => {
    const prompt = '¿Tienes acceso a Gmail?'
    const raw = 'Sí, tengo acceso a herramientas de Gmail (`search_emails`, `read_email`, etc.). Confirmo: veré solo lo que tú autorices en esta conversación, sin exponer contenido privado a terceros ni etiquetar nada de tu contexto familiar (nombres privados — nunca como etiqueta). Y recuerda: si hay código que modificar, verifico antes de decir "listo" (regla de AGENTS.md).'

    const clean = sanitizePhoenixVisibleText(raw, prompt)

    expect(clean).toBe('Sí, tengo acceso a herramientas de Gmail.')
    expect(clean).not.toContain('search_emails')
    expect(clean).not.toContain('read_email')
    expect(clean).not.toContain('AGENTS.md')
    expect(clean).not.toContain('contexto familiar')
  })

  it('keeps ordinary user-facing prose intact for an action request', () => {
    const raw = 'Claro. Voy a revisar los correos recientes y te resumo lo importante.'
    expect(sanitizePhoenixVisibleText(raw, 'Revisa mis correos recientes')).toBe(raw)
  })

  it('removes a standalone internal method sentence and can reduce the result to empty text', () => {
    expect(sanitizePhoenixVisibleText('Uso search_emails. Todo listo.', 'Hola')).toBe('Todo listo.')
    expect(sanitizePhoenixVisibleText('La regla está en AGENTS.md.', 'Hola')).toBe('')
  })

  it('does not shorten a long capability discussion that is not a simple capability question', () => {
    const prompt = `¿Tienes acceso a Gmail y puedes explicarme con detalle cómo funcionaría esa conexión para una auditoría extensa? ${'contexto '.repeat(12)}`
    const raw = 'Sí, puedo conectarme. También puedo explicar el alcance funcional.'
    expect(sanitizePhoenixVisibleText(raw, prompt)).toBe(raw)
  })

  it('does not hide implementation terms when the user explicitly asks to debug Phoenix internals', () => {
    const raw = 'La regla está en AGENTS.md y el conector expone search_emails.'
    expect(sanitizePhoenixVisibleText(raw, 'Estoy depurando Phoenix: dime qué regla interna y qué tool usa Gmail')).toBe(raw)
  })

  it('keeps personal context when the user explicitly asks about memory or family', () => {
    const raw = 'Recuerdo contexto de tu familia porque me lo contaste antes.'
    expect(sanitizePhoenixVisibleText(raw, '¿Qué recuerdas de mi familia?')).toBe(raw)
  })

  it('rewrites completed text blocks and drops stale replay state when visible text changes', () => {
    const raw = 'Sí, tengo acceso a Gmail (`search_emails`). Detalle interno en AGENTS.md.'
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Sí, tengo acceso a Gmail (`search_' },
      { type: 'text-delta', index: 0, text: 'emails`). Detalle interno en AGENTS.md.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: raw } },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { id: 'raw-response' } } },
    ]

    const result = sanitizePhoenixChunks(chunks, '¿Tienes acceso a Gmail?')

    expect(result).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Sí, tengo acceso a Gmail.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Sí, tengo acceso a Gmail.' } },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('retains replay state when text is unchanged and supports delta-only streams', () => {
    const replayState = { response: { id: 'clean-response' } }
    const result = sanitizePhoenixChunks([
      { type: 'block-start', index: 2, blockType: 'text' },
      { type: 'text-delta', index: 2, text: 'Claro.' },
      { type: 'finish', reason: { kind: 'stop' }, replayState },
    ], 'Hazlo')

    expect(result).toEqual([
      { type: 'block-start', index: 2, blockType: 'text' },
      { type: 'text-delta', index: 2, text: 'Claro.' },
      { type: 'finish', reason: { kind: 'stop' }, replayState },
    ])
  })

  it('flushes delta-only text when a provider omits the terminal finish chunk', () => {
    expect(sanitizePhoenixChunks([
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Respuesta final.' },
    ], 'Continúa')).toEqual([
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Respuesta final.' },
    ])
  })

  it('preserves non-text chunks and emits no visible delta for fully removed text', () => {
    const result = sanitizePhoenixChunks([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'private reasoning stream' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning stream' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'AGENTS.md' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], 'Hola')

    expect(result).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'private reasoning stream' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning stream' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'block-end', index: 1, block: { type: 'text', text: '' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('installs one stream interceptor, sanitizes normal sessions, and returns its disposer', async () => {
    type Listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
    let listener: Listener | undefined
    let disposed = false
    const ctx = {
      on(event: string, callback: Listener) {
        expect(event).toBe('llm/stream')
        listener = callback
        return () => { disposed = true }
      },
    } as unknown as Context
    const dispose = installResponseHygiene(ctx)
    const chunks: StreamChunk[] = [
      { type: 'text-delta', index: 0, text: 'Uso search_emails. Listo.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const output = await collect(listener!(request('¿Tienes acceso a Gmail?'), () => stream(chunks)))
    expect(output).toEqual([
      { type: 'text-delta', index: 0, text: 'Listo.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    dispose()
    expect(disposed).toBe(true)
  })

  it('bypasses auxiliary calls, non-session calls, and explicit internal-debug requests', async () => {
    type Listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
    let listener: Listener | undefined
    const ctx = {
      on(_event: string, callback: Listener) {
        listener = callback
        return () => {}
      },
    } as unknown as Context
    installResponseHygiene(ctx)
    const raw: StreamChunk[] = [
      { type: 'text-delta', index: 0, text: 'AGENTS.md search_emails' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    expect(await collect(listener!(request('Resumen', { purpose: 'session-title' }), () => stream(raw)))).toEqual(raw)
    expect(await collect(listener!(request('¿Tienes acceso?', { sessionId: undefined }), () => stream(raw)))).toEqual(raw)
    expect(await collect(listener!(request('Depura Phoenix y dime qué tool interno usa Gmail'), () => stream(raw)))).toEqual(raw)
  })

  it('uses the latest direct human prompt rather than later plugin context', async () => {
    type Listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
    let listener: Listener | undefined
    const ctx = {
      on(_event: string, callback: Listener) {
        listener = callback
        return () => {}
      },
    } as unknown as Context
    installResponseHygiene(ctx)
    const messages = [
      createUserMessage({ content: [{ type: 'text', text: '¿Tienes acceso a Gmail?' }], source: { kind: 'user' } }),
      createUserMessage({ content: [{ type: 'text', text: 'context injection' }], source: { kind: 'plugin', plugin: 'test' } }),
    ]
    const chunks: StreamChunk[] = [
      { type: 'text-delta', index: 0, text: 'Sí. Segunda frase.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    expect(await collect(listener!(request('ignored', { messages }), () => stream(chunks)))).toEqual([
      { type: 'text-delta', index: 0, text: 'Sí.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('sanitizes session output even when there is no direct human prompt in history', async () => {
    type Listener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
    let listener: Listener | undefined
    const ctx = {
      on(_event: string, callback: Listener) {
        listener = callback
        return () => {}
      },
    } as unknown as Context
    installResponseHygiene(ctx)
    const chunks: StreamChunk[] = [
      { type: 'text-delta', index: 0, text: 'AGENTS.md. Mensaje útil.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    expect(await collect(listener!(request('ignored', { messages: [] }), () => stream(chunks)))).toEqual([
      { type: 'text-delta', index: 0, text: 'Mensaje útil.' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })
})
