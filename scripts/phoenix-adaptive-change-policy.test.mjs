import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewAdaptiveChangePlan } from './phoenix-adaptive-change-policy.mjs'

const BASE = 'a'.repeat(40)
const plan = (path, appId = 'app-inventario') => ({
  version: 1, appId, baseCommit: BASE, edits: [{ path, operation: 'update' }],
})

test('safe isolated app changes still require authorization and verified rollback', () => {
  const result = reviewAdaptiveChangePlan(plan('apps/adaptive-extensions/app-inventario/forms/stock.json'))
  assert.equal(result.risk, 'isolated')
  assert.equal(result.authorized, false)
  assert.equal(result.mayApply, false)
  assert.ok(result.prerequisites.includes('tested-rollback'))
})

test('core changes require elevated review and cannot be silently applied', () => {
  const result = reviewAdaptiveChangePlan(plan('packages/client/ui-layout/src/client/AppFrame.tsx'))
  assert.equal(result.risk, 'elevated')
  assert.equal(result.mayApply, false)
})

test('secret and patient paths are blocked even inside app extension', () => {
  for (const path of [
    'apps/adaptive-extensions/app-inventario/.env',
    'apps/adaptive-extensions/app-inventario/credentials/token.json',
    'apps/adaptive-extensions/app-inventario/patients/record.json',
    '.git/config',
  ]) {
    assert.equal(reviewAdaptiveChangePlan(plan(path)).risk, 'blocked', path)
  }
})

test('path traversal, windows absolute paths, duplicates and invalid edits fail closed', () => {
  for (const path of ['../secret', '/tmp/record', 'C:/data', 'a\\b', 'a//b', 'a/./b']) {
    assert.throws(() => reviewAdaptiveChangePlan(plan(path)), /ADAPTIVE_INVALID_EDIT/, path)
  }
  assert.throws(() => reviewAdaptiveChangePlan({ ...plan('foo'), edits: [
    { path: 'foo', operation: 'add' }, { path: 'foo', operation: 'remove' },
  ] }), /ADAPTIVE_INVALID_EDIT/)
  assert.throws(() => reviewAdaptiveChangePlan({ ...plan('foo'), baseCommit: 'HEAD' }), /ADAPTIVE_INVALID_PLAN/)
})
