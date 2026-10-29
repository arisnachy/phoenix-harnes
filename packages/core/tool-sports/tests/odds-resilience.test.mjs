import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {marketOddsDetailed} from '../src/sports.ts'
import {saveOddsSnapshot,loadOddsSnapshots} from '../src/odds-snapshots.ts'

const timestamp=Date.parse('2026-10-29T19:00:00Z')
const future='2026-10-30T01:00:00Z'
const alternate={success:true,data:[{event_id:'nba55',sport:'basketball',league:'NBA',
  home_team:'Boston Celtics',away_team:'Miami Heat',start_time:future,
  books:[{book:'LiveBook',market:'h2h',updated_at:'2026-10-29T18:55:00Z',
    outcomes:[{name:'Boston Celtics',price:1.77},{name:'Miami Heat',price:2.22}]}]}]}
const mock=async url=>String(url).includes('api.the-odds-api.com')
  ?new Response('error',{status:503})
  :new Response(JSON.stringify(alternate),{status:200})
test('failed preferred odds API never hides independent live alternate quotes',async()=>{
 const result=await marketOddsDetailed('basketball_nba','h2h',
  {THE_ODDS_API_KEY:'v4test',THEODDSAPI_API_KEY:'free-test',PHOENIX_SPORTS_ESPN_DISABLED:'1'},mock,timestamp)
 assert.equal(result.quotes.length,2)
 assert.equal(result.quotes[0].bookmaker,'LiveBook')
 assert.equal(result.quotes[0].source,'TheOddsAPI')
 assert.equal(result.sources.find(x=>x.provider==='The Odds API v4').status,'error')
 assert.equal(result.sources.find(x=>x.provider==='TheOddsAPI').status,'observed')
 assert.equal(result.sources.find(x=>x.provider==='ESPN Site/Core').status,'unconfigured')
 assert.ok(result.sources.every(x=>!x.detail.includes('free-test')))
})
test('without providers, clearly report why no odds rather than assert every game has no price',async()=>{
 const result=await marketOddsDetailed('basketball_nba','h2h',
  {PHOENIX_SPORTS_ESPN_DISABLED:'1',PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'},mock,timestamp)
 assert.equal(result.quotes.length,0)
 assert.ok(result.sources.every(x=>x.status==='unconfigured'))
})
test('historical snapshots store original prices and timestamps without making past quotes live',async()=>{
 const root=await mkdtemp(join(tmpdir(),'phoenix-observed-'))
 const env={PHOENIX_SPORTS_SOURCE_HOME:root}
 try{
  const initial={eventId:'nba55',sportKey:'basketball_nba',home:'Boston Celtics',
    away:'Miami Heat',bookmaker:'LiveBook',market:'h2h',selection:'Boston Celtics',
    price:1.77,point:null,timeIso:future,time:future,
    updatedAt:'2026-10-29T18:55:00Z',source:'TheOddsAPI'}
  assert.equal((await saveOddsSnapshot('basketball_nba',[initial],env,timestamp)).count,1)
  const stored=await loadOddsSnapshots('basketball_nba','2026-10-29',env)
  assert.equal(stored.rows,1)
  assert.equal(stored.snapshots[0].quotes[0].price,1.77)
  assert.equal(stored.snapshots[0].historical,true)
  assert.equal(stored.snapshots[0].observedAt,'2026-10-29T19:00:00.000Z')
  assert.equal((await loadOddsSnapshots('basketball_nba','2026-10-28',env)).rows,0)
  assert.equal((await saveOddsSnapshot('basketball_nba',[{...initial,updatedAt:'unverified'}],env,timestamp+1)).count,0)
  await assert.rejects(()=>loadOddsSnapshots('../x','2026-10-29',env),/inválidos/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('free-tier NBA h2h recovers genuine moneylines after a combined-market rejection',async()=>{
 const seen=[]
 const fallback=async url=>{
   const u=new URL(String(url));seen.push(u)
   const market=u.searchParams.get('markets')
   return new Response(market==='h2h'?JSON.stringify(alternate):JSON.stringify({error:'markets not in tier'}),{
     status:market==='h2h'?200:403,
   })
 }
 const result=await marketOddsDetailed('basketball_nba','h2h,totals,spreads',
   {PHOENIX_SPORTS_ESPN_DISABLED:'1',THEODDSAPI_API_KEY:'limited-free'},fallback,timestamp)
 assert.equal(seen.length,2)
 assert.equal(seen[1].searchParams.get('markets'),'h2h')
 assert.equal(result.quotes.length,2)
 assert.equal(result.sources.find(s=>s.provider==='TheOddsAPI').status,'observed')
 assert.ok(result.quotes.every(q=>q.market==='h2h'))
})
