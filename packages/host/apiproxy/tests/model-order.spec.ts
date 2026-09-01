import { describe, expect, it } from 'vitest'
import { orderModelProviderGroups, readProviderOrder } from '../src/model-order.ts'

const groups = [
  { id: 'deepseek', name: 'DeepSeek', models: [] },
  { id: 'openai', name: 'OpenAI', models: [] },
  { id: 'anthropic', name: 'Anthropic', models: [] },
]

describe('model provider order', () => {
  it('sorts preferred providers and keeps unlisted providers visible', () => {
    expect(orderModelProviderGroups(groups, ['openai', 'anthropic']).map(group => group.id))
      .toEqual(['openai', 'anthropic', 'deepseek'])
  })

  it('reads unique non-empty route ids from the profile projection', () => {
    expect(readProviderOrder({ get: () => ({ profile: { modelProviderOrder: ['openai', '', 'openai', 'deepseek'] } }) }))
      .toEqual(['openai', 'deepseek'])
    expect(readProviderOrder(undefined)).toEqual([])
  })
})
