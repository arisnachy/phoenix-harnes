import test from 'node:test'
import assert from 'node:assert/strict'
import { PREPUSH_CHECKS, runPrepushChecks } from './phoenix-ci-prepush.mjs'

test('all required gates execute in order before a successful push', () => {
  const seen = []
  const lines = []
  const code = runPrepushChecks(script => {
    seen.push(script)
    return { status: 0 }
  }, line => lines.push(line))
  assert.equal(code, 0)
  assert.deepEqual(seen, ['check:ci:static', 'typecheck', 'check:ci:lint:contracts-ready'])
  assert.ok(lines.at(-1).includes('remote CI remains mandatory'))
})

test('failure blocks the push and stops the later gates', () => {
  const seen = []
  const code = runPrepushChecks(script => {
    seen.push(script)
    return { status: script === 'typecheck' ? 1 : 0 }
  }, () => {})
  assert.equal(code, 1)
  assert.deepEqual(seen, PREPUSH_CHECKS.slice(0, 2))
})

test('a killed or unlaunchable command fails closed', () => {
  for (const failed of [
    { status: null, signal: 'SIGTERM' },
    { status: null },
    { status: null, error: new Error('spawn failed') },
  ]) {
    const seen = []
    const code = runPrepushChecks(script => {
      seen.push(script)
      return failed
    }, () => {})
    assert.equal(code, 1)
    assert.deepEqual(seen, [PREPUSH_CHECKS[0]])
  }
})
