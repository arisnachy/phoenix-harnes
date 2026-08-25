// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { UpdateFooterAction, type UpdateFooterActionInjected } from '../src/client/UpdateFooterAction.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type UpdateStateResult =
  | { readonly ok: true; readonly value: { readonly status: 'current' } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type RestartResult =
  | { readonly ok: true; readonly value: { readonly accepted: false; readonly status: 'current' } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  const updateState = vi.fn<() => Promise<UpdateStateResult>>()
    .mockResolvedValue({ ok: true, value: { status: 'current' } })
  const restartForUpdate = vi.fn<() => Promise<RestartResult>>()
    .mockResolvedValue({ ok: true, value: { accepted: false, status: 'current' } })
  ctx.provide('remote.pluginInventory', { list, updateState, restartForUpdate })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, updateState, restartForUpdate }
}

function declareSettings(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function declareFooter(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'sidebar',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by its Remote contributions', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory'])
  })

  it('registers the localized tab and updater footer without reading Remotes eagerly', async () => {
    const b = await bench()
    declareSettings(b.slots)
    declareFooter(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')

    const footer = b.slots.entries('sidebar.footer.action')[0]!
    expect(footer.component).toBe(UpdateFooterAction)
    expect(footer.options).toMatchObject({ id: 'phoenix-update', order: -100 })
    expect(footer.locale).toBe(NS)
    expect(b.list).not.toHaveBeenCalled()
    expect(b.updateState).not.toHaveBeenCalled()
    expect(b.restartForUpdate).not.toHaveBeenCalled()

    const inventoryInjected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(inventoryInjected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(inventoryInjected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')

    const updateInjected = (footer.inject as unknown as () => UpdateFooterActionInjected)()
    await expect(updateInjected.readUpdateState()).resolves.toEqual({ status: 'current' })
    await expect(updateInjected.restartForUpdate()).resolves.toEqual({ accepted: false, status: 'current' })
    b.updateState.mockResolvedValueOnce({ ok: false, error: { code: 'STATE_ERROR', message: 'unavailable' } })
    await expect(updateInjected.readUpdateState()).rejects.toThrow('pluginInventory.updateState failed: STATE_ERROR: unavailable')
    b.restartForUpdate.mockResolvedValueOnce({ ok: false, error: { code: 'RESTART_ERROR', message: 'unavailable' } })
    await expect(updateInjected.restartForUpdate()).rejects.toThrow('pluginInventory.restartForUpdate failed: RESTART_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers both registrations across late declaration and reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)

    const stopSettings = declareSettings(b.slots)
    const stopFooter = declareFooter(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1)
      expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin list')

    stopSettings()
    stopFooter()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    declareSettings(b.slots)
    declareFooter(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInventorySettingsTab)
      expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(UpdateFooterAction)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
