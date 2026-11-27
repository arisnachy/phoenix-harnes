import { describe, it, expect } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { ensureFinixResident, observeFinix, executeFinixResident, finixAttention, latestFinixObservation } from '../src/companion-resident.ts'
import type { HardnessService } from '@phoenix-ai/dsh-hardness'
const now = new Date('2026-11-27T12:00:00Z')
const hardness = { snapshot: () => ({ capabilities: [{ status: 'broken' }] }) } as unknown as Pick<HardnessService, 'snapshot'>
describe('Finix resident', () => {
  it('deduplicates a durable system routine across startup and respects pause', async () => {
    const store = new MemoryProactivityStore()
    const executor = { execute: async () => ({ summary: 'ok' }) }
    const engine = new ProactivityEngine(store, executor)
    await ensureFinixResident(engine, now)
    await ensureFinixResident(engine, now)
    const rows = await engine.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.executionPolicy).toBe('companion-resident')
    await engine.pause(rows[0]!.id)
    const restarted = new ProactivityEngine(store, executor)
    await ensureFinixResident(restarted, now)
    expect(await restarted.list()).toHaveLength(1)
    expect((await restarted.list())[0]?.status).toBe('paused')
  })
  it('uses observed facts, prioritizes resource pressure, and never needs a model', () => {
    expect(observeFinix([], hardness, 4, now, { free: 5, total: 100 })).toMatchObject({ identity: 'finix', tools: 4, degraded: 1, next: 'resources' })
    expect(observeFinix([], hardness, 4, now, { free: 50, total: 100 }).next).toBe('verify')
  })
  it('persists a genuine observation and deduplicates the same alert across audits', async () => {
    const store = new MemoryProactivityStore()
    const engine: ProactivityEngine = new ProactivityEngine(store, { execute: async input => executeFinixResident(input, engine, hardness, 4) })
    await ensureFinixResident(engine, new Date(Date.now() - 1000))
    await engine.runDue(new Date())
    const rows = await engine.list()
    expect(latestFinixObservation(rows)?.observation.identity).toBe('finix')
    const alert = finixAttention(rows)[0]
    expect(alert?.revision).toBe(finixAttention(rows)[0]?.revision)
    expect(alert?.title).toContain('Finix')
    expect(latestFinixObservation(rows, new Date(Date.now() + 4 * 3600_000))).toBeUndefined()
  })
  it('rejects a user-created resident policy', async () => {
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) })
    await expect(engine.create({ title: 'fake', instruction: 'fake', runAt: now.toISOString(), createdBy: 'user', delivery: 'work', executionPolicy: 'companion-resident' })).rejects.toThrow()
  })
})
