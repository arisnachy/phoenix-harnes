import {test} from 'node:test'
import assert from 'node:assert/strict'
import {keylessOdds,normalizeOddsHarvester} from '../src/keyless-odds.ts'
const now=Date.parse('2026-10-28T18:05:00Z')
const fixture=[{
  scraped_date:'2026-10-28 18:00:00 UTC',match_date:'2026-10-28 23:00:00 UTC',
  match_link:'https://www.oddsportal.com/football/h2h/home-a/away-b/#GAME1',
  home_team:'Home FC',away_team:'Away FC',league_name:'Premier League',
  '1x2_market':[{bookmaker_name:'Book A',period:'FullTime','1':'1.95',X:'3.20','2':'4.20',
    blocked_outcomes:['X']}],
  'double_chance_market':[{bookmaker_name:'Book A',period:'FullTime','1X':'1.28','12':'1.50','X2':'2.12'}],
  'over_under_2_5_market':[{bookmaker_name:'Book A',period:'FullTime',odds_over:'1.80',odds_under:'2.02'}],
}]
test('parses 1X2, double chance and 2.5 total while excluding withdrawn odds',()=>{
  const out=normalizeOddsHarvester(fixture,'football',now)
  assert.equal(out.length,7)
  assert.ok(out.some(x=>x.market==='double_chance'&&x.selection==='1X'&&x.price===1.28))
  assert.ok(out.some(x=>x.market==='totals'&&x.point===2.5&&x.price===1.8))
  assert.equal(out.some(x=>x.selection==='Empate'),false)
  assert.equal(new Set(out.map(x=>x.eventId)).size,1)
  assert.ok(out.every(x=>x.source.includes('sin API key')))
})
test('rejects stale, started, bogus-domain, missing timestamp and invalid prices',()=>{
  assert.deepEqual(normalizeOddsHarvester(fixture,'football',now+5*86_400_000),[])
  assert.deepEqual(normalizeOddsHarvester([{...fixture[0],
    match_link:'https://example.com/private'}],'football',now),[])
  assert.deepEqual(normalizeOddsHarvester([{...fixture[0],
    match_date:'2026-10-27 23:00:00 UTC'}],'football',now),[])
  assert.deepEqual(normalizeOddsHarvester([{...fixture[0],
    scraped_date:'invalid'}],'football',now),[])
  assert.deepEqual(normalizeOddsHarvester([{...fixture[0],
    '1x2_market':[{'1':'NaN',bookmaker_name:'Book A',period:'FullTime'}],
    'double_chance_market':[],'over_under_2_5_market':[]}],'football',now),[])
})
test('keyless command enforces opt-in and is testable without API key or network',async()=>{
  const fakeRunner=async()=>fixture
  await assert.rejects(()=>keylessOdds('football','1x2','2026-10-28',{},now,fakeRunner),/desactivado/)
  const out=await keylessOdds('football','1x2','2026-10-28',
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'},now,fakeRunner)
  assert.equal(out.length,7)
  await assert.rejects(()=>keylessOdds('football','not-existing','2026-10-28',
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'},now,fakeRunner),/sin soporte/)
})
