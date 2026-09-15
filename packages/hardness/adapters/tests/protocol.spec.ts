import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import { installHardnessProtocol } from '../src/protocol.ts'

describe('HARDNESS model protocol prompt adapter', () => {
  it('registers one deterministic model-facing cognitive and operating protocol section and disposes it', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
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
    expect(section?.text).toContain('Run these protocols silently')
    expect(section?.text).toContain('Interpret the request by its objective and deliverable')
    expect(section?.text).toContain('A turn, compaction, restart, model switch, or update does not erase an active mission')
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
    expect(section?.text).toContain('Ejecuta estos protocolos de forma silenciosa')
    expect(section?.text).toContain('Interpreta la petición por su objetivo y entregable')
    expect(section?.text).toContain('Un turno, compactación, reinicio, cambio de modelo o actualización no borra una misión activa')
    expect(section?.text).not.toContain('function')
    expect(section?.text).not.toContain('credential')
  })
})
