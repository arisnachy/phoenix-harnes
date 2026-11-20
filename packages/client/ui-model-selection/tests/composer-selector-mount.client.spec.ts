import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { createScope, SlotRegistry, type SessionId } from '@phoenix-ai/dsh-client-runtime/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'

describe('composer model selector resilience', () => {
  it('mounts the model picker without the optional slash-command registry', async () => {
    expect(inject).not.toContain('commandUi')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    new TestRemote(ctx)
    const id = 'resilient-composer-model' as SessionId
    const scopes = new Map<SessionId, Context>()
    ctx.provide('connection', {
      api: {
        sessions: {
          models: vi.fn(() => Promise.resolve({ result: { ok: true, value: {
            current: { provider: 'openai-codex', model: 'gpt-6.2-sol', reasoningEffort: 'low' },
            routable: true, groups: [], failures: [],
          } } })),
          selectModel: vi.fn(),
        },
      },
    } as never)
    ctx.provide('sessions', {
      subagentAddress: () => undefined,
      scope: (sessionId: SessionId) => scopes.get(sessionId),
    } as never)
    const scope = createScope(ctx, id)
    scopes.set(id, scope.ctx)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'conversation.input.model': { kind: 'single', scope: 'session' } },
    } as never, () => null)

    await ctx.plugin({ inject: [...inject], apply }).await()
    const seats = slots.entries('conversation.input.model')
    expect(seats).toHaveLength(1)
    expect(seats[0]?.component).toBe(ModelSelect)
    const exposed = (seats[0]?.inject as (id: SessionId) => { available: boolean; load: () => void })(id)
    expect(exposed.available).toBe(true)
    expect(typeof exposed.load).toBe('function')
    await ctx.fiber.dispose()
  })
})
