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
