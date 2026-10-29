import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkSportsTicket,validateSportsSettlement} from '../src/sports-bet-settlement.ts'
const date='2026-10-29'
const now=Date.parse('2026-10-30T10:00:00Z')
const root='https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261029'
const innings=ns=>ns.map(value=>({value}))
const fixture={events:[{id:'1001',status:{type:{state:'post'}},competitions:[{
  competitors:[
    {homeAway:'home',score:'5',team:{id:'3'},linescores:innings([1,0,2,0,0,1,1,0,0])},
    {homeAway:'away',score:'3',team:{id:'4'},linescores:innings([0,1,0,2,0,0,0,0,0])},
  ],
}]}]}
const fetcher=async(url)=>{
  assert.equal(String(url),root)
  return new Response(JSON.stringify(fixture),{status:200})
}
const leg=(market,selection,price,line)=>({
  eventId:'1001',market,selection,price,bookmaker:'Banca confirmada por usuario',
  ...(line===undefined?{}:{line}),
})
const base=(legs)=>({sport:'baseball',league:'mlb',date,stake:100,legs})
test('run line -1.5, 8.5 over, F5 and winning parlay remain provisional',async()=>{
  const result=await checkSportsTicket(base([
    leg('run_line','home',1.85,-1.5),
    leg('total','under',1.90,8.5),
    leg('first_5_total','over',1.80,3.5),
  ]),fetcher,{},now)
  assert.deepEqual(result.legs.map(x=>x.result),['won','won','won'])
  assert.equal(result.status,'won-provisional')
  assert.equal(result.provisionalReturn,316.35)
  assert.equal(result.profit,216.35)
  assert.equal(result.placementVerified,false)
  assert.equal(result.houseSettlementVerified,false)
})
test('push removes its price, winning leg remains; no fake refund or bookmaker-confirmed win',async()=>{
  const result=await checkSportsTicket(base([
    leg('total','over',1.90,8),leg('run_line','home',1.85,-1.5),
  ]),fetcher,{},now)
  assert.deepEqual(result.legs.map(x=>x.result),['push','won'])
  assert.equal(result.provisionalReturn,185)
  assert.equal(result.status,'won-provisional')
})
test('losing selection makes a combined ticket provisionally lost',async()=>{
  const result=await checkSportsTicket(base([
    leg('run_line','home',1.8,-2.5),
    leg('total','over',2.0,7.5),
  ]),fetcher,{},now)
  assert.equal(result.legs[0].result,'lost')
  assert.equal(result.provisionalReturn,0)
  assert.equal(result.profit,-100)
  assert.equal(result.status,'lost-provisional')
})
test('unverified players, unknown games and incomplete innings are not secretly won or voided',async()=>{
  const result=await checkSportsTicket(base([
    {...leg('player_prop','over',2.2,1.5),playerId:'88'},
    {...leg('total','over',1.5,0.5),eventId:'777'},
    leg('first_5_spread','home',1.85,-1.5),
  ]),async url=>{
    const modified=structuredClone(fixture)
    modified.events[0].competitions[0].competitors[0].linescores=[]
    return new Response(JSON.stringify(modified),{status:200})
  },{},now)
  assert.deepEqual(result.legs.map(x=>x.result),['unverifiable','unverifiable','unverifiable'])
  assert.equal(result.provisionalReturn,null)
  assert.equal(result.status,'pending')
})
test('strict reject: wrong bookmaker mixing, missing line, untrusted market and invalid team total',()=>{
  assert.throws(()=>validateSportsSettlement(base([
    leg('run_line','home',1.9,-1.5),{...leg('total','over',1.8,8),bookmaker:'Other'},
  ])),/misma casa/)
  assert.throws(()=>validateSportsSettlement(base([leg('total','over',1.90)])),/Línea/)
  assert.throws(()=>validateSportsSettlement(base([leg('made_up','home',2)])),/mercado/)
  assert.throws(()=>validateSportsSettlement(base([leg('team_total','over',1.9,3.5)])),/Total de equipo/)
  assert.throws(()=>validateSportsSettlement({...base([leg('h2h','home',1.9)]),date:'2026-02-30'}),/inválidos/)
})
test('one uncompleted game does not count as won while other game has settled',async()=>{
  const result=await checkSportsTicket(base([leg('h2h','home',2.0)]),
    async()=>new Response(JSON.stringify({...fixture,events:[{...fixture.events[0],status:{type:{state:'in'}}}]}),{status:200}),{},now)
  assert.equal(result.status,'pending')
  assert.equal(result.legs[0].result,'pending')
})
