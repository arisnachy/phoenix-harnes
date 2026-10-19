/** Read-only, live-session mission continuation view shared by every model provider. */

import { verifyEvolutionCheckpoint } from '@phoenix-ai/dsh-hardness'
import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { recoverEvolutionCheckpoint } from './evolution-runtime.ts'

/** Create a model-facing status tool backed exclusively by the caller's durable session.
 * @returns Read-only mission-resume diagnostic without permissions or synthetic success.
 */
export function createEvolutionStatusTool(): ToolDefinition {
  return defineTool({
    name: 'hardness_evolution_status',
    description: 'Inspect the durable status, objective and independent verification of an existing mission in THIS conversation. Useful after model switching, compaction or recovery. Read only: never creates missions, certifies AGI, changes permissions or deploys.',
    parameters: {
      missionId: { type: 'string', required: true, description: 'Exact existing mission identifier in the current session.' },
      revision: { type: 'number', required: true, description: 'Non-negative integer mission revision.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, execution) {
      const agent = execution.agent
      if (agent === undefined) return { available: false, reason: 'no live session; no verification can be claimed' }
      const missionId = args.missionId.trim()
      if (!missionId || !Number.isSafeInteger(args.revision) || args.revision < 0) {
        return { available: false, reason: 'invalid mission identity' }
      }
      const checkpoint = recoverEvolutionCheckpoint(
        agent.session.events,
        missionId,
        args.revision,
        agent.options.provider + '/' + agent.options.model,
      )
      const verdict = verifyEvolutionCheckpoint(checkpoint)
      const available = checkpoint.objective.length > 0 && verdict.allowed
      return {
        available,
        ...(available ? { checkpoint } : {}),
        reasons: [...verdict.reasons, ...checkpoint.objective.length === 0 ? ['no matching mission in this conversation'] : []],
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Mission continuity · ' + args.missionId, kind: 'read' }
    },
  })
}
