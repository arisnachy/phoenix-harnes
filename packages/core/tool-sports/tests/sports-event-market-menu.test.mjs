import {test} from 'node:test'
import assert from 'node:assert/strict'
import {eventMarketCatalog,readSportsEventMarketMenu} from '../src/sports-event-market-menu.ts'

const now=Date.parse('2026-11-06T17:00:00Z')
const eventId='a6b7c8d9e0f11213'
const env={THE_ODDS_API_KEY:'test-only-secret'}
const feed=async(url)=>{
  const u=new URL(url),markets=u.searchParams.get('markets').split(',')
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
  const partial=async(url)=>{if(++count===2)return new Response('failed',{status:503})
    return feed(url)}
  const report=await readSportsEventMarketMenu('basketball_nba',eventId,env,partial,now,12)
  assert.equal(report.status,'observed')
  assert.ok(report.errors.some(x=>x.includes('503')))
  assert.ok(report.quotes.length>0)
})
