// @vitest-environment jsdom
import { Context, Service } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@phoenix-ai/dsh-client-locale/client'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import {
  TokenTelemetrySection,
  type TokenTelemetrySectionInjected,
} from '../src/client/TokenTelemetrySection.tsx'

describe('Settings Telemetría Remote dependency', () => {
  it('declares the exact nested Remote service its actions use', () => {
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.pluginInventory')
  })

  it('reads, enables and clears real injected Host RPCs through the registered section', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('connection', { isLoopback: false } as never)
    ctx.provide('settingsScope', { describe: () => ({}) } as never)
    class RemoteService extends Service {
      constructor() { super(ctx, 'remote') }
    }
    new RemoteService()
    const data = { enabled: true, records: [] }
    const off = { enabled: false, records: [] }
    const tokenTelemetry = vi.fn().mockResolvedValue({ ok: true, value: data })
    const setTokenTelemetry = vi.fn().mockResolvedValue({ ok: true, value: off })
    const clearTokenTelemetry = vi.fn().mockResolvedValue({ ok: true, value: data })
    ctx.provide('remote.pluginInventory', { tokenTelemetry, setTokenTelemetry, clearTokenTelemetry })

    const slots = ctx.get('slots') as SlotRegistry
    const stop = slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('settings.section').find(row => row.options.id === 'telemetry')
    expect(entry?.component).toBe(TokenTelemetrySection)
    const actions = (entry?.inject as unknown as () => TokenTelemetrySectionInjected)()
    await expect(actions.readTelemetry()).resolves.toEqual(data)
    await expect(actions.setTelemetry(false)).resolves.toEqual(off)
    await expect(actions.clearTelemetry()).resolves.toEqual(data)
    expect(tokenTelemetry).toHaveBeenCalledOnce()
    expect(setTokenTelemetry).toHaveBeenCalledWith({ enabled: false })
    expect(clearTokenTelemetry).toHaveBeenCalledOnce()
    await fiber.dispose()
    stop()
    await ctx.fiber.dispose()
  })
})
