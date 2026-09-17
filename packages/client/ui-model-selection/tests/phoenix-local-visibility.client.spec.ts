import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup, ModelSelection } from '@phoenix-ai/dsh-api-remotes/client'
import {
  assertPhoenixLocalSelectable,
  projectPhoenixLocalAvailability,
  type PhoenixLocalInstallState,
} from '../src/client/phoenix-local-visibility.ts'

const LOCAL_GROUP: ModelProviderGroup = {
  id: 'phoenix-local',
  name: '🔥 Phoenix Local · Offline',
  models: [{ id: 'phoenix-local', name: 'Phoenix Local · Qwen3.5-4B' }],
}

const CLOUD_GROUP: ModelProviderGroup = {
  id: 'openai',
  name: 'OpenAI',
  models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }],
}

const selectedLocal: ModelSelection = { provider: 'phoenix-local', model: 'phoenix-local' }
const selectedCloud: ModelSelection = { provider: 'openai', model: 'gpt-5.6-sol' }

function localState(installed: boolean): PhoenixLocalInstallState {
  return {
    selectedModelId: 'qwen3.5-4b-q4-k-m',
    installedModelIds: installed ? ['qwen3.5-4b-q4-k-m'] : [],
  }
}

describe('Phoenix Local selector availability', () => {
  it('hides Phoenix Local and marks it unroutable until its selected model is installed', () => {
    const projected = projectPhoenixLocalAvailability({
      current: selectedLocal,
      routable: true,
      groups: [CLOUD_GROUP, LOCAL_GROUP],
      failures: [],
    }, localState(false))

    expect(projected.groups.map(group => group.id)).toEqual(['openai'])
    expect(projected.routable).toBe(false)
  })

  it('keeps Phoenix Local visible after the selected local model is installed', () => {
    const projected = projectPhoenixLocalAvailability({
      current: selectedCloud,
      routable: true,
      groups: [CLOUD_GROUP, LOCAL_GROUP],
      failures: [],
    }, localState(true))

    expect(projected.groups.map(group => group.id)).toEqual(['openai', 'phoenix-local'])
    expect(projected.routable).toBe(true)
  })

  it('fails closed when local installation state cannot be read', () => {
    const projected = projectPhoenixLocalAvailability({
      current: selectedCloud,
      routable: true,
      groups: [CLOUD_GROUP, LOCAL_GROUP],
      failures: [],
    }, undefined)

    expect(projected.groups.map(group => group.id)).toEqual(['openai'])
  })

  it('rejects selecting Phoenix Local when it is not installed but leaves cloud selections untouched', () => {
    expect(() => assertPhoenixLocalSelectable(selectedLocal, localState(false))).toThrow(/install Phoenix Local/i)
    expect(() => assertPhoenixLocalSelectable(selectedCloud, undefined)).not.toThrow()
    expect(() => assertPhoenixLocalSelectable(selectedLocal, localState(true))).not.toThrow()
  })
})
