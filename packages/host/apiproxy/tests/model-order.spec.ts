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

it('prioritizes Codex only when the user has no provider ordering preference', () => {
  const routes = [...groups, { id: 'openai-codex', name: 'OpenAI Codex', models: [] }]
  expect(orderModelProviderGroups(routes, []).map(group => group.id)).toEqual(['openai-codex', 'deepseek', 'openai', 'anthropic'])
  expect(orderModelProviderGroups(routes, ['deepseek']).map(group => group.id)).toEqual(['deepseek', 'openai', 'anthropic', 'openai-codex'])
})

it('labels the native Codex route without replacing an explicitly configured name', () => {
  expect(orderModelProviderGroups([{ id: 'openai-codex', name: 'openai-codex', models: [] }], [])[0]?.name).toBe('OpenAI Codex')
  expect(orderModelProviderGroups([{ id: 'openai-codex', name: 'My account', models: [] }], [])[0]?.name).toBe('My account')
})
