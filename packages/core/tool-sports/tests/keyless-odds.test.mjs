import {test} from 'node:test'
import assert from 'node:assert/strict'
import {keylessOdds,normalizeOddsHarvester,oddsHarvesterArgs} from '../src/keyless-odds.ts'
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

test('OddsHarvester requests the correct period for NHL winner including overtime',()=>{
  const args=oddsHarvesterArgs('ice-hockey','home_away','2026-10-29','odds.json')
  assert.ok(args.includes('--period'))
  assert.equal(args[args.indexOf('--period')+1],'full_including_ot')
  const nba=oddsHarvesterArgs('basketball','1x2','2026-10-29','odds.json')
  assert.equal(nba[nba.indexOf('--period')+1],'full_time')
  const soccer=oddsHarvesterArgs('football','double_chance','2026-10-29','odds.json')
  assert.ok(!soccer.includes('--period'))
  assert.deepEqual(soccer.slice(-6),['--headless','--format','json','--output','odds.json'].slice(-6))
})
test('NHL per-bookmaker home/away FullIncludingOT fixture yields genuinely distinct priced selections',()=>{
  const hockey=[{
    scraped_date:'2026-10-29 13:00:00 UTC',match_date:'2026-10-29 23:00:00 UTC',
    match_link:'https://www.oddsportal.com/ice-hockey/h2h/jets-x/lightning-y/#fixture',
    home_team:'Winnipeg Jets',away_team:'Tampa Bay Lightning',
    home_away_market:[{
      bookmaker_name:'Bookmaker A',period:'FullIncludingOT',
      '1':'1.92','2':'1.97',
    }],
  }]
  const result=normalizeOddsHarvester(hockey,'ice-hockey',Date.parse('2026-10-29T13:05:00Z'))
  assert.equal(result.length,2)
  assert.deepEqual(new Set(result.map(x=>x.selection)),new Set(['Winnipeg Jets','Tampa Bay Lightning']))
  assert.ok(result.every(x=>x.bookmaker==='Bookmaker A'&&x.market==='h2h'))
})
