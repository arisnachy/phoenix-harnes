import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@phoenix-ai/cordis'
import { executeResearch, planResearch, researchQuestionForTool, RESEARCH_SOURCES } from '../src/research.ts'

const signal = new AbortController().signal

describe('Phoenix universal research routing', () => {
  it('detects specialized domains including sports, foreign exchange, and biomedical science', () => {
    expect(planResearch('¿A cuánto está el dólar en República Dominicana?').domain).toBe('fx')
    expect(planResearch('¿Cómo quedó el partido del Real Madrid?').domain).toBe('sports')
    expect(planResearch('Nuevos ensayos de alzhéimer en pacientes').domain).toBe('neuroscience')
    expect(planResearch('puedes ayudarme a entender la fisiología del estress que ocurre a nivel cerebral').domain)
      .toBe('neuroscience')
    expect(planResearch('Fisiología del estrés y eje HPA en el cerebro').domain).toBe('neuroscience')
    expect(planResearch('Cómo funciona el hipotálamo bajo estrés').domain).toBe('neuroscience')
    expect(planResearch('Hola ¿qué tal?').domain).toBe('general')
    const stress = planResearch('fisiología del estrés a nivel cerebral')
    expect(stress.candidates.map(source => source.host))
      .toEqual(['europepmc.org', 'ncbi.nlm.nih.gov'])
    expect(stress.totalBatches).toBe(2)
    expect(planResearch('Cualquier pregunta sin palabras clave').domain).toBe('general')
  })

  it('compacts a long APEX clinical case rather than failing before searching', () => {
    const question = [
      'Informe clínico académico profundo de caso simulado: paciente varón de 67 años, 82 kg,',
      'DM2, HTA, FEVI 28%, creatinina 1.8 mg/dL y tratamiento de insuficiencia cardíaca.',
      'Comparar guías ACC/AHA/HFSA y ESC de 2022 a 2026, ensayos HFrEF ARNI SGLT2 y CKD-EPI.',
      'Analizar evidencia, farmacología, cálculos y calidad de las fuentes originales.',
      'No incluir datos del expediente clínico ni abrir perfiles de pacientes.',
      'Completar bibliografía, tablas, alternativas, metodología, limitaciones.',
    ].join(' '.repeat(1)) + ' Verificar evidencia publicada y las contraindicaciones.'.repeat(20)
    expect(question.length).toBeGreaterThan(500)
    const compact = researchQuestionForTool(question)
    expect(compact.length).toBeLessThanOrEqual(500)
    expect(compact).toContain('67')
    expect(compact).toContain('2022')
    expect(compact).toContain('ACC/AHA/HFSA')
    expect(planResearch(compact, 'medicine').queries.length).toBeGreaterThan(0)
    expect(researchQuestionForTool('Dengue República Dominicana')).toBe('Dengue República Dominicana')
    expect(() => researchQuestionForTool('   ')).toThrow('3–500')
    expect(() => researchQuestionForTool('x'.repeat(30_001))).toThrow('30000')
  })

  it('keeps a general recall query and limits authority-scoped search to two hosts', () => {
    const plan = planResearch('dólar en República Dominicana')
    expect(plan.queries[0]).toBe('dólar en República Dominicana')
    expect(plan.queries).toHaveLength(3)
    expect(plan.queries[1]).toContain('site:bancentral.gov.do')
    expect(plan.queries[2]).toContain('site:ecb.europa.eu')
    expect(RESEARCH_SOURCES.fx).toHaveLength(3)
    expect(planResearch('extraordinary custom topic', 'general').queries).toHaveLength(3)
  })

  it('rejects unregistered domains and unbounded question strings', () => {
    expect(() => planResearch('some question', 'unknown-domain')).toThrow('unknown domain')
    expect(() => planResearch('  ')).toThrow('3–500')
    expect(() => planResearch('x'.repeat(501))).toThrow('3–500')
  })

  it('keeps independently successful results when another search fails and deduplicates tracking URLs', async () => {
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query.includes('site:ecb')) throw new Error('provider unavailable')
      return {
        truncated: false,
        sources: [
          { url: 'https://example.org/study?utm_source=one', title: 'Dólar USD tipo de cambio en República Dominicana' },
          { url: 'https://example.org/study?utm_source=two', title: 'Duplicado del dólar' },
        ],
      }
    })
    const ctx = { web: { search } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(ctx, planResearch('dólar en República Dominicana'), 8, signal)
    expect(result.status).toBe('partial')
    expect(result.failedQueries).toHaveLength(1)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.title).toContain('Dólar USD')
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('never invents sources for empty results and throws when every provider call fails', async () => {
    const empty = { web: { search: async () => ({ sources: [], truncated: false }) } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(empty, planResearch('ordinary unanswered question'), 8, signal)
    expect(result.status).toBe('empty')
    expect(result.sources).toEqual([])
    const broken = { web: { search: async () => { throw new Error('offline') } } } as unknown as Pick<Context, 'web'>
    const blocked = await executeResearch(broken, planResearch('ordinary unanswered question'), 8, signal)
    expect(blocked.status).toBe('empty')
    expect(blocked.sources).toEqual([])
    expect(blocked.failedQueries).toHaveLength(blocked.queries.length)
    expect(blocked.note).toContain('CAPTCHA')
  })

  it('caps merged sources and reports truncation', async () => {
    const ctx = { web: { search: async () => ({
      truncated: false,
      sources: [
        { url: 'https://a.test/general-topic', title: 'General topic overview' },
        { url: 'https://b.test/general-topic', title: 'General topic comparisons' },
        { url: 'https://c.test/general-topic', title: 'General topic research' },
      ],
    }) } } as unknown as Pick<Context, 'web'>
    const outcome = await executeResearch(ctx, planResearch('general topic', 'general'), 2, signal)
    expect(outcome.sources).toHaveLength(2)
    expect(outcome.truncated).toBe(true)
  })
  it('splits Dominican public-health evidence across all eight institutional hosts', () => {
    const question = 'APS y cobertura efectiva 2015–2025 República Dominicana'
    const batches = [0, 1, 2, 3].map(batch => planResearch(question, undefined, batch))
    expect(batches.every(plan => plan.domain === 'public_health')).toBe(true)
    expect(batches.every(plan => plan.totalBatches === 4)).toBe(true)
    expect(batches.map(plan => plan.candidates.map(host => host.host))).toEqual([
      ['paho.org', 'worldbank.org'],
      ['one.gob.do', 'msp.gob.do'],
      ['sns.gob.do', 'sisalril.gob.do'],
      ['who.int', 'datos.bancomundial.org'],
    ])
    expect(batches[0]?.queries).toHaveLength(3)
    expect(batches[1]?.queries).toHaveLength(2)
    expect(batches[1]?.queries[0]).toContain('site:one.gob.do')
    expect(batches[0]?.queries[2]).toContain('2015 2025')
    expect(() => planResearch(question, 'public_health', 4)).toThrow(/batch/u)
    expect(() => planResearch(question, 'public_health', -1)).toThrow(/batch/u)
  })

  it('drops irrelevant health search hits and preserves traceable Dominican evidence', async () => {
    const search = vi.fn(async () => ({
      truncated: false,
      sources: [
        { url: 'https://example.com/sports', title: 'Football league standings' },
        { url: 'https://www.paho.org/es/documentos/republica-dominicana-salud',
          title: 'República Dominicana atención primaria y cobertura', snippet: 'Indicadores de salud' },
        { url: 'https://www.paho.org/es/documentos/republica-dominicana-salud?utm_source=news',
          title: 'Duplicate official record' },
      ],
    }))
    const ctx = { web: { search } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(ctx, planResearch('APS en República Dominicana'), 8, signal)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.url).toBe('https://www.paho.org/es/documentos/republica-dominicana-salud')
    expect(result.offTopicDropped).toBeGreaterThan(0)
    expect(result.totalBatches).toBe(4)
  })

})

describe('Dengue research route is not confused with HealthIA patient records', () => {
  it('uses DIGEPI and PAHO as the first sources without losing disease keywords', () => {
    const plan = planResearch('Pronóstico dengue República Dominicana 2026')
    expect(plan.domain).toBe('public_health')
    expect(plan.candidates.map(x => x.host)).toEqual(['epidemiologia.gob.do', 'paho.org'])
    expect(plan.queries.some(q => q.includes('site:epidemiologia.gob.do') && q.includes('dengue'))).toBe(true)
    expect(plan.queries.some(q => q.includes('sistema de salud'))).toBe(false)
  })

  it('rejects irrelevant search results but accepts dengue-specific RD bulletin', async () => {
    const plan = planResearch('Tendencia dengue República Dominicana 2026')
    const ctx = { web: { search: async () => ({ sources: [
      { url: 'https://example.com/cinema', title: 'It (2017 film)' },
      { url: 'https://www.epidemiologia.gob.do/dengue-2026', title: 'Dengue vigilancia semana 41',
        snippet: 'Casos notificados en República Dominicana' },
    ], truncated: false }) } } as unknown as Pick<Context,'web'>
    const outcome = await executeResearch(ctx, plan, 6, signal)
    expect(outcome.sources).toHaveLength(1)
    expect(outcome.sources[0]?.url).toContain('epidemiologia.gob.do')
  })
})

// Generic research must enforce the user's subject even outside clinical topics.
describe('universal topic integrity and ranking', () => {
  it('rejects film It results for Artemis II and keeps only correctly named launch evidence', async () => {
    const plan = planResearch('¿Artemis II habrá despegado en 2026?', 'general')
    const ctx = { web: { search: async () => ({ truncated: false, sources: [
      { url: 'https://movies.example/it', title: 'It (2017) film' },
      { url: 'https://www.nasa.gov/artemis-iii', title: 'Artemis III future mission' },
      { url: 'https://www.nasa.gov/artemis-ii', title: 'NASA Artemis II launch schedule' },
    ] }) } } as unknown as Pick<Context,'web'>
    const answer = await executeResearch(ctx, plan, 8, signal)
    expect(answer.sources.map(s => s.url)).toEqual(['https://www.nasa.gov/artemis-ii'])
    expect(answer.offTopicDropped).toBe(2)
  })

  it('rejects wrong-country dengue even if a source is medically relevant', async () => {
    const plan = planResearch('Dengue República Dominicana 2026', 'public_health')
    const ctx = { web: { search: async () => ({ truncated: false, sources: [
      { url: 'https://example.mx/dengue', title: 'Dengue casos en México' },
      { url: 'https://epidemiologia.gob.do/dengue', title: 'Dengue vigilancia epidemiológica' },
    ] }) } } as unknown as Pick<Context,'web'>
    const report = await executeResearch(ctx, plan, 8, signal)
    expect(report.sources).toHaveLength(1)
    expect(report.offTopicDropped).toBe(1)
  })

  it('returns empty, not ok, when all search hits are off topic', async () => {
    const plan = planResearch('Inter Miami vs Charlotte 2026', 'sports')
    const ctx = { web: { search: async () => ({
      truncated: false, sources: [{ url: 'https://example.com/pizza', title: 'Pizza recipe' }],
    }) } } as unknown as Pick<Context,'web'>
    const report = await executeResearch(ctx, plan, 5, signal)
    expect(report.status).toBe('empty')
    expect(report.sources).toEqual([])
    expect(report.note).toContain('Ningún resultado')
  })
})
