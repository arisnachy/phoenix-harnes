import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildAutomaticSportsTicket,rankMarketFavorites} from '../src/ticket-autopilot.ts'

const now=Date.now()
const stamp=new Date(now-1000).toISOString()
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now+86400000))
const quotes=(house,event,homePrice=1.7,awayPrice=2.4)=>[
  {sportKey:'basketball_nba',eventId:event,bookmaker:house,market:'h2h',
    selection:'Home '+event,price:homePrice,home:'Home '+event,away:'Away '+event,
    time:'Mañana',updatedAt:stamp},
  {sportKey:'basketball_nba',eventId:event,bookmaker:house,market:'h2h',
    selection:'Away '+event,price:awayPrice,home:'Home '+event,away:'Away '+event,
    time:'Mañana',updatedAt:stamp},
]
const mockFallback=async(count,_date,leagues)=>({
  verifiedEvents:Math.min(2,count),complete:count<=2,
  card:{component:'sports_ticket_card',version:1,props:{
    title:'Ticket investigación',source:'ESPN verificado',
    legs:Array.from({length:Math.min(2,count)},(_,i)=>({
      event:'Visita '+i+' vs Local '+i,selection:'Local '+i,price:'Por verificar',
      bookmaker:'Sin casa confirmada',
    })),requestedLegs:count,combinedOdds:'No disponible',
    note:'Pronósticos sin precio · ligas '+leagues.join(','),
  }},
})
test('autopilot provides complete priced ticket with one bookmaker and correct stake',async()=>{
  const api=[...quotes('Casa Uno','101'),...quotes('Casa Uno','102'),
    ...quotes('Casa Uno','103'),...quotes('Casa Dos','104')]
  const calls=[]
  const result=await buildAutomaticSportsTicket(3,day,['basketball_nba'],100,
    async(key,date)=>{calls.push([key,date]);return api},mockFallback,now)
  assert.deepEqual(calls,[['basketball_nba',day]])
  assert.equal(result.mode,'priced')
  assert.equal(result.complete,true)
  assert.equal(result.priced,true)
  assert.equal(result.placed,false)
  assert.equal(result.card.props.requestedLegs,3)
  assert.equal(result.card.props.legs.length,3)
  assert.equal(result.card.props.stake,'100.00')
  assert.equal(result.card.props.grossReturn,'491.30')
  assert.ok(result.card.props.legs.every(x=>x.bookmaker==='Casa Uno'))
  assert.ok(result.card.props.legs.every(x=>x.rationale.includes('Favorito observado')))
})
test('autopilot continues through provider failures and returns a clearly unpriced research card',async()=>{
  const result=await buildAutomaticSportsTicket(5,day,['basketball_nba'],100,
    async()=>{throw Error('HTTP 503')},mockFallback,now)
  assert.equal(result.mode,'research')
  assert.equal(result.complete,false)
  assert.equal(result.priced,false)
  assert.equal(result.placed,false)
  assert.equal(result.verifiedEvents,2)
  assert.equal(result.card.props.legs.length,2)
  assert.equal(result.providerErrors.length,1)
  assert.match(result.card.props.note,/nba/)
})
test('one quoted outcome does not establish the market favorite and bookmaker groups are not mixed',()=>{
  const ranked=rankMarketFavorites([
    ...quotes('Casa A','101'),
    ...quotes('Casa B','102'),
    quotes('Casa A','103')[0],
  ],3,now)
  assert.equal(ranked.length,2)
  assert.equal(ranked[0].legs.length,1)
  assert.equal(ranked[0].legs[0].quote.eventId,'101')
  assert.equal(ranked[1].legs[0].quote.eventId,'102')
})
test('stale price observations and invalid inputs never become a quoted ticket',async()=>{
  const old=new Date(now-90*60_000).toISOString()
  const ranked=rankMarketFavorites(quotes('Casa A','101').map(q=>({...q,updatedAt:old})),3,now)
  assert.deepEqual(ranked,[])
  const lookup=async()=>[]
  await assert.rejects(()=>buildAutomaticSportsTicket(0,day,['basketball_nba'],0,lookup,mockFallback,now),/Número/)
  await assert.rejects(()=>buildAutomaticSportsTicket(3,'2026-02-31',['basketball_nba'],0,lookup,mockFallback,now),/Fecha/)
})
test('requires provider comparisons within the same house even if other houses have more games',async()=>{
  const api=[...quotes('A','1'),...quotes('A','2'),...quotes('B','3'),...quotes('B','4')]
  const result=await buildAutomaticSportsTicket(3,day,['basketball_nba'],0,
    async()=>api,mockFallback,now)
  assert.equal(result.mode,'research')
  assert.equal(result.priced,false)
  assert.equal(result.requestedLegs,3)
})
