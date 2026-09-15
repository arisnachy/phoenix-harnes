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
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('keeps orchestration private while preserving a human voice and the full quality bar', () => {
    const systemPrompt = { section: vi.fn((_section: PromptSection) => () => {}) }

    installHardnessProtocol(systemPrompt, 'en')

    const text = systemPrompt.section.mock.calls[0]?.[0]?.text
    if (typeof text !== 'string') throw new Error('expected model-facing prompt text')
    expect(text).toContain('<phoenix_human_presentation>')
    expect(text).toContain('Treat workflow labels, execution modes, quality gates, retries, model routing, and tool orchestration as private execution scaffolding')
    expect(text).toContain('Do not expose them as user-facing headings, status narration, or implementation jargon')
    expect(text).toContain('Speak naturally, warmly, directly, and in the user\'s language')
    expect(text).toContain('Fast or lightweight execution changes internal cost and latency only')
    expect(text).toContain('never the requested scope, deliverables, verification, or quality bar')
    expect(text).toContain('Never claim completion until the exact requested outcome is delivered and verified')
  })

  it('supports the Spanish model-facing guides without executable handles', () => {
    const systemPrompt = { section: vi.fn((_section: PromptSection) => () => {}) }

    installHardnessProtocol(systemPrompt, 'es')

    const text = systemPrompt.section.mock.calls[0]?.[0]?.text
    if (typeof text !== 'string') throw new Error('expected model-facing prompt text')
    expect(text).toContain('HARDNESS conoce estos flujos cognitivos')
    expect(text).toContain('Pasos obligatorios')
    expect(text).toContain('<phoenix_human_presentation>')
    expect(text).toContain('Trata las etiquetas de flujo, modos de ejecución, quality gates, reintentos, enrutamiento de modelos y orquestación de herramientas como andamiaje privado de ejecución')
    expect(text).toContain('Habla de forma natural, cálida, directa y en el idioma del usuario')
    expect(text).not.toContain('function')
    expect(text).not.toContain('credential')
  })
})
