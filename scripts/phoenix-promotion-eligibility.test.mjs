import test from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRED_WORKFLOWS, verifyPromotionEvidence } from './phoenix-promotion-eligibility.mjs'

const main = 'a'.repeat(40), head = 'b'.repeat(40)
const pull = { number: 1250, merged_at: '2026-11-01T18:00:00Z', merge_commit_sha: main,
  base: { ref: 'main' }, head: { sha: head } }
const workflows = [...REQUIRED_WORKFLOWS, 'Phoenix sports live ESPN chat'].map((name, i) => ({
  name, id: i + 1, event: 'pull_request', head_sha: head,
  status: 'completed', conclusion: 'success',
}))
const realE2E = { name: 'e2e', status: 'completed', conclusion: 'success' }
const source = () => ({ targetSha: main, pulls: [pull], workflowRuns: workflows, deepseekJobs: [realE2E] })

test('requires exact merged PR, complete PR checks and real E2E', () => {
  assert.deepEqual(verifyPromotionEvidence(source()), {
    prNumber: 1250, prHeadSha: head, checkedWorkflows: workflows.length,
  })
})
test('rejects unmerged or unmatched main SHA, including direct pushes', () => {
  assert.throws(() => verifyPromotionEvidence({ ...source(),
    pulls: [{ ...pull, merge_commit_sha: 'c'.repeat(40) }] }), /merged PR/)
})
test('rejects a required workflow absent from the source HEAD', () => {
  assert.throws(() => verifyPromotionEvidence({ ...source(), workflowRuns: workflows.slice(1) }), /Required workflow/)
})
test('rejects failed, pending, cancelled and wrong-SHA workflow evidence', () => {
  for (const change of [
    { conclusion: 'failure' }, { status: 'in_progress', conclusion: null },
    { conclusion: 'cancelled' }, { head_sha: 'd'.repeat(40) },
  ]) {
    const runs = [...workflows]; runs[0] = { ...runs[0], ...change }
    assert.throws(() => verifyPromotionEvidence({ ...source(), workflowRuns: runs }))
  }
})
test('a green configuration job never substitutes for the real DeepSeek E2E', () => {
  assert.throws(() => verifyPromotionEvidence({ ...source(), deepseekJobs: [
    { name: 'real API E2E configuration', status: 'completed', conclusion: 'success' },
    { name: 'e2e', status: 'completed', conclusion: 'skipped' },
  ] }), /Real DeepSeek/)
})
test('explicitly non-applicable optional workflow is distinguished from skipped required checks', () => {
  const extra = { name: 'PHOENIX Evolution Gate', id: 50, event: 'pull_request',
    head_sha: head, status: 'completed', conclusion: 'skipped' }
  assert.equal(verifyPromotionEvidence({ ...source(), workflowRuns: [...workflows, extra] })
    .checkedWorkflows, workflows.length + 1)
  assert.throws(() => verifyPromotionEvidence({ ...source(), workflowRuns: [
    ...workflows, { ...extra, name: 'Unexpected skipped gate' },
  ] }), /skipped/)
})
