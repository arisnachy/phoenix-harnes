import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  applyOpenClawRuntimeRetention,
  executeOpenClawRuntimeRetention,
  planOpenClawRuntimeRetention,
} from './phoenix-runtime-retention.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-runtime-retention-'))
  const home = join(root, 'dsh')
  const runtime = join(home, 'openclaw-runtime')
  mkdirSync(runtime, { recursive: true })
  return { root, home, runtime }
}

function dispose(value) {
  rmSync(value.root, { recursive: true, force: true })
}

function planFor(value, options = {}) {
  return planOpenClawRuntimeRetention({ home: value.home, runtimeLockHeld: true, ...options })
}

function marker(runtime, name, version, nodeVersion = '24.22.1') {
  const runtimePath = join(runtime, 'versions', version)
  const nodePath = join(runtime, 'node', `node-v${nodeVersion}-win-x64`, 'node.exe')
  const artifactPath = join(runtime, 'artifacts', `openclaw-${version}.tgz`)
  mkdirSync(runtimePath, { recursive: true })
  mkdirSync(join(nodePath, '..'), { recursive: true })
  mkdirSync(join(artifactPath, '..'), { recursive: true })
  writeFileSync(nodePath, 'node fixture\n')
  writeFileSync(artifactPath, `${version}\n`)
  writeFileSync(join(runtime, `${name}.json`), JSON.stringify({
    schema: 1,
    status: name === 'candidate' ? 'prepared' : name === 'previous' ? 'stopped' : 'active',
    version,
    runtimePath,
    nodePath,
    artifactPath,
  }))
  return { runtimePath, nodePath, artifactPath }
}

test('plans active, previous, and candidate retention without touching state or user entries', () => {
  const value = fixture()
  try {
    const active = marker(value.runtime, 'active', '2026.10.5')
    const previous = marker(value.runtime, 'previous', '2026.9.4')
    const candidate = marker(value.runtime, 'candidate', '2026.11.0')
    for (const name of ['2026.8.1', '.staging-2026.12.0-1-deadbeef']) mkdirSync(join(value.runtime, 'versions', name), { recursive: true })
    mkdirSync(join(value.runtime, 'versions', 'user-folder'), { recursive: true })
    mkdirSync(join(value.runtime, 'node', 'node-v23.1.0-win-x64'), { recursive: true })
    writeFileSync(join(value.runtime, 'artifacts', 'openclaw-2026.8.1.tgz'), 'old\n')
    writeFileSync(join(value.runtime, 'artifacts', 'node-v23.1.0-win-x64.zip'), 'old node\n')
    writeFileSync(join(value.runtime, 'artifacts', 'user-file.bin'), 'keep\n')
    mkdirSync(join(value.runtime, 'state', 'sessions'), { recursive: true })
    writeFileSync(join(value.runtime, 'state', 'sessions', 'session.jsonl'), 'session\n')
    writeFileSync(join(value.runtime, 'openclaw.json'), '{"user":"keep"}\n')
    writeFileSync(join(value.runtime, 'credentials.json'), '{"token":"keep"}\n')

    const plan = planFor(value)
    assert.equal(plan.status, 'ready')
    assert.deepEqual(plan.targets.map((entry) => entry.path).sort(), [
      join(value.runtime, 'artifacts', 'node-v23.1.0-win-x64.zip'),
      join(value.runtime, 'artifacts', 'openclaw-2026.8.1.tgz'),
      join(value.runtime, 'node', 'node-v23.1.0-win-x64'),
      join(value.runtime, 'versions', '.staging-2026.12.0-1-deadbeef'),
      join(value.runtime, 'versions', '2026.8.1'),
    ].sort())
    assert.ok(plan.retained.some((entry) => entry.path === active.runtimePath))
    assert.ok(plan.retained.some((entry) => entry.path === previous.runtimePath))
    assert.ok(plan.retained.some((entry) => entry.path === candidate.runtimePath))
    assert.equal(existsSync(join(value.runtime, 'state', 'sessions', 'session.jsonl')), true)
    assert.equal(existsSync(join(value.runtime, 'openclaw.json')), true)
    assert.equal(existsSync(join(value.runtime, 'credentials.json')), true)
    assert.equal(existsSync(join(value.runtime, 'versions', 'user-folder')), true)
  } finally {
    dispose(value)
  }
})

test('npm-cache is included only as a safe managed directory and dry-run never mutates the fixture', () => {
  const value = fixture()
  try {
    mkdirSync(join(value.runtime, 'npm-cache', '_cacache'), { recursive: true })
    writeFileSync(join(value.runtime, 'npm-cache', '_cacache', 'index'), 'cache\n')
    const defaultPlan = planFor(value)
    assert.equal(defaultPlan.targets.some((entry) => entry.kind === 'npm-cache'), true)

    const plan = planFor(value, { includeNpmCache: false })
    assert.equal(plan.status, 'ready')
    assert.equal(plan.targets.some((entry) => entry.path === join(value.runtime, 'npm-cache')), false)
    const result = executeOpenClawRuntimeRetention(plan)
    assert.equal(result.executed, false)
    assert.equal(existsSync(join(value.runtime, 'npm-cache', '_cacache', 'index')), true)
  } finally {
    dispose(value)
  }
})

test('requires the shared runtime lock for staging and bounded cache cleanup', () => {
  const value = fixture()
  try {
    mkdirSync(join(value.runtime, 'versions', '.staging-2026.12.0-1-deadbeef'), { recursive: true })
    mkdirSync(join(value.runtime, 'npm-cache', '_cacache'), { recursive: true })
    const unlocked = planOpenClawRuntimeRetention({ home: value.home })
    assert.equal(unlocked.targets.some((entry) => entry.kind === 'npm-cache'), false)
    assert.equal(unlocked.targets.some((entry) => entry.path.includes('.staging-')), false)
    assert.ok(unlocked.skipped.some((entry) => entry.reason === 'runtime-lock-not-held'))

    const busy = planFor(value, { installerBusy: true })
    assert.equal(busy.targets.some((entry) => entry.kind === 'npm-cache'), false)
    assert.equal(busy.targets.some((entry) => entry.path.includes('.staging-')), false)
    assert.ok(busy.skipped.some((entry) => entry.reason === 'live-installer'))
  } finally {
    dispose(value)
  }
})

test('execution requires explicit caller confirmation and deletes only a fresh safe plan', () => {
  const value = fixture()
  try {
    mkdirSync(join(value.runtime, 'versions', '2026.8.1'), { recursive: true })
    const plan = planFor(value)
    assert.throws(() => applyOpenClawRuntimeRetention(plan), /explicit retention confirmation/)
    const result = applyOpenClawRuntimeRetention(plan, { confirm: true, runtimeLockHeld: true })
    assert.equal(result.status, 'applied')
    assert.equal(result.removed.length, 1)
    assert.equal(existsSync(join(value.runtime, 'versions', '2026.8.1')), false)
  } finally {
    dispose(value)
  }
})

test('blocks a marker that points outside the isolated runtime before planning deletion', () => {
  const value = fixture()
  try {
    const outside = join(value.root, 'outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(value.runtime, 'active.json'), JSON.stringify({
      schema: 1,
      status: 'active',
      version: '2026.10.5',
      runtimePath: outside,
    }))
    mkdirSync(join(value.runtime, 'versions', '2026.8.1'), { recursive: true })
    const plan = planFor(value)
    assert.equal(plan.status, 'blocked')
    assert.equal(plan.targets.length, 0)
    assert.ok(plan.issues.some((entry) => entry.code === 'marker-path-outside-runtime-root'))
  } finally {
    dispose(value)
  }
})

test('blocks symlink or reparse entries instead of following them', (t) => {
  const value = fixture()
  try {
    const outside = join(value.root, 'outside')
    mkdirSync(outside, { recursive: true })
    const link = join(value.runtime, 'versions', '2026.8.1')
    mkdirSync(join(value.runtime, 'versions'), { recursive: true })
    try {
      symlinkSync(outside, link, 'junction')
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
        t.skip(`symlink fixture unavailable: ${error?.code ?? 'unknown'}`)
        return
      }
      throw error
    }
    const plan = planFor(value)
    assert.equal(plan.status, 'blocked')
    assert.equal(plan.targets.length, 0)
    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.ok(plan.issues.some((entry) => entry.code === 'managed-entry-is-symlink-or-reparse'))
    assert.equal(existsSync(outside), true)
  } finally {
    dispose(value)
  }
})

test('blocks a DSH_HOME ancestor that is a symlink or reparse point', (t) => {
  const value = fixture()
  try {
    const homeLink = join(value.root, 'dsh-link')
    try {
      symlinkSync(value.home, homeLink, 'junction')
    } catch (error) {
      if (['EPERM', 'EACCES', 'EINVAL', 'UNKNOWN'].includes(error?.code)) {
        t.skip(`home-link fixture unavailable: ${error?.code ?? 'unknown'}`)
        return
      }
      throw error
    }
    const plan = planOpenClawRuntimeRetention({ home: homeLink, runtimeLockHeld: true })
    assert.equal(plan.status, 'blocked')
    assert.equal(plan.targets.length, 0)
    assert.ok(plan.issues.some((entry) => entry.code === 'runtime-home-or-ancestor-is-symlink-or-reparse'))
  } finally {
    dispose(value)
  }
})

test('rejects a tampered non-absolute target at the execution boundary', () => {
  const value = fixture()
  try {
    mkdirSync(join(value.runtime, 'versions', '2026.8.1'), { recursive: true })
    const plan = planFor(value)
    const result = applyOpenClawRuntimeRetention({ ...plan, targets: [...plan.targets, { path: 'versions/old' }] }, { confirm: true, runtimeLockHeld: true })
    assert.equal(result.status, 'blocked')
    assert.equal(result.removed.length, 0)
    assert.equal(existsSync(join(value.runtime, 'versions', '2026.8.1')), true)
    assert.ok(result.issues.some((entry) => entry.code === 'delete-target-is-not-absolute'))

    const unmanaged = join(value.runtime, 'versions', 'user-folder')
    mkdirSync(unmanaged, { recursive: true })
    const unmanagedResult = applyOpenClawRuntimeRetention({ ...plan, targets: [{ path: unmanaged }] }, { confirm: true, runtimeLockHeld: true })
    assert.equal(unmanagedResult.status, 'blocked')
    assert.equal(existsSync(unmanaged), true)
    assert.ok(unmanagedResult.issues.some((entry) => entry.code === 'plan-target-not-fresh-eligible'))
  } finally {
    dispose(value)
  }
})

test('rejects an inserted active target when applying a stale plan', () => {
  const value = fixture()
  try {
    const active = marker(value.runtime, 'active', '2026.10.5')
    mkdirSync(join(value.runtime, 'versions', '2026.8.1'), { recursive: true })
    const plan = planFor(value)
    const result = applyOpenClawRuntimeRetention({ ...plan, targets: [...plan.targets, { path: active.runtimePath, kind: 'versions' }] }, { confirm: true, runtimeLockHeld: true })
    assert.equal(result.status, 'blocked')
    assert.equal(result.removed.length, 0)
    assert.equal(existsSync(active.runtimePath), true)
    assert.ok(result.issues.some((entry) => entry.code === 'retention-target-set-changed-before-apply'))
  } finally {
    dispose(value)
  }
})

test('rejects a marker revision change between planning and applying', () => {
  const value = fixture()
  try {
    const active = marker(value.runtime, 'active', '2026.10.5')
    mkdirSync(join(value.runtime, 'versions', '2026.8.1'), { recursive: true })
    const plan = planFor(value)
    writeFileSync(join(value.runtime, 'active.json'), JSON.stringify({
      schema: 1,
      status: 'active',
      version: '2026.10.5',
      runtimePath: active.runtimePath,
      nodePath: active.nodePath,
      artifactPath: active.artifactPath,
      activationNote: 'marker changed after dry-run',
    }))
    const result = applyOpenClawRuntimeRetention(plan, { confirm: true, runtimeLockHeld: true })
    assert.equal(result.status, 'blocked')
    assert.equal(result.removed.length, 0)
    assert.equal(existsSync(join(value.runtime, 'versions', '2026.8.1')), true)
    assert.ok(result.issues.some((entry) => entry.code === 'marker-revision-changed-before-apply'))
  } finally {
    dispose(value)
  }
})

test('requires the plan root to be the exact openclaw-runtime child of its home', () => {
  const value = fixture()
  try {
    const plan = planFor(value)
    assert.throws(() => applyOpenClawRuntimeRetention({ ...plan, runtimeRoot: join(value.home, 'other-runtime') }, { confirm: true, runtimeLockHeld: true }), /valid OpenClaw retention plan/)
  } finally {
    dispose(value)
  }
})
