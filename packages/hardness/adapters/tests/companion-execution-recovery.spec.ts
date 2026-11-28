import { describe, expect, it, vi } from 'vitest'
import { companionGreeting, companionFailure } from '../src/companion-local-policy.ts'
import { createProactivityExecutor } from '../src/proactivity-runtime.ts'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
describe('Finix execution recovery', () => {
  it('handles exact greetings without an agent, model or tool provider', async () => {
    const get = vi.fn(() => undefined)
    const executor = createProactivityExecutor({ get, roots: () => [], list: () => [] }, undefined, { pollMs: 15000, privateWorkProvider: 'spawn', privateWorkResultChars: 2000 })
    const engine = new ProactivityEngine(new MemoryProactivityStore(), executor)
    const task = await engine.create({ title: 'hola', instruction: 'hola', runAt: new Date().toISOString(), createdBy: 'user', delivery: 'work', executionPolicy: 'companion-local' })
    await engine.runDue(new Date())
    const result = await engine.get(task.id)
    expect(result?.status).toBe('completed')
    expect(result?.history.at(-1)?.summary).toContain('¡Hola!')
    expect(get).not.toHaveBeenCalled()
  })
  it('does not treat requests or questions as greetings', () => {
    expect(companionGreeting('¡Hola, Finix!')).toContain('¡Hola!')
    expect(companionGreeting('hola, revisa mis archivos')).toBeUndefined()
    expect(companionGreeting('¿Puedes ayudarme?')).toBeUndefined()
  })
  it('classifies known local engine failures without exposing raw diagnostic content', () => {
    expect(companionFailure('error', 'Phoenix Local está apagado en Settings. secret=abc')).toContain('[LOCAL_DISABLED]')
    expect(companionFailure('error', 'No hay memoria libre suficiente')).toContain('[LOCAL_MEMORY]')
    expect(companionFailure('error', 'pi-ai stream idle timeout')).toContain('[LOCAL_TIMEOUT]')
    expect(companionFailure('error', 'secret=abc')).not.toContain('secret=abc')
    expect(companionFailure('error', 'unclassified')).toContain('[LOCAL_UNKNOWN]')
  })
})
