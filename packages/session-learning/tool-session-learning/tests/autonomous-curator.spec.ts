import { describe, expect, it } from 'vitest'
import {
  AutonomousMemoryCurator,
  classifyAutonomousMemory,
  type AutonomousMemoryStore,
  type AutonomousMemoryWrite,
} from '../src/autonomous-curator.ts'

class Store implements AutonomousMemoryStore {
  readonly writes: AutonomousMemoryWrite[] = []
  remember(input: AutonomousMemoryWrite): Promise<void> {
    this.writes.push(input)
    return Promise.resolve()
  }
}

describe('classifyAutonomousMemory', () => {
  it('recognizes a naturally stated durable preference without requiring remember language', () => {
    expect(classifyAutonomousMemory('Quiero que siempre verifiques las pruebas relevantes antes de decir que terminaste.')).toMatchObject({
      kind: 'preference',
    })
  })

  it('ignores transient one-off instructions', () => {
    expect(classifyAutonomousMemory('Esta vez no corras todas las pruebas, solo revisa este archivo.')).toBeUndefined()
  })

  it('recognizes an explicit correction as durable corrective evidence', () => {
    expect(classifyAutonomousMemory('Corrijo eso: de ahora en adelante prueba primero el componente afectado.')).toMatchObject({
      kind: 'correction',
    })
  })
})

describe('AutonomousMemoryCurator', () => {
  it('persists strong durable user guidance without memory_teach or memory_remember', async () => {
    const store = new Store()
    const curator = new AutonomousMemoryCurator(store)
    const learned = await curator.observeUserMessage({
      text: 'Prefiero que cada vez que cambies Phoenix ejecutes las pruebas relevantes y muestres evidencia.',
      sessionId: 's',
      eventSeq: 4,
      occurredAt: 1_000,
      projectId: 'phoenix',
    })

    expect(learned?.kind).toBe('preference')
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]?.sourceEventType).toBe('autonomous/user-preference')
    expect(store.writes[0]?.layers).toContain('semantic')
  })

  it('refuses secret-bearing guidance instead of persisting it', async () => {
    const store = new Store()
    const curator = new AutonomousMemoryCurator(store)
    await expect(curator.observeUserMessage({
      text: 'Quiero que siempre uses api_key=sk-super-secret-value para este proveedor.',
      sessionId: 's',
      eventSeq: 5,
      occurredAt: 1_100,
      projectId: 'phoenix',
    })).resolves.toBeUndefined()
    expect(store.writes).toHaveLength(0)
  })
})
