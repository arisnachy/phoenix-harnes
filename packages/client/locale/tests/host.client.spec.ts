import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import SystemPrompt, { renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@phoenix-ai/dsh-settings'
import {
  LOCALE_SETTINGS_NAMESPACE, apply,
} from '@phoenix-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  it('registers an optional explicit locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    await expect(ctx.settings.update(ns, { preference: 'fr' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
  it('updates the model-facing output language from the selected Host preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    const prompt = async () => renderPrompt(await ctx.systemPrompt.assemble())
    expect(await prompt()).not.toContain('explicitly selected')
    await ctx.settings.update(ns, { preference: 'es' })
    expect(await prompt()).toContain('explicitly selected Spanish')
    await ctx.settings.update(ns, { preference: 'en' })
    expect(await prompt()).toContain('explicitly selected English')
    await ctx.settings.update(ns, { preference: 'zh' })
    expect(await prompt()).toContain('explicitly selected Chinese')
    await ctx.settings.replace(ns, {})
    expect(await prompt()).not.toContain('explicitly selected')
    await fiber.dispose()
    expect(await prompt()).not.toContain('explicitly selected')
  })

})
