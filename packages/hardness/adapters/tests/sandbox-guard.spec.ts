import { describe, expect, it, vi } from 'vitest'
import type { ToolGuard, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '@deepseek-ai/dsh-hardness'
import { installSandboxCapabilityGuard } from '../src/sandbox-guard.ts'

const descriptor = { id: 'tool:run', modalities: ['sandbox'] } as unknown as CapabilityDescriptor
const get = (_id: CapabilityId): CapabilityDescriptor => descriptor

describe('HARDNESS sandbox guard', () => {
  it('denies sandbox capabilities when no policy is resolved', () => {
    let guard: ToolGuard | undefined
    const tools: Pick<ToolRuntime, 'guard'> = { guard: vi.fn((candidate: ToolGuard) => { guard = candidate; return () => {} }) }
    const hardness: Pick<HardnessService, 'get'> = { get }
    const dispose = installSandboxCapabilityGuard(tools, hardness, undefined)
    expect(guard?.({ name: 'run' } as Parameters<ToolGuard>[0])).toMatch(/sandbox policy/i)
    dispose()
  })

  it('allows sandbox capabilities when the policy service resolves a call', () => {
    let guard: ToolGuard | undefined
    const tools: Pick<ToolRuntime, 'guard'> = { guard: vi.fn((candidate: ToolGuard) => { guard = candidate; return () => {} }) }
    const policy = { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/workspace' })) }
    installSandboxCapabilityGuard(tools, { get }, policy)
    expect(guard?.({ name: 'run' } as Parameters<ToolGuard>[0])).toBeUndefined()
    expect(policy.resolve).toHaveBeenCalled()
  })
})
