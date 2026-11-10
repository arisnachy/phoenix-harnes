import {describe,it,expect,vi} from 'vitest'
import {Context} from '@phoenix-ai/cordis'
import {
  SPORTS_API_PROVIDERS,sportsApiKeyStates,saveSportsApiKey,
  removeSportsApiKey,verifySportsApiKey,
} from '../src/sports-api-connectors.ts'

const newVault=()=>{
  const entries=new Map<string,string>()
  const vault={
    describe:vi.fn(async(ref:string)=>({configured:entries.has(ref),writable:true,
      ...(entries.has(ref)?{source:'file'}:{})})),
    resolve:vi.fn(async(ref:string)=>entries.has(ref)?{value:entries.get(ref)!}:undefined),
    set:vi.fn(async(ref:string,value:string)=>{entries.set(ref,value)}),
    unset:vi.fn(async(ref:string)=>{entries.delete(ref)}),
  }
  const ctx=new Context()
  ;(ctx as unknown as {provide(name:string,value:unknown):void}).provide('credentials',vault)
  return{ctx,vault,entries}
}
describe('sports connectors secure Ask handoff and Host vault',()=>{
  it('reports missing credentials without reading or transmitting any values',async()=>{
    const {ctx,vault}=newVault()
    const rows=await sportsApiKeyStates(ctx)
    expect(rows).toHaveLength(SPORTS_API_PROVIDERS.length)
    expect(rows.every(row=>row.status==='missing-key'&&row.configured===false)).toBe(true)
    expect(vault.resolve).not.toHaveBeenCalled()
    expect(JSON.stringify(rows)).not.toMatch(/apiKey|password|secret/i)
  })
  it('allows one owner input and resolves it in the Host vault only',async()=>{
    const {ctx,entries}=newVault()
    const key='therundown_test_12345678901234'
    const saved=await saveSportsApiKey(ctx,'THERUNDOWN_API_KEY',key,vi.fn())
    expect(entries.get('THERUNDOWN_API_KEY')).toBe(key)
    expect(saved).toMatchObject({configured:true,source:'vault',
      status:'configured-unverified',verified:false})
    expect(JSON.stringify(saved)).not.toContain(key)
    const rows=await sportsApiKeyStates(ctx)
    expect(rows.find(x=>x.id==='THERUNDOWN_API_KEY')?.configured).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(key)
    const removed=await removeSportsApiKey(ctx,'THERUNDOWN_API_KEY')
    expect(removed.status).toBe('missing-key')
    expect(entries.has('THERUNDOWN_API_KEY')).toBe(false)
  })
  it('does not admit arbitrary env names, malformed secrets or unreadable vault',async()=>{
    const {ctx,entries}=newVault()
    await expect(saveSportsApiKey(ctx,'PHOENIX_HACKER_KEY','somegoodkey')).rejects.toThrow('no admitido')
    await expect(saveSportsApiKey(ctx,'THERUNDOWN_API_KEY','any key with whitespace')).rejects.toThrow('inválido')
    expect(entries.size).toBe(0)
    await expect(removeSportsApiKey(ctx,'OTHER_PROVIDER')).rejects.toThrow('no admitido')
    const empty=await sportsApiKeyStates(new Context())
    expect(empty.every(row=>row.status==='vault-unavailable')).toBe(true)
  })
  it('preserves a valid key when new The Odds API key is rejected (HTTP 401)',async()=>{
    const {ctx,entries}=newVault()
    const old='abcdefabcdefabcdefabcdefabcdef12'
    entries.set('THE_ODDS_API_KEY',old)
    const fake=vi.fn(async()=>({status:401,ok:false,headers:new Headers()} as Response))
    await expect(saveSportsApiKey(ctx,'THE_ODDS_API_KEY',
      '11111111111111111111111111111111',fake)).rejects.toThrow('rechazó')
    expect(entries.get('THE_ODDS_API_KEY')).toBe(old)
  })
  it('verifies The Odds API on its official zero-credit catalog and reports no key',async()=>{
    const {ctx,entries}=newVault()
    const key='abcdefabcdefabcdefabcdefabcdef12'
    const request=vi.fn(async()=>({status:200,ok:true,headers:new Headers(),
      json:async()=>[]} as Response))
    const saved=await saveSportsApiKey(ctx,'THE_ODDS_API_KEY',key,request)
    expect(saved).toMatchObject({status:'ready',verified:true})
    expect(entries.get('THE_ODDS_API_KEY')).toBe(key)
    expect(JSON.stringify(saved)).not.toContain(key)
    const state=await verifySportsApiKey(ctx,'THE_ODDS_API_KEY',request)
    expect(state.verified).toBe(true)
    expect(request).toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(
      'https://api.the-odds-api.com/v4/sports/?apiKey='+key,expect.anything())
  })
})
