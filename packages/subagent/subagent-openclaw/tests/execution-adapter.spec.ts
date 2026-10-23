import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { Context } from '@phoenix-ai/cordis'
import type { ExecutionContext, ExecutionSnapshot } from '@phoenix-ai/dsh-agent-team'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenClawExecutionAdapter,
  apply,
} from '../src/index.ts'
import type { OpenClawPolicyAttester } from '../src/types.ts'

interface RequestFrame {
  readonly type: 'req'
  readonly id: string
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface Gateway {
  readonly url: string
  readonly requests: RequestFrame[]
  close(): Promise<void>
}

const gateways: Gateway[] = []

const nativePolicy = {
  provider: 'openai', model: 'gpt-5', agentRuntime: 'codex', sandbox: 'workspace-write', approval: 'never', cwd: 'C:/phoenix-workspace',
  toolPolicy: { profile: 'minimal', allow: ['session_status'], deny: ['browser', 'cron', 'gateway', 'group:fs', 'group:runtime', 'group:web', 'nodes'], profileHash: 'sha256:fixture' },
} as const

async function gatewayFor(options: {
  readonly agentModel?: string
  readonly sessionModel?: string
  readonly holdWait?: boolean
  readonly dropAgentAck?: boolean
  readonly malformedWait?: boolean
  readonly sessionKey?: string
  readonly emitOutput?: boolean
  readonly overflowOutput?: boolean
  readonly emitUnrelated?: boolean
} = {}): Promise<Gateway> {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture Gateway did not bind a TCP port')
  const requests: RequestFrame[] = []
  let createdKey = options.sessionKey
  let aborted = false
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture', ts: 1 } }))
    socket.on('message', (raw) => {
      const request = JSON.parse(raw.toString()) as RequestFrame
      requests.push(request)
      if (request.method === 'connect') {
        socket.send(JSON.stringify({
          type: 'res', id: request.id, ok: true,
          payload: {
            type: 'hello-ok', protocol: 4,
            server: { version: 'fixture-openclaw', connId: 'fixture-connection' },
            features: { methods: ['health', 'agents.list', 'sessions.list', 'sessions.create', 'sessions.abort', 'agent', 'agent.wait', 'chat.history'], events: ['agent'] },
            auth: { role: 'operator', scopes: ['operator.read', 'operator.write'] },
            policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 1024 * 1024, tickIntervalMs: 15_000 },
          },
        }))
        return
      }
      if (request.method === 'sessions.abort') { aborted = true }
      if (request.method === 'agent.wait' && options.holdWait === true && !aborted) return
      if (request.method === 'agent' && options.dropAgentAck === true) { socket.terminate(); return }
      const payload = request.method === 'agents.list'
        ? { agents: [{ id: 'worker', model: { primary: `openai/${options.agentModel ?? 'gpt-5'}` }, agentRuntime: { id: 'codex' } }] }
        : request.method === 'sessions.list'
          ? { sessions: [{ key: createdKey ?? 'agent:worker:phoenix', agentId: 'worker', modelProvider: 'openai', model: options.sessionModel ?? 'gpt-5', agentRuntime: { id: 'codex' } }] }
          : request.method === 'sessions.create'
            ? (createdKey = String(request.params?.key ?? ''), { key: createdKey, sessionId: 'session-1', agentId: 'worker', modelProvider: 'openai', model: 'gpt-5', agentRuntime: { id: 'codex' } })
            : request.method === 'agent'
              ? { runId: 'native-run-1', status: 'accepted', acceptedAt: 1 }
              : request.method === 'agent.wait'
                ? options.malformedWait === true ? { unrecognized: true } : { runId: 'native-run-1', status: 'ok', stopReason: aborted ? 'aborted' : 'completed' }
                : request.method === 'chat.history'
                  ? { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'native answer' }] }] }
                  : { ok: true }
      const shouldEmitOutput = (request.method === 'agent' || request.method === 'agent.wait')
        && (options.emitOutput ?? true)
        && options.malformedWait !== true
      const emitOutput = () => {
        const runId = 'native-run-1'
        const sessionKey = String(request.params?.sessionKey ?? createdKey ?? 'agent:worker:phoenix')
        if (options.emitUnrelated ?? true) {
          socket.send(JSON.stringify({ type: 'event', event: 'agent', payload: {
            runId: 'other-run', sessionKey, stream: 'assistant', data: { delta: 'unrelated' },
          } }))
        }
        socket.send(JSON.stringify({ type: 'event', event: 'agent', payload: {
          runId, sessionKey, stream: 'assistant', data: { delta: 'native ' },
        } }))
        socket.send(JSON.stringify({ type: 'event', event: 'agent', payload: {
          runId, sessionKey, stream: 'assistant', data: {
            text: options.overflowOutput === true ? 'x'.repeat(65 * 1024) : 'native answer',
          },
        } }))
      }
      if (request.method === 'agent.wait' && shouldEmitOutput) emitOutput()
      socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }))
      if (request.method === 'agent' && shouldEmitOutput) setTimeout(emitOutput, 0)
    })
  })
  const gateway: Gateway = {
    url: `ws://127.0.0.1:${address.port}`,
    requests,
    async close() {
      for (const socket of server.clients) socket.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
  gateways.push(gateway)
  return gateway
}

afterEach(async () => {
  while (gateways.length > 0) await gateways.pop()?.close()
})

function executionContext(overrides: Partial<ExecutionSnapshot> = {}) {
  const controller = new AbortController()
  const checkpoints: Array<{ phase: string; binding: unknown }> = []
  const progress: unknown[] = []
  const snapshot = {
    id: 'execution-1', teamId: 'team-1', missionId: 'mission-1', cancellationEpoch: 0,
    idempotencyKey: 'phoenix-key', engine: 'openclaw', provider: 'openai-codex', model: 'gpt-5', nativePolicy,
    task: 'perform the bounded task', capabilities: ['conversation'], phase: 'reserved', revision: 1,
    createdAt: 1, updatedAt: 1, ...overrides,
  } as unknown as ExecutionSnapshot
  return {
    context: {
      root: { session: { header: { cwd: 'C:/phoenix-workspace' } },
        ctx: { get: (key: string) => key === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined }, options: { provider: 'openai-codex', model: 'gpt-5' } },
      snapshot, signal: controller.signal, sharedMemory: 'reference only',
      checkpoint: async (phase: string, binding: unknown) => { checkpoints.push({ phase, binding }) },
      progress: async (event: unknown) => { progress.push(event) },
    } as unknown as ExecutionContext,
    checkpoints,
    progress,
    controller,
  }
}

const attest: OpenClawPolicyAttester = async request => ({
  agentId: request.agentId,
  ...(request.sessionKey === undefined ? {} : { sessionKey: request.sessionKey }),
  provider: request.expected.provider,
  model: request.expected.model,
  agentRuntime: request.expected.agentRuntime,
  sandbox: request.expected.sandbox,
  approval: request.expected.approval,
  cwd: request.expected.cwd,
  toolPolicy: request.expected.toolPolicy,
  ...(request.taskIdempotencyKey === undefined ? {} : { taskIdempotencyKey: request.taskIdempotencyKey }),
})

function adapterConfig(url: string, options: Partial<ConstructorParameters<typeof OpenClawExecutionAdapter>[0]> = {}) {
  return {
    url, agentId: 'worker', provider: 'openai', model: 'gpt-5', agentRuntime: 'codex',
    sandbox: 'workspace-write', approval: 'never', cwd: 'C:/phoenix-workspace', toolPolicy: nativePolicy.toolPolicy,
    policyAttester: attest, timeoutMs: 5_000, ...options,
  }
}

describe('OpenClaw Agent Teams adapter', () => {
  it('rejects dynamically supplied admin scopes instead of widening operator access', () => {
    expect(() => new OpenClawExecutionAdapter({
      scopes: ['operator.admin' as never],
    })).toThrow('only permits operator.read and operator.write scopes')
  })

  it('blocks configured production execution without opening the Gateway and unregisters on HMR disposal', async () => {
    const gateway = await gatewayFor()
    const register = vi.fn<(adapter: OpenClawExecutionAdapter) => () => void>(() => vi.fn())
    const ctx = new Context()
    ctx.provide('agentTeams', { executions: { register } } as never)
    const fiber = await ctx.plugin({ name: 'subagent-openclaw', inject: ['agentTeams'], apply }, { url: gateway.url, agentId: 'phoenix', provider: 'openai', model: 'gpt-5' })
    expect(register).toHaveBeenCalledOnce()
    const adapter = register.mock.calls[0]?.[0] as OpenClawExecutionAdapter
    await expect(adapter.probe()).resolves.toMatchObject({ engine: 'openclaw', connected: false, diagnostic: 'OPENCLAW_NOT_CONFIGURED' })
    await expect(adapter.run(executionContext().context)).resolves.toMatchObject({ status: 'failed', errorCode: 'OPENCLAW_NOT_CONFIGURED' })
    await expect(adapter.recover(executionContext().context)).resolves.toMatchObject({ status: 'uncertain', errorCode: 'OPENCLAW_NOT_CONFIGURED' })
    expect(gateway.requests).toHaveLength(0)
    await fiber.dispose()
    expect(register.mock.results[0]?.value).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('verifies the native route, checkpoints, uses the snapshot id, and waits for completion', async () => {
    const gateway = await gatewayFor()
    const policyResolver = vi.fn(async () => nativePolicy)
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { policyResolver }))
    await expect(adapter.probe()).resolves.toMatchObject({ engine: 'openclaw', connected: true, providers: ['openai-codex'], capabilities: ['conversation'] })
    expect(gateway.requests.find(item => item.method === 'connect')?.params).toMatchObject({ client: { id: 'gateway-client', mode: 'backend' } })
    const fixture = executionContext()
    await expect(adapter.run(fixture.context)).resolves.toEqual({ status: 'completed', output: 'native answer' })
    expect(fixture.checkpoints.map(item => item.phase)).toEqual(['prepared', 'dispatching', 'running'])
    const request = gateway.requests.find(item => item.method === 'agent')
    expect(gateway.requests.some(item => item.method === 'sessions.create')).toBe(true)
    expect(request?.params).toMatchObject({ idempotencyKey: 'execution-1', agentId: 'worker', deliver: false })
    expect(String(request?.params?.sessionKey)).toMatch(/^agent:worker:phoenix:execution-1$/u)
    expect(policyResolver).toHaveBeenCalledWith(expect.objectContaining({ executionId: request?.params?.idempotencyKey }))
    expect(request?.params).not.toHaveProperty('provider')
    expect(request?.params).not.toHaveProperty('model')
    expect(gateway.requests.some(item => item.method === 'agent.wait')).toBe(true)
  })

  it('rejects a task from another Phoenix workspace before any native request', async () => {
    const gateway = await gatewayFor()
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    const fixture = executionContext()
    const context = { ...fixture.context, root: {
      ...fixture.context.root,
      session: { header: { cwd: 'C:/another-project' } },
    } as ExecutionContext['root'] }
    await expect(adapter.run(context)).resolves.toMatchObject({ status: 'failed', errorCode: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED' })
    expect(gateway.requests).toHaveLength(0)
  })

  it('rejects native write authority for a read-only Phoenix session', async () => {
    const gateway = await gatewayFor()
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    const fixture = executionContext()
    const context = { ...fixture.context, root: {
      ...fixture.context.root,
      ctx: { get: () => ({ resolve: () => ({ mode: 'read-only' }) }) },
    } as unknown as ExecutionContext['root'] }
    await expect(adapter.run(context)).resolves.toMatchObject({ status: 'failed', errorCode: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED' })
    expect(gateway.requests).toHaveLength(0)
  })

  it('rechecks host policy at dispatch and rejects changed tool authority', async () => {
    const gateway = await gatewayFor()
    const policyResolver = vi.fn(async () => ({ ...nativePolicy,
      toolPolicy: { ...nativePolicy.toolPolicy, profileHash: 'changed-after-reservation' },
    }))
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { policyResolver }))
    const fixture = executionContext()
    await expect(adapter.run(fixture.context)).resolves.toMatchObject({
      status: 'failed', errorCode: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED',
    })
    expect(policyResolver).toHaveBeenCalledWith(expect.objectContaining({ root: fixture.context.root }))
    expect(gateway.requests).toHaveLength(0)
  })

  it('fails closed when the native agent route differs from the selected snapshot', async () => {
    const gateway = await gatewayFor()
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { model: 'different-model' }))
    const fixture = executionContext()
    await expect(adapter.run(fixture.context)).resolves.toEqual({ status: 'failed', errorCode: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED' })
    expect(gateway.requests.some(item => item.method === 'agent')).toBe(false)
  })

  it('fails closed when host-owned policy attestation disagrees with effective restrictions', async () => {
    const gateway = await gatewayFor()
    const policyAttester: OpenClawPolicyAttester = async request => ({
      ...await attest(request),
      toolPolicy: { ...request.expected.toolPolicy, profileHash: 'sha256:wrong' },
    })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { policyAttester }))
    const fixture = executionContext()
    await expect(adapter.probe()).resolves.toMatchObject({ connected: false, diagnostic: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED' })
    await expect(adapter.run(fixture.context)).resolves.toEqual({ status: 'failed', errorCode: 'OPENCLAW_EXECUTION_POLICY_UNVERIFIED' })
    expect(gateway.requests.some(item => item.method === 'agent')).toBe(false)
  })

  it('keeps a dispatched run uncertain when the Gateway drops its acknowledgement', async () => {
    const gateway = await gatewayFor({ dropAgentAck: true })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { timeoutMs: 500 }))
    const fixture = executionContext()
    await expect(adapter.run(fixture.context)).resolves.toMatchObject({ status: 'uncertain' })
    expect(gateway.requests.filter(item => item.method === 'agent')).toHaveLength(1)
    expect(fixture.checkpoints.at(-1)?.phase).toBe('dispatching')
  })

  it('does not certify failure from an unrecognized native wait response', async () => {
    const gateway = await gatewayFor({ malformedWait: true })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    await expect(adapter.run(executionContext().context)).resolves.toMatchObject({ status: 'uncertain' })
  })

  it('does not attribute an uncorrelated session transcript to the current run', async () => {
    const gateway = await gatewayFor()
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    const result = await adapter.run(executionContext().context)
    expect(result.status).toBe('completed')
    expect(result).toHaveProperty('output', 'native answer')
    expect(gateway.requests.some(item => item.method === 'chat.history')).toBe(false)
  })

  it('fails closed when a terminal wait has no correlated assistant output', async () => {
    const gateway = await gatewayFor({ emitOutput: false })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    await expect(adapter.run(executionContext().context)).resolves.toEqual({ status: 'uncertain', errorCode: 'OPENCLAW_NATIVE_RUN_UNCERTAIN' })
  })

  it('fails closed when correlated assistant output exceeds the bounded root context', async () => {
    const gateway = await gatewayFor({ overflowOutput: true })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    await expect(adapter.run(executionContext().context)).resolves.toEqual({ status: 'uncertain', errorCode: 'OPENCLAW_NATIVE_RUN_UNCERTAIN' })
  })

  it('does not treat models.list membership as proof of the native agent route', async () => {
    const gateway = await gatewayFor({ agentModel: 'gpt-4', sessionModel: 'gpt-4' })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    const fixture = executionContext()
    await expect(adapter.probe()).resolves.toMatchObject({ connected: false, diagnostic: 'OPENCLAW_NATIVE_ROUTE_UNVERIFIED' })
    await expect(adapter.run(fixture.context)).resolves.toEqual({ status: 'failed', errorCode: 'OPENCLAW_NATIVE_ROUTE_UNVERIFIED' })
    expect(gateway.requests.some(item => item.method === 'models.list')).toBe(false)
    expect(gateway.requests.some(item => item.method === 'agent')).toBe(false)
  })

  it('recovers by waiting on the persisted native binding without resubmitting', async () => {
    const gateway = await gatewayFor()
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url, { sessionKey: 'agent:worker:phoenix' }))
    const fixture = executionContext({ binding: { sessionId: 'agent:worker:phoenix', turnId: 'native-run-1' } })
    await expect(adapter.recover(fixture.context)).resolves.toEqual({ status: 'completed', output: 'native answer' })
    expect(gateway.requests.some(item => item.method === 'agent')).toBe(false)
    expect(gateway.requests.some(item => item.method === 'agent.wait')).toBe(true)
  })

  it('confirms exact native cancellation before returning cancelled', async () => {
    const gateway = await gatewayFor({ holdWait: true })
    const adapter = new OpenClawExecutionAdapter(adapterConfig(gateway.url))
    const fixture = executionContext()
    const running = adapter.run(fixture.context)
    await expect.poll(() => gateway.requests.some(item => item.method === 'agent')).toBe(true)
    fixture.controller.abort()
    await expect(running).resolves.toEqual({ status: 'cancelled', errorCode: 'OPENCLAW_NATIVE_RUN_CANCELLED' })
    expect(gateway.requests.some(item => item.method === 'sessions.abort')).toBe(true)
  })
})
