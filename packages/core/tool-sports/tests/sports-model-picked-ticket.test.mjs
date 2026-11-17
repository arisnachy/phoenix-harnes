import {test} from 'node:test'
import assert from 'node:assert/strict'
import {quoteKiraChosenTicket} from '../src/sports-model-picked-ticket.ts'

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
