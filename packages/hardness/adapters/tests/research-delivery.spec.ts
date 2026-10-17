import { describe, expect, it } from 'vitest'
import { researchDeliveryFile, createResearchDeliverTool } from '../src/research-delivery.ts'

describe('Research Studio governed report distribution', () => {
  it('never accepts untrusted arbitrary file paths as report ids', () => {
    expect(() => researchDeliveryFile('../../private', 'pdf')).toThrow()
    expect(() => researchDeliveryFile('a'.repeat(16), 'pdf')).not.toThrow()
    expect(() => researchDeliveryFile('g'.repeat(16), 'pdf')).toThrow()
    expect(researchDeliveryFile('a'.repeat(16), 'pdf')).toContain('informe.pdf')
    expect(researchDeliveryFile('a'.repeat(16), 'docx')).toContain('informe.docx')
    expect(() => researchDeliveryFile('a'.repeat(16), 'exe' as 'pdf')).toThrow()
  })
  it('exposes a dedicated permission-gated tool rather than treating mail text as an attachment', () => {
    const tool = createResearchDeliverTool({
      ctx: {} as never,
      approval: {} as never,
      mailbox: () => undefined,
      mailCredentialRef: 'PHOENIX_AGENTMAIL_API_KEY',
    })
    expect(tool.name).toBe('phoenix_research_deliver')
    expect(tool.timeoutMs).toBeGreaterThan(30000)
    expect(tool.description).toContain('aprobación')
    expect(tool.description).toContain('Telegram')
  })
})
