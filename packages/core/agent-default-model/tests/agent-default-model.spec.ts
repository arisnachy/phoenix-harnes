/** Default Agent model settings layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentDefaultModelConfig, {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, ECLIPSE_ROUTING_SETTINGS_NAMESPACE,
} from '../src/index.ts'
import { SettingsProvider } from '@phoenix-ai/dsh-settings'
import type { SettingsNamespace } from '@phoenix-ai/dsh-settings'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  defaultModel: AgentDefaultModelConfig
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  return { ctx, settingsFiber, defaultModel: ctx.agentDefaultModel }
}

describe('AgentDefaultModelConfig', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })

    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high',
    })
    await bench.ctx.fiber.dispose()
  })

  it('clears a stored effort when the saved selection has none', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-plain' })
    expect(bench.defaultModel.currentSelection()).toEqual({ provider: 'acme-gateway', model: 'acme-plain' })
    await bench.ctx.fiber.dispose()
  })

  it('layers a hand-written partial section over the entry', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      model: 'deepseek-reasoner',
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-reasoner',
    })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })
    expect(bench.defaultModel.currentSelection().provider).toBe('acme-gateway')
    await bench.settingsFiber.dispose()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await bench.ctx.fiber.dispose()
  })

  it('stores Eclipse independently of the ordinary default Agent model', async () => {
    const bench = await boot()
    const profile = {
      mode: 'hybrid' as const,
      coordinator: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
      subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'high' },
    }
    await bench.settingsFiber.ctx.settings.replace(ECLIPSE_ROUTING_SETTINGS_NAMESPACE, profile)
    expect(bench.defaultModel.currentEclipseProfile()).toMatchObject(profile)
    expect(bench.defaultModel.currentSelection().model).toBe('deepseek-v4-flash')
    expect(bench.settingsFiber.ctx.settings.describe().map(entry => entry.ns)).toEqual([
      AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
      ECLIPSE_ROUTING_SETTINGS_NAMESPACE,
    ])
    await bench.defaultModel.saveSelection({ provider: 'other-provider', model: 'other-model' })
    expect(bench.defaultModel.currentEclipseProfile()).toMatchObject(profile)
    await bench.ctx.fiber.dispose()
  })

  it('requires Codex routes for new canonical writes without restricting effort ids', async () => {
    const bench = await boot()
    await expect(bench.settingsFiber.ctx.settings.replace(ECLIPSE_ROUTING_SETTINGS_NAMESPACE, {
      mode: 'manual',
      coordinator: { provider: 'openrouter', model: 'some-model', reasoningEffort: 'provider-specific' },
    })).rejects.toThrow(/openai-codex/)
    await bench.settingsFiber.ctx.settings.replace(ECLIPSE_ROUTING_SETTINGS_NAMESPACE, {
      mode: 'manual',
      coordinator: { provider: 'openai-codex', model: 'gpt-current', reasoningEffort: 'provider-specific' },
    })
    expect(bench.defaultModel.currentEclipseProfile()).toMatchObject({
      coordinator: { model: 'gpt-current', reasoningEffort: 'provider-specific' },
    })
    await bench.ctx.fiber.dispose()
  })

  it('reads legacy Eclipse preferences until saved on the dedicated model', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      eclipse: { mode: 'manual', planner: { provider: 'openai-codex', model: 'old-coordinator' } },
    })
    expect(bench.defaultModel.currentEclipseProfile()?.planner?.model).toBe('old-coordinator')
    expect(bench.defaultModel.currentEclipseProfile()?.coordinator?.model).toBe('old-coordinator')
    await bench.settingsFiber.ctx.settings.replace(ECLIPSE_ROUTING_SETTINGS_NAMESPACE, {
      mode: 'automatic',
    })
    expect(bench.defaultModel.currentEclipseProfile()?.mode).toBe('automatic')
    expect(bench.defaultModel.currentEclipseProfile()?.planner).toBeUndefined()
    expect(bench.defaultModel.currentEclipseProfile()?.coordinator).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('remembers the last real picker choice across service recreation', async () => {
    const first = await boot()
    await first.defaultModel.saveWebSelection(
      { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('high') },
      { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('high') },
    )
    const saved = first.settingsFiber.ctx.settings.describe()
    expect(first.defaultModel.preferredSelection()).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high',
    })
    expect(first.defaultModel.currentSelection().provider).toBe('openai-codex')
    expect(saved.some(entry => entry.ns === AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE)).toBe(true)
    await first.ctx.fiber.dispose()
  })

  it('preserves synthetic Fénix Eclipse as the last choice without using it as runtime', async () => {
    const bench = await boot()
    await bench.defaultModel.saveWebSelection(
      { provider: 'openai-codex', model: 'phoenix-auto' },
      { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') },
    )
    expect(bench.defaultModel.preferredSelection()).toEqual({
      provider: 'openai-codex', model: 'phoenix-auto',
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max',
    })
    await bench.defaultModel.saveSelection({ provider: 'other', model: 'new' })
    expect(bench.defaultModel.preferredSelection()).toEqual({ provider: 'other', model: 'new' })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'other', model: 'other' })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })
})
