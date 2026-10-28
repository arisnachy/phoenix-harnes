import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evidenceTicket} from '../src/evidence-ticket.ts'

const day='2026-10-28',now=Date.parse('2026-10-28T15:00:00Z')
const future='2026-10-28T23:00:00Z'
const base=(n,date,state,homeScore,awayScore)=>({
  id:String(n),date,status:{type:{state}},competitions:[{competitors:[
    {homeAway:'home',team:{id:String(n)+'1',displayName:'Home '+n},records:[{summary:'2-0'}],
      ...(homeScore===null?{}:{score:String(homeScore)})},
    {homeAway:'away',team:{id:String(n)+'2',displayName:'Away '+n},records:[{summary:'0-2'}],
      ...(awayScore===null?{}:{score:String(awayScore)})},
  ]}],
})
const fixture=(url,withHistory=true)=>{
  const key=String(url).match(/dates=([0-9]{8})/u)?.[1]
  if(!String(url).includes('/soccer/eng.1/'))return{events:[]}
  if(key==='20261028')return{events:Array.from({length:6},(_,i)=>base(100+i,future,'pre',null,null))}
  if(withHistory&&['20261027','20261026'].includes(key)){
    const stamp=key==='20261027'?'2026-10-27T21:00:00Z':'2026-10-26T21:00:00Z'
    return{events:Array.from({length:6},(_,i)=>base(100+i,stamp,'post',3,0))}
  }
  return{events:[]}
}
const mock=(history=true)=>async url=>new Response(JSON.stringify(fixture(url,history)),{status:200})
test('evidence-first automatic ticket returns exactly five sourced legs, no invented prices or probabilities',async()=>{
  const result=await evidenceTicket(5,day,'soccer',mock(),now)
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(new Set(result.card.props.legs.map(x=>x.event)).size,5)
  assert.equal(result.priced,false)
  assert.equal(result.modelProbabilities,false)
  assert.equal(result.card.props.combinedOdds,'No disponible')
})
test('auto ticket blocks unsupported predictions when historic games are unavailable',async()=>{
  await assert.rejects(()=>evidenceTicket(5,day,'soccer',mock(false),now),/No hay encuentros con suficiente evidencia/)
})
test('auto ticket rejects unsupported sports or leg counts',async()=>{
  await assert.rejects(()=>evidenceTicket(7,day,'soccer',mock(),now),/1 y 6/)
  await assert.rejects(()=>evidenceTicket(5,day,'unknown',mock(),now),/sin cobertura/)
})
