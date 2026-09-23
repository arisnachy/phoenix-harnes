import type { Context } from '@phoenix-ai/cordis'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type { RealityContextEngine } from './reality-context.ts'

/**
 * Create the read-only tool that waits for current Reality Context evidence.
 * Fresh mode respects signal TTLs; full mode deliberately reprobes every host
 * and runtime signal before returning.
 * @param ctx - The ctx value.
 * @param engine - The engine value.
 * @returns The resulting value.
 */
export function createRealitySnapshotTool(
  engine: RealityContextEngine,
  ctx: Context,
): ToolDefinition {
  return defineTool({
    name: 'phoenix_reality_now',
    description: 'Read Phoenix\'s current verified Reality Context. Use this before an environment-sensitive decision when the prompt snapshot is stale, unknown, or the action is high-impact. mode=fresh waits for due probes while respecting TTLs; mode=full forces all configured host/runtime probes to run again. This tool is read-only and never grants permissions.',
    parameters: {
      mode: {
        type: 'string',
        enum: ['fresh', 'full'],
        description: 'fresh = refresh only expired/missing signals; full = force every configured Reality Context probe now.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const assembly = exec.agent === undefined ? undefined : { agent: exec.agent }
      await engine.refreshNow(ctx, args.mode === 'full', assembly)
      const snapshot = engine.snapshot(
        ctx,
        new Date(),
        assembly,
      )
      return JSON.parse(JSON.stringify(snapshot)) as Record<string, JsonValue>
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.mode === 'full' ? 'Refresh full reality state' : 'Refresh reality state',
        kind: 'read',
      }
    },
  })
}
