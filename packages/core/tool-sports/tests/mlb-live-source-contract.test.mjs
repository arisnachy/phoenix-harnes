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
  // Exercise the exact hydrated endpoint used by researchMlbCase, not a
  // different unhydrated venue-list route.
  const venue=await official('/venues/'+fixture.venue.id+'?hydrate=location,fieldInfo')
  assert.ok(venue?.venues?.some(v=>v.id===fixture.venue.id&&v.name),
    'Hydrated venue identity does not match game fixture')
  const playerId=home.batters.find(n=>Number.isSafeInteger(n)&&n>0)
  assert.ok(playerId,'No genuine batter ID in boxscore')
  const player=await official('/people/'+playerId)
  assert.ok(player?.people?.some(p=>p.id===playerId))
  const stats=await official('/people/'+playerId+
    '/stats?stats=season&group=hitting&season=2025')
  assert.ok(Array.isArray(stats?.stats),'Season stats contract missing')
  // Validate the real pitcher game-log shape consumed by the dossier, rather
  // than only the generic player/season endpoints.
  const pitcherId=home.pitchers?.find(n=>Number.isSafeInteger(n)&&n>0)
  assert.ok(pitcherId,'Completed boxscore has no official pitcher ID')
  const pitcher=await official('/people/'+pitcherId)
  assert.ok(pitcher?.people?.some(p=>p.id===pitcherId))
  const gameLog=await official('/people/'+pitcherId+
    '/stats?stats=gameLog&group=pitching&season=2025')
  assert.ok(Array.isArray(gameLog?.stats),'Pitcher gameLog contract missing')
  assert.ok(gameLog.stats.some(group=>Array.isArray(group.splits)&&
    group.splits.some(split=>typeof split.date==='string'&&split.stat)),
    'Historical pitcher gameLog has no dated evidence')
  const dodgerVenue=await official('/venues/22?hydrate=location,fieldInfo')
  assert.ok(dodgerVenue?.venues?.some(v=>v.id===22&&
    ['Open','Indoor','Retractable'].includes(v.fieldInfo?.roofType)),
    'Hydrated MLB fieldInfo must expose the official roof construction type')
  const standings=await official('/standings?leagueId=103,104&season=2025&date=2025-07-01')
  assert.ok(Array.isArray(standings?.records)&&standings.records.length>0)
})
