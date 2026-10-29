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
  it('only asks for truly missing fields, in one intake bundle', () => {
    const result = planAcademicResearch({ entry: 'vancouver', document_type: 'thesis', target_pages: 100 })
    expect(result.missing_fields).toEqual([
      'nivel de tesis: licenciatura, maestría o doctorado',
      'institución', 'participantes', 'si las páginas incluyen portada, bibliografía y anexos',
    ])
  })
  it('uses planned expected-results structure rather than completed-results for protocols', () => {
    const result = planAcademicResearch({ entry: 'apa7', document_type: 'research_protocol',
      cover: { institution: 'Universidad', author: 'Autor' } })
    expect(result.pages.page_plan.some(x => x.kind === 'results')).toBe(false)
    expect(result.reporting_standard_hint).toContain('resultados esperados')
  })
  it('provides advisory reference targets by thesis level without asserting university rules', () => {
    for (const [level, min, max] of [
      ['bachelors', 20, 40], ['masters', 40, 80], ['doctorate', 100, null],
    ] as const) {
      const result = planAcademicResearch({ intent: 'Tesis APA', level, document_type: 'thesis' })
      expect(result.reference_guidance).toMatchObject({ min, max, advisory_only: true, verified_count: 0 })
      expect(result.citation_guidance.style).toBe('apa7')
      expect(result.citation_guidance.requirements).toContain('APA 7: citas autor-fecha')
      expect(result.visual_guidance.design_preset).toBe('academic_classic')
      expect(result.visual_guidance.safeguards.join(' ')).toContain('datos reales')
    }
    const unknown = planAcademicResearch({ intent: 'Tesis Vancouver', document_type: 'thesis' })
    expect(unknown.reference_guidance).toBeNull()
    expect(unknown.missing_fields).toContain('nivel de tesis: licenciatura, maestría o doctorado')
    expect(unknown.citation_guidance.requirements).toContain('citas numéricas por orden de primera aparición')
  })
  it('infers an explicitly requested thesis and uses a requested bibliographic format', () => {
    const thesis = planAcademicResearch({ intent: 'Preparar tesis sobre políticas públicas', level: 'bachelors',
      citation_style: 'vancouver' })
    expect(thesis.document_type).toBe('thesis')
    expect(thesis.citation_style).toBe('vancouver')
    expect(thesis.reference_guidance?.min).toBe(20)
    expect(thesis.missing_fields).not.toContain('entrada: APA 7, Vancouver o Artículo científico')
  })
  it('respects a requested enhanced visual presentation without fabricating charts', () => {
    const formal = planAcademicResearch({ entry: 'apa7', level: 'masters', document_type: 'thesis' })
    const enhanced = planAcademicResearch({ entry: 'apa7', level: 'masters',
      document_type: 'thesis', visual_mode: 'enhanced' })
    expect(formal.visual_guidance).toMatchObject({
      presentation: 'academic', design_preset: 'academic_classic',
    })
    expect(enhanced.visual_guidance).toMatchObject({
      presentation: 'hybrid', design_preset: 'minimal_graphite',
    })
    expect(enhanced.visual_guidance.safeguards.join(' ')).toContain('datos reales')
    const natural = planAcademicResearch({ intent: 'Tesis hermosa y elegante con gráficos', level: 'masters' })
    expect(natural.visual_guidance.presentation).toBe('hybrid')
    const override = planAcademicResearch({ intent: 'Tesis hermosa', level: 'masters', visual_mode: 'formal' })
    expect(override.visual_guidance.presentation).toBe('academic')
  })
  it('rejects unsafe or impossible page budgets', () => {
    expect(() => planAcademicResearch({ entry: 'apa7', target_pages: -1 })).toThrow()
    expect(() => planAcademicResearch({ entry: 'apa7', target_pages: 10000 })).toThrow()
    expect(() => planAcademicResearch({ entry: 'fake' })).toThrow()
    expect(() => planAcademicResearch({ entry: 'apa7', document_type: 'thesis', level: 'monograph' })).toThrow()
    expect(() => planAcademicResearch({ entry: 'apa7', visual_mode: 'invalid' })).toThrow()
    expect(createResearchPlanTool().name).toBe('phoenix_research_plan')
  })
})
