import {test} from 'node:test'
import assert from 'node:assert/strict'
import {oddsDisciplines,belongsToLeague,scanOddsDisciplines,coveredSportKeys}
  from '../src/sports-odds-coverage.ts'
import {keylessSports,describeScraperError,oddsHarvesterArgs} from '../src/keyless-odds.ts'

test('coverage scans all eleven scraper disciplines in pages with no silent omission',async()=>{
  assert.equal(oddsDisciplines.length,11)
  const calls=[]
  const lookup=async(sport,market)=>{
    calls.push([sport,market])
    if(sport==='tennis')throw new Error('Blocked site in tennis')
    return sport==='basketball'?[{home:'Team H',away:'Team A',league:'WNBA',
      bookmaker:'Book A',market:'h2h',selection:'Team H',price:1.91,
      updatedAt:'2026-10-29T18:05:00Z'}]:[]
  }
  const a=await scanOddsDisciplines({offset:0,limit:4},lookup)
  const b=await scanOddsDisciplines({offset:4,limit:4},lookup)
  const c=await scanOddsDisciplines({offset:8,limit:4},lookup)
  const rows=[...a.checked,...b.checked,...c.checked]
  assert.equal(rows.length,11)
  assert.equal(new Set(rows.map(x=>x.sport)).size,11)
  assert.equal(a.nextOffset,4)
  assert.equal(b.nextOffset,8)
  assert.equal(c.nextOffset,null)
  assert.equal(c.complete,true)
  assert.equal(a.checked.find(x=>x.sport==='basketball')?.sample[0]?.league,'WNBA')
  assert.equal(b.checked.find(x=>x.sport==='tennis')?.status,'error')
  assert.equal(c.checked.find(x=>x.sport==='cricket')?.status,'empty')
  assert.equal(calls.length,11)
  assert.ok(coveredSportKeys.basketball.includes('basketball_wnba'))
  assert.ok(coveredSportKeys.tennis.includes('tennis_wta'))
  await assert.rejects(()=>scanOddsDisciplines({offset:9,limit:5},lookup),/máximo cuatro/)
})
test('NBA, WNBA, MLB, NFL, NHL, ATP and WTA are not mislabeled from generic sports data',()=>{
  assert.equal(belongsToLeague('basketball_nba',{league:'WNBA - Women'}),false)
  assert.equal(belongsToLeague('basketball_wnba',{league:'WNBA'}),true)
  assert.equal(belongsToLeague('basketball_nba',{league:'NBA - Regular Season'}),true)
  assert.equal(belongsToLeague('baseball_mlb',{league:'Japanese NPB'}),false)
  assert.equal(belongsToLeague('baseball_mlb',{league:'MLB'}),true)
  assert.equal(belongsToLeague('americanfootball_nfl',{league:'NFL'}),true)
  assert.equal(belongsToLeague('icehockey_nhl',{league:'NHL'}),true)
  assert.equal(belongsToLeague('tennis_atp',{league:'ATP - Rome'}),true)
  assert.equal(belongsToLeague('tennis_wta',{league:'ATP - Rome'}),false)
  assert.equal(belongsToLeague('tennis_wta',{league:'WTA - Dubai'}),true)
  assert.equal(belongsToLeague('soccer_usa_mls',{league:'MLS Next Pro'}),false)
  assert.equal(belongsToLeague('soccer_usa_mls',{league:'MLS'}),true)
  assert.equal(belongsToLeague('soccer_epl',{league:'Premier League'}),false)
  assert.equal(belongsToLeague('soccer_epl',{
    league:'Premier League',matchLink:'https://www.oddsportal.com/football/england/premier-league/game'
  }),true)
  assert.equal(belongsToLeague('basketball_wnba',{}),false)
})
test('tennis and volleyball use correct verified market tokens, not generic totals',()=>{
  assert.ok(keylessSports.tennis.includes('total_games_over_under'))
  assert.ok(keylessSports.tennis.includes('total_sets_over_under'))
  assert.ok(keylessSports.volleyball.includes('total_points_over_under'))
  assert.ok(keylessSports.volleyball.includes('total_sets_over_under'))
  const args=oddsHarvesterArgs('tennis','total_games_over_under','2026-10-29','odds.json')
  assert.equal(args[args.indexOf('--market')+1],'total_games_over_under')
})
test('scraper errors explain missing browser, timeout or block without exposing secrets',()=>{
  const a=describeScraperError({code:1,signal:null,killed:false,
    stderr:"BrowserType.launch: Executable doesn't exist; apiKey=supersecret"})
  assert.match(a,/missing-playwright-browser/)
  assert.match(a,/exitCode=1/)
  assert.doesNotMatch(a,/supersecret/)
  const b=describeScraperError({code:'ETIMEDOUT',killed:true,
    stderr:'Timed out opening OddsPortal'})
  assert.match(b,/category=timeout/)
  const c=describeScraperError({code:1,stderr:'HTTP 403 Cloudflare challenge'})
  assert.match(c,/site-blocked-or-limited/)
  assert.match(describeScraperError({code:'ENOENT'}),/missing-executable/)
})
