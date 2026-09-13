import assert from 'node:assert/strict'
import test from 'node:test'
import { hydratePhoenixEnvironment } from './phoenix-windows-environment.mjs'

test('hydrates the OAuth token from the user environment when the supervisor process lacks it', () => {
  const result = hydratePhoenixEnvironment({}, () => 'fresh-user-token')
  assert.equal(result.GOOGLE_OAUTH_ACCESS_TOKEN, 'fresh-user-token')
})

test('preserves a non-empty process token instead of replacing it', () => {
  const result = hydratePhoenixEnvironment({ GOOGLE_OAUTH_ACCESS_TOKEN: 'process-token' }, () => 'user-token')
  assert.equal(result.GOOGLE_OAUTH_ACCESS_TOKEN, 'process-token')
})

test('does not add the variable when Windows user environment has no token', () => {
  const result = hydratePhoenixEnvironment({ OTHER: 'kept' }, () => undefined)
  assert.deepEqual(result, { OTHER: 'kept' })
})
