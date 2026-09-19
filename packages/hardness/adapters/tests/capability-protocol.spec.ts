import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import {
  CAPABILITY_OPERATING_PROTOCOL,
  installCapabilityOperatingProtocol,
} from '../src/capability-protocol.ts'

describe('PHOENIX capability operating protocol', () => {
  it('registers one stable source-first capability policy section', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
    }

    const returned = installCapabilityOperatingProtocol(systemPrompt)
    expect(systemPrompt.section).toHaveBeenCalledWith({
      name: 'hardness:capability-operating-protocol',
      order: 154,
      text: CAPABILITY_OPERATING_PROTOCOL,
    })
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('pins authoritative retrieval, current evidence, modality, automation, recovery, and low overhead', () => {
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('retrieve the actual content before making claims')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('recover materially relevant session/memory context')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('use a live web/data capability')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('private/account-scoped state')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('phoenix_visualize')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('generative-image capability')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('durable task system')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('classifying it')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('Batch independent read-only operations')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('One primary agent is the default')
    expect(CAPABILITY_OPERATING_PROTOCOL).toContain('Do not promise future work unless it has actually been scheduled')
  })
})
