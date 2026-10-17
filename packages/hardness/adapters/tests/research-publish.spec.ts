import { describe, expect, it } from 'vitest'
import { researchOutputPaths, validateResearchPublication, createResearchPublishTool } from '../src/research-publish-tool.ts'

const report = {
  title: 'Informe de investigación sobre envejecimiento cognitivo',
  style: 'vancouver',
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
})
