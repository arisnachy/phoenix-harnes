/** Deterministic completion obligations derived only from the original objective. */

export type VerificationCriterionSource = 'objective' | 'literal' | 'risk' | 'edge'

/** One immutable criterion that a completion tester is not allowed to omit or downgrade. */
export interface VerificationCriterion {
  readonly id: string
  readonly criterion: string
  readonly mandatory: true
  readonly source: VerificationCriterionSource
}

/** Bounded contract shared by adversarial design and execution. */
export interface VerificationContract {
  readonly criteria: readonly VerificationCriterion[]
  readonly softwareLike: boolean
  readonly requiresBuilderTestAudit: boolean
}

const MAX_LITERAL_REQUIREMENTS = 12

const EXPLICIT_OBLIGATION = /\b(?:must|shall|required|requires?|need(?:s)?\s+to|has\s+to|use|using|include|includes|including|return|returns|output|named|called|exact(?:ly)?|support|accept|reject|without|do\s+not|never|debe|deber[aá]|deber[ií]a|tiene\s+que|usar|usa|utiliza|inclu(?:ir|ye)|devolver|retornar|se\s+llame|llamarse|exactamente|soportar|aceptar|rechazar|sin|no\s+debe|nunca)\b/iu
const NAMED_TOKEN = /`[^`]+`|--[a-z0-9][a-z0-9-]*|\b[A-Za-z_][A-Za-z0-9_.-]{2,}\(\)/u

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().replace(/[.;]+$/u, '').trim()
}

function splitObjective(objective: string): Array<{ text: string; bullet: boolean }> {
  const rows = objective.replace(/\r/gu, '').split(/\n+/u)
  const parts: Array<{ text: string; bullet: boolean }> = []
  for (const row of rows) {
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/u.test(row)
    const cleaned = row.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '')
    for (const part of cleaned.split(/(?<=[.!?;])\s+/u)) {
      const text = normalize(part)
      if (text.length > 0) parts.push({ text, bullet })
    }
  }
  return parts
}

function pushCriterion(
  target: VerificationCriterion[],
  seen: Set<string>,
  criterion: string,
  source: VerificationCriterionSource,
  id: string,
): void {
  const normalized = normalize(criterion)
  const key = normalized.toLocaleLowerCase()
  if (normalized.length === 0 || seen.has(key)) return
  seen.add(key)
  target.push({ id, criterion: normalized, mandatory: true, source })
}

function softwareSignals(text: string): boolean {
  return /\b(?:code|software|program|application|app|cli|api|service|function|class|method|library|package|parser|regex|regexp|json|yaml|xml|csv|algorithm|python|javascript|typescript|node|rust|golang|java|c\+\+|input|string|expression|command|argument|argparse|test|tests)\b/iu.test(text)
}

function universalRiskCriteria(): VerificationCriterion[] {
  const criteria: VerificationCriterion[] = []
  const seen = new Set<string>()
  const add = (id: string, criterion: string): void => pushCriterion(criteria, seen, criterion, 'risk', id)

  add('RISK-AMBIGUITY',
    'Actively search for ambiguous interpretations, representations, normalization rules, implicit conventions, or multiple plausible meanings that could change the result. Exercise the ambiguity or document the chosen rule with evidence.')
  add('RISK-LIMITATIONS',
    'Before claiming that no known limitations remain, generate plausible failure classes beyond the happy path and either test them, bound them explicitly as out of scope with evidence, or report them as known limitations.')
  add('RISK-REPORT-INTEGRITY',
    'Cross-check final claims, counts, statuses, evidence references, and limitation statements for duplication or contradiction. One canonical result must survive into the final report.')

  return criteria
}

function edgeCriteria(objective: string, softwareLike: boolean): VerificationCriterion[] {
  const text = objective.toLocaleLowerCase()
  const criteria: VerificationCriterion[] = []
  const seen = new Set<string>()
  const add = (id: string, criterion: string): void => pushCriterion(criteria, seen, criterion, 'edge', id)

  if (softwareLike) {
    add('EDGE-EMPTY', 'Exercise empty input or zero-cardinality state at the real user-facing boundary when that state is representable.')
    add('EDGE-BOUNDARY', 'Exercise cardinality one, exact lower/upper boundaries, first and last element or iteration, and adjacent off-by-one cases where applicable.')
    add('EDGE-MALFORMED', 'Exercise malformed, truncated, unsupported, or otherwise invalid externally controlled input and require a domain-classified failure rather than an implementation exception.')
    add('EDGE-REPRESENTATION', 'Exercise equivalent, non-canonical, padded, case-varied, whitespace-varied, separator-varied, or otherwise ambiguous external representations wherever parsing or normalization can change meaning.')
    add('EDGE-ENVIRONMENT', 'Exercise plausible environment differences that can affect observable behavior, including platform/path rules, locale/timezone/encoding, permissions, dependency availability, and clean-state versus stale-state execution where applicable.')
  }

  if (softwareLike && /\b(?:text|string|parser|parse|regex|regexp|json|yaml|xml|csv|unicode|utf|escape|character|char|token|lexer|scanner|position|offset)\b/iu.test(text)) {
    add('EDGE-UNICODE', 'Exercise Unicode outside the BMP and boundary encoding cases, including surrogate behavior when the runtime representation makes it relevant.')
  }

  if (softwareLike && /\b(?:loop|while|for|iterator|iteration|regex|regexp|parser|parse|token|lexer|scanner|cursor|stream|match|consume)\b/iu.test(text)) {
    add('EDGE-ZERO-PROGRESS', 'Exercise an iteration where the inner operation consumes or advances zero units and prove bounded termination without an infinite loop.')
  }

  if (softwareLike && /\b(?:regex|regexp|json|yaml|xml|csv|url|uri|base64|date|time|math|expression|parser|parse|standard|compatible)\b/iu.test(text)) {
    add('EDGE-ORACLE', 'When a trustworthy reference implementation or standard-library oracle exists, run differential generated cases against it; otherwise record why no oracle applies and use property or metamorphic invariants.')
  }

  if (softwareLike && /\b(?:position|offset|index|column|line|location|error|exception|diagnostic)\b/iu.test(text)) {
    add('EDGE-ERROR-POSITION', 'Verify observable error type and required diagnostic details, including exact position, offset, line, column, identifier, or collection content when requested.')
  }

  if (/\b(?:automation|workflow|scheduler|scheduled|webhook|sync|retry|restart|resume|job|queue)\b/iu.test(text)) {
    add('EDGE-RETRY', 'Exercise retry, duplicate execution, interruption, restart, and idempotency behavior wherever the operation can be repeated or resumed.')
  }

  if (/\b(?:data|dataset|table|csv|spreadsheet|database|sql|analytics|statistics)\b/iu.test(text)) {
    add('EDGE-DATA', 'Exercise missing values, duplicates, empty and single-row inputs, boundary values, and schema/type violations that are meaningful for the data path.')
  }

  return criteria
}

/**
 * Build the immutable verifier-owned requirement contract before any workspace
 * or Builder test is inspected. The whole objective is always mandatory, and
 * explicit literal clauses are promoted to independently checkable criteria.
 * @param objective - The objective value.
 * @returns The resulting value.
 */
export function buildVerificationContract(objective: string): VerificationContract {
  const root = normalize(objective)
  if (root.length === 0) throw new TypeError('verification objective must be non-empty')

  const criteria: VerificationCriterion[] = []
  const seen = new Set<string>()
  pushCriterion(criteria, seen, root, 'objective', 'REQ-ROOT')

  let literalIndex = 1
  for (const part of splitObjective(objective)) {
    if (literalIndex > MAX_LITERAL_REQUIREMENTS) break
    if (part.text === root) continue
    if (!part.bullet && !EXPLICIT_OBLIGATION.test(part.text) && !NAMED_TOKEN.test(part.text)) continue
    pushCriterion(
      criteria,
      seen,
      part.text,
      'literal',
      'REQ-' + String(literalIndex).padStart(3, '0'),
    )
    literalIndex += 1
  }

  for (const criterion of universalRiskCriteria()) {
    if (!seen.has(criterion.criterion.toLocaleLowerCase())) {
      seen.add(criterion.criterion.toLocaleLowerCase())
      criteria.push(criterion)
    }
  }

  const softwareLike = softwareSignals(objective)
  for (const criterion of edgeCriteria(objective, softwareLike)) {
    if (!seen.has(criterion.criterion.toLocaleLowerCase())) {
      seen.add(criterion.criterion.toLocaleLowerCase())
      criteria.push(criterion)
    }
  }

  return {
    criteria,
    softwareLike,
    requiresBuilderTestAudit: softwareLike,
  }
}
