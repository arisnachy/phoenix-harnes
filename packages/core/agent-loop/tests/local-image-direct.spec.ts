import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import LlmRuntime, { createUserMessage } from '@phoenix-ai/dsh-llm'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import { localImageDirectPrompt } from '../src/local-image-direct.ts'

const mockWorker = vi.hoisted(() => vi.fn())

vi.mock('../src/local-image-direct.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/local-image-direct.ts')>(),
  runLocalImageDirect: mockWorker,
}))

const savedEnabled = process.env.PHOENIX_FASTSD_ENABLE
beforeEach(() => {
  delete process.env.PHOENIX_FASTSD_ENABLE
  mockWorker.resetAllMocks()
  mockWorker.mockResolvedValue('![Imagen generada localmente](/local-images/0123456789abcdef0123456789abcdef.jpg)')
})
afterEach(() => {
  if (savedEnabled === undefined) delete process.env.PHOENIX_FASTSD_ENABLE
  else process.env.PHOENIX_FASTSD_ENABLE = savedEnabled
})

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('Direct local-image request isolation', () => {
  it('recognizes a self-contained local request and preserves the real user subject', () => {
    const msg = (text: string) => createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    expect(localImageDirectPrompt(msg('Kira, genera una imagen local de un corazón humano usando SD Turbo OpenVINO')))
      .toBe('un corazón humano')
    expect(localImageDirectPrompt(msg('por favor crea una ilustración local de riñón humano con FastSD CPU')))
      .toBe('riñón humano')
    expect(localImageDirectPrompt(msg('Kira, genera una imagen de un cerebro usando SD Turbo OpenVINO')))
      .toBe('un cerebro')
    expect(localImageDirectPrompt(msg('Explica cómo generar una imagen con FastSD'))).toBeUndefined()
    expect(localImageDirectPrompt(msg('No generes una imagen local'))).toBeUndefined()
    expect(localImageDirectPrompt(msg('Genera una imagen como la anterior usando SD Turbo OpenVINO'))).toBeUndefined()
    expect(localImageDirectPrompt(msg('Kira, edita esta imagen local'))).toBeUndefined()
    expect(localImageDirectPrompt(msg('Kira, genera una imagen de un corazón'))).toBeUndefined()
    expect(localImageDirectPrompt(msg('Genera una imagen local de un corazón'.repeat(500)))).toBeUndefined()
    expect(localImageDirectPrompt(undefined)).toBeUndefined()
    expect(localImageDirectPrompt(createUserMessage({
      content: [{ type: 'text', text: 'genera una imagen local de gato' }, { type: 'text', text: 'extra' }],
      source: { kind: 'user' },
    }))).toBeUndefined()
    expect(localImageDirectPrompt(createUserMessage({
      content: [{ type: 'text', text: 'genera una imagen local de gato' }],
      source: { kind: 'plugin', plugin: 'x' },
    }))).toBeUndefined()
    process.env.PHOENIX_FASTSD_ENABLE = '0'
    expect(localImageDirectPrompt(msg('genera una imagen local de gato'))).toBeUndefined()
  })

  it('bypasses all model calls after a large pre-existing chat history', async () => {
    const adapter = new MockAdapter([textResponse('historial aceptado')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('fastsd-direct-large-history'), { provider: 'mock', model: 'mock' })
    const steps: number[] = []
    ctx.on('agent/pre-step', ({ agent: owner }, next) => {
      if (owner === agent) steps.push(1)
      return next()
    })
    send(agent, 'analiza lo siguiente: ' + 'token '.repeat(12000))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    send(agent, 'Kira, genera una imagen local de un corazón humano usando SD Turbo OpenVINO')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(steps).toHaveLength(1)
    expect(mockWorker).toHaveBeenCalledOnce()
    expect(mockWorker).toHaveBeenCalledWith('un corazón humano', expect.any(AbortSignal))
    const userEvents = agent.session.events.filter(event => event.type === 'user/message')
    expect(userEvents).toHaveLength(2)
    const assistants = agent.session.events.filter(event => event.type === 'assistant/message')
    expect(assistants).toHaveLength(2)
    const image = assistants.at(-1)
    expect(image?.type === 'assistant/message' && image.data.message.content)
      .toEqual([{ type: 'text', text: '![Imagen generada localmente](/local-images/0123456789abcdef0123456789abcdef.jpg)' }])
    expect(image?.type === 'assistant/message' && image.data.message.source)
      .toMatchObject({ provider: 'fastsd-local', model: 'sd-turbo-openvino' })
    expect(agent.session.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason)
      .toEqual({ kind: 'completed' })
    await ctx.dispose()
  })

  it('surfaces real generator failures in the chat without falling back to the local LLM', async () => {
    mockWorker.mockRejectedValueOnce(new Error('FastSD CPU sin modelo descargado'))
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('fastsd-direct-failure'), { provider: 'mock', model: 'mock' })
    send(agent, 'Kira, genera una imagen local de un cerebro usando SD Turbo OpenVINO')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    const response = agent.session.events.find(event => event.type === 'assistant/message')
    expect(response?.type === 'assistant/message' && response.data.message.content)
      .toEqual([{ type: 'text', text: 'No se pudo generar la imagen local con SD Turbo OpenVINO: FastSD CPU sin modelo descargado' }])
    await ctx.dispose()
  })

  it('leaves context-dependent requests on the ordinary agent route', async () => {
    const adapter = new MockAdapter([textResponse('necesito referencia')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('fastsd-no-reference-bypass'), { provider: 'mock', model: 'mock' })
    send(agent, 'Kira, genera una imagen como la anterior usando SD Turbo OpenVINO')
    await agent.whenIdle()
    expect(mockWorker).not.toHaveBeenCalled()
    expect(adapter.requests).toHaveLength(1)
    await ctx.dispose()
  })
})
