/** Model-facing allowlisted Home Assistant tools for PHOENIX. */

import type { Context } from '@phoenix-ai/cordis'
import type { HomeControlRequest, HomeDevice } from '@phoenix-ai/dsh-home-gateway'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView, PreToolDecision } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-home-gateway'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-home-gateway'

/** Services required by the Home Assistant tool pair. */
export const inject = ['tools', 'home', 'systemPrompt']

type ListDevicesValue = { devices: HomeDevice[] }
type ControlValue = { result: { entityId: string; service: string; status: number; succeeded: boolean } }

const DEVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entityId: { type: 'string', required: true },
    state: { type: 'string', required: true },
    attributes: { type: 'object', additionalProperties: true, required: true },
  },
} as const

const CONTROL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      result: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          entityId: { type: 'string', required: true },
          service: { type: 'string', required: true },
          status: { type: 'integer', required: true },
          succeeded: { type: 'boolean', required: true },
        },
      },
    },
  } as const,
  render: (_args: unknown, value: ControlValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'execute', ...rawInput === undefined ? {} : { rawInput } }
}

/** Register read and control tools over the configured Home Assistant service. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:home-gateway',
    order: 119,
    text: 'Home control is available only through the allowlisted Home Assistant gateway. '
      + 'Use home_list_devices before acting when current state matters. Never infer or invent '
      + 'entity ids or services, and never attempt direct LAN requests. A control call is limited '
      + 'to the entity and service allowlists configured by the user.',
  })

  // Device control changes external state. Keep the approval decision in the
  // shared tool pipeline so full-access or custom deployments cannot silently
  // turn a home command into an unreviewed network action.
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const decision = await next()
    if (exec.name !== 'home_control' || decision.kind !== 'allow') return decision
    return {
      kind: 'ask',
      risk: 'high',
      reversible: false,
      reason: 'Home control requires approval because it changes a physical device through the configured allowlist.',
    }
  })

  ctx.tools.register(defineTool({
    name: 'home_list_devices',
    description: 'List current states and safe attributes for explicitly allowlisted Home Assistant entities. '
      + 'This does not scan the network or expose non-allowlisted devices.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: { type: 'array', required: true, items: DEVICE_SCHEMA },
        },
      },
      render: (_args, value: ListDevicesValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(_args, exec): Promise<ListDevicesValue> {
      return { devices: [...await ctx.home.listDevices(exec.signal)] }
    },
    presentCall: () => present('List allowlisted home devices'),
  }))

  ctx.tools.register(defineTool({
    name: 'home_control',
    description: 'Call one explicitly allowlisted Home Assistant service for one explicitly allowlisted entity. '
      + 'The service must be written without its domain (for example turn_on for light.office); '
      + 'the gateway derives and validates the domain. Never use this tool for arbitrary network devices.',
    parameters: {
      entity_id: { type: 'string', required: true, description: 'Exact allowlisted entity id, such as light.office.' },
      service: { type: 'string', required: true, description: 'Allowlisted service name without domain, such as turn_on.' },
      data: { type: 'object', additionalProperties: true, required: true, description: 'JSON service data, usually {}.' },
    },
    output: CONTROL_OUTPUT,
    async execute(args, exec): Promise<ControlValue> {
      const request: HomeControlRequest = {
        entityId: args.entity_id,
        service: args.service,
        data: args.data,
      }
      return { result: await ctx.home.control(request, exec.signal) }
    },
    presentCall: args => present(`Control ${args.entity_id}`, { entity_id: args.entity_id, service: args.service }),
  }))
}

/** Cordis plugin entry that registers the allowlisted Home Assistant tools. */
export default { name, inject, apply }
