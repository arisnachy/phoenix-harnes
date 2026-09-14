/** Models and Connectors registration: slot injection, locale-following labels, and HMR recovery. */
import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@phoenix-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@phoenix-ai/dsh-client-ui-settings/client'
import { apply, inject, refreshIfLoaded } from '@phoenix-ai/dsh-client-ui-settings-models/client'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import { ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

async function bench(isLoopback = true, settings?: object, services: object = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  // Without a settings face the mirror's reads fail and stay contained; the
  // Models join itself never fetches until a section actually loads. The real
  // ui-settings apply also provides the settingsSchema service.
  ctx.provide('connection', {
    api: settings === undefined ? services : { ...services, settings },
    isLoopback,
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

function section(slots: SlotRegistry, id: string) {
  return slots.entries('settings.section').find(candidate => candidate.options.id === id)!
}

describe('ui-settings-models apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope', 'settingsSchema'])
  })

  it('registers Models and Connectors for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('settings.section')).toHaveLength(2)

    const entry = section(before.slots, 'models')
    expect(entry.component).toBe(ModelsSection)
    expect(entry.options).toMatchObject({ id: 'models', order: 10 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('模型')
    const injected = (entry.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected)()
    expect(injected.t('nav')).toBe('模型')
    expect(injected.t('deleteTitle')).toBe('删除 {provider}？')
    expect(typeof injected.controller.load).toBe('function')
    expect(injected.hooks.snapshot).toBe(injected.controller.store)
    expect(injected.api).toBeDefined()

    const connectors = section(before.slots, 'connectors')
    expect(connectors.component).toBe(ConnectorsSettingsSection)
    expect(connectors.options).toMatchObject({ id: 'connectors', order: 12 })
    expect(resolveSlotLabel(connectors.options.label)).toBe('连接器')
    const connectorsInjected = (
      connectors.inject as unknown as () => import('../src/client/AuthorizationPanel.tsx').ConnectorsSettingsSectionProps
    )()
    expect(connectorsInjected.connectorT('nav')).toBe('连接器')
    expect(connectorsInjected.connectorT('catalog')).toBe('连接器目录')

    const onboarding = before.slots.entries('settings.onboarding')
    expect(onboarding).toHaveLength(2)
    expect(onboarding.find(entry => entry.options.id === 'welcome-notice')).toMatchObject({
      component: WelcomeNotice,
      options: { id: 'welcome-notice', order: -100 },
    })
    const deepSeek = onboarding.find(entry => entry.options.id === 'deepseek-official')!
    expect(deepSeek.component).toBe(DeepSeekOnboardingDialog)
    expect(deepSeek.options).toMatchObject({ id: 'deepseek-official', order: 0 })
    const deepSeekInjected = (
      deepSeek.inject as unknown as () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    expect(deepSeekInjected.hooks.models).toBe(injected.controller.store)
    expect(deepSeekInjected.api).toBeDefined()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(section(after.slots, 'models').component).toBe(ModelsSection)
    expect(section(after.slots, 'connectors').component).toBe(ConnectorsSettingsSection)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(2)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(2)
  })

  it('the label thunks follow the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(resolveSlotLabel(section(b.slots, 'models').options.label)).toBe('Models')
    expect(resolveSlotLabel(section(b.slots, 'connectors').options.label)).toBe('Connectors')
    const injected = section(b.slots, 'models').inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    expect(injected().t('deleteTitle')).toBe('Delete {provider}?')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(section(b.slots, 'models').options.label)).toBe('模型')
    expect(resolveSlotLabel(section(b.slots, 'connectors').options.label)).toBe('连接器')
    expect(injected().t('deleteTitle')).toBe('删除 {provider}？')
  })

  it('locale change while the slot is undeclared stays a no-op', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.locale.setLocale('zh')
  })

  it('re-registers both pages after an HMR collapse re-declares the slot', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(2)
    // Declarer unload: the cascade removes our entries while local disposer
    // variables go stale.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(section(b.slots, 'models').component).toBe(ModelsSection)
    expect(section(b.slots, 'connectors').component).toBe(ConnectorsSettingsSection)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(2)
    // The locale path also recovers through the same ledger re-check.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(section(b.slots, 'models').options.label)).toBe('Models')
    expect(resolveSlotLabel(section(b.slots, 'connectors').options.label)).toBe('Connectors')
    b.locale.setLocale('zh')
  })

  it('registers both locale namespaces and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.models')('nav')).toBe('模型')
    expect(b.locale.bind('settings.connectors')('nav')).toBe('连接器')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('settings.models', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.models', 'en', {})).not.toThrow()
    expect(() => b.locale.register('settings.connectors', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.connectors', 'en', {})).not.toThrow()
  })

  it('keeps remote-browser acknowledgement in process memory', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()

    await injected.controller.load()
    expect(injected.controller.store.getSnapshot()).toEqual({
      status: 'ready', acknowledged: false, error: null,
    })
  })
})

describe('pushed invalidations', () => {
  it('ignores invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The fake wire face has no methods: a fetch attempt would throw.
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    b.ctx.remote.$dispatch('credentials/reference-updated', ['OPENAI_API_KEY'])
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
  })

  it('routes pushed credential invalidation into the shared onboarding join', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'deepseek-official')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    injected.controller.store.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()
    b.ctx.remote.$dispatch('credentials/reference-updated', ['DEEPSEEK_API_KEY'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('welcome state follows the shared mirror across document commits', async () => {
    // The welcome notice derives from its settings scope: a document commit
    // reaches it through the mirror's one refresh, with no routing here.
    const acknowledgement = { current: undefined as string | undefined }
    const settings = {
      describe: vi.fn(() => Promise.resolve({
        rpcId: 'apply-welcome' as never,
        result: {
          ok: true as const,
          value: {
            writable: true,
            hasDocument: false,
            namespaces: [{
              ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
              schema: {},
              value: acknowledgement.current === undefined ? {} : { [WELCOME_NOTICE_ACK_FIELD]: acknowledgement.current },
              applies: 'live' as const,
              secrets: [],
              revision: 0,
            }],
          },
        },
      })),
    }
    const b = await bench(true, settings)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()
    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    })
    acknowledgement.current = WELCOME_NOTICE_VERSION
    b.ctx.remote.$dispatch('settings/document-updated', ['ui-onboarding', 1])
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
    })
  })

  it('joins the refreshed mirror view on a settings invalidation', async () => {
    let revision = 1
    const describe = vi.fn(() => Promise.resolve({
      rpcId: `apply-models-${revision}` as never,
      result: {
        ok: true as const,
        value: {
          writable: true,
          hasDocument: false,
          namespaces: [{
            ns: 'llm-test',
            schema: {},
            value: {},
            applies: 'live' as const,
            secrets: [],
            revision,
          }],
        },
      },
    }))
    const providers = vi.fn(() => Promise.resolve({
      rpcId: 'apply-models-providers' as never,
      result: { ok: true as const, value: { providers: [] } },
    }))
    const b = await bench(true, { describe }, { llm: { providers } })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = section(b.slots, 'models')
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    )()
    await injected.controller.load()
    expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(1)

    revision = 2
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-test', revision])

    await vi.waitFor(() => {
      expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(2)
    })
    expect(describe).toHaveBeenCalledTimes(2)
  })
})
