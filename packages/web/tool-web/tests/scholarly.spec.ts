import { describe, expect, it, vi } from 'vitest'
import { projectEuropePmcRecords, searchEuropePmc, createScholarlySearchTool } from '../src/scholarly.ts'

const provider = {
  resultList: { result: [
    { pmid: '12345678', doi: '10.1000/test.2026', title: 'Valid scientific record',
      authorString: 'Author A; Author B', pubYear: '2026', journalTitle: 'Research Journal',
      source: 'MED', firstPublicationDate: '2026-10-16', abstractText: '<h3>Summary</h3><p>Observed data</p>' },
    { pmid: '12345678', doi: '10.1000/test.2026', title: 'Duplicate',
      authorString: 'Author A', pubYear: '2026' },
    { id: 'X', title: 'Incomplete record', authorString: 'Unknown', pubYear: '2026' },
  ] },
}
describe('Europe PMC official scholarly metadata', () => {
  it('rejects duplicates and incomplete citations without inventing metadata', () => {
    const results = projectEuropePmcRecords(provider)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      key: 'pmid12345678', pmid: '12345678', doi: '10.1000/test.2026',
      title: 'Valid scientific record', year: '2026',
      url: 'https://doi.org/10.1000/test.2026',
    })
    expect(results[0]?.abstract).toContain('Observed data')
  })
  it('constructs a bounded official Europe PMC API query', async () => {
    const fetcher = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url))
      expect(parsed.host).toBe('www.ebi.ac.uk')
      expect(parsed.pathname).toBe('/europepmc/webservices/rest/search')
      expect(parsed.searchParams.get('format')).toBe('json')
      expect(parsed.searchParams.get('pageSize')).toBe('3')
      return new Response(JSON.stringify(provider), { status: 200 })
    }) as unknown as typeof fetch
    const response = await searchEuropePmc('Alzheimer 2026', 3, undefined, fetcher)
    expect(response.state).toBe('ok')
    expect(response.records[0]?.key).toBe('pmid12345678')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('reports genuine provider unavailability instead of fabricated articles', async () => {
    const fail = vi.fn(async () => { throw new Error('connection unavailable') }) as unknown as typeof fetch
    const response = await searchEuropePmc('Alzheimer', 2, undefined, fail)
    expect(response.state).toBe('unavailable')
    expect(response.records).toEqual([])
    await expect(searchEuropePmc('', 20)).rejects.toThrow()
  })
  it('provides a model-facing research tool', () => {
    const tool = createScholarlySearchTool()
    expect(tool.name).toBe('research_scholar')
    expect(tool.timeoutMs).toBeGreaterThan(10000)
  })
})
