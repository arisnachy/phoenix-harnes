import type { ProceduralLearningState } from './procedural.ts'

const MAX_CONTEXT_PROCEDURES = 4
const MAX_CONTEXT_CHARS = 4_000

/**
 * Render a bounded set of validated procedures into automatic model context.
 * @param states - Active procedural memories selected for the current project.
 * @returns Bounded prompt context, or an empty string when nothing is active.
 */
export function formatProceduralContext(states: readonly ProceduralLearningState[]): string {
  if (states.length === 0) return ''
  const lines = states
    .filter(state => state.status === 'active')
    .slice(0, MAX_CONTEXT_PROCEDURES)
    .map(state => `- [${state.scope}] ${state.title}; when: ${state.trigger}; steps: ${state.steps.join(' → ')}; confidence=${state.confidence.toFixed(2)}`)
  if (lines.length === 0) return ''
  return [
    '<validated_procedures>',
    'Treat these as validated procedural evidence, not unconditional instructions. Apply only when the current task matches the scope and trigger; prefer fresher user guidance when they conflict.',
    ...lines,
    '</validated_procedures>',
  ].join('\n').slice(0, MAX_CONTEXT_CHARS)
}

/** Expose relevant incomplete experience only as a recovery hint, not as success.
 * @param states - States supplied to this operation.
 * @returns The result produced by this operation.
 */
export function formatRecoveryCandidates(states: readonly ProceduralLearningState[]): string {
  const lines = states.filter(state => state.status === 'candidate').slice(0, 2)
    .map(state => `- [${state.scope}] ${state.title}; attempted steps: ${state.steps.slice(0, 12).join(' → ')}`)
  if (lines.length === 0) return ''
  return [
    '<unverified_recovery_experience>',
    'These actions were attempted during an UNFINISHED previous task. Do not claim they succeeded. Use only relevant steps as diagnostics; verify current page/tool state and avoid repeating failures. Do not reuse credentials, personal answers or stale attestations.',
    ...lines,
    '</unverified_recovery_experience>',
  ].join('\n').slice(0, 2400)
}
