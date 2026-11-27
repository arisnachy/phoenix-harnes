/** Explicit counterfactual comparison and structural bias audit. No execution or independent source validation. */
import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type Status = 'pass' | 'fail' | 'unknown'
type Basis = 'observed' | 'hypothesis' | 'unknown'
interface Outcome { id: string; status: Status; basis: Basis; sources: string[] }
interface Scenario { id: string; intervention: string; assumptions: string[]; falsifier: string; outcomes: Outcome[] }
interface Criterion { id: string; mandatory: boolean }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('META_INVALID_OBJECT')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('META_INVALID_TEXT')
  return value.trim()
}
function identifier(value: unknown): string {
  const id = text(value, 64)
  if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error('META_INVALID_ID')
  return id
}
function list<T>(value: unknown, min: number, max: number, parse: (raw: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('META_INVALID_LIST')
  return value.map(parse)
}
function distinct<T extends { id: string }>(rows: T[]): T[] {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('META_DUPLICATE_ID')
  return rows
}
function outcome(raw: unknown): Outcome {
  const row = object(raw)
  if (row.status !== 'pass' && row.status !== 'fail' && row.status !== 'unknown') throw new Error('META_INVALID_STATUS')
  if (row.basis !== 'observed' && row.basis !== 'hypothesis' && row.basis !== 'unknown') throw new Error('META_INVALID_BASIS')
  const sources = [...new Set(list(row.sources, 0, 6, item => text(item, 240)))]
  if (row.basis === 'observed' && sources.length === 0) throw new Error('META_OBSERVATION_REQUIRES_SOURCE')
  if ((row.status === 'unknown') !== (row.basis === 'unknown')) throw new Error('META_INCONSISTENT_UNKNOWN')
  return { id: identifier(row.id), status: row.status, basis: row.basis, sources }
}
function scenario(raw: unknown, criteria: readonly Criterion[]): Scenario {
  const row = object(raw)
  const outcomes = distinct(list(row.outcomes, 1, 8, outcome))
  if (outcomes.length !== criteria.length || criteria.some(item => !outcomes.some(result => result.id === item.id))) {
    throw new Error('META_SCENARIOS_MUST_USE_IDENTICAL_CRITERIA')
  }
  return { id: identifier(row.id), intervention: text(row.intervention),
    assumptions: list(row.assumptions, 0, 6, item => text(item)),
    falsifier: row.falsifier === '' ? '' : text(row.falsifier), outcomes }
}

/** Compare a baseline and alternatives under identical criteria. Source strings are claims, not proof.
 * @param raw - Explicit hypothetical interventions, invariants and declared observations.
 * @returns Comparison with uncertainty, constraint and source-dependence warnings.
 */
export function compareMetaScenarios(raw: unknown) {
  const input = object(raw)
  const invariants = list(input.invariants, 1, 8, item => text(item))
  const criteria = distinct(list(input.criteria, 1, 8, item => {
    const row = object(item)
    if (typeof row.mandatory !== 'boolean') throw new Error('META_INVALID_CRITERION')
    return { id: identifier(row.id), mandatory: row.mandatory }
  }))
  if (!criteria.some(item => item.mandatory)) throw new Error('META_MANDATORY_CRITERION_REQUIRED')
  const baseline = scenario(input.baseline, criteria)
  const alternatives = distinct([baseline, ...list(input.alternatives, 1, 3, item => scenario(item, criteria))]).slice(1)
  const baselineSources = new Set(baseline.outcomes.flatMap(row => row.sources))
  const baselineKnown = baseline.outcomes.filter(row => row.basis === 'observed').length
  const candidates = alternatives.map(candidate => {
    if (candidate.intervention.toLowerCase() === baseline.intervention.toLowerCase()) throw new Error('META_DISTINCT_INTERVENTION_REQUIRED')
    const mandatory = candidate.outcomes.filter(row => criteria.some(item => item.id === row.id && item.mandatory))
    const failures = mandatory.filter(row => row.status === 'fail')
    const unresolved = mandatory.filter(row => row.status !== 'pass' || row.basis !== 'observed')
    const candidateKnown = candidate.outcomes.filter(row => row.basis === 'observed').length
    const sharedSources = [...new Set(candidate.outcomes.flatMap(row => row.sources).filter(source => baselineSources.has(source)))]
    const flags = [
      ...(candidate.falsifier === '' || baseline.falsifier === '' ? ['missing-disconfirming-test'] : []),
      ...(candidateKnown !== baselineKnown ? ['asymmetric-declared-observation-coverage'] : []),
      ...(sharedSources.length > 0 ? ['shared-source-dependence'] : []),
      ...(candidate.outcomes.some(row => row.basis !== 'observed') ? ['unverified-hypotheses-or-unknowns'] : []),
    ]
    return { id: candidate.id,
      status: failures.length > 0 ? 'declared-constraint-failure'
        : unresolved.length > 0 || candidate.falsifier === '' ? 'insufficient-evidence' : 'candidate-for-independent-verification',
      declaredFailedCriteria: failures.map(row => row.id), unresolvedCriteria: unresolved.map(row => row.id),
      comparison: criteria.map(item => {
        const before = baseline.outcomes.find(row => row.id === item.id)!
        const after = candidate.outcomes.find(row => row.id === item.id)!
        return { criterion: item.id, baseline: before.status, alternative: after.status, baselineBasis: before.basis, alternativeBasis: after.basis }
      }), flags }
  })
  return { baseline: baseline.id, invariantCount: invariants.length, candidates, evidenceIndependentlyVerified: false,
    causalConclusion: false, recommendation: 'Use the discriminating tests and independent sources before selecting an alternative. No action or permission was granted.' }
}

/** Register an inspectable, bounded counterfactual scenario tool. */
export function createMetaScenarioTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_meta_compare',
    description: 'Compare competing explanations or strategies under identical criteria. Input is a declared hypothesis/observation ledger, not verified reality. Returns constraint failures, uncertainty and structural evidence-dependence warnings; never executes or selects an action.',
    parameters: { comparison: { type: 'object', required: true, additionalProperties: true,
      description: 'Object with invariants:string[], criteria:[{id,mandatory}], baseline and alternatives (1-3). Each scenario: {id,intervention,assumptions:string[],falsifier:string,outcomes:[{id,status:pass|fail|unknown,basis:observed|hypothesis|unknown,sources:string[]}]}. Every scenario must cover the same criterion IDs. Observed claims require source references; unknown stays unknown.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute(args) { return JSON.stringify(compareMetaScenarios(args.comparison)) },
    presentCall: () => ({ card: 'generic', title: 'PHOENIX META · Counterfactual comparison', kind: 'read' }),
  })
}
