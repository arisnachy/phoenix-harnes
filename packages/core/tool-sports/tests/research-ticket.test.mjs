import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchTicket,autoResearchTicket} from '../src/research-ticket.ts'

const future = () => new Date(Date.now()+2*86_400_000).toISOString()
const fixture = (date, state='pre') => ({
  events:[{id:'2045',date,status:{type:{state}},competitions:[{competitors:[
    {homeAway:'home',team:{displayName:'Atlas'}},
    {homeAway:'away',team:{displayName:'Puebla'}},
  ]}]}],
})
const dayOf = (iso) => new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(iso))
const mock = (value,urls=[]) => async (url) => {
  urls.push(String(url))
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}})
}
const selected = (pick='home') => [{sport:'soccer',league:'mex.1',eventId:'2045',pick,
  rationale:'Hipótesis sobre desempeño reciente; requiere contrastar estadísticas.'}]

test('generates a visual research ticket from future verified soccer fixture without prices',async()=>{
  const at=future(),urls=[]
  const result=await researchTicket(selected(),dayOf(at),mock(fixture(at),urls))
  assert.equal(result.card.component,'sports_ticket_card')
  assert.equal(result.verifiedEvents,1)
  assert.equal(result.priced,false)
  assert.equal(result.placed,false)
  assert.equal(result.card.props.legs[0].event,'Puebla vs Atlas')
  assert.equal(result.card.props.legs[0].selection,'Atlas')
  assert.equal(result.card.props.legs[0].price,'Por verificar')
  assert.equal(result.card.props.legs[0].bookmaker,'Sin casa confirmada')
  assert.equal(result.card.props.legs[0].league,'Liga MX')
  assert.equal(result.card.props.combinedOdds,'No disponible')
  assert.equal(result.card.props.grossReturn,undefined)
  assert.match(result.card.props.note,/SIN APUESTA REAL/)
  assert.match(urls[0],/site\.api\.espn\.com.*soccer\/mex\.1\/scoreboard/)
})
test('handles legitimate soccer draw without inventing odds',async()=>{
  const at=future()
  const result=await researchTicket(selected('draw'),dayOf(at),mock(fixture(at)))
  assert.equal(result.card.props.legs[0].selection,'Empate')
  assert.equal(result.card.props.legs[0].price,'Por verificar')
})
test('refuses started and finished events, invented event IDs and repeated event',async()=>{
  const at=future(),day=dayOf(at)
  await assert.rejects(()=>researchTicket(selected(),day,mock(fixture(at,'post'))),/iniciado o finalizado/)
  await assert.rejects(()=>researchTicket(selected(),day,mock(fixture(new Date(Date.now()-1000).toISOString()))),/iniciado o finalizado/)
  await assert.rejects(()=>researchTicket([{...selected()[0],eventId:'0000'}],day,mock(fixture(at))),/no encontrado/)
  await assert.rejects(()=>researchTicket([...selected(),...selected()],day,mock(fixture(at))),/duplicado/)
})
test('does not fetch arbitrary hosts or allow invalid markets and dates',async()=>{
  const at=future(),day=dayOf(at),urls=[]
  await assert.rejects(()=>researchTicket([{...selected()[0],league:'../../secret'}],day,mock(fixture(at),urls)),/evento real/)
  await assert.rejects(()=>researchTicket([{...selected()[0],pick:'spread'}],day,mock(fixture(at),urls)),/evento real/)
  await assert.rejects(()=>researchTicket([{...selected()[0],sport:'baseball',league:'mlb',pick:'draw'}],day,mock(fixture(at),urls)),/evento real/)
  await assert.rejects(()=>researchTicket(selected(),'2026-02-31',mock(fixture(at),urls)),/Fecha/)
  await assert.rejects(()=>researchTicket(selected(),day,mock(fixture(at),urls),Date.now(),{PHOENIX_SPORTS_ESPN_DISABLED:'1'}),/deshabilitado/)
  assert.deepEqual(urls,[])
})
test('reuses one verified scoreboard query for multiple different events',async()=>{
  const at=future(),day=dayOf(at),urls=[]
  const board=fixture(at);board.events.push({...board.events[0],id:'2046'})
  const legs=[...selected(),{...selected()[0],eventId:'2046',pick:'away'}]
  const result=await researchTicket(legs,day,mock(board,urls))
  assert.equal(result.card.props.legs.length,2)
  assert.equal(urls.length,1)
  assert.equal(result.card.props.legs[1].selection,'Puebla')
})

test('five requested legs cannot silently become a one-leg completed ticket',async()=>{
  const at=future(),day=dayOf(at)
  await assert.rejects(
    ()=>researchTicket(selected(),day,mock(fixture(at)),Date.now(),{},5),
    /Ticket incompleto: solicitaste 5 patas y recibí 1/,
  )
})
const recordEvent=(id,at,hw='3-0',aw='0-3')=>({
  id:String(id),date:at,status:{type:{state:'pre'}},competitions:[{competitors:[
    {homeAway:'home',team:{displayName:'Home '+id,logo:'https://a.espncdn.com/logo.png'},records:[{summary:hw}]},
    {homeAway:'away',team:{displayName:'Away '+id,logo:'https://a.espncdn.com/away.png'},records:[{summary:aw}]},
  ]}],
})
test('automatic research discovers five unique real ESPN fixtures without synthetic IDs',async()=>{
  const at=future(),urls=[]
  const mockBoards=async(url)=>{
    urls.push(String(url))
    const board=String(url).includes('/basketball/nba/')?{events:Array.from({length:6},(_,i)=>recordEvent(301+i,at))}:{events:[]}
    return new Response(JSON.stringify(board),{status:200})
  }
  const result=await autoResearchTicket(5,dayOf(at),mockBoards)
  assert.equal(result.complete,true)
  assert.equal(result.verifiedEvents,5)
  assert.equal(result.card.props.requestedLegs,5)
  assert.equal(result.card.props.legs.length,5)
  assert.equal(new Set(result.card.props.legs.map(x=>x.event)).size,5)
  assert.equal(result.card.props.legs[0].homeLogo,'https://a.espncdn.com/logo.png')
  assert.equal(result.card.props.legs[0].homeTeam,'Home 301')
  assert.equal(result.card.props.legs[0].awayTeam,'Away 301')
  assert.equal(result.card.props.legs[0].price,'Por verificar')
  assert.equal(urls.length,8)
  assert.equal(urls.filter(u=>u.includes('/basketball/nba/')).length,1)
})
test('automatic research marks 2 of 5 as incomplete instead of claiming success',async()=>{
  const at=future()
  const fetched=async(url)=>new Response(JSON.stringify(
    String(url).includes('/basketball/nba/')?
      {events:[recordEvent(401,at),recordEvent(402,at)]}:{events:[]},
  ),{status:200})
  const result=await autoResearchTicket(5,dayOf(at),fetched)
  assert.equal(result.complete,false)
  assert.equal(result.verifiedEvents,2)
  assert.equal(result.card.props.requestedLegs,5)
  assert.match(result.card.props.note,/faltan 3 patas/)
  assert.match(result.card.props.title,/incompleto/)
})
test('automatic research will not fabricate legs when records or fixture data are missing',async()=>{
  const at=future()
  const fetched=async()=>new Response(JSON.stringify({events:[{
    id:'700',date:at,status:{type:{state:'pre'}},competitions:[{competitors:[
      {homeAway:'home',team:{displayName:'Home'}},
      {homeAway:'away',team:{displayName:'Away'}},
    ]}],
  }]}),{status:200})
  await assert.rejects(()=>autoResearchTicket(5,dayOf(at),fetched),/No hay eventos futuros/)
})
