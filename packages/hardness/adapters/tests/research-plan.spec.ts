import { describe, expect, it } from 'vitest'
import { createResearchPlanTool, planAcademicResearch } from '../src/research-plan-tool.ts'

describe('Phoenix academic research intake and length planning', () => {
  it('preserves the three familiar entry points but separates article type from citation format', () => {
    const article = planAcademicResearch({ intent: 'Haz un artículo científico sobre cardiología' })
    expect(article.entry).toBe('scientific_article')
    expect(article.document_type).toBe('journal_manuscript')
    expect(article.citation_style).toBeNull()
    expect(article.missing_fields).toContain('estilo de citas del artículo: APA 7 o Vancouver')
    const planned = planAcademicResearch({ entry: 'scientific_article', citation_style: 'apa7' })
    expect(planned.citation_style).toBe('apa7')
    expect(planned.presentation).toBe('hybrid')
  })
  it('allocates the user-specified 80-page masters thesis faithfully without filler', () => {
    const result = planAcademicResearch({
      intent: 'Tesis APA 7', level: 'masters', document_type: 'thesis', target_pages: 80,
      page_scope: 'all', cover: { institution: 'Universidad', authors: [{ name: 'Investigadora', student_id: 'ID123' }] },
    })
    expect(result.state).toBe('PLAN_READY')
    expect(result.pages.page_plan.map(x => x.pages)).toEqual([9, 4, 6, 2, 15, 12, 12, 9, 5, 6])
    expect(result.pages.page_plan.reduce((total, x) => total + x.pages, 0)).toBe(80)
    expect(result.pages.verification).toContain('pending PDF')
  })
  it('plans level-specific bibliography guidance and premium academic visuals without inventing evidence', () => {
    const cases = [
      ['licenciatura', 'bachelors', 20, 40],
      ['maestría', 'masters', 40, 80],
      ['doctorado', 'doctorate', 100, null],
    ] as const
    for (const [name, level, minimum, suggestedMaximum] of cases) {
      const plan = planAcademicResearch({ intent: 'Tesis APA 7 de ' + name + ' con gráficos hermosos' })
      expect(plan.document_type).toBe('thesis')
      expect(plan.level).toBe(level)
      expect(plan.reference_guidance).toMatchObject({
        minimum, suggested_maximum: suggestedMaximum, policy: 'advisory',
      })
      expect(plan.citation_requirements).toMatchObject({
        style: 'apa7', citations: 'author-date', bibliography: 'alphabetical',
      })
      expect(plan.visual_plan).toMatchObject({
        preference: 'premium', design_preset: 'academic_classic', evidence_required: true,
      })
    }
    const vancouver = planAcademicResearch({ intent: 'Tesis de medicina Vancouver', level: 'masters' })
    expect(vancouver.citation_requirements).toMatchObject({
      style: 'vancouver', citations: 'numeric', bibliography: 'first-appearance',
    })
    expect(() => planAcademicResearch({ entry: 'apa7', visual_preference: 'bling' })).toThrow()
  })

  it('only asks for truly missing fields, in one intake bundle', () => {
    const result = planAcademicResearch({ entry: 'vancouver', document_type: 'thesis', target_pages: 100 })
    expect(result.missing_fields).toEqual([
      'institución', 'participantes', 'si las páginas incluyen portada, bibliografía y anexos',
    ])
  })
  it('uses planned expected-results structure rather than completed-results for protocols', () => {
    const result = planAcademicResearch({ entry: 'apa7', document_type: 'research_protocol',
      cover: { institution: 'Universidad', author: 'Autor' } })
    expect(result.pages.page_plan.some(x => x.kind === 'results')).toBe(false)
    expect(result.reporting_standard_hint).toContain('resultados esperados')
  })
  it('rejects unsafe or impossible page budgets', () => {
    expect(() => planAcademicResearch({ entry: 'apa7', target_pages: -1 })).toThrow()
    expect(() => planAcademicResearch({ entry: 'apa7', target_pages: 10000 })).toThrow()
    expect(() => planAcademicResearch({ entry: 'fake' })).toThrow()
    expect(createResearchPlanTool().name).toBe('phoenix_research_plan')
  })
})
