import { Context } from '@phoenix-ai/cordis'
import { expect, it } from 'vitest'
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
