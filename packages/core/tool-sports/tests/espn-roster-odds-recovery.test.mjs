import {test} from 'node:test'
import assert from 'node:assert/strict'
import {espnAthleteId,parseEspnRoster,recoverEspnRoster}
  from '../src/espn-public-roster.ts'
import {collectDirectEspnStats} from '../src/sports-direct-stats.ts'
import {fetchPublicEspnOddsDetailed} from '../src/espn-odds.ts'
import {fetchEspnInjuryBackup} from '../src/espn-injury-backup.ts'
const base='https://site.api.espn.com/apis/site/v2/sports/'
const now=Date.parse('2026-11-12T15:00:00Z')
const json=(v)=>new Response(JSON.stringify(v),{status:200})
test('ESPN roster parses flat NBA athletes and group NHL/NFL rosters with link-only IDs',()=>{
  const flat=parseEspnRoster({athletes:[
    {displayName:'Player Alpha',links:[{href:'https://www.espn.com/nba/player/_/id/3146557/player-alpha'}]},
    {id:'4312',displayName:'Player Bravo',position:{abbreviation:'G'}},
  ]})
  assert.equal(flat.length,2)
  assert.equal(flat[0].id,'3146557')
  assert.equal(flat[1].id,'4312')
  const grouped=parseEspnRoster({athletes:[{items:[{
    athlete:{displayName:'Goalie',position:{abbreviation:'G'},
      $ref:'http://sports.core.api.espn.pvt/v2/sports/hockey/leagues/nhl/athletes/8675309'}
  }]}]})
  assert.equal(grouped[0].id,'8675309')
  assert.equal(espnAthleteId({displayName:'Unknown',
    links:[{href:'https://evil.example/id/999999/'}]}),'')
  assert.equal(espnAthleteId({displayName:'No ID'},
    {links:[{href:'https://www.espn.com/nba/player/_/id/411000/a'}]}),'411000')
})
test('numbered team roster empty -> only SAME verified team abbreviation may be retried',async()=>{
  const routes=[]
  const read=async(url)=>{routes.push(url)
    if(url===base+'hockey/nhl/teams/1/roster')return {athletes:[]}
    if(url===base+'hockey/nhl/teams/1')return {team:{
      id:'1',displayName:'Boston Bruins',abbreviation:'BOS'}}
    if(url===base+'hockey/nhl/teams/bos/roster')
      return {athletes:[{id:'250',displayName:'ESPN Goalie',
        position:{abbreviation:'G'}}]}
    return null
  }
  const r=await recoverEspnRoster('hockey','nhl',{id:'1',name:'Boston Bruins'},read)
  assert.equal(r.people[0].id,'250')
  assert.equal(r.attempts.length,3)
  assert.ok(routes.some(x=>x.endsWith('/teams/bos/roster')))
  const mismatch=await recoverEspnRoster('hockey','nhl',
    {id:'1',name:'Montreal Canadiens'},read)
  assert.equal(mismatch.people.length,0)
  assert.equal(mismatch.attempts.length,2)
})
test('direct stats invoke verified abbreviation fallback, not fake player membership',async()=>{
  const calls=[]
  const transport=async url=>{const u=String(url);calls.push(u)
    if(u.endsWith('/teams/1'))return json({team:{
      id:'1',displayName:'Boston Bruins',abbreviation:'BOS'}})
    if(u.endsWith('/teams/bos/roster'))return json({athletes:[{
      displayName:'Forward Example',position:{abbreviation:'C'},
      links:[{href:'https://www.espn.com/nhl/player/_/id/100234/forward-example'}]
    }]})
    return json({})
  }
  const report=await collectDirectEspnStats('hockey','nhl',
    [{id:'1',name:'Boston Bruins'}],transport,now,1)
  assert.equal(report.teams[0].athleteCount,1)
  assert.equal(report.teams[0].athletes[0].id,'100234')
  assert.ok(report.teams[0].coverage.some(x=>x.endpoint.endsWith('/teams/bos/roster')
    &&x.status==='available'))
})
test('injuries recover athlete ID from personal $ref only, not adjacent unrelated ids',async()=>{
  const fixture={sport:'basketball',league:'nba',home:'Boston Celtics',
    away:'Milwaukee Bucks',date:'2026-11-12'}
  const feed={timestamp:new Date(now).toISOString(),injuries:[
    {displayName:'Boston Celtics',injuries:[{status:'Out',date:new Date(now).toISOString(),
      athlete:{displayName:'Player One'},$ref:
      'http://sports.core.api.espn.pvt/v2/sports/basketball/leagues/nba/athletes/3146557/injuries/527211'}]},
    {displayName:'Milwaukee Bucks',injuries:[{status:'Questionable',date:new Date(now).toISOString(),
      athlete:{displayName:'Player Two',
        links:[{href:'https://www.espn.com/nba/player/_/id/20024/player-two'}]}}]},
  ]}
  const result=await fetchEspnInjuryBackup(fixture,
    async()=>json(feed),now)
  assert.equal(result.home.injuries[0].athleteId,'3146557')
  assert.equal(result.away.injuries[0].athleteId,'20024')
  assert.equal(result.away.injuries[0].status,'Questionable')
})
const event=(compId='7002')=>({events:[{id:'7001',
  date:'2026-11-12T23:00:00Z',status:{type:{state:'pre'}},
  competitions:[{id:compId,competitors:[
    {homeAway:'home',team:{displayName:'Home NBA'}},
    {homeAway:'away',team:{displayName:'Away NBA'}}],
  }]}]})
test('Core odds use actual competitionId, resolve ESPN .pvt refs and current ML',async()=>{
  const calls=[]
  const core='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/7001/competitions/7002/odds'
  const fetcher=async url=>{const u=String(url);calls.push(u)
    if(u.includes('/scoreboard?dates=20261112'))return event()
    if(u===core+'?limit=12')return {items:[{$ref:
      'http://sports.core.api.espn.pvt/v2/sports/basketball/leagues/nba/events/7001/competitions/7002/odds/5'}]}
    if(u===core+'/5')return {provider:{name:'DraftKings'},
      homeTeamOdds:{moneyLine:-190,current:{moneyLine:-145}},
      awayTeamOdds:{current:{moneyLine:+125}}}
    return {}
  }
  const result=await fetchPublicEspnOddsDetailed('basketball_nba','h2h',fetcher,
    {date:'20261112',eventId:'7001',now})
  assert.equal(result.quotes.length,2)
  assert.equal(result.quotes[0].bookmaker,'DraftKings')
  assert.equal(result.quotes[0].price,1.68966)
  assert.equal(result.quotes[1].price,2.25)
  assert.ok(calls.includes(core+'/5'))
  assert.equal(result.diagnostics.resolvedRefs,1)
})
test('Site Web summary fallback can recover NHL markets when Site/Core empty',async()=>{
  const calls=[]
  const fetcher=async url=>{const u=String(url);calls.push(u)
    if(u.includes('/scoreboard?dates=20261112'))
      return {events:[{id:'5555',date:'2026-11-12T23:00:00Z',
        competitions:[{id:'5555',competitors:[
          {homeAway:'home',team:{displayName:'Home NHL'}},
          {homeAway:'away',team:{displayName:'Away NHL'}},
        ]}]}]}
    if(u.startsWith('https://site.web.api.espn.com/')&&u.includes('/summary?'))
      return {pickcenter:[{provider:{name:'DraftKings'},
        homeTeamOdds:{current:{moneyLine:-120}},
        awayTeamOdds:{current:{moneyLine:+105}}}]}
    return {}
  }
  const result=await fetchPublicEspnOddsDetailed('icehockey_nhl','h2h',fetcher,
    {date:'20261112',eventId:'5555',now})
  assert.equal(result.quotes.length,2)
  assert.ok(result.quotes.every(x=>x.endpointSource==='summary'))
  assert.ok(calls.some(x=>x.startsWith('https://site.web.api.espn.com/')))
})
