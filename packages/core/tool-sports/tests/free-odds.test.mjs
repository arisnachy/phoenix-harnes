import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchTheOddsApi} from '../src/free-odds.ts'
import {marketOdds,pricedTicket} from '../src/sports.ts'

const at=new Date(Date.now()+86_400_000).toISOString()
const payload={success:true,source:'cache',data:[{
  event_id:'nba-provider-33',sport:'basketball',league:'NBA',
  home_team:'Atlanta Hawks',away_team:'Miami Heat',start_time:at,
  books:[{book:'draftkings',market:'h2h',updated_at:'2026-10-28T16:30:00Z',
    outcomes:[{name:'Atlanta Hawks',price:1.81},{name:'Miami Heat',price:2.12}]},
  {book:'fanduel',market:'h2h',updated_at:'2026-10-28T16:31:00Z',
    outcomes:[{name:'Atlanta Hawks',price:1.9},{name:'Miami Heat',price:2.03}]}],
}]}
const mock=(requestLog)=>async(url,options)=>{
  requestLog.push({url:String(url),options})
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}})
}

test('independent free-tier odds provider requires its own header, never leaks key in URL',async()=>{
  const log=[]
  const quotes=await fetchTheOddsApi('basketball_nba','h2h','test-secret-only',mock(log))
  assert.equal(quotes.length,4)
  assert.equal(quotes[0].source,'TheOddsAPI')
  assert.equal(quotes[0].price,1.81)
  assert.equal(quotes[0].eventId,'nba-provider-33')
  assert.equal(quotes[0].updatedAt,'2026-10-28T16:30:00Z')
  assert.ok(log[0].url.startsWith('https://api.theoddsapi.com/odds/'))
  assert.ok(!log[0].url.includes('test-secret-only'))
  assert.equal(log[0].options.headers['x-api-key'],'test-secret-only')
  assert.equal(log[0].options.redirect,'error')
  assert.match(log[0].url,/oddsFormat=decimal/)
})
test('the separate free odds provider integrates with native priced ticket simulation',async()=>{
  const quotes=await marketOdds('basketball_nba','h2h',{THEODDSAPI_API_KEY:'test-secret'},mock([]))
  assert.equal(quotes.length,4)
  const selected=[quotes[0],quotes[3]].map(({eventId,bookmaker,market,selection,point})=>({
    eventId,bookmaker,market,selection,point,
  }))
  const {card,warning}=pricedTicket(selected,quotes,100)
  assert.equal(card.props.source,'TheOddsAPI · cuotas de casas identificadas')
  assert.equal(card.props.combinedOdds,'3.674')
  assert.match(warning,/mismo encuentro/)
})
test('free source rejects invalid filters, missing key, malformed feed and already-started events',async()=>{
  await assert.rejects(()=>fetchTheOddsApi('../unsafe','h2h','secret',mock([])),/Filtros/)
  await assert.rejects(()=>fetchTheOddsApi('basketball_nba','h2h','',mock([])),/THEODDSAPI_API_KEY/)
  const broken=async()=>new Response(JSON.stringify({success:true,data:{not:'array'}}),{status:200})
  await assert.rejects(()=>fetchTheOddsApi('basketball_nba','h2h','secret',broken),/inválida/)
  const finished=async()=>new Response(JSON.stringify({success:true,data:[{
    ...payload.data[0],start_time:new Date(Date.now()-86_400_000).toISOString(),
  }]}),{status:200})
  assert.deepEqual(await fetchTheOddsApi('basketball_nba','h2h','secret',finished),[])
})
