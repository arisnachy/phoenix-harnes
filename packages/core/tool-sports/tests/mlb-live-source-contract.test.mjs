import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverMlbDay} from '../src/mlb-evidence-research.ts'

const base='https://statsapi.mlb.com/api/v1'
async function official(path){
  const response=await fetch(base+path,{signal:AbortSignal.timeout(15000)})
  assert.equal(response.ok,true,'MLB source unavailable: '+path+' ('+response.status+')')
  return response.json()
}

test('real MLB Stats API: schedule IDs -> boxscore -> venue -> player statistics', {
  timeout:90000,
},async()=>{
  // Completed historical game: stable identity and no reliance on today's off-season slate.
  const slate=await discoverMlbDay('2025-07-02')
  assert.ok(slate.fixtures.length>0,'Historical MLB schedule returned no fixtures')
  const fixture=slate.fixtures.find(g=>g.venue.id!==null)
  assert.ok(fixture,'No verified gamePk with venue ID')
  assert.ok(fixture.gamePk>0&&fixture.home.id!==fixture.away.id)
  assert.ok(slate.sources.some(s=>s.status==='verified'))
  const box=await official('/game/'+fixture.gamePk+'/boxscore')
  const home=box?.teams?.home
  assert.ok(Array.isArray(home?.batters)&&home.batters.length>=9,
    'Completed game has no observable batting roster')
  assert.ok(Object.keys(home?.players??{}).length>=9)
  const venue=await official('/venues?venueIds='+fixture.venue.id)
  assert.ok(venue?.venues?.some(v=>v.id===fixture.venue.id&&v.name),
    'Venue identity does not match game fixture')
  const playerId=home.batters.find(n=>Number.isSafeInteger(n)&&n>0)
  assert.ok(playerId,'No genuine batter ID in boxscore')
  const player=await official('/people/'+playerId)
  assert.ok(player?.people?.some(p=>p.id===playerId))
  const stats=await official('/people/'+playerId+
    '/stats?stats=season&group=hitting&season=2025')
  assert.ok(Array.isArray(stats?.stats),'Season stats contract missing')
  const standings=await official('/standings?leagueId=103,104&season=2025&date=2025-07-01')
  assert.ok(Array.isArray(standings?.records)&&standings.records.length>0)
})
