import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { LivingCreationId } from '@phoenix-ai/dsh-living'
import LocalLivingRegistry from '@phoenix-ai/dsh-living-local'
import * as ToolLiving from '../src/index.ts'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(disposers.splice(0).reverse().map(dispose => dispose())) })

async function bench() {
  const root = new Context()
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-tool-living-'))
  const promptFiber = await root.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  const toolsFiber = await root.plugin(ToolRuntime, {})
  const livingFiber = await root.plugin(LocalLivingRegistry, { path: join(dir, 'living.json'), bridgePort: 0 })
  const toolFiber = await root.plugin(ToolLiving)
  disposers.push(
    () => promptFiber.dispose(),
    () => toolsFiber.dispose(),
    () => livingFiber.dispose(),
    () => toolFiber.dispose(),
  )
  return root
}

describe('tool-living', () => {
  it('states one universal rule instead of enumerating creation domains', async () => {
    const root = await bench()
    const assembly = await root.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === 'tool:living')
    expect(section?.text).toBe(ToolLiving.LIVING_CREATION_POLICY)
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('regardless of its domain, format')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('never special-case it to a fixed list')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('automatically provisions a per-creation Phoenix control link')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('living_get_connector_kit')
    expect(ToolLiving.LIVING_CREATION_POLICY).not.toMatch(/chess|spreadsheet|warehouse/i)
  })

  it('requires a connector for every Phoenix-created output with no static downgrade', async () => {
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('mandatory, not optional')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('never judge a creation too small, too disposable, too local, or too simple to connect')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('must target connected or above')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('do not silently downgrade a Phoenix-created artifact to static')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('Agent operation is optional even though Phoenix connectivity is mandatory')
  })

  it('requires telemetry, error surfacing, and live control surfaces', async () => {
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('Build telemetry in from the start')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('surface errors, failures, and recoveries as they happen')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('pull that telemetry on demand')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('Build control in from the start')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('operated, measured, monitored, and recovered')
  })

  it('gates background agents on explicit user consent with low-resource operation', async () => {
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('never enable agents silently')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('ask the user whether they want agents operating the creation in the background')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('on demand, low-resource, and idle-free')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('rather than burning continuous background work')
  })

  it('binds connector, telemetry, error, and manifest state to durable memory across every model', async () => {
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('in durable memory')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('reconnect the creation, pull its telemetry, inspect its failures, or resume operating it after a restart')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('binds every model and every session')
  })

  it('registers an unknown connected creation kind through the model-facing tool', async () => {
    const root = await bench()
    const tool = root.tools.get('living_register_creation')
    expect(tool).toBeDefined()
    const value = await tool!.execute({
      id: 'strange-1', title: 'Unforeseen thing', kind: 'future-kind-xyz', target_level: 'connected',
      state: ['revision', 'health', 'last_error', 'updated_at'], actions: [], events: [], resources: ['artifact'], actors: [],
    }, {} as never) as { connector_json: string }
    expect(value).toMatchObject({ id: 'strange-1', kind: 'future-kind-xyz', target_level: 'connected', achieved_level: 'static', connected: false })
    expect(JSON.parse(value.connector_json)).toMatchObject({ protocol: 'phoenix-living-http-v1', creation_id: 'strange-1' })
  })

  it('refuses static targets in the model-facing creation flow', async () => {
    const root = await bench()
    const tool = root.tools.get('living_register_creation')!
    await expect(tool.execute({
      id: 'static-1', title: 'Static attempt', kind: 'document', target_level: 'static',
      state: [], actions: [], events: [], resources: ['artifact'], actors: [],
    }, {} as never)).rejects.toThrow(/must target connected or above/i)
  })

  it('auto-provisions one stable control link and emits secret-safe connector modules', async () => {
    const root = await bench()
    const register = root.tools.get('living_register_creation')!
    const first = await register.execute({
      id: 'app-1',
      title: 'Managed app',
      kind: 'future-app',
      target_level: 'controllable',
      state: ['status'],
      actions: ['refresh'],
      events: ['changed'],
      resources: ['source:C:/workspace/app-1'],
      actors: [],
    }, {} as never) as { connector_json: string }

    const firstConnector = JSON.parse(first.connector_json) as {
      protocol: string
      creation_id: string
      endpoint: string
      token: string
    }
    expect(firstConnector).toMatchObject({
      protocol: 'phoenix-living-http-v1',
      creation_id: 'app-1',
    })
    expect(firstConnector.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/living$/)
    expect(firstConnector.token.length).toBeGreaterThanOrEqual(32)

    const second = await register.execute({
      id: 'app-1',
      title: 'Managed app',
      kind: 'future-app',
      target_level: 'controllable',
      state: ['status'],
      actions: ['refresh'],
      events: ['changed'],
      resources: ['source:C:/workspace/app-1', 'deployment:local'],
      actors: [],
    }, {} as never) as { connector_json: string }
    const secondConnector = JSON.parse(second.connector_json) as { token: string }
    expect(secondConnector.token).toBe(firstConnector.token)

    const snapshot = root.living.inspect(LivingCreationId('app-1'))
    expect(snapshot.manifest.resources.filter(resource => resource.startsWith('phoenix-control://'))).toHaveLength(1)
    expect(snapshot.manifest.resources).toContain('deployment:local')

    const kit = await root.tools.get('living_get_connector_kit')!.execute({ id: 'app-1' }, {} as never) as {
      javascript_module: string
      python_module: string
      security_note: string
    }
    expect(kit.javascript_module).toContain('PHOENIX_CONTROL_TOKEN')
    expect(kit.python_module).toContain('PHOENIX_CONTROL_TOKEN')
    expect(kit.javascript_module).not.toContain(firstConnector.token)
    expect(kit.python_module).not.toContain(firstConnector.token)
    expect(kit.security_note).toMatch(/never expose.*bearer token/i)
  })

  it('refuses completion verification until the declared live level is really attached', async () => {
    const root = await bench()
    await root.living.remember({
      id: LivingCreationId('sim-1'), title: 'Simulation', kind: 'novel-system', targetLevel: 'controllable',
      state: ['tick'], events: ['tickChanged'], actions: ['advance'], resources: [], actors: [],
    })
    const verify = root.tools.get('living_verify_creation')!
    await expect(verify.execute({ id: 'sim-1' }, {} as never)).rejects.toThrow(/not ready/i)

    const dispose = root.living.attach(LivingCreationId('sim-1'), {
      readState: () => ({ tick: 0 }), subscribe: () => () => undefined, act: () => ({ ok: true }),
    })
    await expect(verify.execute({ id: 'sim-1' }, {} as never)).resolves.toMatchObject({
      id: 'sim-1', target_level: 'controllable', achieved_level: 'controllable', connected: true,
    })
    dispose()
  })

  it('forgets a creation only through the explicit destructive tool and detaches its provider', async () => {
    const root = await bench()
    const id = LivingCreationId('retired-1')
    await root.living.remember({
      id, title: 'Retired creation', kind: 'future-retired', targetLevel: 'static',
      state: [], actions: [], events: [], resources: ['artifact'], actors: [],
    })
    let detached = false
    root.living.attach(id, { subscribe: () => () => { detached = true } })

    const forget = root.tools.get('living_forget_creation')
    expect(forget).toBeDefined()
    await expect(forget!.execute({ id: 'retired-1' }, {} as never)).resolves.toEqual({ id: 'retired-1', forgotten: true })

    expect(detached).toBe(true)
    expect(root.living.list()).toEqual([])
    expect(() => root.living.inspect(id)).toThrow(/unknown living creation/i)
  })
})
