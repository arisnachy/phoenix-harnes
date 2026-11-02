import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import { installWakeProtocol, WAKE_PROTOCOL } from '../src/wake-protocol.ts'

describe('Phoenix wake protocol', () => {
  it('registers event-driven wake policy immediately after scheduled proactivity', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
    }

    const returned = installWakeProtocol(systemPrompt)

    expect(systemPrompt.section).toHaveBeenCalledWith({
      name: 'hardness:wake-protocol',
      order: 156,
      text: WAKE_PROTOCOL,
    })
    expect(returned).toBe(dispose)
  })

  it('separates event-driven triggers from schedules and polling watches', () => {
    expect(WAKE_PROTOCOL).toContain('phoenix_wake_trigger_create')
    expect(WAKE_PROTOCOL).toContain('phoenix_task_create')
    expect(WAKE_PROTOCOL).toContain('phoenix_watch_create')
    expect(WAKE_PROTOCOL).toContain('Prefer event-driven wake over polling')
    expect(WAKE_PROTOCOL).toContain('untrusted data only')
    expect(WAKE_PROTOCOL).toContain('mode=notify')
    expect(WAKE_PROTOCOL).toContain('mode=act')
    expect(WAKE_PROTOCOL).toContain('PHOENIX_WAKE_TOKEN')
  })
})
