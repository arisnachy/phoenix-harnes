import { Context } from '@phoenix-ai/cordis'
import { expect, it } from 'vitest'
import { createScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { SessionId } from '@phoenix-ai/dsh-client-runtime/client'
import { ModelDirectoryResolver } from '../src/client/service.ts'

const sid = 'optional-plugin-inventory' as SessionId

it('keeps the composer model directory available when pluginInventory remote is absent', async () => {
  const ctx = new Context()
  const scopes = new Map<SessionId, Context>()

  ctx.provide('connection', {
    api: {
      sessions: {
        models: () => Promise.resolve({
          result: {
            ok: true as const,
            value: {
              current: { provider: 'cloud', model: 'model' },
              routable: true,
              groups: [],
              failures: [],
            },
          },
        }),
        selectModel: () => Promise.resolve({
          result: { ok: true as const, value: { selected: { provider: 'cloud', model: 'model' } } },
        }),
      },
    },
  } as never)
  ctx.provide('sessions', {
    scope: (sessionId: SessionId) => scopes.get(sessionId),
    subagentAddress: () => undefined,
  } as never)

  // Production's generated Remote namespaces are guarded by Cordis. The
  // pluginInventory namespace is optional here, so reaching it through the
  // injected root Remote is the bug; ctx.get('remote.pluginInventory') is the
  // supported optional lookup and returns undefined when the Host lacks it.
  ctx.provide('remote', {
    $on: () => () => undefined,
    get pluginInventory(): never {
      throw new Error('optional pluginInventory must not be read through ctx.remote')
    },
  } as never)

  await ctx.plugin(ModelDirectoryResolver, { blockReason: () => 'unroutable' }).await()
  const scope = createScope(ctx, sid)
  scopes.set(sid, scope.ctx)

  expect(() => ctx.modelDirectories.directoryFor(sid)).not.toThrow()
})
