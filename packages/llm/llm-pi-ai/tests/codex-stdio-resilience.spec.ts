import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { finishProcessSetup } from '../src/codex-discovery.ts'

describe('Codex metadata stdio resilience', () => {
  it('owns child stdin errors so a late EPIPE cannot crash the PHOENIX Host', () => {
    const resume = vi.fn()
    const child = new EventEmitter() as EventEmitter & {
      stderr: { resume(): void }
      stdin: EventEmitter
    }
    child.stderr = { resume }
    child.stdin = new EventEmitter()

    finishProcessSetup(child as never)

    expect(child.stdin.listenerCount('error')).toBeGreaterThan(0)
    expect(() => {
      child.stdin.emit(
        'error',
        Object.assign(new Error('broken pipe'), { code: 'EPIPE' }),
      )
    }).not.toThrow()
    expect(resume).toHaveBeenCalledOnce()
  })
})
