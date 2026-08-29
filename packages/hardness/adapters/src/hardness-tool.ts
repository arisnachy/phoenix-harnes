import type { CapabilityNeed, CapabilityStatus } from '@phoenix-ai/dsh-hardness'
import { snapshotJsonValue } from '@phoenix-ai/dsh-session'
import {
  defineTool,
  ToolArgsError,
  type JsonValue,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'
import type { CapabilityExecutionContext } from './execution-bridge.ts'
import type { HardnessMissionResult } from './mission-orchestrator.ts'
import type { HardnessMissionRunner } from './mission-runtime.ts'

export type { HardnessMissionRunner } from './mission-runtime.ts'

const CAPABILITY_STATUSES = [
  'experimental',
  'testing',
  'verified',
  'broken',
  'quarantined',
  'deprecated',
] as const satisfies readonly CapabilityStatus[]

type HardnessToolResult =
  | { readonly kind: 'blocked'; readonly reason: string }
  | {
    readonly kind: 'completed'
    readonly artifact_id: string
    readonly artifact_mime: string
    readonly rendered: JsonValue
  }

const SENSITIVE_RENDER_KEY = /(?:api[-_]?key|authorization|credential|password|private(?:[-_]?key)?|secret|token)/i

function containsSensitiveRenderKey(value: JsonValue): boolean {
  const pending: JsonValue[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || current === null || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    for (const [key, child] of Object.entries(current)) {
      if (SENSITIVE_RENDER_KEY.test(key)) return true
      pending.push(child)
    }
  }
  return false
}

function safeRendered(value: unknown): JsonValue | undefined {
  let snapshot: JsonValue | undefined
  try {
    snapshot = snapshotJsonValue(value) as JsonValue | undefined
  } catch {
    // A renderer getter that throws cannot produce a safe model-facing result.
    return undefined
  }
  return snapshot === undefined || containsSensitiveRenderKey(snapshot) ? undefined : snapshot
}

function projectMissionResult(result: HardnessMissionResult): HardnessToolResult {
  switch (result.kind) {
    case 'blocked':
      return { kind: 'blocked', reason: result.reason }
    case 'completed':
    {
      const rendered = safeRendered(result.rendered)
      if (rendered === undefined) {
        return { kind: 'blocked', reason: 'mission produced an unsafe model-facing rendering' }
      }
      return {
        kind: 'completed',
        artifact_id: result.artifact.id,
        artifact_mime: result.artifact.mime,
        rendered,
      }
    }
  }
}

function executionContext(exec: { readonly callId: CapabilityExecutionContext['callId']; readonly signal: AbortSignal; readonly agent?: CapabilityExecutionContext['agent'] }): CapabilityExecutionContext {
  return {
    callId: exec.callId,
    signal: exec.signal,
    ...(exec.agent === undefined ? {} : { agent: exec.agent }),
  }
}

/**
 * Create the model-facing HARDNESS mission adapter.
 * @param runner - Governed mission runner that owns capability resolution and execution.
 * @returns A registry-ready `hardness_run` tool definition.
 */
export function createHardnessTool(runner: HardnessMissionRunner): ToolDefinition {
  return defineTool({
    name: 'hardness_run',
    description: 'Run one governed HARDNESS capability mission.',
    parameters: {
      need: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          inputs: { type: 'array', items: { type: 'string' } },
          outputs: { type: 'array', items: { type: 'string' } },
          requiredStatus: { type: 'string', enum: CAPABILITY_STATUSES },
          permissions: { type: 'array', items: { type: 'string' } },
        },
      },
      arguments: { type: 'json', required: true },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'blocked', required: true },
              reason: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', const: 'completed', required: true },
              artifact_id: { type: 'string', required: true },
              artifact_mime: { type: 'string', required: true },
              rendered: { type: 'json', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.need.kind.trim().length === 0) {
        throw new ToolArgsError(['need.kind must be a non-empty string'])
      }
      const context = executionContext(exec)
      const result = await runner.run({
        need: args.need as CapabilityNeed,
        args: args.arguments,
        context,
      })
      return projectMissionResult(result)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `HARDNESS ${args.need.kind}`,
        kind: 'execute',
        rawInput: args.need.kind,
      }
    },
  })
}
