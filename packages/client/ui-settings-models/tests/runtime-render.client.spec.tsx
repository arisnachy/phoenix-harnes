// @vitest-environment jsdom
import { Context } from '@phoenix-ai/cordis'
import { act, render, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { SlotRegistry, createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@phoenix-ai/dsh-client-ui-settings/client'
import { apply as modelsApply, inject as modelsInject } from '@phoenix-ai/dsh-client-ui-settings-models/client'
import { createSlotRenderer } from '../../ui-renderer/src/client/scoped-slots.tsx'

const ok = <T,>(value: T) => ({
  rpcId: 'models-runtime-rpc' as never,
  result: { ok: true as const, value },
})

function runtimeContext() {
  const ctx = new Context()
  return { ctx }
}

async function mountModels(options: { preseedReady?: boolean } = {}) {
  const { ctx } = runtimeContext()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  new TestRemote(ctx)

  const namespaces = [{
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: {} },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  }]
  const api = {
    settings: {
      describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces })),
      mutate: () => Promise.resolve(ok({ revision: 1, value: {} })),
      update: () => Promise.resolve(ok({ revision: 1, value: {} })),
      replace: () => Promise.resolve(ok({ revision: 1, value: {} })),
    },
    llm: {
      providers: () => Promise.resolve(ok({
        providers: [{
          provider: 'openai',
          displayName: 'OpenAI',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'openai'],
          active: false,
        }],
      })),
      models: () => Promise.resolve(ok({ groups: [], failures: [] })),
    },
    credentials: {
      describe: () => Promise.resolve(ok({ credentials: {} })),
      set: () => Promise.resolve(ok({})),
      unset: () => Promise.resolve(ok({})),
    },
  }
  ctx.provide('connection', { isLoopback: true, api } as never)
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
    controller: {
      load: () => Promise<void>
      store: ReturnType<typeof createSnapshotStore>
    }
  })()
  if (options.preseedReady === true) {
    injected.controller.store.update((state: any) => {
      state.status = 'ready'
      state.writable = true
      state.error = null
    })
  }

  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<>{slots.renderSlot('root', {})}</>)
  })
  return { ctx, slots, view, controller: injected.controller }
}

it('renders the Models page through the real slot renderer without pluginInventory', async () => {
  const { view } = await mountModels({ preseedReady: true })
  expect(view.container.querySelector('[data-slot-error="settings.section"]')).toBeNull()
  expect(view.container.textContent).toContain('Models')
  expect(view.container.textContent).toContain('Phoenix Local')
})

it('stays rendered after the real Models directory/settings/credentials load settles', async () => {
  const { view, controller } = await mountModels()
  await act(async () => { await controller.load() })
  await waitFor(() => expect(controller.store.getSnapshot().status).toBe('ready'))

  expect(view.container.querySelector('[data-slot-error="settings.section"]')).toBeNull()
  expect(view.container.textContent).toContain('Models')
  expect(view.container.textContent).toContain('OpenAI')
  expect(view.container.textContent).toContain('Phoenix Local')
})
