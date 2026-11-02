/** Settings shell registrations: shell copy stays ownerless; feature status uses the trailing seat. */
import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@phoenix-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { TestRemote } from '@phoenix-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@phoenix-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@phoenix-ai/dsh-client-ui-settings-general/client'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from '../src/client/SettingsDocumentAction.tsx'

const SEATS = [
  ['settings.trigger', TriggerContent],
  ['settings.header', HeaderContent],
  ['settings.action', SettingsDocumentAction],
  ['settings.close', CloseLabel],
  ['settings.section', GeneralSection],
] as const

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const settingsDescribe = vi.fn(() => Promise.resolve({
    rpcId: 'settings-general' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [] },
    },
  }))
  const settingsOpenDocument = vi.fn(() => Promise.resolve({
    rpcId: 'settings-open' as never,
    result: { ok: true as const, value: { opened: true as const } },
  }))
  ctx.provide('connection', {
    api: { settings: { describe: settingsDescribe, openDocument: settingsOpenDocument } },
    isLoopback,
  } as never)
  new TestRemote(ctx)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, settingsDescribe }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.trigger.trailing': { kind: 'single', scope: 'session-maybe' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

function generalEntry(slots: SlotRegistry) {
  return slots.entries('settings.section').find(e => e.component === GeneralSection)
}

describe('ui-settings-general apply', () => {
  it('declares only the services owned by the Settings shell', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'settingsScope'])
  })

  it('fills shell seats while leaving settings.trigger.trailing for feature-owned status', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    for (const [name, component] of SEATS) {
      expect(b.slots.entries(name)[0]!.component).toBe(component)
    }
    expect(b.slots.entries('settings.trigger.trailing')).toEqual([])
    const entry = generalEntry(b.slots)!
    expect(entry.options).toMatchObject({ id: 'general', order: 0 })
    expect(resolveSlotLabel(entry.options.label)).toBe('通用设置')
    expect(b.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
  })

  it('keeps copy locale-driven without re-registering the shell seats', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const versions = SEATS.map(([name]) => b.slots.getVersion(name))
    b.locale.setLocale('en')
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('General')
    SEATS.forEach(([name], i) => {
      expect(b.slots.getVersion(name)).toBe(versions[i]!)
      expect(b.slots.entries(name)).toHaveLength(1)
    })
  })

  it('withholds the loopback-only document action off-loopback', async () => {
    const b = await bench(false)
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.action')).toEqual([])
    expect(b.settingsDescribe).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('re-registers after the declaring chain collapses and frees all seats on teardown', async () => {
    const b = await bench()
    const removeDeclaration = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    removeDeclaration()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    for (const [name, component] of SEATS) {
      expect(b.slots.entries(name)[0]!.component).toBe(component)
    }
    await fiber.dispose()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
  })

  it('keeps the document action controller on the shared settings mirror', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.action')[0]!
    const { controller } = (entry.inject as unknown as () => SettingsDocumentActionInjected)()
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledOnce() })
    await controller.load()
    expect(b.settingsDescribe).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
})
