import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import type { Config as TeamConfig } from '../../../packages/subagent/tool-agent-team/src/index.ts'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import {
  assembly,
  execute,
  setup,
  spawnedChildId,
} from '../../../packages/subagent/tool-agent-team/tests/team-lifecycle-fixture.ts'

const PRESET_PATH = fileURLToPath(new URL('../config/agent-presets/kira-max/agent.cordis.yml', import.meta.url))

interface CordisRow {
  id?: string
  name?: string
  config?: unknown
  disabled?: unknown
}

interface DelegationRow extends CordisRow {
  config?: TeamConfig
}

interface PresetDocument {
  rows: CordisRow[]
  delegation: CordisRow & { config: CordisRow[] }
  team: DelegationRow & { config: TeamConfig }
  persona: CordisRow & { config: { text: string } }
  hardness: DelegationRow & { config: Record<string, unknown> }
}

// The CLI loader accepts this expression tag as inert text while resolving the
// composition later. Reuse that schema so this test reads the shipped YAML in
// the same dialect as the production loader.
const jsExpressionType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => String(value),
})
const compositionSchema = yaml.JSON_SCHEMA.extend(jsExpressionType)

async function readPreset(): Promise<PresetDocument> {
  const rows = yaml.load(await readFile(PRESET_PATH, 'utf8'), { schema: compositionSchema })
  if (!Array.isArray(rows)) throw new Error('Kira Max composition must be a row list')
  const row = (id: string): CordisRow => {
    const found = rows.find(candidate => typeof candidate === 'object' && candidate !== null && candidate.id === id)
    if (found === undefined) throw new Error(`Kira Max composition is missing ${id}`)
    return found as CordisRow
  }
  const delegation = row('delegation')
  if (!Array.isArray(delegation.config)) throw new Error('Kira Max delegation group must contain rows')
  const team = delegation.config.find(candidate => candidate.id === 'tool-agent-team')
  if (team === undefined || typeof team.config !== 'object' || team.config === null) {
    throw new Error('Kira Max delegation group is missing tool-agent-team config')
  }
  const persona = row('persona')
  const personaConfig: unknown = persona.config
  if (
    typeof personaConfig !== 'object'
    || personaConfig === null
    || !('text' in personaConfig)
    || typeof personaConfig.text !== 'string'
  ) {
    throw new Error('Kira Max persona text is missing')
  }
  const hardness = row('hardness-model-tools')
  if (typeof hardness.config !== 'object' || hardness.config === null) {
    throw new Error('Kira Max HARDNESS config is missing')
  }
  return {
    rows: rows as CordisRow[],
    delegation: delegation as CordisRow & { config: CordisRow[] },
    team: team as DelegationRow & { config: TeamConfig },
    persona: persona as CordisRow & { config: { text: string } },
    hardness: hardness as DelegationRow & { config: Record<string, unknown> },
  }
}

async function interruptChild(ctx: Parameters<typeof execute>[0], lead: Agent, name: string): Promise<void> {
  const result = await execute(ctx, lead, 'interrupt_agent', { target: name })
  expect(result.isError).toBe(false)
}

async function waitRunningWithBudget(ctx: Parameters<typeof execute>[0], id: ReturnType<typeof spawnedChildId>): Promise<Agent> {
  let running: Agent | undefined
  await vi.waitFor(() => {
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    running = child
    return child
  }, { timeout: 15_000 })
  if (running === undefined) throw new Error(`teammate ${id} did not become available`)
  return running
}

async function waitGoneWithBudget(ctx: Parameters<typeof execute>[0], id: ReturnType<typeof spawnedChildId>): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 15_000 })
}

describe('Kira Max execution contract', () => {
  it('starts two fresh Team specialists on the configured Codex Luna route', async () => {
    const preset = await readPreset()
    const reasoning = {
      efforts: [{ id: ReasoningEffortId('max'), name: 'Max' }],
      defaultEffort: ReasoningEffortId('max'),
    }
    const { ctx, lead } = await setup(['hang', 'hang'], false, preset.team.config, reasoning)
    ctx.llm.registerAdapter(['openai-codex'], new MockAdapter(['hang', 'hang'], reasoning))
    lead.options.provider = 'openai-codex'
    lead.options.model = 'selected-kira-model'
    const privateHistory = 'KIRA_PRIVATE_HISTORY_SENTINEL_7f4a'
    lead.session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: privateHistory }],
    }), { surfaceOp: 'append' })

    const firstResult = await execute(ctx, lead, 'spawn_teammate', {
      name: 'kira-specialist-one',
      description: 'independent first front',
      prompt: 'Complete the bounded first front and report evidence.',
      context: 'fresh',
    })
    const secondResult = await execute(ctx, lead, 'spawn_teammate', {
      name: 'kira-specialist-two',
      description: 'independent second front',
      prompt: 'Complete the bounded second front and report evidence.',
      context: 'fresh',
    })
    expect(firstResult.isError).toBe(false)
    expect(secondResult.isError).toBe(false)

    const first = await waitRunningWithBudget(ctx, spawnedChildId(firstResult))
    const second = await waitRunningWithBudget(ctx, spawnedChildId(secondResult))
    const profileName = preset.team.config.defaultModelProfile
    if (profileName === undefined) throw new Error('Kira Max Team profile name is missing')
    const profile = preset.team.config.modelProfiles?.[profileName]
    if (profile === undefined) throw new Error(`Kira Max Team profile ${profileName} is missing`)
    expect(profile).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' })
    expect(first.options).toMatchObject(profile)
    expect(second.options).toMatchObject(profile)
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.role === 'teammate')).toHaveLength(2)
    const firstPrompt = renderPrompt(await assembly(ctx, first))
    expect(firstPrompt).toContain('Your Team role is teammate')
    expect(firstPrompt).not.toContain(privateHistory)
    const firstBrief = first.session.events
      .filter(event => event.type === 'user/message')
      .flatMap(event => event.data.content)
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    expect(firstBrief).toContain('Complete the bounded first front')
    expect(firstBrief).not.toContain(privateHistory)

    await interruptChild(ctx, lead, 'kira-specialist-one')
    await interruptChild(ctx, lead, 'kira-specialist-two')
    await waitGoneWithBudget(ctx, first.id)
    await waitGoneWithBudget(ctx, second.id)
  }, 30_000)

  it('keeps an explicitly selected non-Codex provider and model on fresh workers', async () => {
    const preset = await readPreset()
    const { ctx, lead } = await setup(['hang'], false, preset.team.config)
    lead.options.provider = 'mock'
    lead.options.model = 'selected-non-codex-model'

    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'non-codex-specialist',
      description: 'provider inheritance front',
      prompt: 'Complete the bounded provider inheritance check.',
      context: 'fresh',
    })
    expect(result.isError).toBe(false)
    const child = await waitRunningWithBudget(ctx, spawnedChildId(result))
    expect(child.options).toMatchObject({ provider: 'mock', model: 'selected-non-codex-model' })
    expect(child.options.model).not.toBe('gpt-6-luna')

    await interruptChild(ctx, lead, 'non-codex-specialist')
    await waitGoneWithBudget(ctx, child.id)
  }, 30_000)

  it('records a scripted teammate conclusion in the durable Team session', async () => {
    const preset = await readPreset()
    const { ctx, lead } = await setup([textResponse('bounded conclusion with evidence')], false, preset.team.config)
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'conclusion-specialist',
      description: 'bounded read-only conclusion',
      prompt: 'Return one concise conclusion with the evidence you observed.',
      context: 'fresh',
    })
    expect(result.isError).toBe(false)
    const childId = spawnedChildId(result)
    await waitGoneWithBudget(ctx, childId)
    const persisted = await ctx.sessionPersistence.inspect(childId)
    expect(JSON.stringify(persisted.events)).toContain('bounded conclusion with evidence')
    expect(ctx.agentTeams.listMembers(lead).some(member => member.name === 'conclusion-specialist')).toBe(true)
  }, 30_000)

  it('keeps memory, HARDNESS, and Kira execution rules in the shipped composition', async () => {
    const preset = await readPreset()
    const memory = preset.rows.find(row => row.id === 'tool-session-learning')
    expect(memory).toBeDefined()
    expect(preset.persona.config.text).toContain('<kira_execution_contract>')
    expect(preset.persona.config.text).toContain('memory_search')
    expect(preset.persona.config.text).toContain('hardness_workflow')
    expect(preset.persona.config.text).toContain('hardness_run')
    expect(preset.persona.config.text).toContain('Después de dos esperas sin novedades')
    expect(preset.persona.config.text).toContain('Sol 6.1 xhigh hace el primer plan/diagnóstico')
    expect(preset.persona.config.text).toContain('supervisando y orquestando con GPT-6 Luna Max')
    expect(preset.persona.config.text).toContain('Kira con Luna Max ASUME ese plan')
    expect(preset.persona.config.text).toContain('de 1 a 5 tareas independientes')
    expect(preset.persona.config.text).toContain('vuelve inmediatamente a Kira con Luna Max')
    expect(preset.persona.config.text).not.toContain('Kira con Sol ASUME ese plan')
    expect(preset.persona.config.text).not.toContain('continúa coordinando con Sol high')
    expect(preset.hardness).toMatchObject({ name: '@phoenix-ai/dsh-hardness-adapters' })
    expect(preset.hardness.config).toMatchObject({
      judgeProvider: 'spawn',
      modelTools: true,
      judgeOrdinaryMutations: true,
      maxOrdinaryJudgePasses: 2,
    })
  })
})
