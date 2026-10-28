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

  it('never invents sources for empty results and reports when every provider call fails', async () => {
    const empty = { web: { search: async () => ({ sources: [], truncated: false }) } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(empty, planResearch('ordinary unanswered question'), 8, signal)
    expect(result.status).toBe('empty')
    expect(result.sources).toEqual([])
    const broken = { web: { search: async () => { throw new Error('offline') } } } as unknown as Pick<Context, 'web'>
    const unavailable = await executeResearch(broken, planResearch('ordinary unanswered question'), 8, signal)
    expect(unavailable.status).toBe('empty')
    expect(unavailable.failedQueries).toHaveLength(1)
    expect(unavailable.note).toContain('Do not repeat equivalent queries')
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
  it('routes thesis rules to institutional domains and shortens only scoped queries', () => {
    const plan = planResearch('¿Qué exigen las universidades para tesis de licenciatura maestría y doctorado sobre referencias bibliográficas?')
    expect(plan.domain).toBe('academic')
    expect(plan.queries).toHaveLength(3)
    expect(plan.queries[1]).toContain('site:edu')
    expect(plan.queries[2]).toContain('site:ac.uk')
    expect(plan.queries[0]).toContain('¿Qué exigen')
    expect(plan.queries[1]).not.toContain('¿Qué exigen')
  })

  it('offers opt-in deep multi-region academic discovery without slowing the default plan', () => {
    const question = 'Requisitos de referencias bibliográficas para tesis de doctorado'
    const quick = planResearch(question)
    const deep = planResearch(question, undefined, 'deep')
    expect(quick.queries).toHaveLength(3)
    expect(deep.queries).toHaveLength(5)
    expect(deep.queries[3]).toContain('site:edu.do')
    expect(deep.queries[4]).toContain('site:edu.mx')
    expect(() => planResearch(question, undefined, 'unbounded')).toThrow('depth must be quick or deep')
  })

  it('keeps deep research useful when some institutional domains are unavailable', async () => {
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query.includes('site:edu.mx')) throw new Error('regional provider offline')
      return {
        sources: [{
          url: 'https://university.edu.do/doctorado/referencias',
          title: 'Doctorado — reglas de referencias',
        }],
        truncated: false,
      }
    })
    const ctx = { web: { search } } as unknown as Pick<Context, 'web'>
    const plan = planResearch('Normas de referencias de tesis de doctorado', 'academic', 'deep')
    const result = await executeResearch(ctx, plan, 8, signal)
    expect(search).toHaveBeenCalledTimes(5)
    expect(result.status).toBe('partial')
    expect(result.sources).toHaveLength(1)
    expect(result.failedQueries).toEqual([plan.queries[4]])
  })

  it('rejects irrelevant academic search hits without inventing sources', async () => {
    const ctx = { web: { search: async () => ({
      truncated: false,
      sources: [
        { url: 'https://example.net/sports', title: 'Tonight sports score' },
        { url: 'https://grad.university.edu/thesis-guidelines', title: 'Thesis preparation guide' },
      ],
    }) } } as unknown as Pick<Context, 'web'>
    const result = await executeResearch(ctx, planResearch('tesis maestría doctorado'), 8, signal)
    expect(result.status).toBe('ok')
    expect(result.sources.map(source => source.title)).toEqual(['Thesis preparation guide'])
  })
})
