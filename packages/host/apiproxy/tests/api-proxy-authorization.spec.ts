import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { AuthorizationEntry, AuthorizationRequest, AuthorizationService } from '@phoenix-ai/dsh-authorization'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'

const DEFAULTS = {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/tmp',
}

function request<P>(payload: P) {
  return { rpcId: RpcId('authorization-test'), payload }
}

function ok<T>(response: { result: { ok: boolean; value?: T } }): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('expected success')
  return response.result.value as T
}

/** The host API only needs the service's public methods; the fake remains keyless and in-memory. */
function fakeAuthorization() {
  const key = 'llm-pi-ai/openai-codex' as AuthorizationEntry['key']
  const entry: AuthorizationEntry = {
    key,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    inFlight: false,
    disconnectable: true,
  }
  let running: AuthorizationRequest | undefined
  let finish: ((outcome: { status: 'authorized' | 'cancelled' }) => void) | undefined
  let disconnected = false
  const service = {
    list: () => [entry],
    describe: () => ({ ...entry, inFlight: running !== undefined }),
    inspect: async () => ({
      kind: 'account' as const,
      provider: 'Codex',
      connectors: [{ id: 'drive', name: 'Drive', accessible: true, enabled: true, installed: true, callable: true }],
    }),
    disconnect: async () => { disconnected = true },
    begin: (authorization: AuthorizationRequest) => {
      running = authorization
      authorization.interaction.notify({ message: 'Continue in your browser', url: 'https://example.test/oauth' })
      void authorization.interaction.prompt({ kind: 'secret', message: 'Paste the code' }).then(() => {
        running = undefined
        finish?.({ status: 'authorized' })
      }, () => {
        running = undefined
        finish?.({ status: 'cancelled' })
      })
      return new Promise<{ status: 'authorized' | 'cancelled' }>((resolve) => { finish = resolve })
    },
    cancel: () => {
      running = undefined
      finish?.({ status: 'cancelled' })
    },
  } as unknown as AuthorizationService
  return { service, key, wasDisconnected: () => disconnected }
}

describe('authorization API domain', () => {
  it('keeps OAuth notices/prompt state in a background attempt and never returns the answer', async () => {
    const ctx = new Context()
    const { service, key } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    const api = createApiProxy(ctx, DEFAULTS)

    const entries = ok(await api.authorization.list(request({})))
    expect(entries.entries[0]?.key).toBe(key)

    const begun = ok(await api.authorization.begin(request({ key: String(key), method: 'oauth' })))
    await Promise.resolve()
    let state = ok(await api.authorization.status(request({ attemptId: begun.attemptId })))
    expect(state.status).toBe('pending')
    expect(state.notices[0]?.notice.url).toBe('https://example.test/oauth')
    expect(state.prompt?.kind).toBe('secret')

    const promptId = state.prompt?.promptId
    expect(promptId).toBeDefined()
    ok(await api.authorization.answer(request({ attemptId: begun.attemptId, promptId: promptId!, value: 'secret-value' })))
    await Promise.resolve()
    await Promise.resolve()
    state = ok(await api.authorization.status(request({ attemptId: begun.attemptId, after: state.nextSeq })))
    expect(state.status).toBe('authorized')
    expect(JSON.stringify(state)).not.toContain('secret-value')
    expect(state.prompt).toBeUndefined()
  })

  it('rejects a second attempt for the same key and keeps the answer method loopback-gated by connection policy', async () => {
    const ctx = new Context()
    const { service, key } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    const api = createApiProxy(ctx, DEFAULTS)
    const first = ok(await api.authorization.begin(request({ key: String(key) })))
    const second = await api.authorization.begin(request({ key: String(key) }))
    expect(second.result.ok).toBe(false)
    expect(first.status).toBe('pending')
    ok(await api.authorization.cancel(request({ attemptId: first.attemptId })))
  })

  it('reports the stored record behind a flow so cards can show connected state', async () => {
    const ctx = new Context()
    const { service } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    ctx.provide('credentials', {
      describeRecord: async () => ({ configured: true, kind: 'grant', writable: true }),
    } as never)
    const api = createApiProxy(ctx, DEFAULTS)

    const entries = ok(await api.authorization.list(request({})))
    expect(entries.entries[0]?.stored).toEqual({ kind: 'grant' })
  })

  it('omits stored state when the seam cannot answer or stores nothing for the key', async () => {
    const ctx = new Context()
    const { service } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    ctx.provide('credentials', {
      describeRecord: async () => ({ configured: false, writable: true }),
    } as never)
    const api = createApiProxy(ctx, DEFAULTS)

    const entries = ok(await api.authorization.list(request({})))
    expect(entries.entries[0]?.stored).toBeUndefined()
  })

  it('projects live connector telemetry and forwards provider-owned disconnect', async () => {
    const ctx = new Context()
    const { service, key, wasDisconnected } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    const api = createApiProxy(ctx, DEFAULTS)

    const entries = ok(await api.authorization.list(request({})))
    expect(entries.entries[0]?.disconnectable).toBe(true)
    expect(entries.entries[0]?.telemetry?.connectors?.[0]?.name).toBe('Drive')

    const disconnected = ok(await api.authorization.disconnect(request({ key: String(key) })))
    expect(disconnected.disconnected).toBe(true)
    expect(wasDisconnected()).toBe(true)
  })

})
