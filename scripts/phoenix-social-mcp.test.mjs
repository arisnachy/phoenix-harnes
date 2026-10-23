import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

test('Kira can prepare Phoenix own social identities without falsely claiming external signup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-own-social-mcp-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cli = fileURLToPath(new URL('./phoenix-social-mcp.mjs', import.meta.url))
  const proc = spawn(process.execPath, [cli], { env: { ...process.env, PHOENIX_SOCIAL_HOME: root },
    stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => { proc.kill() })
  const waiters = new Map()
  createInterface({ input: proc.stdout }).on('line', line => {
    const message = JSON.parse(line)
    const waiting = waiters.get(message.id)
    if (waiting) { waiters.delete(message.id); waiting(message) }
  })
  let nextId = 0
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { waiters.delete(id); reject(new Error('RPC timeout')) }, 10000)
    waiters.set(id, value => { clearTimeout(timeout); resolve(value) })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const initial = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.equal(initial.result.serverInfo.name, 'phoenix-social-engine')
  const listed = await request('tools/list')
  assert.ok(listed.result.tools.some(x => x.name === 'social_phoenix_onboarding'))
  for (const listedTool of listed.result.tools) {
    const schema = listedTool.inputSchema
    assert.equal(schema.type, 'object', listedTool.name)
    for (const keyword of ['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not']) {
      assert.equal(Object.hasOwn(schema, keyword), false, listedTool.name + ': ' + keyword)
    }
  }
  const start = await request('tools/call', { name: 'social_phoenix_onboarding', arguments: {} })
  assert.equal(start.result.isError, undefined)
  const body = JSON.parse(start.result.content[0].text)
  assert.equal(body.brand.id, 'phoenix')
  assert.equal(body.externallyCreated, 0)
  assert.equal(body.profiles.length, 6)
  assert.ok(body.profiles.every(p => p.stage === 'human-verification-required'))
  assert.ok(body.profiles.every(p => p.officialSignup.startsWith('https://')))
  const accounts = await request('tools/call', { name: 'social_accounts', arguments: {} })
  assert.deepEqual(JSON.parse(accounts.result.content[0].text), [])
  const campaign = await request('tools/call', {
    name: 'social_campaign_create',
    arguments: { brand: 'phoenix', title: 'Prueba MCP', destination: 'https://example.com/campaign' },
  })
  assert.equal(campaign.result.isError, undefined)
  const created = JSON.parse(campaign.result.content[0].text)
  assert.equal(created.title, 'Prueba MCP')
  assert.equal(created.brandId, 'phoenix')
  assert.equal(created.destination, 'https://example.com/campaign')
})
