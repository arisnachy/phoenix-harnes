import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LivingCreationId } from '@phoenix-ai/dsh-living'
import LivingLocal from '@phoenix-ai/dsh-living-local'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.dispose()))
})

async function runtime() {
  const root = new Context()
  roots.push(root)
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-living-'))
  const path = join(dir, 'living-creations.json')
  root.plugin(LivingLocal, { path })
  await root.start()
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
    root.living.remember(ecosystem)

    expect(root.living.inspect(ecosystem.id)).toMatchObject({
      manifest: ecosystem,
      connected: false,
      achievedLevel: 'static',
    })

    const persisted = JSON.parse(await readFile(path, 'utf8')) as { version: number; creations: unknown[] }
    expect(persisted.version).toBe(1)
    expect(persisted.creations).toEqual([ecosystem])
  })

  it('derives the achieved level from a real provider and routes state, actions, and events', async () => {
    const { root } = await runtime()
    root.living.remember(ecosystem)
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

  it('rejects a target integration level that the manifest cannot describe', async () => {
    const { root } = await runtime()
    expect(() => root.living.remember({
      id: LivingCreationId('broken'),
      title: 'Broken creation',
      kind: 'arbitrary',
      targetLevel: 'controllable',
      state: [],
      actions: [],
      events: [],
      resources: [],
      actors: [],
    })).toThrow(/controllable.*action/i)
  })
})
