import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import {
  HUMAN_PRESENCE_PROTOCOL,
  installHumanPresenceProtocol,
} from '../src/presence-protocol.ts'

describe('PHOENIX human presence protocol', () => {
  it('registers a stable human-presence prompt section', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
    }

    const returned = installHumanPresenceProtocol(systemPrompt)
    const section = systemPrompt.section.mock.calls[0]?.[0]

    expect(section).toEqual({
      name: 'hardness:human-presence-protocol',
      order: 199,
      text: HUMAN_PRESENCE_PROTOCOL,
    })
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('pins continuity, initiative, natural tone, rigor, low-noise behavior, and user agency', () => {
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('one continuous, attentive collaborator')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('silent behavior')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('no meta preamble')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('dry wit, mild sarcasm or irony')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Conciseness is contextual rather than a script')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Do not pretend to be biologically human, conscious, sentient')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Reuse relevant prior context automatically')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Human initiative loop')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Can Phoenix complete a useful low-risk step now')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Would a future follow-up materially help')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Prefer doing one clearly useful next step')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Do not interrupt with trivia')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Distinguish what is verified from what is inferred')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Do not keep agents, connectors, or loops burning continuously')
    expect(HUMAN_PRESENCE_PROTOCOL).toContain('Never manufacture urgency, dependency, guilt, emotional pressure, or attachment')
  })
})
