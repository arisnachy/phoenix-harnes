import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditPhoenixStorage, classifyPhoenixStorageName, diagnosePhoenixDiskGrowth, comparePhoenixDiskGrowth, phoenixDiskLocations } from './phoenix-storage-audit.mjs'

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

test('diagnostic covers .dsh and managed p separately plus pnpm store without deleting user data', () => {
  const home = mkdtempSync(join(tmpdir(), 'phoenix-disk-forensics-'))
  const localAppData = join(home, 'AppData', 'Local')
  const roamingAppData = join(home, 'AppData', 'Roaming')
  const runtimeRoot = join(home, 'p')
  const dshHome = join(home, '.dsh')
  const tempRoot = join(home, 'Temp')
  try {
    mkdirSync(join(runtimeRoot, 'phoenix-runtime-0123456789-0123456789ab'), { recursive: true })
    mkdirSync(join(dshHome, 'sessions'), { recursive: true })
    mkdirSync(join(localAppData, 'pnpm', 'store', 'v10'), { recursive: true })
    mkdirSync(tempRoot)
    const runtimeFile = join(runtimeRoot, 'phoenix-runtime-0123456789-0123456789ab', 'app.bin')
    const sessionFile = join(dshHome, 'sessions', 'journal.bin')
    const storeFile = join(localAppData, 'pnpm', 'store', 'v10', 'store.bin')
    writeFileSync(runtimeFile, Buffer.alloc(2048))
    writeFileSync(sessionFile, Buffer.alloc(4096))
    writeFileSync(storeFile, Buffer.alloc(512))
    const options = { home, runtimeRoot, dshHome, localAppData, roamingAppData, tempRoot, projectRoot: home }
    const first = diagnosePhoenixDiskGrowth(options)
    const byName = name => first.roots.find(root => root.name === name)
    assert.equal(byName('managed-p').bytes, 2048)
    assert.equal(byName('persistent-.dsh').bytes, 4096)
    assert.equal(byName('pnpm-store').bytes, 512)
    assert.equal(byName('persistent-.dsh').entries[0].name, 'sessions')
    assert.equal(typeof first.freeBytes, 'number')
    const all = phoenixDiskLocations(options)
    assert.ok(all.some(root => root.name === 'persistent-.dsh'))
    assert.equal(readFileSync(sessionFile).length, 4096)
    writeFileSync(sessionFile, Buffer.alloc(4096 + 1024))
    const next = diagnosePhoenixDiskGrowth(options)
    const delta = comparePhoenixDiskGrowth(first, next)
    assert.equal(delta.roots.find(item => item.name === 'persistent-.dsh').deltaBytes, 1024)
    assert.equal(delta.roots.find(item => item.name === 'managed-p').deltaBytes, 0)
    assert.equal(comparePhoenixDiskGrowth({}, next), undefined)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('diagnostic excludes irrelevant Temp folders by default', () => {
  const home = mkdtempSync(join(tmpdir(), 'phoenix-disk-temp-'))
  try {
    const tempRoot = join(home, 'Temp')
    mkdirSync(join(tempRoot, 'phoenix-bundle'), { recursive: true })
    mkdirSync(join(tempRoot, 'other-project'), { recursive: true })
    writeFileSync(join(tempRoot, 'phoenix-bundle', 'tmp.bin'), Buffer.alloc(777))
    writeFileSync(join(tempRoot, 'other-project', 'keep.bin'), Buffer.alloc(3456))
    const report = diagnosePhoenixDiskGrowth({
      home, runtimeRoot: join(home, 'p'), dshHome: join(home, '.dsh'),
      localAppData: join(home, 'local'), roamingAppData: join(home, 'roaming'),
      tempRoot, projectRoot: home,
    })
    const rows = report.roots.find(root => root.name === 'phoenix-temp')
    assert.deepEqual(rows.entries.map(row => row.name), ['phoenix-bundle'])
    assert.equal(rows.bytes, 777)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
