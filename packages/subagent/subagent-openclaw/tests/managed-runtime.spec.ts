import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createManagedOpenClawConfig, type ManagedOpenClawRuntimeHost } from '../src/managed-runtime.ts'

const location = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => location.home }))
let config: Record<string, unknown>
const policy = { provider: 'openai',
  model: 'gpt-6-luna',
  agentRuntime: 'codex',
  sandbox: 'read-only',
  approval: 'never',
  cwd: 'C:/project',
  toolPolicy: { profile: 'minimal',
    allow: ['session_status'],
    deny: [],
    profileHash: 'verified' } }
const host = (): ManagedOpenClawRuntimeHost => ({ clientFactory: vi.fn(),
  resolvePolicy: vi.fn(async () => policy),
  attestPolicy: vi.fn(async () => undefined) })
function save() { writeFileSync(join(location.home, '.dsh/openclaw-runtime/openclaw.json'), JSON.stringify(config)) }
beforeEach(() => {
  location.home = mkdtempSync(join(tmpdir(), 'phoenix-managed-config-'))
  mkdirSync(join(location.home, '.dsh/openclaw-runtime'), { recursive: true })
  config = { gateway: { port: 18879,
    bind: 'loopback',
    auth: { token: 'private-fixture' } },
  agents: { entries: { phoenix: { model: { primary: 'openai/gpt-6-luna' },
    workspace: 'C:/project',
    tools: { profile: 'minimal' } } },
  defaults: { models: { 'openai/gpt-6-luna': { agentRuntime: { id: 'codex' } } } } },
  plugins: { entries: { codex: { enabled: true,
    config: { appServer: { sandbox: 'read-only',
      approvalPolicy: 'never' } } } } } }
  save()
})
afterEach(() => rmSync(location.home, { recursive: true, force: true }))

it('uses exact managed route and host factories without copying credentials', async () => {
  const authority = host()
  const result = await createManagedOpenClawConfig(authority)
  expect(result).toMatchObject({ url: 'ws://127.0.0.1:18879',
    agentId: 'phoenix',
    model: 'gpt-6-luna',
    clientFactory: authority.clientFactory })
  expect(JSON.stringify(result)).not.toContain('private-fixture')
})
it('fails closed when the trusted policy resolver is unavailable', async () => {
  await expect(createManagedOpenClawConfig({ ...host(),
    resolvePolicy: async () => { throw new Error('private failure') } })).resolves.toBeUndefined()
})
it('rejects a route whose effective restrictions disagree with saved settings', async () => {
  await expect(createManagedOpenClawConfig({ ...host(),
    resolvePolicy: async () => ({ ...policy,
      sandbox: 'danger-full-access' }) })).resolves.toBeUndefined()
})
it('rejects an invalid loopback port before querying host authority', async () => {
  config.gateway = { port: 65536, bind: 'loopback' }; save()
  const authority = host()
  expect(await createManagedOpenClawConfig(authority)).toBeUndefined()
  expect(authority.resolvePolicy).not.toHaveBeenCalled()
})
