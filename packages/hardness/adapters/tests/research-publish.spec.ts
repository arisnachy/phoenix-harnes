import { describe, expect, it } from 'vitest'
import { researchOutputPaths, validateResearchPublication, createResearchPublishTool } from '../src/research-publish-tool.ts'

const report = {
  title: 'Informe de investigación sobre envejecimiento cognitivo',
  style: 'vancouver',
  document_type: 'brief', quality_profile: 'educational_brief', user_requested_brief: true,
  cover: { institution: 'Institución de prueba', author: 'Investigador de prueba' },
  sections: [
    { heading: 'Resumen', text: 'Hallazgo sustentado en fuente primaria [@study2026].' },
    { heading: 'Limitaciones', text: 'La evidencia tiene limitaciones metodológicas [@study2026].' },
  ],
  references: [
    { key: 'study2026', authors: 'Apellido, A.', year: '2026', title: 'Investigación verificable',
      journal: 'Revista de prueba', url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' },
  ],
}
describe('Phoenix research report publisher', () => {
  it('only accepts a structured report linked to actual supplied source metadata', () => {
    expect(validateResearchPublication(report)).toEqual(report)
    expect(() => validateResearchPublication({ ...report, sections: [{ heading: 'Uno', text: 'Sin referencias' }] })).toThrow()
    expect(() => validateResearchPublication({ ...report, sections: [{ heading: 'Uno', text: 'Mención [@missing].' }] })).toThrow()
    expect(() => validateResearchPublication({ ...report, references: [{ ...report.references[0], url: 'http://localhost/secret' }] })).toThrow()
    expect(() => validateResearchPublication({ ...report, style: 'inventado' })).toThrow()
  })
  it('admits named modern design presets but protects strict academic styling', () => {
    const options = ['editorial_navy', 'clinical_teal', 'executive_amber',
      'minimal_graphite', 'creative_coral', 'journal_ink', 'research_violet', 'biotech_green',
      'ocean_blue', 'terracotta_report', 'clinical_white', 'auto']
    for (const design_preset of options) {
      expect(validateResearchPublication({ ...report, presentation: 'hybrid', design_preset })).toMatchObject({ design_preset })
    }
    expect(validateResearchPublication({ ...report, presentation: 'journal', design_preset: 'academic_classic' }))
      .toMatchObject({ presentation: 'journal' })
    expect(() => validateResearchPublication({ ...report, presentation: 'journal',
      design_preset: 'journal_ink' })).toThrow(/academic y journal/u)
    expect(validateResearchPublication({ ...report, presentation: 'academic', design_preset: 'academic_classic' }))
      .toMatchObject({ design_preset: 'academic_classic' })
    expect(() => validateResearchPublication({ ...report, presentation: 'academic',
      design_preset: 'creative_coral' })).toThrow(/academic y journal/u)
    expect(() => validateResearchPublication({ ...report, presentation: 'hybrid',
      design_preset: 'academic_classic' })).toThrow(/academic_classic/u)
    expect(() => validateResearchPublication({ ...report, design_preset: 'unknown' })).toThrow(/Diseño desconocido/u)
  })
  it('derives the same stable and isolated publication paths for identical content', () => {
    const a = researchOutputPaths(report)
    const b = researchOutputPaths({ ...report })
    expect(a).toEqual(b)
    expect(a.docx).toMatch(/informe\.docx$/u)
    expect(a.pdf).toMatch(/informe\.pdf$/u)
    expect(a.html).toMatch(/informe\.html$/u)
    expect(a.pdf).not.toEqual(researchOutputPaths({ ...report, title: 'Una versión distinta' }).pdf)
  })
  it('registers a genuine report creator rather than a visual mockup', () => {
    const tool = createResearchPublishTool()
    expect(tool.name).toBe('phoenix_research_publish')
    expect(tool.timeoutMs).toBeGreaterThan(30000)
    expect(tool.presentCall?.({ report })).toMatchObject({ card: 'generic', kind: 'edit' })
    expect(tool.presentCall?.({ report: {} })).toMatchObject({ card: 'generic', kind: 'execute' })
  })
  it('resolves all keys in a semicolon-separated or comma-separated citation group', () => {
    const second = { ...report.references[0]!, key: 'study2025', year: '2025' }
    const valid = { ...report, references: [...report.references, second],
      sections: [{ heading: 'Método', text: 'Síntesis conjunta [@study2026; @study2025] y [@study2026, @study2025].' }] }
    expect(validateResearchPublication(valid)).toEqual(valid)
    expect(() => validateResearchPublication({ ...valid, references: report.references })).toThrow(/Cita sin fuente/u)
    expect(() => validateResearchPublication({ ...valid,
      sections: [{ heading: 'Método', text: 'Fuente mal construida [@study2026; @].' }] })).toThrow()
  })
  it('rejects the actual three-page scientific failure instead of claiming report ready', () => {
    const shortReview = { ...report, document_type: 'narrative_review',
      quality_profile: 'professional', user_requested_brief: false,
      sections: [
        { kind: 'abstract', heading: 'Resumen', text: 'Conclusión breve [@study2026].' },
        { kind: 'introduction', heading: 'Introducción', text: 'Texto de una línea [@study2026].' },
        { kind: 'methods', heading: 'Método', text: 'Cuatro estudios mencionados sin examen exhaustivo [@study2026].' },
        { kind: 'results', heading: 'Resultados', text: 'Un pequeño hallazgo [@study2026].' },
        { kind: 'discussion', heading: 'Discusión', text: 'Poco análisis [@study2026].' },
        { kind: 'limitations', heading: 'Limitaciones', text: 'Limitaciones breves [@study2026].' },
        { kind: 'conclusions', heading: 'Conclusiones', text: 'Sin profundidad [@study2026].' },
      ] }
    expect(() => validateResearchPublication(shortReview)).toThrow(/Investigación insuficiente/u)
    expect(() => validateResearchPublication({ ...report, quality_profile: 'professional' })).toThrow()
    expect(() => validateResearchPublication({ ...report, user_requested_brief: false })).toThrow()
  })

})
