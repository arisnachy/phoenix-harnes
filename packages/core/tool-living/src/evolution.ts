/** Bounded, provider-neutral operational evidence. No filesystem, network,
 * timers, raw conversation storage, background workers or authority grants. */
import { freemem, totalmem } from 'node:os'

const MAX = 128
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const kinds = ['timeout', 'resource', 'tool', 'verification', 'routing'] as const
type Kind = typeof kinds[number]
type Observation = { id: string; kind: Kind; strategy: string; fixture: string; ok: boolean; ms: number }
type Obj = Record<string, unknown>

function object(v: unknown): Obj {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('EVOLUTION_INVALID_OBJECT')
  return v as Obj
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new Error('EVOLUTION_INVALID_ID')
  return v
}
function number(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error('EVOLUTION_INVALID_NUMBER')
  return v
}
function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length > MAX) throw new Error('EVOLUTION_INPUT_LIMIT')
  return v
}
function observations(v: unknown): Observation[] {
  const unique = new Map<string, Observation>()
  for (const raw of list(v)) {
    const o = object(raw)
    if (!kinds.includes(o.kind as Kind) || typeof o.ok !== 'boolean') throw new Error('EVOLUTION_INVALID_OBSERVATION')
    const item = { id: id(o.id), kind: o.kind as Kind, strategy: id(o.strategy), fixture: id(o.fixture), ok: o.ok, ms: number(o.ms, 3_600_000) }
    const old = unique.get(item.id)
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw new Error('EVOLUTION_CONFLICTING_EVIDENCE')
    unique.set(item.id, item)
  }
  return [...unique.values()]
}
function summary(rows: Observation[]) {
  const passed = rows.filter(row => row.ok).length
  return { n: rows.length, passed, failed: rows.length - passed,
    successRate: rows.length ? passed / rows.length : null,
    meanMs: rows.length ? rows.reduce((sum, row) => sum + row.ms, 0) / rows.length : null }
}
function paired(rows: Observation[], baseline: string, candidate: string) {
  if (baseline === candidate) throw new Error('EVOLUTION_IDENTICAL_STRATEGIES')
  const fixtures = new Map<string, { base?: Observation; next?: Observation; duplicate?: boolean }>()
  for (const row of rows) {
    if (row.strategy !== baseline && row.strategy !== candidate) continue
    const key = row.kind + ':' + row.fixture
    const entry = fixtures.get(key) ?? {}
    if (row.strategy === baseline) {
      if (entry.base) entry.duplicate = true
      entry.base = row
    } else {
      if (entry.next) entry.duplicate = true
      entry.next = row
    }
    fixtures.set(key, entry)
  }
  const base: Observation[] = [], next: Observation[] = []
  let improved = 0, regressed = 0, excluded = 0
  for (const entry of fixtures.values()) {
    if (!entry.base || !entry.next || entry.duplicate) { excluded++; continue }
    base.push(entry.base); next.push(entry.next)
    if (!entry.base.ok && entry.next.ok) improved++
    if (entry.base.ok && !entry.next.ok) regressed++
  }
  return { baseline: summary(base), candidate: summary(next), improved, regressed, excluded,
    evidence: base.length >= 5 ? 'paired-observations' : 'insufficient',
    causalProof: false, trustedEvidence: false,
    reviewCandidate: base.length >= 5 && improved > 0 && regressed === 0 && excluded === 0,
    mayPromote: false }
}

function consolidate(rows: Observation[]) {
  const groups = kinds.map(kind => {
    const group = rows.filter(row => row.kind === kind)
    return { kind, ...summary(group) }
  }).filter(group => group.n > 0)
  const repeated = groups.filter(group => group.failed >= 2).map(group => group.kind)
  return { groups, repeated, recommendations: repeated.map(kind => ({ kind, action: 'investigate-and-test-alternative' })),
    rawRowsRetained: 0, scheduled: false, writes: 0 }
}

function twin(input: Obj) {
  const nodes = [...new Set(list(input.nodes).map(id))]
  const set = new Set(nodes)
  const edges = list(input.edges).map(raw => {
    const e = object(raw), dependent = id(e.dependent), dependency = id(e.dependency)
    if (!set.has(dependent) || !set.has(dependency)) throw new Error('EVOLUTION_UNKNOWN_NODE')
    return { dependent, dependency }
  })
  const removed = id(input.remove)
  if (!set.has(removed)) throw new Error('EVOLUTION_UNKNOWN_NODE')
  const affected = new Set([removed])
  for (let i = 0; i < nodes.length; i++) {
    const size = affected.size
    for (const e of edges) if (affected.has(e.dependency)) affected.add(e.dependent)
    if (affected.size === size) break
  }
  return { removed, potentialAffected: [...affected].filter(n => n !== removed).sort(),
    simulatedOnly: true, functionalReplica: false, causalProof: false, writes: 0 }
}

function handoff(input: Obj) {
  const pending = [...new Set(list(input.pending).map(id))]
  const completed = [...new Set(list(input.completed).map(id))]
  if (pending.some(item => completed.includes(item))) throw new Error('EVOLUTION_CONFLICTING_TASK_STATE')
  return { schema: 'phoenix.evolution.handoff.v1', missionRef: id(input.missionRef),
    sourceModel: id(input.sourceModel), targetModel: id(input.targetModel),
    pending, completed, evidenceRefs: [...new Set(list(input.evidenceRefs).map(id))],
    requiresContextRevalidation: true, transfersCredentials: false, switched: false, writes: 0 }
}

/** Execute a read-only, bounded operation using caller-supplied evidence.
 * Evidence is untrusted, so review candidates never authorize execution. */
export function runEvolution(operation: string, raw: string): unknown {
  if (Buffer.byteLength(raw, 'utf8') > 32_768) throw new Error('EVOLUTION_INPUT_LIMIT')
  const input = object(JSON.parse(raw))
  switch (operation) {
    case 'dreaming': return consolidate(observations(input.observations))
    case 'metrics': return { ...summary(observations(input.observations)), scope: 'supplied-observations', trustedEvidence: false }
    case 'causal':
    case 'lab':
    case 'skill': {
      const candidate = id(input.candidate)
      const result = paired(observations(input.observations), id(input.baseline), candidate)
      return { ...result, ...(operation === 'skill' ? { skillCandidate: result.reviewCandidate ? candidate : null, installed: false } : {}) }
    }
    case 'twin': return twin(input)
    case 'handoff': return handoff(input)
    case 'intent': {
      const goal = id(input.goal)
      const routes: Record<string, string[]> = { debugging: ['metrics', 'causal', 'lab'],
        planning: ['twin', 'homeostasis'], switching: ['handoff'], learning: ['dreaming', 'skill'] }
      return { goal, suggestions: Object.hasOwn(routes, goal) ? routes[goal] : [], executes: false }
    }
    case 'homeostasis': {
      const total = totalmem(), free = freemem()
      const reserve = Math.max(512 * 1024 ** 2, total * 0.15)
      const requested = number(input.requestedBytes, Number.MAX_SAFE_INTEGER)
      const available = Math.max(0, free - reserve)
      return { totalBytes: total, freeBytes: free, reserveBytes: Math.ceil(reserve),
        availableBytes: Math.floor(available), recommendation: requested <= available ? 'within-host-ram-estimate' : 'defer-or-reduce-context',
        gpuChecked: false, reservationGranted: false, applied: false }
    }
    default: throw new Error('EVOLUTION_UNKNOWN_OPERATION')
  }
}
