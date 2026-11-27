import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hasDetachedRuntimeReserve } from './phoenix-runtime-capacity.mjs'

test('one detached Windows runtime can coexist with a healthy Host and its replacement', t => {
  const base = mkdtempSync(join(tmpdir(), 'phoenix-runtime-capacity-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const active = join(base, 'active')
  const detached = join(base, 'detached')
  const extra = join(base, 'extra')
  for (const path of [active, detached, extra]) mkdirSync(path)
  const registered = new Set([active])
  const options = { directories: [active, detached], registered, activePath: active, limit: 2, pathKey: path => path }
  assert.equal(hasDetachedRuntimeReserve(options), true)
  assert.equal(hasDetachedRuntimeReserve({ ...options, directories: [active, detached, extra] }), false)
  assert.equal(hasDetachedRuntimeReserve({ ...options, directories: [active, detached, extra], limit: 3 }), false)
  assert.equal(hasDetachedRuntimeReserve({ ...options, activePath: undefined }), false)
  assert.equal(hasDetachedRuntimeReserve({ ...options, registered: undefined }), false)
  assert.equal(hasDetachedRuntimeReserve({ ...options, registered: new Set([active, detached]) }), false)

  writeFileSync(join(detached, '.git'), 'gitdir: unavailable')
  assert.equal(hasDetachedRuntimeReserve(options), false)
  rmSync(join(detached, '.git'))
  writeFileSync(join(detached, '.phoenix-keep'), '')
  assert.equal(hasDetachedRuntimeReserve(options), false)
})
