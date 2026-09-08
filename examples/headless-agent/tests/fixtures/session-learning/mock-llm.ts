import type { Context } from '@phoenix-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@phoenix-ai/dsh-llm'

export interface MemoryCapture {
  readonly sessionId: string
  readonly memories: readonly {
    readonly sessionId: string
    readonly kind: string
    readonly summary: string
  }[]
}

const OFF = ReasoningEffortId('off')
const captures: MemoryCapture[] = []

function memoriesFromSystem(system: string | undefined): MemoryCapture['memories'] {
  return memoriesFromText(system)
}

function memoriesFromText(text: string | undefined): MemoryCapture['memories'] {
  const match = text?.match(/<phoenix-memory>\n([\s\S]*?)\n<\/phoenix-memory>/u)
  if (match?.[1] === undefined) return []
  const parsed: unknown = JSON.parse(match[1])
  if (typeof parsed !== 'object' || parsed === null || !('memories' in parsed) || !Array.isArray(parsed.memories)) return []
  return parsed.memories.flatMap((value): MemoryCapture['memories'][number][] => {
    if (typeof value !== 'object' || value === null) return []
    const item = value as { session_id?: unknown; kind?: unknown; summary?: unknown }
    return typeof item.session_id === 'string' && typeof item.kind === 'string' && typeof item.summary === 'string'
      ? [{ sessionId: item.session_id, kind: item.kind, summary: item.summary }]
      : []
  })
}

/** Requests captured from the real agent-loop model seam for this fixture. */
export function drainCaptures(): MemoryCapture[] {
  return captures.splice(0).map(capture => ({ ...capture, memories: [...capture.memories] }))
}

class LearningMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const memories = [
      ...memoriesFromSystem(options.system),
      ...options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? memoriesFromText(block.text) : [])),
    ]
    captures.push({ sessionId: String(options.sessionId), memories })
    const reply = `LEARNING_MEMORY_REPLY:${String(options.sessionId)}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'learning-mock-llm'
export const inject = ['llm']

/** Register the deterministic external model substitute used by the assembled example. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['learning-mock'], new LearningMockAdapter())
}
