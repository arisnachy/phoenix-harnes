import { describe, expect, it, vi } from 'vitest'
import { projectFederatedRecords, searchFederatedScholar, createFederatedScholarTool } from '../src/federated-scholar.ts'
import { listResearchCatalog, RESEARCH_API_CATALOG } from '../src/research-source-catalog.ts'

const crossref = { message: { items: [
  { DOI: '10.1000/example', title: ['Study on diabetes'], author: [{ given: 'Ana', family: 'Doe' }],
    published: { 'date-parts': [[2025, 3, 2]] }, 'container-title': ['Journal A'] },
] } }
const openalex = { results: [
  { doi: 'https://doi.org/10.1000/example', title: 'Study on diabetes',
    publication_year: 2025, authorships: [{ author: { display_name: 'Ana Doe' } }] },
] }
describe('Public federated scholarly search', () => {
  it('keeps a 100-source catalog but excludes key-only and uncertain entries from automatic anonymous mode', () => {
    expect(RESEARCH_API_CATALOG).toHaveLength(100)
    const anonymous = listResearchCatalog('', 'anonymous', 100)
    expect(anonymous.sources.every(s => s.access === 'none' || s.access === 'none_limited')).toBe(true)
    expect(listResearchCatalog('medicina', 'all', 100).matched).toBeGreaterThan(0)
    expect(() => listResearchCatalog('', 'all', 101)).toThrow()
  })
  it('projects only genuine provider DOI/title records', () => {
    expect(projectFederatedRecords('crossref', crossref)[0]).toMatchObject({
      doi: '10.1000/example', title: 'Study on diabetes', year: '2025', authors: 'Ana Doe',
    })
    expect(projectFederatedRecords('crossref', { message: { items: [{ title: ['Unknown'] }] } })).toEqual([])
  })
  it('deduplicates articles across independent providers and reports sources', async () => {
    const fetcher = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url))
      if (u.hostname === 'api.crossref.org') return new Response(JSON.stringify(crossref))
      if (u.hostname === 'api.openalex.org') return new Response(JSON.stringify(openalex))
      throw new Error('Unexpected host')
    }) as unknown as typeof fetch
    const result = await searchFederatedScholar('diabetes evidence', ['crossref', 'openalex'], 5, undefined, fetcher)
    expect(result.state).toBe('ok')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.providers).toEqual(['Crossref', 'OpenAlex'])
    expect(result.sources).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('returns partial metadata on provider outage without inventing missing results', async () => {
    const fetcher = vi.fn(async (url: string | URL) => {
      if (String(url).includes('crossref')) return new Response(JSON.stringify(crossref))
      return new Response('', { status: 429 })
    }) as unknown as typeof fetch
    const r = await searchFederatedScholar('diabetes evidence', ['crossref', 'datacite'], 5, undefined, fetcher)
    expect(r.state).toBe('partial')
    expect(r.records).toHaveLength(1)
    expect(r.sources[1]).toMatchObject({ id: 'datacite', state: 'unavailable', error: 'HTTP 429' })
  })
  it('does not follow redirects and enforces invalid query/limit bounds', async () => {
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return new Response('', { status: 301 })
    }) as unknown as typeof fetch
    const r = await searchFederatedScholar('example', ['crossref'], 3, undefined, fetcher)
    expect(r.state).toBe('unavailable')
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(searchFederatedScholar(' ', ['crossref'], 2, undefined, fetcher)).rejects.toThrow()
    await expect(searchFederatedScholar('example', ['crossref'], 20, undefined, fetcher)).rejects.toThrow()
    expect(createFederatedScholarTool().name).toBe('research_federated')
  })
})
