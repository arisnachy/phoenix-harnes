import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeStep, runProfile, selectSteps, writeReport } from './phoenix-assurance.mjs'

const temp = mkdtempSync(join(tmpdir(), 'phoenix-assurance-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))

test('profiles select real existing tests and only one build in full', () => {
  assert.equal(selectSteps('quick').length, 3)
  assert.ok(selectSteps('agents').some(x => x.id === 'deliverables-regression'))
  const full = selectSteps('full')
  assert.equal(full.filter(x => x.id === 'build-libraries').length, 1)
  assert.equal(full.filter(x => x.id === 'build-browser').length, 1)
  assert.equal(full.length, new Set(full.map(x => x.id)).size)
  assert.throws(() => selectSteps('nonexistent'), /Unknown assurance profile/u)
})

test('process execution observes success, failure, and missing executable', async () => {
  const opts = { stdio: 'ignore', timeoutMs: 2000 }
  const success = await executeStep(process.execPath, ['-e', 'process.exit(0)'], opts)
  const failure = await executeStep(process.execPath, ['-e', 'process.exit(7)'], opts)
  const missing = await executeStep('nonexistent-phoenix-runner-xyz', [], opts)
  assert.equal(success.status, 'passed')
  assert.equal(failure.status, 'failed')
  assert.equal(failure.exitCode, 7)
  assert.equal(missing.status, 'failed')
})

test('a failed mandatory step stops the profile and reports missing execution', async () => {
  const invoked = []
  const report = await runProfile('agents', {
    persist: false,
    log() {},
    invocation: args => ({ command: 'mock', args }),
    execute: async (_command, args) => {
      invoked.push(args)
      return { status: 'failed', exitCode: 2, durationMs: 5, error: 'test failure' }
    },
  })
  assert.equal(invoked.length, 1)
  assert.equal(report.result, 'failed')
  assert.equal(report.executedSteps, 1)
  assert.equal(report.requestedSteps, 3)
  assert.equal(report.steps[0].error, 'test failure')
})

test('all mandatory steps must pass for a successful report', async () => {
  const report = await runProfile('quick', {
    persist: false, log() {},
    invocation: args => ({ command: 'mock', args }),
    execute: async () => ({ status: 'passed', exitCode: 0, durationMs: 3 }),
  })
  assert.equal(report.result, 'passed')
  assert.equal(report.executedSteps, report.requestedSteps)
})

test('writes parseable structured evidence without spilling child output', () => {
  const file = join(temp, 'evidence.json')
  writeReport({ schemaVersion: 1, result: 'passed', steps: [] }, file)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).result, 'passed')
})
