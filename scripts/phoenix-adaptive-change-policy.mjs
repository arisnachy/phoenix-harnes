/**
 * PHOENIX Adaptive OS: fail-closed preflight for proposed self-modification.
 *
 * Pure policy evaluator. It DOES NOT edit files, validate human identity,
 * grant permission, run tests, or enable autonomous core changes.
 * A privileged, authenticated supervisor must enforce approvals and
 * verify worktree snapshot, checks and activation separately.
 */
const OID = /^[a-f0-9]{40}$/u
const APP_ID = /^app-[a-z0-9][a-z0-9-]{0,40}$/u
const FORBIDDEN = [
  /(?:^|\/)\.env(?:\.|$)/u,
  /(?:^|\/)(?:credentials|secrets|private-keys?)(?:\/|\.|$)/iu,
  /(?:^|\/)(?:patient|patients|clinical-records|ehr-data)(?:\/|\.|$)/iu,
  /(?:^|\/)\.git(?:\/|$)/u,
]
function safePath(value) {
  return typeof value === 'string' && value.length <= 240
    && !value.startsWith('/') && !value.includes('\\') && !value.includes(':')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

/** Classification only: nothing below constitutes a grant or a signature. */
export function reviewAdaptiveChangePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
      || plan.version !== 1 || !OID.test(plan.baseCommit)
      || !Array.isArray(plan.edits) || plan.edits.length === 0 || plan.edits.length > 100) {
    throw new Error('ADAPTIVE_INVALID_PLAN')
  }
  const seen = new Set()
  const entries = plan.edits.map(edit => {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)
      || !safePath(edit.path) || !['add', 'update', 'remove'].includes(edit.operation)
      || seen.has(edit.path)) throw new Error('ADAPTIVE_INVALID_EDIT')
    seen.add(edit.path)
    const blocked = FORBIDDEN.some(re => re.test(edit.path))
    const extension = APP_ID.test(plan.appId)
      && edit.path.startsWith(`apps/adaptive-extensions/${plan.appId}/`)
    return {
      path: edit.path, operation: edit.operation,
      classification: blocked ? 'blocked' : extension ? 'isolated-app' : 'harness-review',
    }
  })
  const blocked = entries.some(e => e.classification === 'blocked')
  const critical = entries.some(e => e.classification === 'harness-review')
  return {
    schema: 'phoenix.adaptive.change-preflight.v1',
    appId: typeof plan.appId === 'string' ? plan.appId : 'unknown',
    baseCommit: plan.baseCommit,
    entries,
    risk: blocked ? 'blocked' : critical ? 'elevated' : 'isolated',
    // All mutations still require trusted approval, validated CI and a
    // recoverable snapshot; this client-side/CLI evaluator NEVER authorizes.
    authorized: false,
    mayApply: false,
    prerequisites: [
      'authenticated-approval',
      'isolated-worktree-and-backup',
      'build-and-unit-tests',
      'privacy-and-security-tests',
      'tested-rollback',
      'verified-activation',
    ],
  }
}
