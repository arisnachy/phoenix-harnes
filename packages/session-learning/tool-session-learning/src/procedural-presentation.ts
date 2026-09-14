import type { ProceduralLearningState } from './procedural.ts'

const MAX_CONTEXT_PROCEDURES = 4
const MAX_CONTEXT_CHARS = 4_000

function privateProcedureText(value: string): string {
  return value
    .replace(/\b(?:AGENTS|CLAUDE)\.md\b/giu, '[internal guidance]')
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/gu, '[local path]')
    .replace(/(?:\/Users\/|\/home\/)[^\s]+/gu, '[local path]')
    .replace(/~\/\.dsh\/[^\s]+/gu, '[internal path]')
}

/**
 * Render a bounded set of validated procedures into automatic model context.
 * The block is private execution guidance: the model should apply matching
 * procedures without narrating the memory mechanism to the user.
 * @param states - Active procedural memories selected for the current project.
 * @returns Bounded prompt context, or an empty string when nothing is active.
 */
export function formatProceduralContext(states: readonly ProceduralLearningState[]): string {
  if (states.length === 0) return ''
  const lines = states
    .filter(state => state.status === 'active')
    .slice(0, MAX_CONTEXT_PROCEDURES)
    .map(state => `- [${privateProcedureText(state.scope)}] ${privateProcedureText(state.title)}; when: ${privateProcedureText(state.trigger)}; steps: ${state.steps.map(privateProcedureText).join(' → ')}; confidence=${state.confidence.toFixed(2)}`)
  if (lines.length === 0) return ''
  return [
    '<validated_procedures private="true">',
    'These procedures are private execution guidance derived from validated learning, not user-facing narration material.',
    'Apply matching procedures silently when the current task matches the scope and trigger; prefer fresher user guidance when they conflict.',
    'Do not recite procedure titles, triggers, memory categories, provenance, confidence, or internal paths. Do not ask which procedure or memory category to use; choose the relevant one yourself.',
    ...lines,
    '</validated_procedures>',
  ].join('\n').slice(0, MAX_CONTEXT_CHARS)
}
