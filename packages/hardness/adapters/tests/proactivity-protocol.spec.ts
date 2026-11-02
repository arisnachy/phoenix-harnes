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
    expect(PROACTIVITY_PROTOCOL).toContain('evaluate whether a specific next step is worth scheduling')
    expect(PROACTIVITY_PROTOCOL).toContain('schedule it automatically only inside existing user goals and authorization, otherwise stay quiet')
    expect(PROACTIVITY_PROTOCOL).toContain('Do not create noisy, duplicative, or speculative tasks')
    expect(PROACTIVITY_PROTOCOL).toContain('create at most one useful new task per completed mission')
    expect(PROACTIVITY_PROTOCOL).toContain('clear trigger/time and expected user benefit')
    expect(PROACTIVITY_PROTOCOL).toContain('Prefer one high-value follow-up')
    expect(PROACTIVITY_PROTOCOL).toContain('never create a duplicate')
    expect(PROACTIVITY_PROTOCOL).toContain('Autonomous tasks never grant new permissions')
    expect(PROACTIVITY_PROTOCOL).toContain('phoenix_watch_create')
    expect(PROACTIVITY_PROTOCOL).toContain('stays silent while false or uncertain')
    expect(PROACTIVITY_PROTOCOL).toContain('no more often than hourly')
    expect(PROACTIVITY_PROTOCOL).toContain('event-driven connector or webhook')
    expect(PROACTIVITY_PROTOCOL).toContain('do not claim the task is scheduled until a real recipient')
    expect(PROACTIVITY_PROTOCOL).toContain('Never invent "the email associated with your account"')
    expect(PROACTIVITY_PROTOCOL).toContain('dedicated Phoenix mail identity is optional')
  })
})
