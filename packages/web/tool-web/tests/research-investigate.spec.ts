import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@phoenix-ai/cordis'
import { assessResearchRelevance, conciseResearchQuery, readableResearchExcerpt,
  isBlockedResearchBody } from '../src/research-relevance.ts'
import { investigateResearch } from '../src/research-investigate.ts'
import { planResearch, executeResearch } from '../src/research.ts'

const signal = new AbortController().signal
const nasaText = 'NASA confirms Artemis II mission: the crew launch requires technical reviews and a scheduled launch window. '.repeat(5)
const nasaLead = { url: 'https://www.nasa.gov/artemis-ii', title: 'NASA Artemis II mission and launch schedule',
  snippet: 'Artemis II astronauts and mission status' }

function webFixture(sources: Array<{ url: string; title: string; snippet?: string }>,
  fetcher: (url: string) => Promise<{ url: string; statusCode: number;
    body: { kind: 'text' | 'html'; content: string }; truncated: boolean }>) {
  const search = vi.fn(async () => ({ sources, truncated: false }))
  const fetch = vi.fn(async ({ url }: { url: string }) => fetcher(url))
  const ctx = { web: { search, fetch } } as unknown as Pick<Context,'web'>
  return { ctx, search, fetch }
}

describe('universal search relevance', () => {
  it('protects named mission designations against irrelevant films and other mission versions', () => {
    const question = '¿La misión Artemis II habrá sido lanzada antes de diciembre de 2026?'
    expect(assessResearchRelevance(question, nasaLead).relevant).toBe(true)
    expect(assessResearchRelevance(question,
      { url: 'https://en.wikipedia.org/wiki/It_(2017_film)', title: 'It (2017 film)' }).relevant).toBe(false)
    expect(assessResearchRelevance(question,
      { url: 'https://www.nasa.gov/artemis-iii', title: 'Artemis III news and flight' }).reason).toBe('wrong_entity')
  })

  it('distinguishes country and recognizes public-health synonyms without shifting topic', () => {
    const question = 'Atención primaria APS en República Dominicana'
    expect(assessResearchRelevance(question, { url: 'https://www.paho.org/es/aps',
      title: 'Atención primaria de salud en República Dominicana' }).relevant).toBe(true)
    expect(assessResearchRelevance('Dengue República Dominicana', {
      url: 'https://example.com/dengue-mexico', title: 'Dengue en México',
    }).reason).toBe('wrong_geography')
    expect(assessResearchRelevance('Dengue República Dominicana', {
      url: 'https://epidemiologia.gob.do/dengue', title: 'Boletín de dengue semanal',
    }).relevant).toBe(true)
  })

  it('keeps essential terms in concise cross-language search', () => {
    expect(conciseResearchQuery('¿Cuál será la incidencia de dengue en República Dominicana durante 2027?'))
      .toContain('dengue')
    expect(conciseResearchQuery('¿Cuál será la incidencia de dengue en República Dominicana durante 2027?'))
      .toContain('República Dominicana')
    expect(isBlockedResearchBody('<html><title>Just a moment...</title><div>Wait</div></html>')).toBe(true)
    expect(readableResearchExcerpt('<html><script>SECRET</script><p>Dengue&#237;</p></html>', 'html'))
      .toBe('Dengu eí'.replace(' ', ''))
  })
})

describe('end-to-end autonomous investigation contract', () => {
  it('reads the NASA article and excludes film results; evidence comes from a real fetch response', async () => {
    const { ctx, fetch } = webFixture([
      { url: 'https://movies.example/it', title: 'It (2017) film' },
      nasaLead,
    ], async url => ({ url, statusCode: 200, body: { kind: 'text', content: nasaText }, truncated: false }))
    const report = await investigateResearch(ctx,
      { question: '¿Se lanzará Artemis II antes de diciembre 2026?', depth: 'standard' },
      signal, planResearch, executeResearch)
    expect(report.batchesSearched).toBe(1)
    expect(report.offTopicDropped).toBeGreaterThan(0)
    expect(report.readRelevantCount).toBe(1)
    expect(report.sources[0]?.excerpt).toContain('Artemis II')
    expect(report.evidenceStatus).toBe('retrieved_unverified')
    expect(fetch).toHaveBeenCalledOnce()
    expect(report.sources.every(s => !s.url.includes('movies.example'))).toBe(true)
  })

  it('does not count an HTTP-200 CAPTCHA as read evidence', async () => {
    const { ctx } = webFixture([nasaLead], async url => ({
      url, statusCode: 200, body: { kind: 'html',
        content: '<html><title>Just a moment...</title><h1>Checking your browser</h1></html>' },
      truncated: false,
    }))
    const report = await investigateResearch(ctx, { question: 'Artemis II launch schedule' },
      signal, planResearch, executeResearch)
    expect(report.readRelevantCount).toBe(0)
    expect(report.challengesCount).toBe(1)
    expect(report.evidenceStatus).toBe('search_results_only')
    expect(report.sources[0]?.excerpt).toBeUndefined()
  })

  it('rejects a matching URL when the retrieved body is about an unrelated subject', async () => {
    const { ctx } = webFixture([nasaLead], async url => ({
      url, statusCode: 200, body: { kind: 'text',
        content: 'This page describes Italian pasta, fine dining, pizza recipes and tomato sauces. '.repeat(5) },
      truncated: false,
    }))
    const report = await investigateResearch(ctx, { question: 'Artemis II launch schedule' },
      signal, planResearch, executeResearch)
    expect(report.readRelevantCount).toBe(0)
    expect(report.sources[0]?.status).toBe('read_off_topic')
  })

  it('does not fetch or fabricate results if every free search hit is off-topic', async () => {
    const { ctx, fetch } = webFixture([{ url: 'https://movies.example/it', title: 'It movie review' }],
      async url => ({ url, statusCode: 200, body: { kind: 'text', content: nasaText }, truncated: false }))
    const report = await investigateResearch(ctx, { question: 'Artemis II NASA mission 2026' },
      signal, planResearch, executeResearch)
    expect(report.sources).toEqual([])
    expect(report.evidenceStatus).toBe('no_evidence')
    expect(report.nextActions.some(t => t.includes('fuentes oficiales'))).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains explicit blocked access and independently searches additional batches in deep mode', async () => {
    const question = 'Dengue República Dominicana 2026'
    const { ctx, search } = webFixture([
      { url: 'https://epidemiologia.gob.do/dengue', title: 'Dengue boletín epidemiológico' },
    ], async url => { throw new Error('WEB_ROBOTS_DISALLOWED: forbidden ' + url) })
    const report = await investigateResearch(ctx, { question, depth: 'deep' },
      signal, planResearch, executeResearch)
    expect(report.batchesSearched).toBe(3)
    expect(search).toHaveBeenCalled()
    expect(report.sources[0]?.status).toBe('challenge')
    expect(report.readRelevantCount).toBe(0)
  })
})

describe('multilingual topic preservation', () => {
  it('accepts Mandarin subject overlaps rather than erasing non-Latin script', () => {
    const score = assessResearchRelevance('中国经济增速走势', {
      url: 'https://example.org/china-economy',
      title: '中国经济发展趋势与增长',
    })
    expect(score.relevant).toBe(true)
    expect(score.score).toBeGreaterThan(0)
  })
})

describe('multiple-entity precision in research', () => {
  it('does not confuse Charlotte-only results with an Inter Miami vs Charlotte comparison', () => {
    const q = 'Inter Miami vs Charlotte 2026'
    expect(assessResearchRelevance(q, {
      url: 'https://example.com/charlotte', title: 'Charlotte city guide',
    }).relevant).toBe(false)
    expect(assessResearchRelevance(q, {
      url: 'https://mlssoccer.com/clubs/inter-miami', title: 'Inter Miami match preview',
    }).relevant).toBe(true)
    expect(assessResearchRelevance(q, {
      url: 'https://example.com/matches', title: 'Inter Miami vs Charlotte match analysis',
    }).relevant).toBe(true)
  })
})

describe('adaptive evidence acquisition rather than fixed top-three fetches', () => {
  const quote1 = 'Artemis II NASA launch planning identifies the crew mission and scheduled review process. '.repeat(6)
  const quote2 = 'Artemis II mission launch dates are described alongside astronaut assignments and safety review. '.repeat(6)

  it('replaces blocked sources without revisiting the blocked host and retrieves two independent documents', async () => {
    const first = { url: 'https://www.nasa.gov/artemis-ii', title: 'NASA Artemis II official launch' }
    const blockedMirror = { url: 'https://www.nasa.gov/artemis-ii/update', title: 'NASA Artemis II official update' }
    const second = { url: 'https://www.esa.int/artemis-ii', title: 'ESA Artemis II international mission' }
    const third = { url: 'https://science.nature.com/artemis-ii', title: 'Artemis II launch planning report' }
    const calls: string[] = []
    const { ctx } = webFixture([first, blockedMirror, second, third], async url => {
      calls.push(url)
      if (url.includes('nasa.gov')) return { url, statusCode: 403,
        body: { kind: 'text', content: 'Forbidden' }, truncated: false }
      return { url, statusCode: 200, body: { kind: 'text',
        content: url.includes('esa.int') ? quote1 : quote2 }, truncated: false }
    })
    const report = await investigateResearch(ctx, {
      question: 'Artemis II launch status 2026',
    }, signal, planResearch, executeResearch)
    expect(report.readRelevantCount).toBe(2)
    expect(report.independentReadCount).toBe(2)
    expect(report.challengesCount).toBe(1)
    expect(calls.filter(url => url.includes('nasa.gov'))).toHaveLength(1)
    expect(report.sources.filter(row => row.status === 'read_relevant').every(row =>
      row.quote !== undefined && row.excerpt?.includes(row.quote) === true
        && row.contentSha256?.length === 64)).toBe(true)
  })

  it('does not count word-for-word mirrored pages as two independent corroborating sources', async () => {
    const text = 'Artemis II mission launch reviews are planned and documented by a public source. '.repeat(6)
    const { ctx } = webFixture([
      { url: 'https://alpha.example/artemis-ii', title: 'Artemis II source one' },
      { url: 'https://beta.example/artemis-ii', title: 'Artemis II source two' },
    ], async url => ({ url, statusCode: 200, body: { kind: 'text', content: text }, truncated: false }))
    const report = await investigateResearch(ctx, { question: 'Artemis II launch plans' },
      signal, planResearch, executeResearch)
    expect(report.readRelevantCount).toBe(2)
    expect(report.independentReadCount).toBe(1)
    expect(report.duplicateContentCount).toBe(1)
    expect(report.limitations.some(line => line.includes('independientes'))).toBe(true)
  })

  it('widens institutional batches after blocked first-batch documents rather than ending at search results', async () => {
    const question = 'Dengue República Dominicana 2026'
    const search = vi.fn(async ({ query }: { query: string }) => ({
      truncated: false,
      sources: query.includes('crossref.org')
        ? [{ url: 'https://crossref.org/dengue-rd', title: 'Dengue en República Dominicana 2026' }]
        : [{ url: 'https://epidemiologia.gob.do/dengue-rd', title: 'Dengue República Dominicana 2026' }],
    }))
    const fetch = vi.fn(async ({ url }: { url: string }) => ({
      url, statusCode: url.includes('epidemiologia') ? 403 : 200,
      body: { kind: 'text' as const,
        content: 'Dengue en República Dominicana: reportes semanales de vigilancia epidemiológica. '.repeat(5) },
      truncated: false,
    }))
    const ctx = { web: { search, fetch } } as unknown as Pick<Context,'web'>
    const report = await investigateResearch(ctx, { question, depth: 'deep', domain: 'science' },
      signal, planResearch, executeResearch)
    expect(report.batchesSearched).toBeGreaterThan(1)
    expect(report.readRelevantCount).toBeGreaterThan(0)
  })
})

describe('independence and excerpt accuracy', () => {
  it('does not treat two institutional subdomains as independent owners', async () => {
    const fetcher = vi.fn(async ({ url }: { url: string }) => ({
      url, statusCode: 200, body: { kind: 'text' as const,
        content: url.includes('/report')
          ? 'Artemis II mission technical launch schedule and crew assignment report. '.repeat(7)
          : 'Artemis II astronauts are preparing for their launch date. '.repeat(8) },
      truncated: false,
    }))
    const ctx = { web: {
      search: async () => ({ truncated: false, sources: [
        { url: 'https://www.nasa.gov/artemis-ii/report', title: 'Artemis II NASA mission report' },
        { url: 'https://science.nasa.gov/artemis-ii', title: 'Artemis II NASA science update' },
      ] }),
      fetch: fetcher,
    } } as unknown as Pick<Context,'web'>
    const result = await investigateResearch(ctx, { question: 'Artemis II launch schedule 2026' },
      signal, planResearch, executeResearch)
    expect(result.readRelevantCount).toBe(2)
    expect(result.independentReadCount).toBe(1)
    expect(result.duplicateContentCount).toBe(0)
    expect(result.limitations.some(line => line.includes('independientes'))).toBe(true)
  })

  it('selects a quote from the most relevant body window, not an irrelevant navigation prefix', async () => {
    const body = 'Artemis II navigation menu. ' + 'Menu pages and site information. '.repeat(75)
      + 'Artemis II mission launch schedule 2026 includes astronaut details and flight timeline. '.repeat(5)
    const { ctx } = webFixture([
      { url: 'https://www.nasa.gov/artemis-ii', title: 'NASA Artemis II schedule' },
    ], async url => ({ url, statusCode: 200, body: { kind: 'text', content: body }, truncated: false }))
    const result = await investigateResearch(ctx, { question: 'Artemis II mission launch schedule 2026' },
      signal, planResearch, executeResearch)
    const quote = result.sources[0]?.quote ?? ''
    expect(result.readRelevantCount).toBe(1)
    expect(quote).toContain('launch schedule')
    expect(body).toContain(quote)
  })
})
