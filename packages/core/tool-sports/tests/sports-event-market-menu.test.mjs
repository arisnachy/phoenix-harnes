import {test} from 'node:test'
import assert from 'node:assert/strict'
import {eventMarketCatalog,readSportsEventMarketMenu} from '../src/sports-event-market-menu.ts'

const now=Date.parse('2026-11-06T17:00:00Z')
const eventId='a6b7c8d9e0f11213'
const env={THE_ODDS_API_KEY:'test-only-secret'}
const feed=async(url)=>{
  const u=new URL(url)
  if(u.pathname.endsWith('/markets'))return new Response(JSON.stringify({
    id:eventId,sport_key:'basketball_nba',commence_time:'2026-11-06T23:00:00Z',
    bookmakers:[{key:'draftkings',markets:[
      'player_points','alternate_spreads','alternate_totals','team_totals',
      'totals_h1','spreads_h1','totals_q1','spreads_q1',
      'player_rebounds','player_assists','player_threes','player_points_rebounds_assists',
    ].map(key=>({key,last_update:'2026-11-06T16:55:00Z'}))}],
  }),{status:200})
  const markets=(u.searchParams.get('markets')??'').split(',')
  const names=markets.includes('player_points')?['player_points']:markets.filter(m=>m.startsWith('alternate_'))
  return new Response(JSON.stringify({
    id:eventId,commence_time:'2026-11-06T23:00:00Z',
    bookmakers:[{key:'draftkings',title:'DraftKings',last_update:'2026-11-06T16:50:00Z',
      markets:names.map(key=>({key,last_update:'2026-11-06T16:55:00Z',
        outcomes:key==='player_points'?
          [{name:'Over',description:'Player One',point:24.5,price:1.9},
            {name:'Under',description:'Player One',point:24.5,price:1.9},
            {name:'Over',description:'Player Two',point:16.5,price:2},
            {name:'Under',description:'Player Two',point:16.5,price:1.8}]:
          [{name:'Over',point:230.5,price:1.91},
            {name:'Under',point:230.5,price:1.89}]}))}],
  }),{status:200})
}
test('six sports publish their supported extra market catalogs without fabricating availability',()=>{
  assert.ok(eventMarketCatalog('basketball_nba').includes('player_points'))
  assert.ok(eventMarketCatalog('basketball_wnba').includes('player_rebounds'))
  assert.ok(eventMarketCatalog('baseball_mlb').includes('totals_1st_5_innings'))
  assert.ok(eventMarketCatalog('americanfootball_nfl').includes('player_pass_yds'))
  assert.ok(eventMarketCatalog('icehockey_nhl').includes('player_shots_on_goal'))
  assert.ok(eventMarketCatalog('soccer_epl').includes('btts'))
  assert.deepEqual(eventMarketCatalog('../bad'),[])
})
test('a missing commercial key is visible and cannot masquerade as available props',async()=>{
  const result=await readSportsEventMarketMenu('baseball_mlb',eventId,{},feed,now)
  assert.equal(result.status,'unconfigured')
  assert.deepEqual(result.quotes,[])
  assert.equal(result.bookmakerCount,0)
})
test('real event player props retain athlete identity with separate Over and Under',async()=>{
  const result=await readSportsEventMarketMenu('basketball_nba',eventId,env,feed,now,12)
  assert.equal(result.status,'observed')
  const props=result.quotes.filter(q=>q.market==='player_points')
  assert.equal(props.length,4)
  assert.equal(new Set(props.map(q=>q.participant)).size,2)
  assert.ok(props.some(q=>q.participant==='Player Two'&&q.point===16.5))
  assert.ok(props.every(q=>q.bookmaker==='DraftKings'))
  assert.ok(props.every(q=>q.source==='The Odds API v4'))
  assert.ok(!JSON.stringify(result).includes(env.THE_ODDS_API_KEY))
})
test('stale offers, mismatched game IDs and finished games are not live markets',async()=>{
  const stale=async(url)=>{const r=await feed(url),d=await r.json()
    d.bookmakers[0].last_update='2026-11-06T10:00:00Z'
    d.bookmakers[0].markets.forEach(m=>{m.last_update='2026-11-06T10:00:00Z'})
    return new Response(JSON.stringify(d))
  }
  const r=await readSportsEventMarketMenu('basketball_nba',eventId,env,stale,now,12)
  assert.equal(r.status,'empty')
  assert.equal(r.quotes.length,0)
  const wrong=async(url)=>{const v=await(await feed(url)).json();v.id='different'
    return new Response(JSON.stringify(v))
  }
  const w=await readSportsEventMarketMenu('basketball_nba',eventId,env,wrong,now,12)
  assert.equal(w.status,'error')
  assert.deepEqual(w.quotes,[])
})
test('validates event ID and bounded credit use',async()=>{
  await assert.rejects(()=>readSportsEventMarketMenu('basketball_nba','../../bad',env,feed,now),/sin soporte/)
  await assert.rejects(()=>readSportsEventMarketMenu('basketball_nba',eventId,env,feed,now,13),/1 y 12/)
})
test('one failed market batch does not erase valid prior market results',async()=>{
  let count=0
  const partial=async(url)=>{
    const u=new URL(url)
    if(u.pathname.endsWith('/odds')&&++count===2)return new Response('failed',{status:503})
    return feed(url)
  }
  const report=await readSportsEventMarketMenu('basketball_nba',eventId,env,partial,now,12)
  assert.equal(report.status,'observed')
  assert.ok(report.errors.some(x=>x.includes('503')))
  assert.ok(report.quotes.length>0)
})

test('discover event market keys first and spend odds requests only on published options',async()=>{
  const calls=[]
  const dynamic=async(url)=>{
    const u=new URL(url)
    calls.push(u.pathname)
    if(u.pathname.endsWith('/markets'))return new Response(JSON.stringify({
      id:eventId,sport_key:'basketball_nba',commence_time:'2026-11-06T23:00:00Z',
      bookmakers:[{key:'draftkings',markets:[
        {key:'player_points',last_update:'2026-11-06T16:55:00Z'},
        {key:'alternate_totals',last_update:'2026-11-06T16:55:00Z'},
        {key:'not_analyzed_market',last_update:'2026-11-06T16:55:00Z'},
      ]}],
    }))
    return feed(url)
  }
  const report=await readSportsEventMarketMenu('basketball_nba',eventId,env,dynamic,now,8)
  assert.equal(report.discoveryStatus,'observed')
  assert.deepEqual(report.marketsQueried,['player_points','alternate_totals'])
  assert.ok(report.publishedMarkets.includes('not_analyzed_market'))
  assert.equal(report.quotes.filter(x=>x.market==='player_points').length,4)
  assert.equal(calls.length,2)
  assert.ok(calls[0].endsWith('/markets'))
  assert.ok(calls[1].endsWith('/odds'))
})
test('a real but empty event menu must not spend additional bookmaker quote calls',async()=>{
  let calls=0
  const noMarkets=async(url)=>{
    calls++
    assert.ok(String(url).includes('/markets'))
    return new Response(JSON.stringify({
      id:eventId,sport_key:'basketball_nba',commence_time:'2026-11-06T23:00:00Z',
      bookmakers:[],
    }))
  }
  const report=await readSportsEventMarketMenu('basketball_nba',eventId,env,noMarkets,now)
  assert.equal(report.discoveryStatus,'empty')
  assert.equal(report.status,'empty')
  assert.deepEqual(report.quotes,[])
  assert.equal(calls,1)
})
test('an event catalog for the wrong sport never authorizes betting quotes',async()=>{
  let calls=0
  const mismatch=async(url)=>{
    calls++
    return new Response(JSON.stringify({
      id:eventId,sport_key:'americanfootball_nfl',
      commence_time:'2026-11-06T23:00:00Z',bookmakers:[],
    }))
  }
  const report=await readSportsEventMarketMenu('basketball_nba',eventId,env,mismatch,now,8)
  assert.equal(report.discoveryStatus,'unavailable')
  assert.ok(report.errors.some(x=>x.includes('no corresponde')))
  assert.equal(report.quotes.length,0)
})
