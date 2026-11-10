import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchTheRundownOdds,fetchSportsGameOdds} from '../src/open-odds-providers.ts'
import {marketOddsDetailed} from '../src/sports.ts'
import {fetchBetBetterModels,findModelOpinion} from '../src/betbetter-model-evidence.ts'

const now=Date.parse('2026-11-08T18:00:00Z')
const kickoff='2026-11-08T21:00:00Z'
const updated='2026-11-08T17:50:00Z'
const json=v=>new Response(JSON.stringify(v),{status:200})
const rundown={events:[{event_id:'r1',event_date:kickoff,teams:[
  {name:'Boston Celtics',is_away:true},{name:'Chicago Bulls',is_away:false}],
  markets:[{market_id:1,period_id:0,participants:[
    {name:'Boston Celtics',lines:[{prices:{
      '19':{price:-150,updated_at:updated,is_main_line:true},
      '23':{price:-140,updated_at:updated,is_main_line:true,closed_at:'2026-11-08T17:55:00Z'},
    }}]},
    {name:'Chicago Bulls',lines:[{prices:{
      '19':{price:130,updated_at:updated,is_main_line:true},
    }}]},
  ]}],
}]}
const sportsGame={success:true,data:[{eventID:'g1',
  status:{started:false,cancelled:false,startsAt:kickoff},
  teams:{home:{names:{long:'Chicago Bulls'}},away:{names:{long:'Boston Celtics'}}},
  odds:{'points-home-game-ml-home':{
    betTypeID:'ml',periodID:'game',sideID:'home',statEntityID:'home',
    byBookmaker:{fanduel:{odds:'+130',lastUpdatedAt:updated,available:true}},
  },'points-away-game-ml-away':{
    betTypeID:'ml',periodID:'game',sideID:'away',statEntityID:'away',
    byBookmaker:{fanduel:{odds:'-155',lastUpdatedAt:updated,available:true},
      betmgm:{odds:'-145',lastUpdatedAt:updated,available:false}},
  }},
}]}
test('TheRundown authenticates privately and converts fresh open sportsbook odds',async()=>{
  const feed=async(url,init)=>{
    assert.match(String(url),/\/sports\/4\/events\/2026-11-08/)
    assert.equal(init.headers['X-TheRundown-Key'],'private-rundown')
    assert.ok(!String(url).includes('private-rundown'))
    return json(rundown)
  }
  const rows=await fetchTheRundownOdds('basketball_nba','h2h','private-rundown',feed,now)
  assert.deepEqual(rows.map(r=>r.bookmaker),['DraftKings','DraftKings'])
  assert.deepEqual(rows.map(r=>r.price),[1.66667,2.3])
  assert.equal(rows[0].updatedAt,updated)
  assert.equal(rows[0].observedAt,new Date(now).toISOString())
  assert.equal(rows[0].source,'TheRundown')
})
test('TheRundown rejects wrong period but preserves verified open lines with older last change',async()=>{
  const wrong=structuredClone(rundown)
  wrong.events[0].markets[0].period_id=1
  assert.deepEqual(await fetchTheRundownOdds('basketball_nba','h2h','key',
    async()=>json(wrong),now),[])
  const old=structuredClone(rundown)
  old.events[0].markets[0].participants[0].lines[0].prices['19'].updated_at='2026-11-07T12:00:00Z'
  const oldRows=await fetchTheRundownOdds('basketball_nba','h2h','key',
    async()=>json(old),now)
  assert.equal(oldRows.length,2)
  assert.equal(oldRows[0].updatedAt,'2026-11-07T12:00:00Z')
  assert.equal(oldRows[0].observedAt,new Date(now).toISOString())
  assert.ok(Date.parse(oldRows[0].updatedAt)<Date.parse(oldRows[0].observedAt))
})
test('SportsGameOdds uses authentic bookmaker offers only, not model fair odds',async()=>{
  const feed=async(url,init)=>{
    assert.match(String(url),/leagueID=NBA/)
    assert.equal(init.headers['x-api-key'],'private-sgo')
    assert.ok(!String(url).includes('private-sgo'))
    return json(sportsGame)
  }
  const rows=await fetchSportsGameOdds('basketball_nba','h2h','private-sgo',feed,now)
  assert.deepEqual(rows.map(r=>r.selection),['Chicago Bulls','Boston Celtics'])
  assert.deepEqual(rows.map(r=>r.price),[2.3,1.64516])
  assert.ok(rows.every(r=>r.bookmaker==='FanDuel'&&r.source==='SportsGameOdds'))
})
test('SportsGameOdds refuses unavailable rows and wrong soccer settlement',async()=>{
  const wrong=structuredClone(sportsGame)
  wrong.data[0].odds['points-home-game-ml-home'].byBookmaker.fanduel.available=false
  wrong.data[0].odds['points-away-game-ml-away'].byBookmaker.fanduel.lastUpdatedAt='2026-11-07T12:00:00Z'
  const oldRows=await fetchSportsGameOdds('basketball_nba','h2h','key',
    async()=>json(wrong),now)
  assert.equal(oldRows.length,1)
  assert.equal(oldRows[0].updatedAt,'2026-11-07T12:00:00Z')
  assert.equal(oldRows[0].observedAt,new Date(now).toISOString())
  assert.deepEqual(await fetchSportsGameOdds('soccer_epl','h2h','key',
    async()=>json(sportsGame),now),[])
})
test('fallback source survives first provider HTTP 401 and hides keys',async()=>{
  const feed=async(url)=>String(url).includes('therundown.io')
    ?new Response('unauthorized',{status:401}):json(sportsGame)
  const report=await marketOddsDetailed('basketball_nba','h2h',{
    PHOENIX_SPORTS_ESPN_DISABLED:'1',
    THERUNDOWN_API_KEY:'secret-do-not-print',
    SPORTSGAMEODDS_API_KEY:'secondary-secret',
  },feed,now)
  assert.equal(report.sources.find(s=>s.provider==='TheRundown').status,'error')
  assert.equal(report.sources.find(s=>s.provider==='SportsGameOdds').status,'observed')
  assert.equal(report.quotes.length,2)
  assert.ok(!JSON.stringify(report).includes('secret-do-not-print'))
  assert.ok(!JSON.stringify(report).includes('secondary-secret'))
})
test('Bet Better is independent probability and locked rows are excluded',async()=>{
  const feed=async url=>{
    assert.match(String(url),/betbetter.world\/nba\/picks\?format=json&free=1/)
    return json({updatedUtc:'2026-11-08T17:55:00Z',picks:[
      {game:'Boston Celtics @ Chicago Bulls',gameTimeUtc:kickoff,
        market:'Head to Head',selection:'Boston Celtics',
        modelProbabilityPct:60,fairOdds:1.67,confidence:'HIGH',locked:false},
      {game:'New York Knicks @ Chicago Bulls',gameTimeUtc:kickoff,
        market:'Head to Head',selection:'New York Knicks',
        modelProbabilityPct:55,fairOdds:1.82,confidence:'LEAN',locked:true},
    ]})
  }
  const models=await fetchBetBetterModels('basketball_nba',feed,now)
  assert.equal(models.length,1)
  assert.equal(models[0].kind,'model-probability')
  assert.ok(!('bookmaker' in models[0]))
  assert.equal(findModelOpinion(models,{home:'Chicago Bulls',away:'Boston Celtics',
    kickoff,pick:'away'}).status,'support')
  assert.equal(findModelOpinion(models,{home:'Chicago Bulls',away:'Boston Celtics',
    kickoff,pick:'home'}).status,'contradiction')
})

test('TheRundown official V2 JSON without period_id retains open full-game moneylines',async()=>{
  const example=structuredClone(rundown)
  delete example.events[0].markets[0].period_id
  const prices=await fetchTheRundownOdds('basketball_nba','h2h','key',
    async()=>json(example),now)
  assert.equal(prices.length,2)
  assert.deepEqual(prices.map(x=>x.selection),['Boston Celtics','Chicago Bulls'])
  assert.ok(prices.every(x=>x.bookmaker==='DraftKings'&&x.observedAt))
  // An explicit subperiod must still be rejected.
  example.events[0].markets[0].period_id='1'
  assert.deepEqual(await fetchTheRundownOdds('basketball_nba','h2h','key',
    async()=>json(example),now),[])
})

test('rejects stale CDN odds snapshots even when their last bookmaker price looks recent',async()=>{
  const request=async(url,options)=>{
    assert.equal(options.cache,'no-store')
    assert.equal(options.redirect,'error')
    return new Response(JSON.stringify(rundown),{status:200,headers:{age:'901'}})
  }
  await assert.rejects(()=>fetchTheRundownOdds('basketball_nba','h2h',
    'not-a-real-secret',request,now),/snapshot de caché demasiado antiguo/u)
})
