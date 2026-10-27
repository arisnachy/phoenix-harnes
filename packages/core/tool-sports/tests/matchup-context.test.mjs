import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadMarketMatchups,findVerifiedMatchup} from '../src/matchup-context.ts'

const future=new Date(Date.now()+86400000).toISOString()
test('verifies exact teams, trusted logos and independent standings research',async()=>{
  const urls=[]
  const mock=async url=>{
    urls.push(String(url))
    return new Response(JSON.stringify({events:[{
      id:'abc123',date:future,status:{type:{state:'pre'}},competitions:[{competitors:[
        {homeAway:'home',team:{displayName:'Atlanta Hawks',logo:'https://a.espncdn.com/atl.png'},
          records:[{summary:'4-0'}]},
        {homeAway:'away',team:{displayName:'Miami Heat',logo:'https://untrusted.example/heat.png'},
          records:[{summary:'0-4'}]},
      ]}],
    }]}),{status:200})
  }
  const results=await loadMarketMatchups('basketball_nba','2026-10-28',mock)
  assert.equal(results.length,1)
  assert.equal(results[0].homeLogo,'https://a.espncdn.com/atl.png')
  assert.equal(results[0].awayLogo,undefined)
  assert.equal(results[0].signal.pick,'home')
  assert.ok(urls[0].includes('basketball/nba/scoreboard?dates=20261028'))
  assert.equal(findVerifiedMatchup(results,'Atlanta Hawks','Miami Heat')?.eventId,'abc123')
  assert.equal(findVerifiedMatchup(results,'Hawks','Miami Heat'),undefined)
})
test('rejects already-started matchups, unrecognized leagues and mismatched opponents',async()=>{
  const mock=async()=>new Response(JSON.stringify({events:[{
    id:'123',date:new Date(Date.now()-1000).toISOString(),
    status:{type:{state:'in'}},competitions:[{competitors:[
      {homeAway:'home',team:{name:'Home'}},{homeAway:'away',team:{name:'Away'}},
    ]}],
  }]}),{status:200})
  assert.deepEqual(await loadMarketMatchups('basketball_nba','2026-10-28',mock),[])
  assert.deepEqual(await loadMarketMatchups('unlisted_sport','2026-10-28',mock),[])
})
