import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cloudForecastTicket,cloudReceiptTicket,registerCloudForecast,
  registerCloudReceipt} from '../src/sports-cloud-host.ts'
const events=Array.from({length:5},(_,i)=>({
  eventId:String(200+i),sport:'soccer',league:'eng.1',
  date:'2026-11-09',pick:'home',kickoff:'2026-11-09T20:00:00Z',
}))
test('forecast without bookmaker quotes never registers double chance from a straight winner',()=>{
 const ticket=cloudForecastTicket(events,'double_chance',false)
 assert.ok(ticket.legs.every(x=>x.market==='winner'&&x.selection==='home'))
 assert.equal(ticket.kind,'research')
})
test('priced soccer double chance maps home and away to separate valid settlement markets',()=>{
 const cases=[{...events[0],pick:'home'},{...events[1],pick:'away'}]
 const ticket=cloudForecastTicket(cases,'double_chance',true)
 assert.deepEqual(ticket.legs.map(x=>x.selection),['1X','X2'])
 assert.ok(ticket.legs.every(x=>x.market==='double_chance'))
})
test('receipt tracking preserves each market and signed line, rejects unsupported live props',()=>{
 const base={sport:'basketball',league:'nba',date:'2026-11-09'}
 const x=cloudReceiptTicket('12345',[
  {...base,eventId:'410',goal:{market:'spread',side:'home',line:-1.5}},
  {...base,eventId:'411',goal:{market:'total',side:'under',line:221.5}},
 ])
 assert.equal(x.kind,'receipt')
 assert.deepEqual(x.legs.map(y=>y.line),[-1.5,221.5])
 assert.throws(()=>cloudReceiptTicket('12345',[{
  ...base,eventId:'412',goal:{market:'player_prop',side:'over',line:1.5}
 }]))
})
test('monitor disabled does not call GitHub or leak ticket on either ticket creation route',async()=>{
 let requests=0
 const mock=async()=>{requests++;throw Error('unexpected network')}
 const env={}
 assert.equal((await registerCloudForecast(events,'winner',false,env,mock)).status,'disabled')
 assert.equal((await registerCloudReceipt('ABC',[{
   sport:'basketball',league:'nba',eventId:'5',date:'2026-11-09',
   goal:{market:'moneyline',side:'home'}
 }],env,mock)).status,'disabled')
 assert.equal(requests,0)
})
