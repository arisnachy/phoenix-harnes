import { describe, expect, it } from 'vitest'
import { buildExpertResearchContract, resolveExpertDiscipline } from '../src/expert-research.ts'

describe('APEX professional research contract', () => {
  it('routes expert disciplines using the existing domain classification', () => {
    expect(resolveExpertDiscipline('Qué hacer en caso de hipotensión', 'medicine')).toBe('medicine')
    expect(resolveExpertDiscipline('Diseño de epidemiología', 'public_health')).toBe('public_health')
    expect(resolveExpertDiscipline('Solucionar Python', 'software')).toBe('software')
    expect(resolveExpertDiscipline('Algo universal', 'general')).toBe('general')
  })

  it('asks for real clinical dose context only when it is pertinent', () => {
    const contract = buildExpertResearchContract({
      question: 'Calcular dosis pediátrica y comparar esquemas', domain: 'medicine',
      readRelevantCount: 2, independentReadCount: 2, duplicateContentCount: 0,
      challengesCount: 0, budgetExhausted: false,
    })
    expect(contract.discipline).toBe('medicine')
    expect(contract.specialistChecks.some(text => text.includes('función renal'))).toBe(true)
    expect(contract.specialistChecks.some(text => text.includes('comparabilidad'))).toBe(true)
    expect(contract.evidenceState).toBe('multiple_owners_unverified')
    expect(contract.technicalDimensions.some(text => text.includes('fisiopatología'))).toBe(true)
  })

  it('never equates source retrieval with verified truth', () => {
    const missing = buildExpertResearchContract({
      question: 'Pronóstico de dengue', domain: 'public_health',
      readRelevantCount: 0, independentReadCount: 0, duplicateContentCount: 0,
      challengesCount: 2, budgetExhausted: true,
    })
    expect(missing.evidenceState).toBe('not_read')
    expect(missing.evidenceGaps.some(x => x.includes('bloqueadas'))).toBe(true)
    const duplicate = buildExpertResearchContract({
      question: 'Pronóstico de dengue', domain: 'public_health',
      readRelevantCount: 2, independentReadCount: 1, duplicateContentCount: 1,
      challengesCount: 0, budgetExhausted: false,
    })
    expect(duplicate.evidenceState).toBe('single_owner_unverified')
    expect(duplicate.evidenceGaps.some(x => x.includes('duplicados'))).toBe(true)
  })

  it('enforces contextual graphics and a substantive answer across disciplines', () => {
    for (const domain of ['science', 'engineering', 'software', 'law', 'economics', 'sports', 'education']) {
      const contract = buildExpertResearchContract({
        question: 'Comparar elementos', domain,
        readRelevantCount: 1, independentReadCount: 1, duplicateContentCount: 0,
        challengesCount: 0, budgetExhausted: false,
      })
      expect(contract.requiredSections.length).toBeGreaterThan(3)
      expect(contract.visualRules.some(x => x.includes('comprobados'))).toBe(true)
      expect(contract.specialistChecks).toHaveLength(1)
    }
  })
})
