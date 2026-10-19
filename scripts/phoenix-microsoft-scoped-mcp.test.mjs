import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const executable = join(dirname(fileURLToPath(import.meta.url)), 'phoenix-microsoft-personal-mcp.mjs')
const services = {
  mail: ['microsoft_mail_list', 'microsoft_mail_read', 'microsoft_mail_send'],
  calendar: ['microsoft_calendar_list', 'microsoft_calendar_create'],
  contacts: ['microsoft_contacts_list'],
  onedrive: ['microsoft_onedrive_list'],
  teams: ['microsoft_teams_list', 'microsoft_teams_channels', 'microsoft_teams_messages'],
  sharepoint: ['microsoft_sharepoint_search', 'microsoft_sharepoint_drives'],
}
const universal = ['microsoft_setup', 'microsoft_login_start', 'microsoft_login_complete',
  'microsoft_status', 'microsoft_disconnect', 'microsoft_profile']

function client(service, t) {
  const child = spawn(process.execPath, [executable, service], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PHOENIX_MICROSOFT_CLIENT_ID: '' },
  })
  t.after(() => child.kill())
  const pending = new Map()
  createInterface({ input: child.stdout }).on('line', line => {
    let value
    try { value = JSON.parse(line) } catch { return }
    const resolve = pending.get(value.id)
    if (resolve) { pending.delete(value.id); resolve(value) }
  })
  let id = 0
  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const next = ++id
      const timeout = setTimeout(() => { pending.delete(next); reject(Error('MCP timeout')) }, 8000)
      pending.set(next, value => { clearTimeout(timeout); resolve(value) })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n')
    })
  }
  return { request }
}

for (const [service, ownTools] of Object.entries(services)) {
  test('Microsoft ' + service + ' exposes only its tools and consent entrypoints', async t => {
    const { request } = client(service, t)
    const hello = await request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    })
    assert.equal(hello.result.serverInfo.name, 'phoenix-microsoft-' + service)
    const listed = await request('tools/list')
    const names = listed.result.tools.map(tool => tool.name)
    assert.deepEqual(names.slice(0, universal.length), universal)
    assert.deepEqual(names.slice(universal.length), ownTools)
    assert.ok(listed.result.tools.every(tool => tool.inputSchema.additionalProperties === false))
    const otherTool = Object.values(services).flat().find(name => !ownTools.includes(name))
    assert.ok(otherTool)
    const blocked = await request('tools/call', { name: otherTool, arguments: {} })
    assert.ok(blocked.error || blocked.result?.isError, 'cross-service tools must be rejected')
    assert.ok(!JSON.stringify(blocked).includes('access_token'))
    const bad = await request('tools/call', { name: 'microsoft_setup',
      arguments: { clientId: 'not-a-guid' } })
    assert.equal(bad.result.isError, true)
    const status = await request('tools/call', { name: 'microsoft_status', arguments: {} })
    const data = JSON.parse(status.result.content[0].text)
    assert.equal(data.service, service)
    assert.equal(typeof data.credentialStored, 'boolean')
    assert.equal(data.verified, false, 'cached credentials alone are not a verified Graph session')
  })
}

test('reject unknown service arguments before starting the MCP', async t => {
  const child = spawn(process.execPath, [executable, '../outside'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.notEqual(code, 0)
})
