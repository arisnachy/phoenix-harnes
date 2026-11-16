import {test} from 'node:test'
import assert from 'node:assert/strict'
import {preferredObservedQuote,presentObservedTicketLegs} from '../src/ticket-quote-presentation.ts'
const quote=(price,source='ESPN Site/Core (sin clave)',id='401000001')=>({
  eventId:id,bookmaker:'DraftKings',market:'h2h',selection:'Home Club',
  home:'Home Club',away:'Away Club',price,point:null,
  sportKey:'basketball_nba',source,time:'2026-11-16T23:00:00Z',
  updatedAt:'No indicada por ESPN',observedAt:'2026-11-16T16:00:00Z',
})
test('one ESPN quote is displayed per leg even when 4 of 5 are missing',()=>{
  const legs=Array.from({length:5},(_,i)=>({eventId:'40100000'+i,
    price:'Por verificar',bookmaker:'Sin casa confirmada',
    researchStatus:'conditional',pendingEvidence:['Lesiones sin confirmar']}))
  const group=[[quote(1.77)],[],[],[],[]]
  const actual=presentObservedTicketLegs(legs,group)
  assert.equal(actual.length,5)
  assert.equal(actual[0].price,'1.77')
  assert.equal(actual[0].bookmaker,'DraftKings')
  assert.equal(actual[0].quoteStatus,'espn-observed')
  assert.match(actual[0].quoteSource,/ESPN Site/)
  assert.equal(actual[0].bookmakerUpdatedAt,null)
  assert.equal(actual[0].researchStatus,'conditional')
  assert.equal(actual[0].quoteAcceptedByBookmaker,false)
  assert.equal(actual.filter(l=>l.quoteStatus==='unpriced').length,4)
  assert.equal(actual[1].price,'Por verificar')
  assert.equal(actual[1].bookmaker,'Sin casa confirmada')
})
test('ESPN remains primary even if secondary scraper has a larger price',()=>{
  const provider={...quote(4.5,'OddsHarvester/OddsPortal'),bookmaker:'Other Book'}
  assert.equal(preferredObservedQuote([provider,quote(1.77)]).source,
    'ESPN Site/Core (sin clave)')
})
test('malformed, unknown-bookmaker prices never become visible quotes',()=>{
  assert.equal(preferredObservedQuote([{...quote(Number.NaN)}]),null)
  assert.equal(preferredObservedQuote([{...quote(0.9)}]),null)
  assert.equal(preferredObservedQuote([{...quote(1.77),bookmaker:''}]),null)
  const actual=presentObservedTicketLegs([{researchStatus:'conditional'}],[[{...quote(0)}]])
  assert.equal(actual[0].price,'Por verificar')
  assert.equal(actual[0].quoteStatus,'unpriced')
})
