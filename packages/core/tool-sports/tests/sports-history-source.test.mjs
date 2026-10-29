import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadHistoricalOdds,normalizeSportsbookReviewArchive,normalizeMlbHistoricalArchive} from '../src/sports-archive.ts'
test('real original flancast90 schema stays historical and American prices normalize to decimals',()=>{
 const out=normalizeSportsbookReviewArchive([{date:20211022,home_team:'Home',away_team:'Away',
   home_close_ml:-150,away_close_ml:130}], 'nba')
 assert.equal(out.length,1)
 assert.deepEqual(out[0],{source:'flancast90/sportsbookreview-scraper',sport:'nba',date:'2021-10-22',
  home:'Home',away:'Away',bookmaker:'SportsbookReview cierre agregado',market:'h2h',
  homeDecimal:1.66667,awayDecimal:2.3,historical:true})
})
test('ArnavSaraogi named bookmakers and date-indexed MLB odds remain explicitly historical',()=>{
 const out=normalizeMlbHistoricalArchive({'2024-04-02':[{
   gameView:{homeTeam:{fullName:'Yankees'},awayTeam:{fullName:'Astros'}},
   odds:{moneyline:[{sportsbook:'fanduel',currentLine:{homeOdds:-120,awayOdds:110}}]},
 }]})
 assert.equal(out.length,1)
 assert.equal(out[0].source,'ArnavSaraogi/mlb-odds-scraper')
 assert.equal(out[0].bookmaker,'fanduel')
 assert.equal(out[0].date,'2024-04-02')
 assert.equal(out[0].historical,true)
})
test('missing local historical cache reports sources instead of demanding a manual env key',async()=>{
 const data=await loadHistoricalOdds('nba',{PHOENIX_SPORTS_HISTORY_DIR:'/does/not/exist'})
 assert.equal(data.sources.length,1)
 assert.equal(data.sources[0].available,false)
 assert.equal(data.liveQuotes,false)
})
