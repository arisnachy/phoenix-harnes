import { describe, expect, it } from 'vitest'
import { qualityRequirementsForNeed } from '../src/quality-contract.ts'

function need(kind: string, extra: Record<string, unknown> = {}) {
  return { kind, ...extra }
}

describe('qualityRequirementsForNeed', () => {
  it('requires executable verification and operational robustness for software work', () => {
    const requirements = qualityRequirementsForNeed(need('code', { description: 'build a web application' }))
    expect(requirements.join(' ')).toMatch(/test|verification/i)
    expect(requirements.join(' ')).toMatch(/error|failure|robust/i)
    expect(requirements.join(' ')).toMatch(/security|unsafe|permission/i)
  })

  it('requires visual, responsive, and accessibility evidence for UI work', () => {
    const requirements = qualityRequirementsForNeed(need('ui', { description: 'responsive hospital dashboard' }))
    expect(requirements.join(' ')).toMatch(/visual|render|screenshot/i)
    expect(requirements.join(' ')).toMatch(/responsive/i)
    expect(requirements.join(' ')).toMatch(/accessib/i)
  })

  it('requires source traceability and unsupported-claim checks for research work', () => {
    const requirements = qualityRequirementsForNeed(need('research', { description: 'evidence review' }))
    expect(requirements.join(' ')).toMatch(/source|citation|trace/i)
    expect(requirements.join(' ')).toMatch(/unsupported|claim|factual/i)
  })

  it('requires reproducibility and validation for data analysis', () => {
    const requirements = qualityRequirementsForNeed(need('analysis', { description: 'analyze a dataset' }))
    expect(requirements.join(' ')).toMatch(/reproduc/i)
    expect(requirements.join(' ')).toMatch(/valid|cross-check|sanity/i)
  })

  it('keeps a strong domain-neutral baseline for unknown capability kinds', () => {
    const requirements = qualityRequirementsForNeed(need('future-capability'))
    expect(requirements.length).toBeGreaterThanOrEqual(3)
    expect(requirements.join(' ')).toMatch(/complete/i)
    expect(requirements.join(' ')).toMatch(/evidence|verif/i)
  })
})
