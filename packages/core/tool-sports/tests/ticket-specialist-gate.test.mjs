import {test} from 'node:test'
import assert from 'node:assert/strict'
import {classifySpecialistCoverage,investigateTicketSpecialist,
  investigateTicketSpecialists,resolveNhlTicketMatch} from '../src/ticket-specialist-gate.ts'

const fixture=(sport,league='nfl',eventId='123')=>({
  sport,league,eventId,date:'2026-11-08',
  home:'Verified Home',away:'Verified Away',
  kickoff:'2026-11-08T21:00:00Z',
})

test('coverage from BOTH rivals and two investigated dimensions required',()=>{
  assert.equal(classifySpecialistCoverage('B',true,['roster','form'],[]).status,'researched')
  assert.equal(classifySpecialistCoverage('C',true,['roster','form'],[]).status,'incomplete')
  assert.equal(classifySpecialistCoverage('A',false,['roster','form'],[]).status,'incomplete')
  assert.equal(classifySpecialistCoverage('A',true,['roster'],[]).status,'incomplete')
})

test('even extensively researched bets remain unapproved without calibrated models',()=>{
  const review=classifySpecialistCoverage('A',true,
    ['starting lineup','injuries','individual matchups'],['forecast not calibrated'])
  assert.equal(review.status,'researched')
  assert.equal(review.approvedForBetting,false)
  assert.match(review.pendingSteps.join(' '),/not calibrated/)
})

test('missing data never turns into an approved or researched pick',()=>{
  const review=classifySpecialistCoverage(null,false,[],['missing QB'])
  assert.equal(review.status,'incomplete')
  assert.equal(review.approvedForBetting,false)
  assert.match(review.pendingSteps.join(' '),/missing QB/)
})

test('unknown sport is rejected without fetching or fabricating quotes',async()=>{
  const result=await investigateTicketSpecialist(fixture('golf','pga'),
    async()=>{throw Error('must not fetch')})
  assert.equal(result.status,'unavailable')
  assert.equal(result.approvedForBetting,false)
  assert.match(result.pendingSteps.join(' '),/Sin especialista/)
})

test('multiple unsupported fixtures retain exact identity and order',async()=>{
  const games=[fixture('golf','pga','123'),fixture('cricket','test','456')]
  const checks=await investigateTicketSpecialists(games,
    async()=>{throw Error('must not fetch')})
  assert.deepEqual(checks.map(x=>x.eventId),['123','456'])
  assert.deepEqual(checks.map(x=>x.status),['unavailable','unavailable'])
  assert.ok(checks.every(x=>x.approvedForBetting===false))
})

test('NHL gameId cannot cross from Devils-Jets to Panthers-Columbus',()=>{
  const slate=[
    {id:'2026020222',date:'2026-11-11T00:30:00Z',
      home:{name:'Columbus Blue Jackets'},away:{name:'Florida Panthers'}},
    {id:'2026020221',date:'2026-11-11T00:00:00Z',
      home:{name:'Winnipeg Jets'},away:{name:'New Jersey Devils'}},
  ]
  const target={home:'Winnipeg Jets',away:'New Jersey Devils',kickoff:'2026-11-11T00:00:00Z'}
  assert.equal(resolveNhlTicketMatch(slate,target)?.id,'2026020221')
  assert.equal(resolveNhlTicketMatch([slate[0]],target),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,
    home:'New Jersey Devils',away:'Winnipeg Jets'}),null)
  assert.equal(resolveNhlTicketMatch([slate[1],slate[1]],target),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,kickoff:'2026-11-11T07:00:00Z'}),null)
})
