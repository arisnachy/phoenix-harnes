// @vitest-environment jsdom
import { Context } from '@phoenix-ai/cordis'
import { act, render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { SlotRegistry, createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@phoenix-ai/dsh-client-ui-settings/client'
import { apply as modelsApply, inject as modelsInject } from '@phoenix-ai/dsh-client-ui-settings-models/client'
import { createSlotRenderer } from '../../ui-renderer/src/client/scoped-slots.tsx'

it('renders the Models page through the real slot renderer without pluginInventory', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  new TestRemote(ctx)

  const settingsDescribe = () => Promise.resolve({
    rpcId: 'models-runtime-settings' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: false, namespaces: [] },
    },
  })
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: { describe: settingsDescribe },
      llm: {},
      credentials: {},
    },
  } as never)
  ctx.provide('sessions', {
    list: createSnapshotStore({ phase: 'ready', byId: {}, current: undefined }),
    currentProvideInfo: createSnapshotStore({ sessionId: undefined, hooks: {}, props: {} }),
  } as never)
  ctx.provide('workspaces', { list: createSnapshotStore({}) } as never)
  slots.install(createSlotRenderer())

  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, ({ renderSlot }: { renderSlot: (key: string, owner: object, opts?: object) => React.ReactNode }) => (
    <>{renderSlot('settings.section', { close: () => undefined }, { only: 'models' })}</>
  ))
  await ctx.plugin({ inject: [...modelsInject], apply: modelsApply }).await()

  const entry = slots.entries('settings.section').find(candidate => candidate.options.id === 'models')!
  const injected = (entry.inject as unknown as () => {
    controller: { store: ReturnType<typeof createSnapshotStore> }
  })()
  injected.controller.store.update((state: any) => {
    state.status = 'ready'
    state.writable = true
    state.error = null
  })

  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<>{slots.renderSlot('root', {})}</>)
  })

  expect(view.container.querySelector('[data-slot-error="settings.section"]')).toBeNull()
  expect(view.container.textContent).toContain('Models')
  expect(view.container.textContent).toContain('Phoenix Local')
})
