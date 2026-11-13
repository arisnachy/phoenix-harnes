import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explainOddsEligibility,eligibleOddsForResearch}
  from '../src/espn-odds-observation-gate.ts'
const now=Date.parse('2026-11-12T22:00:00Z')
const base={
  eventId:'401909977',bookmaker:'DraftKings',market:'h2h',
  selection:'Detroit Pistons',price:1.22831,
  timeIso:'2026-11-13T01:00:00Z',source:'ESPN core (sin clave)',
  observedAt:'2026-11-12T22:00:00Z',
  updatedAt:'No indicada por ESPN',
}
test('ESPN same-day exact event price without bookmaker lastUpdated is an observed market quote',()=>{
  assert.equal(explainOddsEligibility(base,now),'espn_observed')
  assert.equal(eligibleOddsForResearch(base,now),true)
})
test('NHL ESPN price with older bookmaker last change remains a current ESPN observation',()=>{
  const q={...base,eventId:'401892702',selection:'Buffalo Sabres',
    updatedAt:'2026-11-08T15:00:00Z',source:'ESPN summary (sin clave)'}
  assert.equal(explainOddsEligibility(q,now),'espn_observed')
})
test('eventId and calendar date are not proof of unstarted game or available market',()=>{
  assert.equal(explainOddsEligibility({...base,timeIso:'2026-11-12T21:00:00Z'},now),
    'started_or_invalid_event')
  assert.equal(explainOddsEligibility({...base,bookmaker:'ESPN proveedor #41 (nombre no verificado)'},now),
    'missing_price_or_bookmaker')
  assert.equal(explainOddsEligibility({...base,price:NaN},now),
    'missing_price_or_bookmaker')
  assert.equal(explainOddsEligibility({...base,updatedAt:'2026-11-15T12:00:00Z'},now),
    'future_bookmaker_timestamp')
})
test('ESPN observations must be genuinely read during this request, not stale snapshots',()=>{
  assert.equal(explainOddsEligibility({...base,observedAt:undefined},now),
    'espn_observation_missing_or_old')
  assert.equal(explainOddsEligibility({...base,observedAt:'2026-11-11T22:00:00Z'},now),
    'espn_observation_missing_or_old')
})
test('other odds providers preserve their independent bookmaker timestamp policy',()=>{
  const external={...base,source:'The Odds API',updatedAt:'2026-11-12T21:55:00Z',
    observedAt:undefined}
  assert.equal(explainOddsEligibility(external,now),'provider_recent')
  assert.equal(explainOddsEligibility({...external,updatedAt:'No indicada por ESPN'},now),
    'provider_timestamp_missing_or_old')
  assert.equal(explainOddsEligibility({...external,updatedAt:'2026-11-12T20:00:00Z'},now),
    'provider_timestamp_missing_or_old')
})
