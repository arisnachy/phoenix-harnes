import { describe, expect, it, vi } from 'vitest'
import { createResearchSourceVerifierTool, verifyResearchSources } from '../src/research-source-verifier.ts'

describe('Scholarly source verification from actual provider metadata', () => {
  const verifiedTitle = 'Neuropsychology and cognition in modern clinical practice'
  it('distinguishes a verified identifier and title from absence of retraction alerts', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('api.crossref.org/works/')
      return { ok: true, text: async () => JSON.stringify({
        message: { DOI: '10.1000/test.1', title: [verifiedTitle], 'updated-by': [] },
      }) }
    }) as unknown as typeof fetch
    const audited = await verifyResearchSources([{
      key: 'ref01', title: verifiedTitle, doi: '10.1000/test.1',
    }], fetcher)
    expect(audited.state).toBe('AUDITED')
    expect(audited.sources[0]).toMatchObject({
      status: 'verified_metadata', retraction: 'no_flag_found', checked: ['Crossref'],
    })
    expect(audited.sources[0]?.warnings.join(' ')).toContain('no demuestra ausencia')
  })
  it('flags a Crossref Retraction Watch update even when metadata matches', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({
      message: { DOI: '10.1000/test.1', title: [verifiedTitle],
        'updated-by': [{ type: 'retraction', source: 'retraction-watch' }] },
    }) })) as unknown as typeof fetch
    const result = await verifyResearchSources([{ key: 'ref01', title: verifiedTitle, doi: '10.1000/test.1' }], fetcher)
    expect(result.state).toBe('PARTIAL')
    expect(result.sources[0]?.retraction).toBe('flagged')
  })
  it('cross-checks a PMID in Europe PMC independently of DOI', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({
      resultList: { result: [{ id: '12345678', title: verifiedTitle, isRetracted: true }] },
    }) })) as unknown as typeof fetch
    const result = await verifyResearchSources([{ key: 'pmc', title: verifiedTitle, pmid: '12345678' }], fetcher)
    expect(result.sources[0]).toMatchObject({
      status: 'verified_metadata', retraction: 'flagged', checked: ['Europe PMC'],
    })
  })
  it('fails closed on missing DOI, invalid keys, network outages and mismatched titles', async () => {
    const broken = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const result = await verifyResearchSources([{ key: 'ref', title: verifiedTitle, doi: '10.1000/test.1' }], broken)
    expect(result.sources[0]?.status).toBe('unverified')
    expect(result.sources[0]?.retraction).toBe('not_checked')
    await expect(verifyResearchSources([{ key: 'bad', title: verifiedTitle, pmid: '123-456' }], broken)).rejects.toThrow()
    const mismatched = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({
      message: { DOI: '10.1000/test.1', title: ['A completely different paper about trees'] },
    }) })) as unknown as typeof fetch
    const checked = await verifyResearchSources([{ key: 'ref', title: verifiedTitle, doi: '10.1000/test.1' }], mismatched)
    expect(checked.sources[0]?.status).toBe('mismatch')
    expect(createResearchSourceVerifierTool().name).toBe('phoenix_research_verify_sources')
  })
})
