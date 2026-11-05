import { describe, expect, it, vi } from 'vitest'
import type { WebRuntime } from '@phoenix-ai/dsh-web'
import { investigateEvidence, planEvidenceQueries, researchFocus, scoreResearchLead } from '../src/investigate.ts'

const makeWeb = (sources: Array<{url:string;title:string;snippet?:string}>, content: Record<string,string>) => {
  const search = vi.fn(async () => ({ sources, truncated: false }))
  const fetch = vi.fn(async ({url}: {url:string}) => {
    const body = content[url]
    return body === undefined
      ? { url, statusCode: 403, body: {kind:'text' as const,content:'Access denied'}, truncated:false }
      : { url, statusCode: 200, body: {kind:'html' as const,content:body}, truncated:false }
  })
  return {web:{search,fetch} as unknown as Pick<WebRuntime,'search'|'fetch'>,search,fetch}
}
const article = (title:string,body:string) => '<html><title>'+title+'</title><main><p>'+body.repeat(5)+'</p></main></html>'

describe('Universal Evidence Research', () => {
  it('preserves unique topics while removing generic conversational padding',()=>{
    expect(researchFocus('¿La misión Artemis II será lanzada antes del año 2026?')).toContain('artemis')
    expect(researchFocus('¿Qué pronóstico de dengue República Dominicana 2026?')).toContain('dengue')
    expect(planEvidenceQueries('¿Dengue República Dominicana 2026?')[0]).toContain('dengue')
    expect(planEvidenceQueries('¿Dengue República Dominicana 2026?').length).toBeLessThanOrEqual(3)
  })
  it('rejects 2017 It film as evidence of Artemis II, and reads NASA source', async()=>{
    const nasa='https://www.nasa.gov/artemis-ii-mission'
    const movie='https://example.com/it-2017-film'
    const {web,search,fetch}=makeWeb([
      {url:movie,title:'It movie 2017 film',snippet:'Stephen King television trailer'},
      {url:nasa,title:'Artemis II NASA mission launch plan',snippet:'NASA Artemis II mission schedule'},
    ],{
      [nasa]:article('Artemis II mission', 'NASA Artemis II mission spacecraft and crew schedule. '),
    })
    const r=await investigateEvidence(web,'¿La misión Artemis II será lanzada antes del 31 de diciembre de 2026?')
    expect(r.status).toBe('evidence_retrieved')
    expect(r.leads).toHaveLength(1)
    expect(r.leads[0]?.url).toBe(nasa)
    expect(r.documents).toHaveLength(1)
    expect(r.documents[0]?.excerpt).toContain('Artemis II')
    expect(r.documents[0]?.verification).toBe('retrieved_unverified')
    expect(r.rejectedSearchHits).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(search.mock.calls.length).toBeLessThanOrEqual(3)
  })
  it('does not elevate a promising search title when fetched content is unrelated',async()=>{
    const url='https://example.org/space-info'
    const {web}=makeWeb([{url,title:'Artemis II NASA mission' }],{
      [url]:article('Sports entertainment', 'This article describes tennis league rankings and match statistics. '),
    })
    const r=await investigateEvidence(web,'Artemis II NASA mission launch')
    expect(r.status).toBe('leads_only')
    expect(r.documents).toHaveLength(0)
    expect(r.attempts[0]?.status).toBe('off_topic')
  })
  it('rejects 200 challenge page and keeps the original question',async()=>{
    const url='https://example.org/dengue'
    const {web}=makeWeb([{url,title:'Dengue República Dominicana boletín 2026'}],{
      [url]:'<html><title>Just a moment...</title><div class="cf-chl-widget">Please verify you are human</div></html>',
    })
    const q='Dengue República Dominicana vigilancia epidemiológica 2026'
    const r=await investigateEvidence(web,q)
    expect(r.question).toBe(q)
    expect(r.status).toBe('leads_only')
    expect(r.documents).toHaveLength(0)
    expect(r.attempts[0]?.status).toBe('blocked')
  })
  it('treats provider outage as a diagnosis, never as invented data',async()=>{
    const web={
      search:vi.fn(async()=>{throw new Error('captcha provider unavailable')}),
      fetch:vi.fn(),
    } as unknown as Pick<WebRuntime,'search'|'fetch'>
    const result=await investigateEvidence(web,'¿Cuál es el pronóstico de dengue en República Dominicana?')
    expect(result.status).toBe('blocked')
    expect(result.documents).toEqual([])
    expect(result.leads).toEqual([])
    expect(result.failedQueries.length).toBeGreaterThan(0)
    expect(result.queries.length).toBeLessThanOrEqual(3)
  })
  it('requires actual topic overlap and country for Dominican disease research',()=>{
    const q='Evolución dengue en República Dominicana 2026'
    expect(scoreResearchLead(q,{url:'https://example.com/it-film',title:'It (2017 film)'})).toBe(0)
    expect(scoreResearchLead(q,{url:'https://example.org/dengue',title:'Mexico dengue surveillance data 2026'})).toBe(0)
    expect(scoreResearchLead(q,{url:'https://epidemiologia.gob.do/boletin/dengue',
      title:'Dengue vigilancia epidemiológica semanal'})).toBeGreaterThan(0)
  })
  it('respects user cancellation without continuing to read websites',async()=>{
    const controller=new AbortController()
    controller.abort(new Error('cancelled'))
    const {web,search,fetch}=makeWeb([], {})
    await expect(investigateEvidence(web,'Dengue en República Dominicana 2026',undefined,controller.signal))
      .rejects.toThrow('cancelled')
    expect(search).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
