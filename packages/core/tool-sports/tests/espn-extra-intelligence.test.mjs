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
