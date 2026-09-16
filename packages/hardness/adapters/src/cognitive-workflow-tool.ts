/** Model-facing pure adapter for the deterministic HARDNESS cognitive workflow router. */

import {
  adaptCognitiveWorkflow,
  selectCognitiveWorkflow,
  type CognitiveMissionProfile,
  type CognitiveWorkflowObservation,
  type CognitiveWorkflowPlan,
} from '@phoenix-ai/dsh-hardness'
import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'

const MISSION_KINDS = ['simple', 'build', 'debug', 'research', 'architecture', 'operational', 'recovery', 'mixed'] as const
const MISSION_LEVELS = ['low', 'medium', 'high'] as const
const EXECUTION_MODES = ['fast', 'standard', 'deep'] as const
const WORKFLOW_OBSERVATIONS = [
  'execution-failed',
  'verification-failed',
  'new-risk',
  'scope-expanded',
  'independent-subtasks-discovered',
  'repeated-failure',
  'future-obligation-discovered',
] as const satisfies readonly CognitiveWorkflowObservation[]

function projectWorkflowPlan(plan: CognitiveWorkflowPlan) {
  return {
    profile: { ...plan.profile },
    executionMode: plan.executionMode,
    measurements: { ...plan.measurements },
    thresholds: { ...plan.thresholds },
    budget: { ...plan.budget },
    selected: [...plan.selected],
    reasons: plan.reasons.map(reason => ({ ...reason })),
    skipped: plan.skipped.map(reason => ({ ...reason })),
    qualityGates: [...plan.qualityGates],
  }
}

/** Create the pure model-facing cognitive workflow planner.
 * @returns A registry-ready `hardness_workflow` tool that selects no execution authority.
 */
export function createCognitiveWorkflowTool(): ToolDefinition {
  return defineTool({
    name: 'hardness_workflow',
    description: 'Select the deterministic HARDNESS cognitive workflow before execution planning. Use it for non-trivial missions and again when bounded evidence changes the mission. It returns execution depth, ordered flows, reasons, and quality gates; it does not execute tools or grant permissions.',
    parameters: {
      profile: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: MISSION_KINDS, required: true },
          complexity: { type: 'string', enum: MISSION_LEVELS, required: true },
          risk: { type: 'string', enum: MISSION_LEVELS, required: true },
          novelty: { type: 'string', enum: MISSION_LEVELS, required: true },
          requiresCodeChange: { type: 'boolean', required: true },
          requiresExternalEvidence: { type: 'boolean', required: true },
          hasIndependentSubtasks: { type: 'boolean', required: true },
          persistent: { type: 'boolean', required: true },
          previousFailure: { type: 'boolean', required: true },
          repeatedPattern: { type: 'boolean', required: true },
          userVisibleArtifact: { type: 'boolean', required: true },
          futureObligation: { type: 'boolean', required: true },
        },
      },
      observation: { type: 'string', enum: WORKFLOW_OBSERVATIONS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profile: { type: 'json', required: true },
          executionMode: { type: 'string', enum: EXECUTION_MODES, required: true },
          measurements: { type: 'json', required: true },
          thresholds: { type: 'json', required: true },
          budget: { type: 'json', required: true },
          selected: { type: 'array', items: { type: 'string' }, required: true },
          reasons: { type: 'json', required: true },
          skipped: { type: 'json', required: true },
          qualityGates: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const initial = selectCognitiveWorkflow(args.profile as CognitiveMissionProfile)
      const plan = args.observation === undefined
        ? initial
        : adaptCognitiveWorkflow(initial, args.observation as CognitiveWorkflowObservation)
      return projectWorkflowPlan(plan)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `HARDNESS workflow · ${args.profile.kind}`,
        kind: 'read',
        rawInput: args.profile.kind,
      }
    },
  })
}
