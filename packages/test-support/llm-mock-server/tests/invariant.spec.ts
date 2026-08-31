import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import InvariantRegistry from '@phoenix-ai/dsh-invariants'
import * as MockServerInvariant from '../src/invariant.ts'

describe('mock LLM server invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(MockServerInvariant)

    expect(() => {
      ctx.invariants.register('@phoenix-ai/dsh-llm-mock-server', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
