import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import InvariantRegistry from '@phoenix-ai/dsh-invariants'
import * as AtomicWriteInvariant from '../src/invariant.ts'

describe('atomic-write invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(AtomicWriteInvariant)

    expect(() => {
      ctx.invariants.register('@phoenix-ai/dsh-atomic-write', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
