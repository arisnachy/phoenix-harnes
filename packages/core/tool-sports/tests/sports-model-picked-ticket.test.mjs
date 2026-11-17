import {test} from 'node:test'
import assert from 'node:assert/strict'
import {quoteKiraChosenTicket,ticketResearchChecklist} from '../src/sports-model-picked-ticket.ts'

const now=Date.parse('2026-11-17T17:00:00Z')
const leg=(eventId,overrides={})=>({
  sport:'basketball',league:'nba',eventId,date:'2026-11-17',
  home:'Home Team',away:'Away Team',kickoff:'2026-11-18T01:00:00Z',
  pick:'home',reason:'Kira contrastó jugadores, lesiones y resultados publicados.',
  ...overrides,
})
test('model controls choice; no quote must never create a priced ticket',async()=>{
  const fetcher=async()=>new Response(JSON.stringify({events:[]}),{
    status:200,headers:{'content-type':'application/json'}})
  const result=await quoteKiraChosenTicket([leg('40100')],fetcher,now)
  assert.equal(result.placed,false)
  assert.equal(result.priced,false)
  assert.equal(result.complete,false)
  assert.deepEqual(result.quotes,[])
  assert.equal(result.missing.length,1)
  assert.equal(result.uiBlock.props.legs[0].selection,'Home Team')
  assert.equal(result.uiBlock.props.legs[0].quoteStatus,'unpriced')
  assert.match(result.uiBlock.props.note,/TICKET INCOMPLETO/u)
})
test('cannot invent five picks from one or duplicates or wrong event state',async()=>{
  const never=async()=>{throw Error('No network expected')}
  await assert.rejects(quoteKiraChosenTicket([leg('40100'),leg('40100')],
    never,now),/únicos/)
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    kickoff:'2026-11-15T01:00:00Z'})],never,now),/justificación/)
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    reason:'Gana'})],never,now),/justificación/)
})
test('Kira must explicitly choose home or away without numerical ranking',async()=>{
  const never=async()=>{throw Error('No network expected')}
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    pick:'favourite'})],never,now),/justificación/)
})

test('final research checklist rejects five odds without source-level rebuttals',()=>{
  const legs=Array.from({length:5},(_,i)=>leg(String(40100+i)))
  const errors=ticketResearchChecklist(legs)
  assert.ok(errors.some(x=>/dos publicaciones leídas/.test(x)))
  assert.ok(errors.some(x=>/falta refutación/.test(x)))
  assert.ok(errors.some(x=>/riesgos críticos/.test(x)))
  const withEvidence=legs.map(l=>({...l,
    sourceUrls:['https://www.nhl.com/news/report','https://www.dailyfaceoff.com/news/report'],
    counterEvidence:'El adversario dispone de superioridad en el juego reciente.',
    criticalPending:[],
  }))
  assert.deepEqual(ticketResearchChecklist(withEvidence),[])
  assert.ok(ticketResearchChecklist(withEvidence.slice(0,4))
    .some(x=>/cinco o seis/.test(x)))
})
test('duplicate website citations do not fake a second independent source',()=>{
  const checked=leg('40100',{
    sourceUrls:['https://www.nhl.com/news/a','https://www.nhl.com/news/b'],
    criticalPending:[],
    counterEvidence:'El adversario puede dominar en situaciones especiales.',
  })
  assert.ok(ticketResearchChecklist([checked]).some(x=>/dos publicaciones/.test(x)))
})
