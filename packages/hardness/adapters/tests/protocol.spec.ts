import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { installHardnessProtocol } from '../src/protocol.ts'

describe('HARDNESS model protocol prompt adapter', () => {
  it('registers one deterministic model-facing protocol section and disposes it', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn(() => dispose),
    }

    const returned = installHardnessProtocol(systemPrompt, 'en')

    expect(systemPrompt.section).toHaveBeenCalledWith({
      name: 'hardness:operating-protocol',
      order: 150,
      text: expect.stringContaining('<phoenix_hardness_protocol>'),
    })
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('supports the Spanish model-facing guide without executable handles', () => {
    const systemPrompt = { section: vi.fn((_section: PromptSection) => () => {}) }

    installHardnessProtocol(systemPrompt, 'es')

    const section = systemPrompt.section.mock.calls[0]?.[0]
    expect(section?.text).toContain('Pasos obligatorios')
    expect(section?.text).not.toContain('function')
    expect(section?.text).not.toContain('credential')
  })
})
