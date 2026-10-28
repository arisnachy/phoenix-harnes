import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSportsbookReviewArchive,normalizeMlbHistoricalArchive} from '../src/sports-archive.ts'
import {normalizeCommunity} from '../src/sports-community.ts'
import {researchSport} from '../src/multi-sport-research.ts'

test('first historical Github scraper normalizes old American moneyline without declaring live odds',()=>{
  const results=normalizeSportsbookReviewArchive([{date:20200521,home_team:'Home',away_team:'Away',
    home_close_ml:-125,away_close_ml:110}],'nba')
  assert.equal(results[0].historical,true)
  assert.equal(results[0].source,'flancast90/sportsbookreview-scraper')
  assert.equal(results[0].homeDecimal,1.8)
  assert.equal(results[0].awayDecimal,2.1)
  assert.equal(results[0].date,'2020-05-21')
})
test('second independent MLB historical scraper normalizes sportsbook-specific currentLine as historic',()=>{
  const archive={'2025-08-16':[{gameView:{homeTeam:{fullName:'Yankees'},awayTeam:{fullName:'Red Sox'}},
    odds:{moneyline:[{sportsbook:'fanduel',currentLine:{homeOdds:-200,awayOdds:168}},
      {sportsbook:'draftkings',currentLine:{homeOdds:-195,awayOdds:165}}]}}]}
  const rows=normalizeMlbHistoricalArchive(archive)
  assert.equal(rows.length,2)
  assert.equal(rows[0].homeDecimal,1.5)
  assert.equal(rows[0].awayDecimal,2.68)
  assert.equal(rows[0].source,'ArnavSaraogi/mlb-odds-scraper')
  assert.ok(rows.every(x=>x.historical))
})
test('public community picks are observation of votes, never a forecast probability',()=>{
  const now=Date.parse('2026-10-28T18:05:00Z')
  const opinions=normalizeCommunity([{
    scraped_at:'2026-10-28T18:00:00Z',
    home_team:'Home',away_team:'Away',sport:'football',league:'LaLiga',
    market:'1X2',community_votes_pct:[{outcome:'1',pct:82},{outcome:'X',pct:11},{outcome:'2',pct:7}],
  }],now)
  assert.equal(opinions[0].votes[0].percentage,82)
  assert.match(opinions[0].limitation,/no probabilidad/)
  assert.deepEqual(normalizeCommunity([{
    scraped_at:'2026-10-20T18:00:00Z',
    home_team:'Home',away_team:'Away',sport:'football',market:'1X2',
    community_votes_pct:[{outcome:'1',pct:82}],
  }],now),[])
})
const match=(id,date,state,homeScore,awayScore)=>({
  id:String(id),date,status:{type:{state}},competitions:[{competitors:[
    {homeAway:'home',team:{id:'10',displayName:'Home FC'},...(homeScore===null?{}:{score:String(homeScore)})},
    {homeAway:'away',team:{id:'20',displayName:'Away FC'},...(awayScore===null?{}:{score:String(awayScore)})},
  ]}],
})
test('verified research works for soccer and includes draws, margins, rest, missing evidence',async()=>{
  const today='2026-10-28'
  const now=Date.parse('2026-10-28T12:00:00Z')
  const games={
    '20261028':[match(999,'2026-10-28T23:00:00Z','pre',null,null)],
    '20261027':[match(123,'2026-10-27T17:00:00Z','post',2,1)],
    '20261026':[match(124,'2026-10-26T18:00:00Z','post',1,1)],
  }
  const mock=async url=>{
    const day=String(url).split('dates=')[1]
    return new Response(JSON.stringify({events:games[day]??[]}),{status:200})
  }
  const out=await researchSport('soccer','eng.1',today,mock,now,{},2)
  assert.equal(out.matches.length,1)
  assert.equal(out.matches[0].home.wins,1)
  assert.equal(out.matches[0].home.draws,1)
  assert.equal(out.matches[0].away.losses,1)
  assert.equal(out.matches[0].evidence,'descriptive')
  assert.match(out.note,/no cuotas/)
  await assert.rejects(()=>researchSport('soccer','fake',today,mock,now),/catálogo/)
})
