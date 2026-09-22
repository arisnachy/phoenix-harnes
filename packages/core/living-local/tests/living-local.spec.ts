import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LivingCreationId, createLivingControlResource } from '@phoenix-ai/dsh-living'
import LivingLocal from '@phoenix-ai/dsh-living-local'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
})

async function runtime(extra: {
  bridgePort?: number
  bridgeActionTimeoutMs?: number
  bridgeHeartbeatTimeoutMs?: number
} = {}) {
  const root = new Context()
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-living-'))
  const path = join(dir, 'living-creations.json')
  const fiber = await root.plugin(LivingLocal, { path, bridgePort: 0, ...extra })
  disposers.push(() => fiber.dispose())
  return { root, path }
}

const ecosystem = {
  id: LivingCreationId('ecosystem-1'),
  title: 'Evolving ecosystem',
  kind: 'something-phoenix-has-never-seen-before',
  targetLevel: 'inhabited' as const,
  state: ['species', 'temperature'],
  actions: ['advanceTime', 'changeClimate'],
  events: ['mutationOccurred'],
  resources: ['world'],
  actors: ['phoenix', 'species-agent'],
}

describe('universal living creations', () => {
  it('accepts unknown creation kinds and persists their self-described manifest offline', async () => {
    const { root, path } = await runtime()
    await root.living.remember(ecosystem)

    expect(root.living.inspect(ecosystem.id)).toMatchObject({ manifest: ecosystem, connected: false, achievedLevel: 'static' })
    const persisted = JSON.parse(await readFile(path, 'utf8')) as { version: number; creations: unknown[] }
    expect(persisted.version).toBe(1)
    expect(persisted.creations).toEqual([ecosystem])
  })

  it('derives the achieved level from a real provider and routes state, actions, and events', async () => {
    const { root } = await runtime()
    await root.living.remember(ecosystem)
    const events: unknown[] = []
    const disposeEvent = root.living.onCreationEvent(event => events.push(event))
    const disposeProvider = root.living.attach(ecosystem.id, {
      readState: () => ({ species: 7, temperature: 24 }),
      act: async (action, input) => ({ action, input, accepted: true }),
      subscribe: emit => {
        emit('mutationOccurred', { species: 'phoenix-bird' })
        return () => undefined
      },
      actors: ['phoenix', 'species-agent'],
    })

    expect(root.living.inspect(ecosystem.id)).toMatchObject({ connected: true, achievedLevel: 'inhabited' })
    await expect(root.living.readState(ecosystem.id)).resolves.toEqual({ species: 7, temperature: 24 })
    await expect(root.living.act(ecosystem.id, 'advanceTime', { days: 1 })).resolves.toEqual({
      action: 'advanceTime', input: { days: 1 }, accepted: true,
    })
    expect(events).toEqual([{ creationId: ecosystem.id, name: 'mutationOccurred', data: { species: 'phoenix-bird' } }])

    disposeProvider()
    expect(root.living.inspect(ecosystem.id)).toMatchObject({ connected: false, achievedLevel: 'static' })
    await expect(root.living.act(ecosystem.id, 'advanceTime', {})).rejects.toThrow(/offline/i)
    disposeEvent()
  })

  it('connects an external generated runtime through the authenticated universal control bridge', async () => {
    const { root } = await runtime({ bridgeActionTimeoutMs: 2_000, bridgeHeartbeatTimeoutMs: 5_000 })
    const endpoint = await root.living.controlEndpoint()
    const id = LivingCreationId('external-app-1')
    const token = 'test-control-token-0123456789abcdef'
    const manifest = {
      id,
      title: 'External medical app',
      kind: 'medical-app',
      targetLevel: 'controllable' as const,
      state: ['status', 'patients'],
      actions: ['refresh'],
      events: ['telemetry'],
      resources: [createLivingControlResource(endpoint, token)],
      actors: [],
    }
    await root.living.remember(manifest)

    async function post(pathname: string, body: Record<string, unknown>, auth = token) {
      const response = await fetch(`${endpoint}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
        body: JSON.stringify({ creationId: id, ...body }),
      })
      const value = await response.json() as Record<string, unknown>
      return { response, value }
    }

    const health = await post('/health', {})
    expect(health.response.status).toBe(200)
    expect(health.value).toMatchObject({ ok: true, protocol: 1, bridge: 'living-local' })

    const contract = await post('/manifest', {})
    expect(contract.response.status).toBe(200)
    expect(contract.value).toMatchObject({
      creationId: id,
      capabilities: {
        state: manifest.state,
        actions: manifest.actions,
        events: manifest.events,
        actors: manifest.actors,
      },
    })

    const connected = await post('/connect', {
      capabilities: {
        state: manifest.state,
        actions: manifest.actions,
        events: manifest.events,
        actors: manifest.actors,
      },
      state: { status: 'ready', patients: 3 },
    })
    expect(connected.response.status).toBe(200)
    const sessionId = String(connected.value.sessionId)
    expect(root.living.inspect(id)).toMatchObject({ connected: true, achievedLevel: 'controllable' })

    await post('/state', { sessionId, state: { status: 'syncing', patients: 4 } })
    await expect(root.living.readState(id)).resolves.toEqual({ status: 'syncing', patients: 4 })

    const events: unknown[] = []
    const disposeEvents = root.living.onCreationEvent(event => events.push(event))
    await post('/event', { sessionId, name: 'telemetry', data: { latencyMs: 12 } })
    expect(events).toEqual([{ creationId: id, name: 'telemetry', data: { latencyMs: 12 } }])

    const action = root.living.act(id, 'refresh', { scope: 'all' })
    const polled = await post('/poll', { sessionId })
    const command = polled.value.command as { id: string; action: string; input: unknown }
    expect(command).toMatchObject({ action: 'refresh', input: { scope: 'all' } })
    await post('/result', { sessionId, commandId: command.id, ok: true, result: { refreshed: 4 } })
    await expect(action).resolves.toEqual({ refreshed: 4 })

    await post('/disconnect', { sessionId })
    expect(root.living.inspect(id)).toMatchObject({ connected: false, achievedLevel: 'static' })
    disposeEvents()
  })

  it('rejects forged credentials and runtime capability drift', async () => {
    const { root } = await runtime()
    const endpoint = await root.living.controlEndpoint()
    const id = LivingCreationId('secure-app-1')
    const token = 'test-control-token-fedcba9876543210'
    await root.living.remember({
      id,
      title: 'Secure app',
      kind: 'service',
      targetLevel: 'controllable',
      state: ['status'],
      actions: ['update'],
      events: ['changed'],
      resources: [createLivingControlResource(endpoint, token)],
      actors: [],
    })

    const request = (auth: string, actions: string[]) => fetch(`${endpoint}/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
      body: JSON.stringify({
        creationId: id,
        capabilities: { state: ['status'], actions, events: ['changed'], actors: [] },
        state: { status: 'ready' },
      }),
    })

    await expect(request('wrong-control-token-0123456789abcdef', ['update']).then(response => response.status))
      .resolves.toBe(401)
    await expect(request(token, ['update', 'undeclared']).then(response => response.status))
      .resolves.toBe(400)
    expect(root.living.inspect(id)).toMatchObject({ connected: false, achievedLevel: 'static' })
  })

  it('serializes concurrent durable mutations without losing either creation', async () => {
    const { root, path } = await runtime()
    const first = {
      id: LivingCreationId('parallel-1'), title: 'Parallel one', kind: 'future-a', targetLevel: 'static' as const,
      state: [], actions: [], events: [], resources: ['artifact-a'], actors: [],
    }
    const second = {
      id: LivingCreationId('parallel-2'), title: 'Parallel two', kind: 'future-b', targetLevel: 'static' as const,
      state: [], actions: [], events: [], resources: ['artifact-b'], actors: [],
    }

    await Promise.all([root.living.remember(first), root.living.remember(second)])

    expect(root.living.list().map(item => item.manifest.id)).toEqual([first.id, second.id])
    const persisted = JSON.parse(await readFile(path, 'utf8')) as { creations: Array<{ id: string }> }
    expect(persisted.creations.map(item => item.id)).toEqual([first.id, second.id])
  })

  it('rejects a manifest upgrade that the attached provider cannot satisfy', async () => {
    const { root } = await runtime()
    const id = LivingCreationId('upgrade-1')
    const controllable = {
      id, title: 'Upgradeable creation', kind: 'future-upgrade', targetLevel: 'controllable' as const,
      state: ['status'], actions: ['advance'], events: ['changed'], resources: [], actors: [],
    }
    await root.living.remember(controllable)
    root.living.attach(id, {
      readState: () => ({ status: 'ready' }),
      act: () => ({ ok: true }),
      subscribe: () => () => undefined,
      actors: ['other-agent'],
    })

    await expect(root.living.remember({
      ...controllable,
      targetLevel: 'inhabited' as const,
      actors: ['phoenix'],
    })).rejects.toThrow(/missing declared actors.*phoenix/i)

    expect(root.living.inspect(id)).toMatchObject({
      connected: true,
      manifest: { targetLevel: 'controllable', actors: [] },
    })
  })

  it('checks emitted events against the latest committed manifest', async () => {
    const { root } = await runtime()
    const id = LivingCreationId('events-1')
    const initial = {
      id, title: 'Eventful creation', kind: 'future-events', targetLevel: 'reactive' as const,
      state: ['status'], actions: [], events: ['oldEvent'], resources: [], actors: [],
    }
    await root.living.remember(initial)
    let emit: ((name: string, data: null) => void) | undefined
    root.living.attach(id, {
      readState: () => ({ status: 'ready' }),
      subscribe: callback => {
        emit = callback as (name: string, data: null) => void
        return () => undefined
      },
    })
    await root.living.remember({ ...initial, events: ['newEvent'] })

    expect(() => emit?.('oldEvent', null)).toThrow(/undeclared event/i)
    expect(() => emit?.('newEvent', null)).not.toThrow()
  })

  it('keeps the manifest and provider live when durable forget persistence fails', async () => {
    const { root, path } = await runtime()
    await root.living.remember(ecosystem)
    let disposed = false
    root.living.attach(ecosystem.id, {
      readState: () => ({ species: 7, temperature: 24 }),
      act: async () => ({ accepted: true }),
      subscribe: () => () => { disposed = true },
      actors: ['phoenix', 'species-agent'],
    })

    await rm(path)
    await mkdir(path)
    await expect(root.living.forget(ecosystem.id)).rejects.toThrow()

    expect(disposed).toBe(false)
    expect(root.living.inspect(ecosystem.id)).toMatchObject({ connected: true, achievedLevel: 'inhabited' })
  })

  it('rejects a target integration level that the manifest cannot describe', async () => {
    const { root } = await runtime()
    await expect(root.living.remember({
      id: LivingCreationId('broken'), title: 'Broken creation', kind: 'arbitrary', targetLevel: 'controllable',
      state: ['status'], actions: [], events: ['statusChanged'], resources: [], actors: [],
    })).rejects.toThrow(/controllable.*action/i)
  })
})
