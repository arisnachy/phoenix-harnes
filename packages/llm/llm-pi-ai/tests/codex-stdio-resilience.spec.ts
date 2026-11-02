import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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


describe('Codex metadata teardown source contract', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/codex-discovery.ts', import.meta.url)), 'utf8')

  it('gives app-server EOF time to flush model cache before force-killing the process tree', () => {
    expect(source).toContain('const CODEX_METADATA_EXIT_GRACE_MS = 3_000')
    expect(source).toContain('await waitForNaturalCodexExit(child, CODEX_METADATA_EXIT_GRACE_MS)')
    expect(source).toContain('failed to write models cache: background task failed')
    expect(source.indexOf('await waitForNaturalCodexExit')).toBeLessThan(source.indexOf("spawnSync('taskkill'"))
  })

  it('prefers the Phoenix-managed stable Codex runtime when one is active', () => {
    expect(source).toContain("join(dshHome, 'codex-cli')")
    expect(source).toContain("join(runtimeRoot, 'active.json')")
    expect(source).toContain('const managed = managedCodexBin()')
    expect(source).toContain('[managed, ...codexDiscoveryArgs()]')
  })
})
