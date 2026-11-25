import test from 'node:test'
import assert from 'node:assert/strict'
import { disposableWorkspaceStatus } from './phoenix-retire-integrated-workspaces.mjs'

test('only clean worktrees and ignored dependency caches can be retired', () => {
  assert.equal(disposableWorkspaceStatus(''), true)
  assert.equal(disposableWorkspaceStatus('!! node_modules/\0!! packages/core/node_modules/\0'), true)
  for (const status of ['?? draft.txt\0', ' M package.json\0', '!! .env\0', '!! data.sqlite\0', '!! reports/\0', '!! node_modules/\0!! private.txt\0']) {
    assert.equal(disposableWorkspaceStatus(status), false, status)
  }
})
