import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, SessionId } from '@phoenix-ai/dsh-api-remotes/client'
import { ModelDirectory } from '../src/client/directory.ts'
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
    expect(() =>{  assertPhoenixLocalSelectable(selectedLocal, localState(false)) }).toThrow(/install Phoenix Local/i)
    expect(() =>{  assertPhoenixLocalSelectable(selectedCloud, undefined) }).not.toThrow()
    expect(() =>{  assertPhoenixLocalSelectable(selectedLocal, localState(true)) }).not.toThrow()
  })
})

describe('Installed local model selection', () => {
  const gemma = 'ollama:gemma4:e2b'
  const qwen = 'ollama:qwen3.5:2b'
  const inventory: PhoenixLocalInstallState = {
    selectedModelId: gemma,
    installedModelIds: [gemma, 'stale', 'gguf'],
    ollamaInstalledModelIds: [gemma, qwen],
    catalog: [
      { id: gemma, displayName: 'Gemma 4 E2B', backend: 'ollama' },
      { id: qwen, displayName: 'Qwen 3.5 2B', backend: 'ollama' },
      { id: 'stale', displayName: 'Removed', backend: 'ollama' },
      { id: 'gguf', displayName: 'Managed GGUF', backend: 'llama-server' },
      { id: 'suggested', displayName: 'Not downloaded', backend: 'llama-server' },
    ],
  }
  const hostDirectory = { current: selectedLocal, routable: true, groups: [CLOUD_GROUP, LOCAL_GROUP], failures: [] }

  it('projects all installed artifacts and excludes stale or uninstalled choices', () => {
    const result = projectPhoenixLocalAvailability(hostDirectory, inventory)
    expect(result.current.model).toBe(gemma)
    expect(result.groups[1]?.name).not.toContain('🔥')
    expect(result.groups[1]?.models.map(model => model.id)).toEqual([gemma, qwen, 'gguf'])
    expect(() => assertPhoenixLocalSelectable({ provider: 'phoenix-local', model: qwen }, inventory)).not.toThrow()
    expect(() => assertPhoenixLocalSelectable({ provider: 'phoenix-local', model: 'stale' }, inventory)).toThrow()
  })

  it('activates the exact artifact and submits only the stable adapter route to the session', async () => {
    let local = inventory
    const activate = vi.fn(async (modelId: string) => {
      local = { ...local, selectedModelId: modelId, installedModelIds: [...local.installedModelIds, modelId] }
      return local
    })
    const selectModel = vi.fn(async () => ({ result: { ok: true, value: { selected: selectedLocal } } }))
    const sessions = {
      models: async () => ({ result: { ok: true, value: hostDirectory } }),
      selectModel,
    } as unknown as Pick<IApiClient['sessions'], 'models' | 'selectModel'>
    const directory = new ModelDirectory(sessions, 'local-test' as SessionId, () => true, async () => local, activate)
    await directory.load()
    await directory.select({ provider: 'phoenix-local', model: qwen })
    expect(activate).toHaveBeenCalledWith(qwen)
    expect(selectModel).toHaveBeenCalledWith({ sessionId: 'local-test', provider: 'phoenix-local', model: 'phoenix-local' })
    expect(directory.store.getSnapshot().current?.model).toBe(qwen)
    await directory.load()
    expect(directory.store.getSnapshot().current?.model).toBe(qwen)
  })
})
