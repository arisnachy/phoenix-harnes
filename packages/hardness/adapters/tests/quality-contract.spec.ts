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
    expect(requirements.join(' ')).toMatch(/error.*type|message field|diagnostic/i)
    expect(requirements.join(' ')).toMatch(/scale|performance|memory|superlinear/i)
    expect(requirements.join(' ')).toMatch(/acceptance criterion|aggregate suite/i)
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

  it('requires premium audiovisual, gameplay, and executed-build evidence for game work', () => {
    const requirements = qualityRequirementsForNeed(need('creative', {
      description: 'Crea un juego SNES de alta calidad con personajes, ambientes, animación y sonido',
    }))
    const text = requirements.join(' ')
    expect(text).toMatch(/current high-quality references|quality bar/i)
    expect(text).toMatch(/graphics|art direction/i)
    expect(text).toMatch(/characters|silhouettes|animation/i)
    expect(text).toMatch(/environments|atmosphere|storytelling/i)
    expect(text).toMatch(/sound|music|ambience/i)
    expect(text).toMatch(/gameplay feel|input response|camera/i)
    expect(text).toMatch(/frame-time|performance|memory/i)
    expect(text).toMatch(/executed game|ROM|play evidence/i)
    expect(requirements.length).toBeGreaterThanOrEqual(12)
  })

  it('keeps a strong domain-neutral baseline for unknown capability kinds', () => {
    const requirements = qualityRequirementsForNeed(need('future-capability'))
    expect(requirements.length).toBeGreaterThanOrEqual(3)
    expect(requirements.join(' ')).toMatch(/complete/i)
    expect(requirements.join(' ')).toMatch(/evidence|verif/i)
  })
})
