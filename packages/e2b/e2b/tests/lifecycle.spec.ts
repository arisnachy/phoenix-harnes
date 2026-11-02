import { describe, expect, it } from 'vitest'
import { resolveE2BLifecycleConfig } from '../src/index.ts'

describe('E2B lifecycle configuration', () => {
  it('keeps backward compatible kill semantics by default', () => {
    expect(resolveE2BLifecycleConfig({ cwd: '/work', timeoutMs: 300_000 })).toMatchObject({
      retention: 'kill',
      autoPause: false,
      sandboxId: undefined,
    })
  })

  it('accepts reconnect + pause semantics explicitly', () => {
    expect(resolveE2BLifecycleConfig({
      cwd: '/work',
      timeoutMs: 300_000,
      sandboxId: '  sbx_123  ',
      retention: 'pause',
      autoPause: true,
    })).toMatchObject({ sandboxId: 'sbx_123', retention: 'pause', autoPause: true })
  })

  it('rejects an empty reconnect identity', () => {
    expect(() => resolveE2BLifecycleConfig({
      cwd: '/work',
      timeoutMs: 300_000,
      sandboxId: '   ',
    })).toThrow(/sandboxId.*non-empty/i)
  })

  it('fails closed on an unknown retention value at the runtime boundary', () => {
    expect(() => resolveE2BLifecycleConfig({
      cwd: '/work',
      timeoutMs: 300_000,
      retention: 'archive' as never,
    })).toThrow(/unsupported retention/i)
  })
})
