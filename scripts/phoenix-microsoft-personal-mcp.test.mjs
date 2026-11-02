import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const executable = join(dirname(fileURLToPath(import.meta.url)), 'phoenix-microsoft-personal-mcp.mjs')
test('free Microsoft Graph MCP has valid protocol, tools and no token leaks', async t => {
  const server = spawn(process.execPath, [executable], { stdio: ['pipe','pipe','pipe'] })
  t.after(() => server.kill())
  const pending = new Map()
  const rl = createInterface({ input: server.stdout })
  rl.on('line', line => {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    const done = pending.get(msg.id)
    if (done) { pending.delete(msg.id); done(msg) }
  })
  let id = 0
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id
    const timeout = setTimeout(() => { pending.delete(next); reject(Error('MCP timeout')) }, 8000)
    pending.set(next, result => { clearTimeout(timeout); resolve(result) })
    server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:next, method, params }) + '\n')
  })
  const hello = await request('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'test', version:'1' } })
  assert.equal(hello.result.serverInfo.name, 'phoenix-microsoft-personal')
  const listed = await request('tools/list')
  const names = listed.result.tools.map(x => x.name)
  for (const tool of ['microsoft_login_start','microsoft_mail_list','microsoft_mail_draft',
    'microsoft_mail_send','microsoft_calendar_list','microsoft_calendar_create',
    'microsoft_contacts_list','microsoft_onedrive_list']) {
    assert.ok(names.includes(tool), tool)
  }
  assert.ok(listed.result.tools.every(x => x.inputSchema.additionalProperties === false))
  const bad = await request('tools/call', { name:'microsoft_setup', arguments:{ clientId:'not-a-guid' } })
  assert.equal(bad.result.isError, true)
  assert.ok(!JSON.stringify(bad).includes('access_token'))
  const status = await request('tools/call', { name:'microsoft_status', arguments:{} })
  assert.equal(typeof JSON.parse(status.result.content[0].text).configured, 'boolean')
})
