import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evidencePricedTicket} from '../src/evidence-priced-ticket.ts'

const date='2026-10-28',now=Date.parse('2026-10-28T15:00:00Z')
const kick='2026-10-28T23:00:00Z'
const board=(url)=>{
  const day=String(url).match(/dates=([0-9]{8})/u)?.[1]
  if(!String(url).includes('/soccer/eng.1/'))return{events:[]}
  if(!['20261028','20261027','20261026'].includes(day))return{events:[]}
  const pre=day==='20261028'
  return{events:Array.from({length:5},(_,i)=>({
    id:String(500+i),date:pre?kick:day==='20261027'?'2026-10-27T21:00:00Z':'2026-10-26T21:00:00Z',
    status:{type:{state:pre?'pre':'post'}},competitions:[{competitors:[
      {homeAway:'home',team:{id:String(i)+'1',displayName:'Home '+i},...(!pre?{score:'3'}:{})},
      {homeAway:'away',team:{id:String(i)+'2',displayName:'Away '+i},...(!pre?{score:'0'}:{})},
    ]}],
  }))}}
}
const feed=async url=>new Response(JSON.stringify(board(url)),{status:200})
const mkQuotes=(alternating=false)=>async()=>{
  const out=[]
  for(let i=0;i<5;i++)out.push({
    eventId:'scraper-'+i,bookmaker:alternating&&i===4?'Book B':'Book A',
    market:'1x2',selection:'Home '+i,point:null,price:1.91,
    home:'Home '+i,away:'Away '+i,time:kick,updatedAt:'2026-10-28T14:30:00Z',
    sportKey:'football',source:'OddsHarvester/OddsPortal (sin API key)',
  })
  return out
}
const enabled={PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'}
test('six-legged evidence path quotes only same bookmaker and preserves the requested stake',async()=>{
  // With five real fixtures and six requested legs, never invent the sixth.
  const draft=await evidencePricedTicket(6,date,'soccer',100,now,enabled,feed,mkQuotes())
  assert.equal(draft.complete,false)
  assert.equal(draft.priced,false)
  assert.equal(draft.verifiedEvents,5)
  const complete=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,mkQuotes())
  assert.equal(complete.complete,true)
  assert.equal(complete.priced,true)
  assert.equal(complete.card.props.legs.length,5)
  assert.equal(complete.card.props.stake,'100.00')
  assert.equal(complete.placed,false)
  assert.equal(complete.missingQuotes,0)
})
test('does not combine prices from different bookmakers even when each leg was quoted',async()=>{
  const result=await evidencePricedTicket(5,date,'soccer',100,now,enabled,feed,mkQuotes(true))
  assert.equal(result.priced,false)
  assert.equal(result.quotedLegs,5)
  assert.equal(result.missingQuotes,0)
  assert.match(result.explanation,/distintas casas/)
})
