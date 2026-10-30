import {describe,it,expect,vi} from 'vitest'
import type {Context} from '@phoenix-ai/cordis'
import {sportsEnvWithVaultKey} from '../src/sports-credential-env.ts'

describe('Kira The Odds API runtime credential resolution',()=>{
  it('prefers vault credential at every call, does not mutate ambient env',async()=>{
    let credential='abcdefabcdefabcdefabcdefabcdef12'
    const resolve=vi.fn(async(name:string)=>name==='THE_ODDS_API_KEY'?{value:credential}:undefined)
    const ctx={get:()=>({resolve})} as unknown as Context
    const input={THE_ODDS_API_KEY:'old-env',PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'}
    const first=await sportsEnvWithVaultKey(ctx,input)
    expect(first.THE_ODDS_API_KEY).toBe(credential)
    expect(input.THE_ODDS_API_KEY).toBe('old-env')
    credential='0123456789abcdef0123456789abcdef'
    expect((await sportsEnvWithVaultKey(ctx,input)).THE_ODDS_API_KEY).toBe(credential)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenCalledWith('THE_ODDS_API_KEY')
  })
  it('falls back to ambient configuration only when vault key is absent',async()=>{
    const ctx={get:()=>({resolve:async()=>undefined})} as unknown as Context
    const env={THE_ODDS_API_KEY:'ambient'}
    expect(await sportsEnvWithVaultKey(ctx,env)).toBe(env)
    expect(await sportsEnvWithVaultKey({get:()=>undefined} as unknown as Context,env)).toBe(env)
    expect(await sportsEnvWithVaultKey({get:()=>{throw Error('not running')}} as unknown as Context,env)).toBe(env)
  })
  it('keeps free ESPN operation available when credential store fails',async()=>{
    const ctx={get:()=>({resolve:async()=>{throw Error('vault offline')}})} as unknown as Context
    const env={PHOENIX_SPORTS_ESPN_DISABLED:'0'}
    expect(await sportsEnvWithVaultKey(ctx,env)).toBe(env)
  })
})
