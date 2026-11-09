import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,access,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {dailyResearchFetcher,dailyPreloadTargets,preloadDailyResearch,
  dailyResearchStatus,dailyResearchNeeds} from '../src/sports-daily-preload.ts'

const now=Date.parse('2026-11-09T13:00:00Z')
const date='2026-11-09'
const mock=(track)=>async(url)=>{
  track.push(String(url))
  const path=String(url)
  const body=path.includes('/score/')?{games:[{id:1}]}:
    path.includes('statsapi.mlb.com')?{dates:[{games:[{id:2}]}]}:
    path.includes('api-sports.io')?{response:[{id:3}]}:
    path.includes('bigballsdata')?{data:[{id:4}]}:
    {events:[{id:5}]}
  return new Response(JSON.stringify(body),{status:200,headers:{
    'content-type':'application/json',
    'x-ratelimit-requests-remaining':'90',
  }})
}
async function temp(fn){
  const path=await mkdtemp(join(tmpdir(),'phoenix-daily-research-'))
  try{return await fn(path)}finally{await rm(path,{recursive:true,force:true})}
}
test('daily agenda includes all six sports and reads free providers without keys',()=>{
  assert.equal(dailyResearchNeeds.length,6)
  const targets=dailyPreloadTargets(date,{})
  assert.ok(targets.some(x=>x.provider==='ESPN'))
  assert.ok(targets.some(x=>x.provider==='NHL Web API'))
  assert.ok(targets.some(x=>x.provider==='MLB StatsAPI'))
  assert.ok(targets.some(x=>x.provider==='TheSportsDB'))
  assert.equal(targets.some(x=>x.kind==='quota'),false)
})
test('preload caches fixture data across calls and reports its age without fabricated lineups',async()=>{
  await temp(async root=>{
    const urls=[]
    const env={PHOENIX_SPORTS_DAILY_RESEARCH_HOME:root}
    const first=await preloadDailyResearch(date,env,mock(urls),now)
    assert.ok(first.attempted>=10)
    assert.equal(first.failed,0)
    assert.ok(first.cache.sources.length>=10)
    const original=urls.length
    await preloadDailyResearch(date,env,mock(urls),now+10_000)
    assert.equal(urls.length,original,'fresh entries must be reused')
    const second=await dailyResearchStatus(date,env,now+10_000)
    assert.ok(second.fresh>0)
    assert.equal(second.retentionDays,7)
    assert.equal(second.needs.length,6)
    assert.match(second.note,/NO|cuotas/i)
  })
})
test('research cache is shared by daily specialists while bookmaker URLs remain untouched',async()=>{
  await temp(async root=>{
    const urls=[]
    const transport=dailyResearchFetcher(mock(urls),
      {PHOENIX_SPORTS_DAILY_RESEARCH_HOME:root},()=>now)
    const source='https://api-web.nhle.com/v1/score/2026-11-09'
    assert.equal((await (await transport(source)).json()).games.length,1)
    assert.equal((await (await transport(source)).json()).games.length,1)
    assert.equal(urls.length,1)
    const bookmaker='https://api.the-odds-api.com/v4/sports'
    await transport(bookmaker);await transport(bookmaker)
    assert.equal(urls.length,3,'market discovery is never served from daily cache')
  })
})
test('API-Sports quota is per API, guarded per UTC minute, and secret is never stored',async()=>{
  await temp(async root=>{
    const urls=[]
    const env={PHOENIX_SPORTS_DAILY_RESEARCH_HOME:root,
      PHOENIX_SPORTS_API_SPORTS_DAY_BUDGET:'80'}
    const transport=dailyResearchFetcher(mock(urls),env,()=>now)
    for(let i=0;i<9;i++){
      const res=await transport('https://v1.hockey.api-sports.io/games?date='+date+'&team='+i,
        {headers:{'x-apisports-key':'private-credential'}})
      assert.equal(res.status,200)
    }
    await assert.rejects(()=>transport(
      'https://v1.hockey.api-sports.io/games?date='+date+'&team=10',
      {headers:{'x-apisports-key':'private-credential'}}),/Cuota/)
    assert.equal(urls.length,9)
    const report=await dailyResearchStatus(date,env,now)
    const hockey=report.apiSports.find(x=>x.api==='hockey')
    assert.equal(hockey.consumed,9)
    assert.equal(hockey.remainingLocal,71)
    assert.ok(!JSON.stringify(report).includes('private-credential'))
    const files=await readFile(join(root,'quota-'+date+'.json'),'utf8')
    assert.ok(!files.includes('private-credential'))
  })
})
test('old daily archives are pruned after seven days, with current data retained',async()=>{
  await temp(async root=>{
    await writeFile(join(root,'research-2026-10-31.json'),'{"schema":1}')
    await writeFile(join(root,'quota-2026-10-31.json'),'{"schema":1}')
    const env={PHOENIX_SPORTS_DAILY_RESEARCH_HOME:root}
    await dailyResearchStatus(date,env,now)
    await assert.rejects(()=>access(join(root,'research-2026-10-31.json')))
    await assert.rejects(()=>access(join(root,'quota-2026-10-31.json')))
  })
})

test('a hung preflight provider is isolated while other free fixtures remain cached',async()=>{
 await temp(async root=>{
   const env={PHOENIX_SPORTS_DAILY_RESEARCH_HOME:root,
     PHOENIX_SPORTS_PRELOAD_TIMEOUT_MS:'40'}
   const good=mock([])
   const stalled=async (url,init)=>{
     if(String(url).includes('/basketball/nba/'))return new Promise(()=>{})
     return good(url,init)
   }
   const started=Date.now()
   const result=await preloadDailyResearch(date,env,stalled,now)
   assert.ok(Date.now()-started<1500)
   assert.ok(result.rows.some(x=>x.status==='unavailable'&&x.provider==='ESPN'))
   assert.ok(result.rows.some(x=>x.status==='cached'))
   assert.ok(result.cache.sources.length>=5)
 })
})
