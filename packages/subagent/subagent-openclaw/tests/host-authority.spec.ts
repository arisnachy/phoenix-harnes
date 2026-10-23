import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import OpenClawManagedHostAuthority from '../src/host-authority.ts'
import { createManagedOpenClawConfig, managedOpenClawConfigPath } from '../src/managed-runtime.ts'
import { OpenClawExecutionAdapter } from '../src/execution-adapter.ts'

const DENY = ['browser', 'cron', 'gateway', 'nodes', 'group:fs', 'group:runtime', 'group:web']
const roots: string[] = []
const contexts: Context[] = []
const servers: WebSocketServer[] = []
const oldHome = process.env.DSH_HOME
const oldRoot = process.env.PHOENIX_RUNTIME_ROOT

async function mockGateway(): Promise<{ port: number; requests: string[] }> {
  const server = new WebSocketServer({ port: 0 })
  servers.push(server)
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test Gateway port unavailable')
  const requests: string[] = []
  server.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture-1', ts: 1 } }))
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString()) as { type: string; id: string; method: string; params?: Record<string, unknown> }
      requests.push(request.method)
      if (request.method === 'connect') {
        const auth = request.params?.auth as { token?: string } | undefined
        socket.send(JSON.stringify({ type: 'res', id: request.id, ok: auth?.token === 'private-fixture-token', payload: {
          type: 'hello-ok', protocol: 4, server: { version: 'test-gateway', connId: 'fixture' },
          features: { methods: ['health', 'agents.list', 'sessions.list', 'agent', 'agent.wait', 'sessions.create', 'sessions.abort'], events: [] },
          auth: { role: 'operator', scopes: ['operator.read', 'operator.write'] },
          policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 15_000 },
        } }))
        return
      }
      const payload = request.method === 'agents.list'
        ? { agents: [{ id: 'phoenix', model: { primary: 'openai/gpt-5' }, agentRuntime: { id: 'codex' } }] }
        : request.method === 'sessions.list'
          ? { sessions: [{ key: 'agent:phoenix:phoenix:execution-1', agentId: 'phoenix',
            modelProvider: 'openai', model: 'gpt-5', agentRuntime: { id: 'codex' } }] }
          : { ok: true }
      socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }))
    })
  })
  return { port: address.port, requests }
}

function testConfig(port: number, cwd: string) {
  return {
    gateway: { port, bind: 'loopback', auth: { token: 'private-fixture-token' } },
    agents: { entries: { phoenix: {
      model: { primary: 'openai/gpt-5' }, workspace: cwd,
      tools: { profile: 'minimal', allow: ['session_status'], deny: [...DENY] },
    } }, defaults: { models: { 'openai/gpt-5': { agentRuntime: { id: 'codex' } } } } },
    plugins: { allow: ['codex'], entries: { codex: {
      enabled: true, config: { appServer: { sandbox: 'read-only', approvalPolicy: 'never' } },
    } } },
  }
}

/** Synthetic manager only for Host policy decision tests; never counts as native ownership certification. */
function simulatedManager(root: string) {
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'phoenix-engine-runtime.mjs'), `
    import { createHash } from 'node:crypto'
    import { readFileSync } from 'node:fs'
    import { join } from 'node:path'
    export const ENGINE_RUNTIME_SAFETY_VERSION = 2
    export async function attestManagedOpenClawGateway({ home }) {
      const raw = readFileSync(join(home, 'openclaw-runtime', 'openclaw.json'))
      const config = JSON.parse(raw.toString())
      return { status: 'verified', port: config.gateway.port,
        configDigest: 'sha256:' + createHash('sha256').update(raw).digest('hex') }
    }
  `)
}
async function fixture(activateManager: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-openclaw-host-test-'))
  roots.push(root)
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  mkdirSync(join(home, 'openclaw-runtime'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  process.env.DSH_HOME = home
  process.env.PHOENIX_RUNTIME_ROOT = root
  if (activateManager) simulatedManager(root)
  const gateway = await mockGateway()
  const config = testConfig(gateway.port, workspace)
  writeFileSync(join(home, 'openclaw-runtime', 'openclaw.json'), JSON.stringify(config))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(OpenClawManagedHostAuthority)
  const host = ctx.get('openclawManagedRuntime') as OpenClawManagedHostAuthority
  const selected = {
    configPath: managedOpenClawConfigPath(), agentId: 'phoenix', provider: 'openai', model: 'gpt-5',
    agentRuntime: 'codex', sandbox: 'read-only', approval: 'never', cwd: workspace, toolsProfile: 'minimal',
  }
  return { root, home, workspace, gateway, config, ctx, host, selected }
}
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldRoot === undefined) delete process.env.PHOENIX_RUNTIME_ROOT
  else process.env.PHOENIX_RUNTIME_ROOT = oldRoot
})

it('does not accept a reachable authenticated Gateway without an owned native manager', async () => {
  const f = await fixture(false)
  await expect(f.host.resolvePolicy(f.selected)).resolves.toBeUndefined()
  expect(f.gateway.requests).toEqual([])
})

it('binds the Host-authorized model and sandbox to an authenticated native route', async () => {
  const f = await fixture(true)
  const policy = await f.host.resolvePolicy(f.selected)
  expect(policy).toMatchObject({ model: 'gpt-5', agentRuntime: 'codex',
    sandbox: 'read-only', toolPolicy: { allow: ['session_status'] } })
  expect(f.gateway.requests).toContain('agents.list')
  if (policy === undefined) throw new Error('Host policy not resolved')
  await expect(f.host.attestPolicy({ agentId: 'phoenix', expected: policy })).resolves.toMatchObject({
    agentId: 'phoenix', model: 'gpt-5', toolPolicy: { profileHash: policy.toolPolicy.profileHash },
  })
  expect(JSON.stringify(policy)).not.toContain('private-fixture-token')
  // Drive the actual managed composition and Gateway adapter rather than only
  // inspecting the Host policy service in isolation.
  const managed = await createManagedOpenClawConfig(f.host)
  if (managed === undefined) throw new Error('verified Host did not compose the native adapter')
  const adapter = new OpenClawExecutionAdapter(managed)
  await expect(adapter.probe()).resolves.toMatchObject({
    engine: 'openclaw', connected: true, providers: ['openai-codex'],
  })
  expect(f.gateway.requests).toContain('agents.list')
  expect(f.gateway.requests).not.toContain('agent')
})

it('rejects a weakened sandbox or changed credential-bearing config after the proof', async () => {
  const f = await fixture(true)
  const policy = await f.host.resolvePolicy(f.selected)
  if (policy === undefined) throw new Error('Host policy not resolved')
  expect(await f.host.resolvePolicy({ ...f.selected, sandbox: 'workspace-write' })).toBeUndefined()
  const tampered = { ...f.config, plugins: { ...f.config.plugins, entries: { codex: {
    enabled: true, config: { appServer: { sandbox: 'workspace-write', approvalPolicy: 'never' } },
  } } } }
  writeFileSync(managedOpenClawConfigPath(), JSON.stringify(tampered))
  expect(await f.host.resolvePolicy(f.selected)).toBeUndefined()
  // A transport factory cannot reuse an obsolete digest to disclose credentials.
  expect(() => f.host.clientFactory({ url: `ws://127.0.0.1:${f.gateway.port}` })).toThrow()
})

it('rejects forged task identity even with a valid static Host route', async () => {
  const f = await fixture(true)
  const policy = await f.host.resolvePolicy(f.selected)
  if (policy === undefined) throw new Error('Host policy not resolved')
  expect(await f.host.attestPolicy({ agentId: 'phoenix', expected: policy,
    sessionKey: 'agent:phoenix:phoenix:execution-1', taskIdempotencyKey: 'unbound-task',
  })).toBeUndefined()
})
