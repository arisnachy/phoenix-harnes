import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditPhoenixStorage, classifyPhoenixStorageName } from './phoenix-storage-audit.mjs'

test('storage audit identifies only strict updater-managed directory names', () => {
  assert.equal(classifyPhoenixStorageName('phoenix-runtime-0123456789-0123456789ab'), 'managed-runtime')
  assert.equal(classifyPhoenixStorageName('phoenix-stage-0123456789'), 'managed-runtime')
  assert.equal(classifyPhoenixStorageName('phoenix-vault-baseline-20261020'), 'user-or-evidence-workspace')
  assert.equal(classifyPhoenixStorageName('phoenix-stage-evil'), 'user-or-evidence-workspace')
  assert.equal(classifyPhoenixStorageName('Downloads'), undefined)
})

test('storage audit measures sizes without altering managed or evidence directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-storage-audit-'))
  try {
    const managed = join(root, 'phoenix-runtime-0123456789-0123456789ab')
    const evidence = join(root, 'phoenix-research-evidence')
    mkdirSync(join(managed, 'nested'), { recursive: true })
    mkdirSync(evidence)
    writeFileSync(join(managed, 'nested', 'test.bin'), Buffer.alloc(1024))
    writeFileSync(join(evidence, 'project.txt'), 'keep')
    const report = auditPhoenixStorage(root)
    assert.equal(report.available, true)
    assert.equal(report.entries.length, 2)
    assert.equal(report.entries[0].bytes, 1024)
    assert.equal(report.entries[0].category, 'managed-runtime')
    assert.equal(report.entries[1].category, 'user-or-evidence-workspace')
    assert.equal(report.entries[1].bytes, 4)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
