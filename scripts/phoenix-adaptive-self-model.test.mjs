import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectAdaptiveSource } from './phoenix-adaptive-self-model.mjs'

async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-adaptive-'))
  try {
    await mkdir(join(root, 'packages', 'client', 'demo'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: { test: 'node test.mjs --secret SENSITIVE_SENTINEL', deploy: 'echo DO_NOT_EXPOSE' },
      credentials: { token: 'SENSITIVE_SENTINEL' },
    }))
    await writeFile(join(root, 'packages', 'client', 'demo', 'package.json'), JSON.stringify({
      name: '@phoenix-ai/demo',
      dsh: { client: { inject: ['@phoenix-ai/dsh-runtime', 'window.location.href', 'https://example.com'] } },
      auth: { apiKey: 'SENSITIVE_SENTINEL' },
      scripts: { unauthorized: 'echo SENSITIVE_SENTINEL' },
    }))
    return await callback(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('introspects only bounded source metadata, never credentials or command bodies', async () => fixture(async root => {
  const model = await inspectAdaptiveSource(root, new Date('2026-11-21T12:00:00Z'))
  assert.equal(model.runtimeHealthChecked, false)
  assert.equal(model.authorizationChecked, false)
  assert.equal(model.permissionsGranted, false)
  assert.equal(model.scope, 'declared-source-only')
  assert.equal(model.packageCount, 1)
  assert.equal(model.packages[0].id, '@phoenix-ai/demo')
  assert.deepEqual(model.packages[0].dependencies.client, ['@phoenix-ai/dsh-runtime'])
  assert.deepEqual(model.availableGateNames, ['test'])
  const serialized = JSON.stringify(model)
  assert.ok(!serialized.includes('SENSITIVE_SENTINEL'))
  assert.ok(!serialized.includes('DO_NOT_EXPOSE'))
  assert.ok(!serialized.includes('unauthorized'))
}))

test('does not traverse symlink directories, hidden files or node_modules', async () => fixture(async root => {
  const hidden = join(root, 'packages', '.secret')
  await mkdir(hidden)
  await writeFile(join(hidden, 'package.json'), JSON.stringify({ name: 'secretpackage' }))
  const other = join(root, 'untrusted')
  await mkdir(other)
  await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'untrusted' }))
  await symlink(other, join(root, 'packages', 'linked'), 'dir')
  const model = await inspectAdaptiveSource(root)
  assert.equal(model.packageCount, 1)
  assert.deepEqual(model.packages.map(v => v.id), ['@phoenix-ai/demo'])
}))
