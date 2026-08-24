/**
 * Borrowed-eyes prompt admission: chat images on text-only routes are refused
 * exactly as before while no fallback is configured, transcribed through a
 * discovered or pinned vision route when enabled, refused fail-closed when
 * the side call fails, and passed through untouched for native vision routes.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo,
  StreamChunk, UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`vision-${String(nextRpc++)}`), payload }
}

class StubAdapter extends LlmAdapter {
  constructor(
    private readonly label: string,
    private readonly listed: readonly LlmModelInfo[],
    private readonly modalities: readonly string[],
    private readonly script?: (options: GenerateOptions) => StreamChunk[],
    private readonly calls: GenerateOptions[] = [],
  ) {
    super()
  }

  get streamCalls(): GenerateOptions[] {
    return this.calls
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.label }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.listed)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      inputModalities: [...this.modalities] as never,
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield* this.script?.(options) ?? []
  }
}

const SEE_MODELS: readonly LlmModelInfo[] = [
  { provider: 'eyes', id: 'see-1', name: 'Seer One', inputModalities: ['text', 'image'] },
]

function visionChunks(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'Una captura de prueba.' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Una captura de prueba.' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

async function harness(options?: {
  eyes?: boolean
  eyesChunks?: () => StreamChunk[]
}): Promise<{
  ctx: Context
  agent: Agent
  sessionId: import('@deepseek-ai/dsh-session').SessionId
  eyeCalls: GenerateOptions[]
  followup: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['plain'], new StubAdapter('Plain', [], ['text']))
  const eyeCalls: GenerateOptions[] = []
  if (options?.eyes !== false) {
    ctx.llm.registerAdapter(['eyes'], new StubAdapter(
      'Eyes', SEE_MODELS, ['text', 'image'],
      () => options?.eyesChunks?.() ?? visionChunks(),
      eyeCalls,
    ))
  }
  const session = ctx.sessions.create()
  session.append('request/header', {
    header: { config: { provider: 'plain', model: 'txt-1' } },
    reason: 'initial',
  })
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  const validateImage = vi.fn((_input: { data: Uint8Array }) => Promise.resolve())
  const saveImage = vi.fn((input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
    attachmentId: 'att-1',
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 1,
    height: 1,
    ...input.name === undefined ? {} : { name: input.name },
  }))
  const attachments = {
    imageLimits: {
      maxImageBytes: 64,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 128,
      maxImagePixels: 4096,
      maxImageDimension: 2000,
      mediaTypes: ['image/png'],
    },
    validateImage,
    saveImage,
  }
  ctx.provide('attachments', Object.setPrototypeOf(attachments, AttachmentStore.prototype) as never)
  const followup = vi.fn()
  Object.assign(agent, { followup })
  return {
    ctx, agent, sessionId: session.id, eyeCalls, followup,
  }
}

function proxy(ctx: Context, visionFallback?: Record<string, unknown>) {
  return createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'plain', model: 'txt-1' }),
    cwd: '/tmp',
    ...(visionFallback === undefined ? {} : { visionFallback: visionFallback as never }),
  })
}

const IMAGE_PART = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'shot.png' }

describe('Borrowed-eyes prompt admission', () => {
  it('refuses images on a text-only route when the fallback stays disabled', async () => {
    const { ctx, sessionId, followup } = await harness({ eyes: true })
    const api = proxy(ctx)
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART, { type: 'text', text: 'compare' }],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('transcribes an attachment through the discovered vision entry', async () => {
    const { ctx, sessionId, followup, eyeCalls } = await harness()
    const api = proxy(ctx, { enabled: true })
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART, { type: 'text', text: '¿Qué ves?' }],
    }))
    expect(result.result.ok).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
    const delivered = (followup.mock.calls[0]?.[0] as UserMessage).content
    expect(delivered.some(block => block.type === 'image')).toBe(false)
    expect(delivered[1]).toEqual({ type: 'text', text: '¿Qué ves?' })
    expect(delivered[0]?.type).toBe('text')
    const transcript = (delivered[0] as { text: string }).text
    expect(transcript).toContain('"shot.png"')
    expect(transcript).toContain('fallback vision model see-1')
    expect(transcript).toContain('Una captura de prueba.')
    // The side call reached the discovered vision route with the saved attachment.
    expect(eyeCalls).toHaveLength(1)
    expect(eyeCalls[0]?.provider).toBe('eyes')
    expect(eyeCalls[0]?.model).toBe('see-1')
    expect(eyeCalls[0]?.system).toContain('vision fallback')
    const sideContent = eyeCalls[0]?.messages[0]?.content ?? []
    expect(sideContent.some(block =>
      block.type === 'image' && block.attachment.attachmentId === 'att-1')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('honors an explicit fallback route override', async () => {
    const { ctx, sessionId, eyeCalls } = await harness()
    const api = proxy(ctx, { enabled: true, provider: 'eyes', model: 'pinned' })
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART],
    }))
    expect(result.result.ok).toBe(true)
    expect(eyeCalls[0]?.model).toBe('pinned')
    await ctx.fiber.dispose()
  })

  it('still refuses when discovery finds no image-capable entry', async () => {
    const { ctx, sessionId, followup, eyeCalls } = await harness({ eyes: false })
    const api = proxy(ctx, { enabled: true })
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' } },
    })
    expect(followup).not.toHaveBeenCalled()
    expect(eyeCalls).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('refuses fail-closed when the side call fails', async () => {
    const { ctx, sessionId, followup, eyeCalls } = await harness({
      eyesChunks: () => [{
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'boom', code: 'PROVIDER_DOWN' } },
      }],
    })
    const api = proxy(ctx, { enabled: true })
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'VISION_FALLBACK_FAILED' } },
    })
    expect(followup).not.toHaveBeenCalled()
    expect(eyeCalls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('passes images through untouched for a native vision selection', async () => {
    const { ctx, agent, sessionId, followup, eyeCalls } = await harness()
    agent.session.append('request/header', {
      header: { config: { provider: 'eyes', model: 'see-1' } },
      reason: 'change',
    })
    const api = proxy(ctx, { enabled: true })
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [IMAGE_PART, { type: 'text', text: 'look' }],
    }))
    expect(result.result.ok).toBe(true)
    const delivered = (followup.mock.calls[0]?.[0] as UserMessage).content
    expect(delivered[0]).toEqual({
      type: 'image',
      attachment: {
        attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'shot.png',
      },
    })
    expect(delivered[1]).toEqual({ type: 'text', text: 'look' })
    // No borrowed eyes were spent on a route that sees natively.
    expect(eyeCalls).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
