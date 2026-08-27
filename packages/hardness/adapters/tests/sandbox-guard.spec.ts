import { describe, expect, it, vi } from 'vitest'
import { installSandboxCapabilityGuard } from '../src/sandbox-guard.ts'

const descriptor = { id: 'tool:run', modalities: ['sandbox'] } as const

describe('HARDNESS sandbox guard', () => {
  it('denies sandbox capabilities when no policy is resolved', () => {
    let guard: ((execution: { name: string }) => string | undefined) | undefined
    const tools = { guard: vi.fn((candidate) => { guard = candidate; return () => {} }) }
    const dispose = installSandboxCapabilityGuard(tools as never, { get: () => descriptor } as never, undefined)
    expect(guard?.({ name: 'run' })).toMatch(/sandbox policy/i)
    dispose()
  })

  it('allows sandbox capabilities when the policy service resolves a call', () => {
    let guard: ((execution: { name: string }) => string | undefined) | undefined
    const tools = { guard: vi.fn((candidate) => { guard = candidate; return () => {} }) }
    const policy = { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/workspace' })) }
    installSandboxCapabilityGuard(tools as never, { get: () => descriptor } as never, policy as never)
    expect(guard?.({ name: 'run' })).toBeUndefined()
    expect(policy.resolve).toHaveBeenCalled()
  })
})
