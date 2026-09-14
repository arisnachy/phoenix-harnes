/** Model-facing controls and standing policy for Universal Living Creations. @module @phoenix-ai/dsh-tool-living */

import type { Context } from '@phoenix-ai/cordis'
import { LivingCreationId, livingLevelRank } from '@phoenix-ai/dsh-living'
import type { LivingCreationSnapshot, LivingIntegrationLevel, LivingJson } from '@phoenix-ai/dsh-living'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

export const name = 'tool-living'
export const inject = ['living', 'tools', 'systemPrompt']

const LEVELS: readonly LivingIntegrationLevel[] = ['static', 'connected', 'reactive', 'controllable', 'inhabited']

/** Standing rule applied to every creation domain, including domains unknown to the harness. */
export const LIVING_CREATION_POLICY = `Universal Living Creation rule: whenever you create or materially modify a user-facing artifact or runnable system, keep it connected to Phoenix at the strongest meaningful integration level, regardless of its domain, format, or whether Phoenix has seen that kind before. Before treating a creation as delivered, register it with living_register_creation. Use static only when live state has no meaningful role; connected adds observable state; reactive adds events; controllable adds actions; inhabited adds actors that Phoenix or its agents can operate. For any target above static, build the creation with a provider or adapter that attaches through ctx.living.attach(), then call living_inspect_creation and do not claim completion while achieved_level is below target_level. A visual page, file, preview, or Cordis presentation alone is not an operational connection. Do not invent actors or events merely to raise the level: choose the strongest level that is genuinely useful for the creation. Runtime loss never means deletion: keep an offline manifest so the creation can reconnect later. Use living_forget_creation only when the user explicitly wants Phoenix to stop remembering the creation or when the creation has been permanently deleted and no reconnection is intended. This rule is universal; never special-case it to a fixed list of creation types.`

interface Summary {
  id: string
  title: string
  kind: string
  target_level: LivingIntegrationLevel
  achieved_level: LivingIntegrationLevel
  connected: boolean
}

function summary(snapshot: LivingCreationSnapshot): Summary {
  return {
    id: snapshot.manifest.id,
    title: snapshot.manifest.title,
    kind: snapshot.manifest.kind,
    target_level: snapshot.manifest.targetLevel,
    achieved_level: snapshot.achievedLevel,
    connected: snapshot.connected,
  }
}

const SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    target_level: { type: 'string', enum: LEVELS, required: true },
    achieved_level: { type: 'string', enum: LEVELS, required: true },
    connected: { type: 'boolean', required: true },
  },
} as const

const SUMMARY_OUTPUT = {
  schema: SUMMARY_SCHEMA,
  render: (_args: unknown, value: Summary) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

function parseInput(raw: string): LivingJson {
  try {
    return JSON.parse(raw) as LivingJson
  } catch {
    throw new TypeError('input_json must contain valid JSON')
  }
}

function assertTargetReached(snapshot: LivingCreationSnapshot): void {
  if (livingLevelRank(snapshot.achievedLevel) < livingLevelRank(snapshot.manifest.targetLevel)) {
    throw new Error(`living creation ${snapshot.manifest.id} is not ready: achieved ${snapshot.achievedLevel}, target ${snapshot.manifest.targetLevel}`)
  }
}

/** Register the universal living-creation policy and model controls. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:living', order: 115, text: LIVING_CREATION_POLICY })

  ctx.tools.register(defineTool({
    name: 'living_register_creation',
    description: 'Remember any user-facing artifact or runnable system Phoenix creates or materially modifies, using a self-described operational contract. This accepts arbitrary future creation kinds; kind is descriptive, never an enum.',
    parameters: {
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      target_level: { type: 'string', required: true, enum: LEVELS },
      state: { type: 'array', required: true, items: { type: 'string' } },
      actions: { type: 'array', required: true, items: { type: 'string' } },
      events: { type: 'array', required: true, items: { type: 'string' } },
      resources: { type: 'array', required: true, items: { type: 'string' } },
      actors: { type: 'array', required: true, items: { type: 'string' } },
    },
    output: SUMMARY_OUTPUT,
    async execute(args) {
      const snapshot = await ctx.living.remember({
        id: LivingCreationId(args.id), title: args.title, kind: args.kind,
        targetLevel: args.target_level,
        state: args.state, actions: args.actions, events: args.events, resources: args.resources, actors: args.actors,
      })
      return summary(snapshot)
    },
    presentCall: args => present('Register living creation', args.title),
  }))

  ctx.tools.register(defineTool({
    name: 'living_inspect_creation',
    description: 'Inspect one remembered creation and verify its live provider achieved the target integration level before delivery.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true }, target_level: { type: 'string', enum: LEVELS, required: true },
          achieved_level: { type: 'string', enum: LEVELS, required: true }, connected: { type: 'boolean', required: true },
          ready: { type: 'boolean', required: true }, manifest_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args) {
      const snapshot = ctx.living.inspect(LivingCreationId(args.id))
      return Promise.resolve({
        id: snapshot.manifest.id, target_level: snapshot.manifest.targetLevel, achieved_level: snapshot.achievedLevel,
        connected: snapshot.connected,
        ready: livingLevelRank(snapshot.achievedLevel) >= livingLevelRank(snapshot.manifest.targetLevel),
        manifest_json: JSON.stringify(snapshot.manifest),
      })
    },
    presentCall: args => present('Inspect living creation', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_list_creations',
    description: 'List creations Phoenix remembers, including offline creations that can reconnect later.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { creations_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.creations_json }],
    },
    execute() { return Promise.resolve({ creations_json: JSON.stringify(ctx.living.list().map(summary)) }) },
    presentCall: () => present('List living creations'),
  }))

  ctx.tools.register(defineTool({
    name: 'living_read_state',
    description: 'Read authoritative live state from a connected creation.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { state_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.state_json }],
    },
    async execute(args) { return { state_json: JSON.stringify(await ctx.living.readState(LivingCreationId(args.id))) } },
    presentCall: args => present('Read living state', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_act',
    description: 'Execute one action declared by a connected creation. The call fails when the creation is offline or the action was not declared.',
    parameters: {
      id: { type: 'string', required: true }, action: { type: 'string', required: true },
      input_json: { type: 'string', required: true, description: 'JSON value passed to the creation action.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.result_json }],
    },
    async execute(args) {
      const result = await ctx.living.act(LivingCreationId(args.id), args.action, parseInput(args.input_json))
      return { result_json: JSON.stringify(result) }
    },
    presentCall: args => present(`Living action: ${args.action}`, args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_verify_creation',
    description: 'Fail unless a creation has reached its declared target integration level. Use this immediately before claiming a created artifact or system is complete.',
    parameters: { id: { type: 'string', required: true } },
    output: SUMMARY_OUTPUT,
    execute(args) {
      const snapshot = ctx.living.inspect(LivingCreationId(args.id))
      assertTargetReached(snapshot)
      return Promise.resolve(summary(snapshot))
    },
    presentCall: args => present('Verify living creation', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_forget_creation',
    description: 'Explicitly delete Phoenix’s durable relationship to one creation and detach its live provider. Use only when the user explicitly wants Phoenix to stop remembering it or the creation was permanently deleted with no reconnection intended; runtime loss alone is never a reason to call this.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', required: true }, forgotten: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args) {
      const id = LivingCreationId(args.id)
      await ctx.living.forget(id)
      return { id: args.id, forgotten: true }
    },
    presentCall: args => present('Forget living creation', args.id),
  }))
}
