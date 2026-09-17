import { Context } from '@phoenix-ai/cordis'
import { expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@phoenix-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@phoenix-ai/dsh-client-ui-settings-models/client'

it('keeps the Models settings surface available when pluginInventory remote is absent', async () => {
  // Phoenix Local is optional. Missing pluginInventory must not keep the whole
  // Models/Connectors settings plugin pending.
  expect(inject).not.toContain('remote.pluginInventory')

  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  new TestRemote(ctx)
  ctx.provide('connection', { api: { authorization: {} }, isLoopback: true } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  expect(slots.entries('settings.section').map(entry => entry.options.id)).toContain('models')
})


it('unwraps the pluginInventory Remote result before exposing Phoenix Local state', async () => {
  const snapshot = {
    mode: 'on-demand' as const,
    selectedModelId: 'phoenix-local',
    installedModelIds: ['phoenix-local'],
    phase: 'ready' as const,
    catalog: [{
      id: 'phoenix-local',
      displayName: 'Phoenix Local',
      sizeBytes: 1,
      estimatedRamBytes: 1,
      contextWindow: 8192,
      maxTokens: 4096,
      recommended: true,
    }],
  }
  const localModelState = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: snapshot,
  }))

  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  new TestRemote(ctx)
  ctx.provide('remote.pluginInventory', {
    localModelState,
    installLocalModel: vi.fn(),
    startLocalModel: vi.fn(),
    stopLocalModel: vi.fn(),
    uninstallLocalModel: vi.fn(),
    setLocalModelMode: vi.fn(),
    setDefaultLocalModel: vi.fn(),
  } as never)
  ctx.provide('connection', { api: { authorization: {} }, isLoopback: true } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)

  await ctx.plugin({ inject: [...inject], apply }).await()
  const entry = slots.entries('settings.section').find(candidate => candidate.options.id === 'models')!
  const injected = (
    entry.inject as unknown as
    () => import('../src/client/ModelsWithLocalSection.tsx').ModelsWithLocalSectionInjected
  )()

  await expect(injected.localModel.state()).resolves.toEqual(snapshot)
  expect(localModelState).toHaveBeenCalledTimes(1)
})
