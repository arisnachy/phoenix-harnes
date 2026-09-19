import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import { RuntimeContextProjection } from '../src/runtime-context.ts'

const SOURCE = '@phoenix-ai/dsh-system-prompt'

function contextMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: SOURCE },
  })
}

describe('RuntimeContextProjection', () => {
  it('restores the latest visible owned snapshot and ignores other sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-replay'))
    const retained = session.append('user/message', contextMessage('retained'), { surfaceOp: 'append' })
    const shadowed = session.append('user/message', contextMessage('shadowed'), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: shadowed.seq, end: shadowed.seq },
      sourceEventSeqs: [shadowed.seq],
    })

    const projection = new RuntimeContextProjection(ctx, session)
    expect(session.surface.nodes).toContain(retained.seq)
    expect(projection.project('retained', [])).toBeUndefined()
    expect(projection.project('next', [{ name: 'sandbox:policy', text: 'policy' }])?.source).toEqual({
      kind: 'plugin',
      plugin: SOURCE,
      form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'policy' }],
    })

    const other = ctx.sessions.create(SessionId('runtime-context-other'))
    other.append('user/message', contextMessage('other'), { surfaceOp: 'append' })
    expect(projection.project('retained', [])).toBeUndefined()
  })
  it('replaces stale owned snapshots on the model surface without deleting durable history', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-replacement'))
    const projection = new RuntimeContextProjection(ctx, session)

    const first = projection.project('first runtime context', [])
    expect(first).toBeDefined()
    const firstEvent = session.append('user/message', first!, projection.surfaceIntent(first!))

    const second = projection.project('second runtime context', [])
    expect(second).toBeDefined()
    const secondEvent = session.append('user/message', second!, projection.surfaceIntent(second!))

    expect(session.events.some(event => event.seq === firstEvent.seq)).toBe(true)
    expect(session.events.some(event => event.seq === secondEvent.seq)).toBe(true)
    expect(session.surface.nodes).not.toContain(firstEvent.seq)
    expect(session.surface.nodes).toContain(secondEvent.seq)
    expect(session.deriveMessages()).toEqual([second])
  })

})
