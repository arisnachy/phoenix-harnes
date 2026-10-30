import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  acknowledgeGuardianIncident, guardianBlockedTarget, guardianIncidentPath,
  pendingGuardianIncidents, recordGuardianIncident,
} from './phoenix-guardian-incidents.mjs'
import { recordPhoenixUpdateStep, writePhoenixUpdateState } from './phoenix-update-state.mjs'

const stable = 'a'.repeat(40)
const broken = 'b'.repeat(40)
let root
let originalHome
let originalSupervised

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'phoenix-guardian-test-'))
  originalHome = process.env.DSH_HOME
  originalSupervised = process.env.PHOENIX_UPDATE_SUPERVISED
  process.env.DSH_HOME = root
  process.env.PHOENIX_UPDATE_SUPERVISED = '0'
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  if (originalSupervised === undefined) delete process.env.PHOENIX_UPDATE_SUPERVISED
  else process.env.PHOENIX_UPDATE_SUPERVISED = originalSupervised
  rmSync(root, { recursive: true, force: true })
})

test('persists a real rollback and preserves evidence for Kira after restart', () => {
  const statePath = join(root, 'phoenix-update-state.json')
  recordPhoenixUpdateStep(statePath, 'build', 'failed', broken, 7,
    'Build failed: token=topsecret; stack: TypeError at app.ts:21')
  writePhoenixUpdateState(statePath, {
    schema: 1, status: 'rolled-back', previous: stable, current: stable, failedTarget: broken,
  })
  const pending = pendingGuardianIncidents()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].previous, stable)
  assert.equal(pending[0].failedTarget, broken)
  assert.match(pending[0].diagnosis, /TypeError/)
  assert.doesNotMatch(pending[0].diagnosis, /topsecret/)
  assert.equal(guardianBlockedTarget(broken), true)
  assert.equal(guardianBlockedTarget('c'.repeat(40)), false)
  assert.equal(JSON.parse(readFileSync(guardianIncidentPath(), 'utf8')).incidents.length, 1)
})

test('refuses to duplicate rollback receipts and preserves quarantine after acknowledging', () => {
  const event = { status: 'rolled-back', previous: stable, failedTarget: broken, phase: 'build', diagnosis: 'ECONNRESET' }
  const key = recordGuardianIncident(event)
  assert.equal(recordGuardianIncident(event), key)
  const [entry] = pendingGuardianIncidents()
  assert.ok(entry.id)
  assert.equal(acknowledgeGuardianIncident(entry.id), true)
  assert.equal(acknowledgeGuardianIncident(entry.id), false)
  assert.equal(pendingGuardianIncidents().length, 0)
  assert.equal(guardianBlockedTarget(broken), true)
  assert.equal(JSON.parse(readFileSync(guardianIncidentPath(), 'utf8')).incidents.length, 1)
})

test('quarantines an early Host crash and ignores unrelated network errors', () => {
  const statePath = join(root, 'phoenix-update-state.json')
  writePhoenixUpdateState(statePath, { schema: 1, status: 'error', phase: 'network', target: broken })
  assert.equal(pendingGuardianIncidents().length, 0)
  recordPhoenixUpdateStep(statePath, 'health-check', 'failed', broken, 31, 'Host died before healthyAt')
  writePhoenixUpdateState(statePath, { schema: 1, status: 'error', phase: 'health-check', target: broken, current: stable })
  assert.equal(pendingGuardianIncidents().length, 1)
  assert.match(pendingGuardianIncidents()[0].diagnosis, /Host died/)
  assert.equal(guardianBlockedTarget(broken), true)
})

test('rejects invalid SHA and redacts authorization headers', () => {
  assert.equal(recordGuardianIncident({ failedTarget: 'oops', status: 'rolled-back' }), undefined)
  recordGuardianIncident({
    status: 'activation-failed', failedTarget: broken,
    diagnosis: 'Authorization: Bearer abcd1234; password=hello; ghp_abcdefghijklmnop1234',
  })
  const diagnosis = pendingGuardianIncidents()[0].diagnosis
  assert.doesNotMatch(diagnosis, /abcd1234|hello|ghp_abcdefghijklmnop1234/)
  assert.match(diagnosis, /REDACTED/)
})

test('retains exact SHA quarantine after rotating the bounded incident ledger', () => {
  const oldest = '1'.repeat(40)
  for (let index = 1; index <= 30; index++) {
    const failedTarget = index.toString(16).padStart(40, '0')
    recordGuardianIncident({
      failedTarget, previous: stable, phase: 'health-check',
      status: 'rolled-back', diagnosis: 'Runtime exited unexpectedly',
    })
  }
  assert.equal(guardianBlockedTarget(oldest), false)
  assert.equal(guardianBlockedTarget('0'.repeat(39) + '1'), true)
  assert.equal(guardianBlockedTarget('0'.repeat(39) + '2'), true)
  assert.equal(guardianBlockedTarget('0'.repeat(39) + 'f'), true)
  assert.equal(guardianBlockedTarget('f'.repeat(40)), false)
  assert.equal(JSON.parse(readFileSync(guardianIncidentPath(), 'utf8')).incidents.length, 24)
})

test('redacts quoted JSON credentials and Basic authorization before durable storage', () => {
  recordGuardianIncident({
    failedTarget: broken,
    status: 'activation-failed',
    diagnosis: 'HTTP response: {"token":"veryprivate123","client_secret":"hiddenvalue"}; Authorization: Basic QWxhZGRpbjpvcGVu',
  })
  const text = pendingGuardianIncidents()[0].diagnosis
  assert.doesNotMatch(text, /veryprivate123|hiddenvalue|QWxhZGRpbjpvcGVu/)
  assert.match(text, /REDACTED/)
})

test('refuses updates and preserves forensic bytes when incident ledger is corrupt', () => {
  const path = guardianIncidentPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{broken JSON', 'utf8')
  assert.equal(guardianBlockedTarget(broken), true)
  assert.throws(() => recordGuardianIncident({
    status: 'activation-failed', failedTarget: broken, diagnosis: 'invalid build',
  }), /unreadable/)
  assert.equal(readFileSync(path, 'utf8'), '{broken JSON')
  assert.equal(guardianBlockedTarget('not-a-sha'), false)
})

test('supervisor retains the last healthy runtime through cleanup', () => {
  const source = readFileSync(new URL('./phoenix-windows-supervisor.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(lastKnownGoodRuntimeRoot !== root\) keep\.add\(runtimePathKey\(lastKnownGoodRuntimeRoot\)\)/u)
  assert.match(source, /const recovered = lastGoodSha !== undefined && runtimeIsHealthy\(lastGood, lastGoodSha\)/u)
  assert.match(source, /probationTimer = setTimeout\(/u)
  assert.match(source, /if \(runtimeRoot !== root\) lastKnownGoodRuntimeRoot = runtimeRoot/u)
  assert.match(source, /lastKnownGoodRuntimeRoot = hostRuntimeRoot/u)
  assert.match(source, /recordGuardianIncident\(\{/u)
  assert.match(source, /writeActiveRuntime\(lastGoodSha, runtimeRoot\)/u)
})
