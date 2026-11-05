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
