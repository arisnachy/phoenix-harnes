import {test} from 'node:test'
import assert from 'node:assert/strict'
import {crosscheckFreeFixture,freeOfficialFollowUps}
  from '../src/free-sports-source-audit.ts'

const game={sport:'basketball',league:'nba',eventId:'401909949',
  date:'2026-11-08',home:'Milwaukee Bucks',away:'Boston Celtics',
  kickoff:'2026-11-09T01:00:00Z'}
const reply=(payload,status=200)=>new Response(JSON.stringify(payload),{status})

test('free TheSportsDB agrees only with both teams, home/away and kickoff',async()=>{
  const calls=[]
  const f=async url=>{
    calls.push(String(url))
    return reply({events:[{strHomeTeam:'Milwaukee Bucks',
      strAwayTeam:'Boston Celtics',strTimestamp:'2026-11-09T01:00:00Z'}]})
  }
  const result=await crosscheckFreeFixture(game,f,Date.parse('2026-11-08T18:00:00Z'),{})
  assert.equal(result.length,1)
  assert.equal(result[0].provider,'TheSportsDB')
  assert.equal(result[0].status,'verified')
  assert.match(result[0].detail,/solo calendario/)
  assert.equal(calls.length,1)
  assert.match(calls[0],/eventsday\.php\?d=2026-11-08/)
  assert.ok(!('probability' in result[0]))
  assert.ok(!('odds' in result[0]))
})

test('reversed home-away at the same time is an explicit conflict',async()=>{
  const f=async()=>reply({events:[{strHomeTeam:'Boston Celtics',
    strAwayTeam:'Milwaukee Bucks',strTimestamp:'2026-11-09T01:00:00Z'}]})
  const result=await crosscheckFreeFixture(game,f)
  assert.equal(result[0].status,'conflict')
})

test('unmatched or stale free events never become evidence or contradiction',async()=>{
  const f=async()=>reply({events:[{strHomeTeam:'Milwaukee Bucks',
    strAwayTeam:'Boston Celtics',strTimestamp:'2026-11-11T01:00:00Z'}]})
  const result=await crosscheckFreeFixture(game,f)
  assert.equal(result[0].status,'not-found')
  assert.match(result[0].detail,/NO confirma ausencia/)
})

test('provider 429 is unavailable and never becomes an empty observed event',async()=>{
  const result=await crosscheckFreeFixture(game,async()=>reply({},429))
  assert.equal(result[0].status,'unavailable')
  assert.match(result[0].detail,/429/)
})

test('OpenLigaDB corroborates only Bundesliga and matches official home/away',async()=>{
  const german={sport:'soccer',league:'ger.1',eventId:'9001',
    date:'2026-11-08',home:'Borussia Dortmund',away:'Bayern Munich',
    kickoff:'2026-11-08T18:30:00Z'}
  const f=async url=>String(url).includes('openligadb')?
    reply([{team1:{teamName:'Borussia Dortmund'},
      team2:{teamName:'Bayern Munich'},
      matchDateTimeUTC:'2026-11-08T18:30:00Z'}]):
    reply({events:[]})
  const result=await crosscheckFreeFixture(german,f)
  assert.equal(result.length,2)
  assert.equal(result[0].status,'not-found')
  assert.equal(result[1].status,'verified')
  assert.match(result[1].url,/getmatchdata\/bl1\/2026/)
})

test('free source opt-out and strict event inputs',async()=>{
  const disabled=await crosscheckFreeFixture(game,async()=>{throw Error('no call')},
    Date.now(),{PHOENIX_SPORTS_FREE_BACKUPS_DISABLED:'1'})
  assert.deepEqual(disabled,[])
  await assert.rejects(()=>crosscheckFreeFixture({...game,date:'2026-02-30'},
    async()=>reply({events:[]})),/inválido/)
})

test('injury and starter references are unverified follow-ups, never evidence',()=>{
  assert.match(freeOfficialFollowUps('basketball','2026-11-08')[0],/official\.nba\.com/)
  assert.match(freeOfficialFollowUps('football','2026-11-08')[0],/nflverse/)
  assert.match(freeOfficialFollowUps('hockey','2026-11-08')[0],/no confirma titular/)
  assert.deepEqual(freeOfficialFollowUps('soccer','2026-11-08'),[])
})
