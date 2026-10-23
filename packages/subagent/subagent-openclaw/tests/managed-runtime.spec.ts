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
  resolveExecutionPolicy: vi.fn(async () => policy),
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
it('accepts a provider-scoped native Codex route with verified Host policy', async () => {
  const agents = config.agents as { defaults: Record<string, unknown> }
  agents.defaults = { models: {} }
  config.models = { providers: { openai: { agentRuntime: { id: 'codex' } } } }
  save()
  const authority = host()
  await expect(createManagedOpenClawConfig(authority)).resolves.toMatchObject({
    provider: 'openai', model: 'gpt-6-luna', agentRuntime: 'codex',
  })
  expect(authority.resolvePolicy).toHaveBeenCalledOnce()
})
it('rejects an explicit agent-model runtime that overrides a Codex provider', async () => {
  config.models = { providers: { openai: { agentRuntime: { id: 'codex' } } } }
  const agents = config.agents as { entries: { phoenix: Record<string, unknown> } }
  agents.entries.phoenix.models = { 'openai/gpt-6-luna': { agentRuntime: { id: 'openclaw' } } }
  save()
  const authority = host()
  await expect(createManagedOpenClawConfig(authority)).resolves.toBeUndefined()
  expect(authority.resolvePolicy).not.toHaveBeenCalled()
})
it('does not override an explicit model-level non-Codex runtime', async () => {
  config.models = { providers: { openai: { agentRuntime: { id: 'codex' } } } }
  const agents = config.agents as { defaults: Record<string, unknown> }
  agents.defaults = { models: { 'openai/gpt-6-luna': { agentRuntime: { id: 'openclaw' } } } }
  save()
  const authority = host()
  await expect(createManagedOpenClawConfig(authority)).resolves.toBeUndefined()
  expect(authority.resolvePolicy).not.toHaveBeenCalled()
})
it('rejects a Codex plugin excluded by the native allowlist', async () => {
  const plugins = config.plugins as Record<string, unknown>
  plugins.allow = ['another-plugin']
  save()
  const authority = host()
  await expect(createManagedOpenClawConfig(authority)).resolves.toBeUndefined()
  expect(authority.resolvePolicy).not.toHaveBeenCalled()
})

it('loads the same isolated descriptor as the launcher when DSH_HOME is customized', async () => {
  const custom = join(location.home, 'isolated-home')
  mkdirSync(join(custom, 'openclaw-runtime'), { recursive: true })
  writeFileSync(join(custom, 'openclaw-runtime', 'openclaw.json'), JSON.stringify(config))
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = custom
    await expect(createManagedOpenClawConfig(host())).resolves.toMatchObject({
      agentId: 'phoenix', url: 'ws://127.0.0.1:18879',
    })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
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

it('forwards the owning session and native task identity on each policy resolution', async () => {
  const authority = host()
  const result = await createManagedOpenClawConfig(authority)
  const root = { session: { header: { cwd: 'C:/project' } } } as never
  const request = {
    root, executionId: 'native-execution-1' as never, idempotencyKey: 'caller-request-1',
    engine: 'openclaw' as const, selection: { provider: 'openai-codex', model: 'gpt-6-luna' },
    capabilities: ['conversation'] as const,
  }
  expect(await result?.policyResolver?.(request)).toEqual(policy)
  expect(authority.resolveExecutionPolicy).toHaveBeenCalledWith(expect.objectContaining({
    root, executionId: 'native-execution-1', idempotencyKey: 'caller-request-1', agentId: 'phoenix',
  }))
  expect(JSON.stringify(vi.mocked(authority.resolveExecutionPolicy).mock.calls)).not.toContain('private-fixture')
})

it('fails closed when fresh per-session authority cannot be read', async () => {
  const authority = { ...host(), resolveExecutionPolicy: async () => { throw new Error('private authority failure') } }
  const result = await createManagedOpenClawConfig(authority)
  expect(await result?.policyResolver?.({
    root: {} as never, executionId: 'native-execution-1' as never, idempotencyKey: 'caller-request-1',
    engine: 'openclaw', selection: { provider: 'openai-codex', model: 'gpt-6-luna' }, capabilities: ['conversation'],
  })).toBeUndefined()
})
