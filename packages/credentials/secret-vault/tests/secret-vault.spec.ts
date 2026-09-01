import { Context } from '@phoenix-ai/cordis'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import CommandRuntime from '@phoenix-ai/dsh-commands'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

async function mount() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const values = new Map<string, string>()
  ctx.provide('credentials', {
    set: vi.fn(async (ref: string, value: string) => { values.set(ref, value) }),
    unset: vi.fn(async (ref: string) => { values.delete(ref) }),
    describe: vi.fn(async (ref: string) => ({
      configured: values.has(ref), source: values.has(ref) ? 'vault' : undefined, writable: true,
    })),
  } as never)
  apply(ctx)
  const session = ctx.sessions.create(SessionId('secret-vault-test'))
  const agent = { id: session.id, session } as never
  return { ctx, agent, values }
}

describe('/secret', () => {
  it('stores a value without putting it in the model-visible command log', async () => {
    const { ctx, agent, values } = await mount()
    const secret = 'sk-private-value'

    const result = await ctx.commands.execute(agent, `/secret set OPENAI_API_KEY ${secret}`, [], new AbortController().signal)

    expect(result?.result).toEqual({ kind: 'success', text: 'Secret OPENAI_API_KEY stored securely.' })
    expect(values.get(credentialRef('OPENAI_API_KEY'))).toBe(secret)
    expect(JSON.stringify(ctx.sessions.list().flatMap(item => item.events))).not.toContain(secret)
    expect(ctx.sessions.list()[0]?.events.find(event => event.type === 'command/run')).toMatchObject({
      type: 'command/run', data: { name: 'secret' },
    })
    const run = ctx.sessions.list()[0]?.events.find(event => event.type === 'command/run')
    expect(run?.type === 'command/run' && Object.hasOwn(run.data, 'args')).toBe(false)
  })

  it('reports presence without revealing the stored value and supports deletion', async () => {
    const { ctx, agent } = await mount()
    await ctx.commands.execute(agent, '/secret set DEMO_SECRET do-not-show', [], new AbortController().signal)

    const status = await ctx.commands.execute(agent, '/secret status DEMO_SECRET', [], new AbortController().signal)
    expect(status?.result).toEqual({ kind: 'success', text: 'Secret DEMO_SECRET is configured from vault.' })

    const deleted = await ctx.commands.execute(agent, '/secret delete DEMO_SECRET', [], new AbortController().signal)
    expect(deleted?.result).toEqual({ kind: 'success', text: 'Secret DEMO_SECRET removed.' })
    const missing = await ctx.commands.execute(agent, '/secret status DEMO_SECRET', [], new AbortController().signal)
    expect(missing?.result).toEqual({ kind: 'success', text: 'Secret DEMO_SECRET is not configured.' })
  })

  it('rejects malformed input without invoking the provider', async () => {
    const { ctx, agent, values } = await mount()
    const result = await ctx.commands.execute(agent, '/secret set BAD-NAME value', [], new AbortController().signal)

    expect(result?.result.kind).toBe('error')
    expect(values.size).toBe(0)
  })
})
