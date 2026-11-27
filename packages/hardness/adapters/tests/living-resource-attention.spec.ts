import { describe, expect, it } from 'vitest'
import { LivingResourceAttention } from '../src/living-resource-attention.ts'
describe('living resource attention', () => {
  it('requires sustained pressure, keeps a stable revision and clears after recovery', () => {
    let now = 1_000, free = 7
    const attention = new LivingResourceAttention(() => ({ free, total: 100 }), () => now)
    expect(attention.read()).toEqual([])
    now += 60_000
    const first = attention.read()
    expect(first).toHaveLength(1)
    expect(attention.read()).toEqual(first)
    free = 10
    expect(attention.read()).toEqual(first)
    free = 13
    expect(attention.read()).toEqual([])
    free = 5
    expect(attention.read()).toEqual([])
    now += 60_000
    expect(attention.read()[0]?.revision).not.toBe(first[0]?.revision)
  })
  it('does not interpret invalid readings as pressure', () => {
    const attention = new LivingResourceAttention(() => ({ free: NaN, total: 100 }))
    expect(attention.read()).toEqual([])
  })
})
