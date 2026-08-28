import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldEnsurePhoenix } from './phoenix-update-supervisor.mjs'

test('relaunches after a successful update when the host is gone', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'updated', requestPending: false, parentAlive: false }), true)
})

test('relaunches the last-known-good version after rollback', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'rolled-back', requestPending: false, parentAlive: false }), true)
})

test('relaunches after a safe activation error when a restart was requested', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'error', requestPending: true, parentAlive: false }), true)
})

test('does not reopen after an ordinary close with no update transition', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'ready', requestPending: false, parentAlive: false }), false)
  assert.equal(shouldEnsurePhoenix({ status: 'current', requestPending: false, parentAlive: false }), false)
})

test('never relaunches while the original PHOENIX process is still alive', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'updated', requestPending: true, parentAlive: true }), false)
})

test('fails closed after a catastrophic rollback failure', () => {
  assert.equal(shouldEnsurePhoenix({ status: 'rollback-failed', requestPending: true, parentAlive: false }), false)
})
