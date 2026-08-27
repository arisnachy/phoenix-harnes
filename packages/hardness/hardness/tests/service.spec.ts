import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../src/index.ts'

describe('HARDNESS capability service', () => {
  it('mounts an empty provider-neutral capability service', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness')
    if (service === undefined) throw new Error('hardness service missing')

    expect(service.list()).toEqual([])
    expect(typeof service.register).toBe('function')
    expect(typeof service.resolveNeed).toBe('function')

    await ctx.fiber.dispose()
    expect(ctx.get('hardness')).toBeUndefined()
  })
})
