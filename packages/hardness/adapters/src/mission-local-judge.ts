import type { HardnessMissionJudge, HardnessMissionJudgeInput } from './mission-orchestrator.ts'
import type { MissionJudgeDecision } from './mission-kernel.ts'

const MAX_ITEMS = 8

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function deterministicDecision(input: HardnessMissionJudgeInput): MissionJudgeDecision {
  const artifactReady = text(input.artifactId) && text(input.artifactMime)
    && text(input.rendered.kind) && input.rendered.artifactId === input.artifactId && text(input.evidenceId)
  const criteria = input.criteria.filter(item => item.mandatory).map(item => {
    const tested = item.status === 'TESTED' || item.status === 'VERIFIED'
    const valid = tested && item.evidence.length > 0
    return {
      id: item.id,
      verdict: valid ? 'pass' as const : 'fail' as const,
      evidence: valid ? [...item.evidence] : [],
      findings: valid ? [] : ['criterion is not tested with durable evidence'],
    }
  })
  const missing = criteria.filter(item => item.verdict !== 'pass').map(item => `provide evidence for criterion ${item.id}`)
  if (!artifactReady) missing.push('provide a complete rendered artifact and durable evidence')
  if (missing.length > 0) {
    const changes = [...new Set(missing)].slice(0, MAX_ITEMS)
    return {
      verdict: 'needs_changes',
      summary: 'Deterministic verification found incomplete artifact or criterion evidence.',
      evidence: text(input.evidenceId) ? [input.evidenceId] : [],
      requiredChanges: changes,
      criteria,
      quality: { verdict: 'fail', summary: 'The artifact or tested criteria are incomplete.', evidence: [], findings: changes },
    }
  }
  return {
    verdict: 'pass',
    summary: 'The artifact and every mandatory criterion have deterministic evidence.',
    evidence: [input.evidenceId],
    requiredChanges: [],
    criteria,
    quality: {
      verdict: 'pass',
      summary: 'The artifact is present, rendered, and covered by tested criteria.',
      evidence: [input.evidenceId],
      findings: [],
    },
  }
}

/** Create an always-available local judge for mechanical mission evidence.
 * @returns judge that passes only complete artifacts with tested criterion evidence.
 */
export function createDeterministicMissionJudge(): HardnessMissionJudge {
  return async input => deterministicDecision(input)
}
