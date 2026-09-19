import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import {
  PROACTIVITY_PROTOCOL,
  installProactivityProtocol,
} from '../src/proactivity-protocol.ts'

describe('PHOENIX proactivity protocol', () => {
  it('registers the durable scheduling policy', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
    }

    const returned = installProactivityProtocol(systemPrompt)
    expect(systemPrompt.section).toHaveBeenCalledWith({
      name: 'hardness:proactivity-protocol',
      order: 155,
      text: PROACTIVITY_PROTOCOL,
    })
    expect(returned).toBe(dispose)
  })

  it('requires useful, bounded, non-duplicative initiative', () => {
    expect(PROACTIVITY_PROTOCOL).toContain('one concrete future obligation')
    expect(PROACTIVITY_PROTOCOL).toContain('do not invent a task just to appear proactive')
    expect(PROACTIVITY_PROTOCOL).toContain('clear trigger/time and expected user benefit')
    expect(PROACTIVITY_PROTOCOL).toContain('Prefer one high-value follow-up')
    expect(PROACTIVITY_PROTOCOL).toContain('never create a duplicate')
    expect(PROACTIVITY_PROTOCOL).toContain('Autonomous tasks never grant new permissions')
  })
})
