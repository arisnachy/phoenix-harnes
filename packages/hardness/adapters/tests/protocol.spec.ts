import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import { installHardnessProtocol } from '../src/protocol.ts'

describe('HARDNESS model protocol prompt adapter', () => {
  it('registers one deterministic model-facing cognitive and operating protocol section and disposes it', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn(() => dispose),
    }

    const returned = installHardnessProtocol(systemPrompt, 'en')

    expect(systemPrompt.section).toHaveBeenCalledWith({
      name: 'hardness:operating-protocol',
      order: 150,
      text: expect.stringContaining('<phoenix_hardness_protocol>') as unknown,
    })
    const section = systemPrompt.section.mock.calls[0]?.[0]
    expect(section?.text).toContain('<phoenix_cognitive_workflows>')
    expect(section?.text).toContain('systematic-debugging')
    expect(section?.text).toContain('verification-gate')
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('supports the Spanish model-facing guides without executable handles', () => {
    const systemPrompt = { section: vi.fn((_section: PromptSection) => () => {}) }

    installHardnessProtocol(systemPrompt, 'es')

    const section = systemPrompt.section.mock.calls[0]?.[0]
    expect(section?.text).toContain('HARDNESS conoce estos flujos cognitivos')
    expect(section?.text).toContain('Pasos obligatorios')
    expect(section?.text).not.toContain('function')
    expect(section?.text).not.toContain('credential')
  })
})
