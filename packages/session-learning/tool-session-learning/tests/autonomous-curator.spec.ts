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

  it('learns natural corrective feedback even when the user does not say correction or remember', () => {
    expect(classifyAutonomousMemory('No debe ser así: estás dando muchas vueltas sin resultados; termina la tarea antes de narrar el proceso.')).toMatchObject({
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

  it('reuses the prior durable subject when the user explicitly corrects it', async () => {
    const store = new Store()
    const curator = new AutonomousMemoryCurator(store)
    await curator.observeUserMessage({
      text: 'Prefiero que cada vez que cambies Phoenix ejecutes todas las pruebas antes de terminar.',
      sessionId: 's',
      eventSeq: 1,
      occurredAt: 1_000,
      projectId: 'phoenix',
    })
    await curator.observeUserMessage({
      text: 'Corrijo eso: de ahora en adelante prueba primero el componente afectado y amplía solo si hay riesgo.',
      sessionId: 's',
      eventSeq: 2,
      occurredAt: 1_100,
      projectId: 'phoenix',
    })

    expect(store.writes).toHaveLength(2)
    expect(store.writes[1]?.sourceEventType).toBe('autonomous/user-correction')
    expect(store.writes[1]?.subject).toBe(store.writes[0]?.subject)
  })

  it('does not supersede guidance from an unrelated known project', async () => {
    const store = new Store()
    const curator = new AutonomousMemoryCurator(store)
    await curator.observeUserMessage({
      text: 'Prefiero que siempre verifiques Phoenix antes de terminar.',
      sessionId: 'a',
      eventSeq: 1,
      occurredAt: 1_000,
      projectId: 'phoenix',
    })
    await curator.observeUserMessage({
      text: 'Corrijo eso: de ahora en adelante usa el flujo nuevo.',
      sessionId: 'b',
      eventSeq: 2,
      occurredAt: 1_100,
      projectId: 'other',
    })

    expect(store.writes[1]?.subject).not.toBe(store.writes[0]?.subject)
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
