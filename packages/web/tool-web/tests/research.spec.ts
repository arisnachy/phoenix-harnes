import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@phoenix-ai/cordis'
import { executeResearch, planResearch, RESEARCH_SOURCES } from '../src/research.ts'

const signal = new AbortController().signal

describe('Phoenix universal research routing', () => {
  it('detects specialized domains including sports, foreign exchange, and biomedical science', () => {
    expect(planResearch('¿A cuánto está el dólar en República Dominicana?').domain).toBe('fx')
    expect(planResearch('¿Cómo quedó el partido del Real Madrid?').domain).toBe('sports')
    expect(planResearch('Nuevos ensayos de alzhéimer en pacientes').domain).toBe('neuroscience')
    expect(planResearch('Cualquier pregunta sin palabras clave').domain).toBe('general')
  })

  it('keeps a general recall query and limits authority-scoped search to two hosts', () => {
    const plan = planResearch('dólar en República Dominicana')
    expect(plan.queries[0]).toBe('dólar en República Dominicana')
    expect(plan.queries).toHaveLength(3)
    expect(plan.queries[1]).toContain('site:bancentral.gov.do')
    expect(plan.queries[2]).toContain('site:ecb.europa.eu')
    expect(RESEARCH_SOURCES.fx).toHaveLength(3)
    expect(planResearch('extraordinary custom topic', 'general').queries).toHaveLength(1)
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
          { url: 'https://example.org/study?utm_source=one', title: 'Evidence' },
          { url: 'https://example.org/study?utm_source=two', title: 'Duplicate' },
        ],
      }
    })
    const ctx = { web: { search } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(ctx, planResearch('dólar en República Dominicana'), 8, signal)
    expect(result.status).toBe('partial')
    expect(result.failedQueries).toHaveLength(1)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.title).toBe('Evidence')
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('never invents sources for empty results and throws when every provider call fails', async () => {
    const empty = { web: { search: async () => ({ sources: [], truncated: false }) } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(empty, planResearch('ordinary unanswered question'), 8, signal)
    expect(result.status).toBe('empty')
    expect(result.sources).toEqual([])
    const broken = { web: { search: async () => { throw new Error('offline') } } } as unknown as Pick<Context, 'web'>
    await expect(executeResearch(broken, planResearch('ordinary unanswered question'), 8, signal))
      .rejects.toThrow('No search provider succeeded')
  })

  it('caps merged sources and reports truncation', async () => {
    const ctx = { web: { search: async () => ({
      truncated: false,
      sources: [{ url: 'https://a.test/' }, { url: 'https://b.test/' }, { url: 'https://c.test/' }],
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
