import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../../hardness/src/index.ts'
import { JsonAtlasStore } from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '../../hardness/src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const descriptor: CapabilityDescriptor = {
  id: 'tool:persisted' as CapabilityId,
  kind: 'tool',
  name: 'Persisted fixture',
  description: 'A persisted fixture capability.',
  inputs: [],
  outputs: [],
  dependencies: [],
  requiredPermissions: [],
  provider: 'fixture',
  location: 'local',
  version: '1.0.0',
  compatibility: [],
  limitations: [],
  modalities: ['native'],
  status: 'testing',
}

describe('durable HARDNESS JSON atlas', () => {
  it('round-trips versioned snapshots and rejects corruption', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-hardness-atlas-'))
    const path = join(root, 'atlas.json')
    const context = new Context()
    await context.plugin(HardnessRegistry)
    const service = context.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')
    service.register(descriptor)

    const store = new JsonAtlasStore(path)
    await store.save(service.snapshot())
    const loaded = await store.load()
    expect(loaded.capabilities).toHaveLength(1)
    expect(loaded.capabilities[0]?.id).toBe(descriptor.id)
    expect(await readFile(path, 'utf8')).toContain('formatVersion')

    const restoredContext = new Context()
    await restoredContext.plugin(HardnessRegistry)
    const restored = restoredContext.get('hardness') as HardnessService | undefined
    if (restored === undefined) throw new Error('restored hardness service missing')
    restored.restore(loaded)
    expect(restored.get(descriptor.id)?.version).toBe('1.0.0')

    await writeFile(path, '{corrupt')
    await expect(store.load()).rejects.toThrow(/corrupt|invalid/i)
    await context.fiber.dispose()
    await restoredContext.fiber.dispose()
  })
})
