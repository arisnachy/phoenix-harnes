import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extendedEspnRoutes,extendedEspnUrl,readExtendedEspn}
  from '../src/espn-extra-intelligence.ts'

const base={sport:'football',league:'nfl',season:2026,seasonType:2,
  eventId:'401873032',competitionId:'401873123',teamId:'14',
  athleteId:'12345',week:8}
test('ESPN route catalog covers cross-sport team/player/in-game data',()=>{
  assert.ok(Object.keys(extendedEspnRoutes).length>=30)
  const stats=extendedEspnUrl({...base,mode:'game_team_statistics'})
  assert.equal(new URL(stats).pathname,
    '/v2/sports/football/leagues/nfl/events/401873032/competitions/401873123/competitors/14/statistics')
  assert.equal(new URL(extendedEspnUrl({...base,mode:'athlete_gamelog'})).hostname,
    'site.web.api.espn.com')
  assert.equal(new URL(extendedEspnUrl({...base,mode:'standings'})).pathname,
    '/apis/v2/sports/football/nfl/standings')
  assert.equal(new URL(extendedEspnUrl({...base,mode:'team_news'})).searchParams.get('team'),'14')
})
test('rejects fabricated ID, missing competition ID, injection and unbounded params',()=>{
  for(const example of [
    {...base,mode:'game_plays',competitionId:undefined},
    {...base,mode:'team_roster',teamId:'../private'},
    {...base,mode:'league_events',league:'../../..'},
    {...base,mode:'season_weeks',season:2026.5},
    {...base,mode:'week_events',week:0},
    {...base,mode:'game_plays',limit:500000},
    {...base,mode:'athlete_stats',athleteId:'https://example.com/'},
  ])assert.throws(()=>extendedEspnUrl(example),/inválido|desconocido/u)
})
test('reports empty/unavailable endpoints without guessed players or stats',async()=>{
  const input={...base,mode:'athlete_eventlog'}
  const empty=await readExtendedEspn(input,async()=>({items:[],count:0}))
  assert.equal(empty.status,'empty')
  const failed=await readExtendedEspn(input,async()=>{throw Error('Proveedor HTTP 404')})
  assert.equal(failed.status,'unavailable')
  assert.match(failed.error,/404/)
  assert.equal(failed.snapshot,null)
})
test('truncates large responses while preserving source and provenance',async()=>{
  const sample=await readExtendedEspn({...base,mode:'team_athletes'},async()=>({
    count:1000,items:Array.from({length:100},(_,i)=>({id:i,name:'X'.repeat(400)})),
  }))
  assert.equal(sample.status,'data')
  assert.equal(sample.count,1000)
  assert.ok(sample.snapshot.length<=6)
  assert.ok(sample.snapshot[0].name.length<=350)
})

test('resolves trusted same-league ESPN references without requesting unrelated hosts',async()=>{
  const root='https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/'
  let calls=0
  const result=await readExtendedEspn({...base,mode:'team_athletes'},async url=>{
    calls++
    return calls===1?{count:2,items:[
      {$ref:root+'athletes/100'},{ $ref:'https://evil.example/steal'}]}:
      {id:'100',displayName:'Verified athlete',status:'active'}
  })
  assert.equal(calls,2)
  assert.equal(result.resolvedRefs,1)
  assert.equal(result.refCount,2)
  assert.equal(result.snapshot[0].displayName,'Verified athlete')
  assert.equal(result.snapshot[1].unresolved,true)
})

test('all ESPN families generate fixed-host URLs, not arbitrary destinations',()=>{
  const cases={
    site_scoreboard:['site.api.espn.com','/apis/site/v2/sports/basketball/nba/scoreboard'],
    site_summary:['site.api.espn.com','/apis/site/v2/sports/basketball/nba/summary'],
    game_prop_bets:['sports.core.api.espn.com','/odds/58/propBets'],
    game_situation:['sports.core.api.espn.com','/competitions/200/situation'],
    web_statistics_by_team:['site.web.api.espn.com','/statistics/byteam'],
    cdn_game:['cdn.espn.com','/core/nba/game'],
    fantasy_player_info:['lm-api-reads.fantasy.espn.com','/seasons/2026/players'],
    search_entities:['site.web.api.espn.com','/apis/search/v2'],
    news_feed:['now.core.api.espn.com','/v1/sports/news'],
    video_feed:['site.web.api.espn.com','/apis/v2/videos'],
  }
  for(const [mode,[host,suffix]] of Object.entries(cases)){
    const u=new URL(extendedEspnUrl({...base,sport:'basketball',league:'nba',
      providerId:'58',mode,query:'Ohtani'}))
    assert.equal(u.hostname,host,mode)
    assert.ok(u.pathname.endsWith(suffix),mode)
  }
  assert.equal(new URL(extendedEspnUrl({...base,mode:'site_scoreboard',date:'20261109'})).searchParams.get('dates'),'20261109')
  assert.equal(new URL(extendedEspnUrl({...base,mode:'site_summary'})).searchParams.get('event'),'401873032')
  assert.equal(new URL(extendedEspnUrl({...base,sport:'basketball',league:'nba',mode:'cdn_game'})).searchParams.get('gameId'),'401873032')
  assert.equal(new URL(extendedEspnUrl({...base,sport:'basketball',league:'nba',mode:'fantasy_player_info'})).searchParams.get('view'),'kona_player_info')
})
test('block invalid dates, injection, unsupported Fantasy/CDN leagues and missing IDs',()=>{
  for(const value of [
    {...base,mode:'site_scoreboard',date:'20260230'},
    {...base,mode:'site_scoreboard',date:'20261109&key=evil'},
    {...base,mode:'game_prop_bets',providerId:'../foo'},
    {...base,mode:'season_group_standings',groupId:undefined},
    {...base,mode:'cdn_game',eventId:undefined},
    {...base,mode:'fantasy_players',league:'wnba'},
    {...base,mode:'cdn_scoreboard',sport:'soccer',league:'eng.1'},
    {...base,mode:'search_entities',query:'a'},
  ])assert.throws(()=>extendedEspnUrl(value),/inválid|admitid|Falta/u)
})
test('does not call a ref-only collection an observed data payload',async()=>{
 const input={...base,mode:'game_odds'}
 const result=await readExtendedEspn(input,async()=>({count:1,items:[{
   $ref:'https://untrusted.example/odds/1',
 }]}))
 assert.equal(result.status,'ref_only')
 assert.equal(result.resolvedRefs,0)
})
