import {test} from 'node:test'
import assert from 'node:assert/strict'
import {crosscheckFreeFixture} from '../src/free-sports-source-audit.ts'
const now=Date.parse('2026-11-09T13:00:00Z')
const fixture={sport:'hockey',league:'nhl',eventId:'401234',
  date:'2026-11-09',kickoff:'2026-11-09T20:00:00Z',
  home:'Boston Bruins',away:'Toronto Maple Leafs'}
const stub=async(url)=>{
 const u=String(url)
 const response=u.includes('api-sports.io')?
   {response:[{date:'2026-11-09T20:00:00Z',teams:{
     home:{name:'Boston Bruins'},away:{name:'Toronto Maple Leafs'}}}]}:
   u.includes('bigballsdata')?
   {data:[{home:{name:'Boston Bruins'},away:{name:'Toronto Maple Leafs'},
     kickoff_utc:'2026-11-09T20:00:00Z'}]}:
   u.includes('api-web.nhle.com')?{games:[]}:{events:[]}
 return new Response(JSON.stringify(response),{status:200,
   headers:{'content-type':'application/json'}})
}
test('two keyed NHL backups corroborate fixture but cannot attest goalie starters',async()=>{
 const rows=await crosscheckFreeFixture(fixture,stub,now,{
   PHOENIX_API_HOCKEY_KEY:'test-key',PHOENIX_BIGBALLS_API_KEY:'another-key',
 })
 const api=rows.find(x=>x.provider==='API-Hockey')
 const big=rows.find(x=>x.provider==='Big Balls NHL')
 assert.equal(api.status,'verified')
 assert.equal(big.status,'verified')
 assert.match(api.detail,/NO prueba titular/)
 assert.ok(!JSON.stringify(rows).includes('test-key'))
 assert.ok(!JSON.stringify(rows).includes('another-key'))
})
test('wrong home-away relationship is conflict, not verified',async()=>{
 const reversed=async url=>{
   if(String(url).includes('hockey.api-sports.io'))return new Response(JSON.stringify({
     response:[{date:'2026-11-09T20:00:00Z',teams:{
       home:{name:'Toronto Maple Leafs'},away:{name:'Boston Bruins'}}}]
   }))
   return stub(url)
 }
 const rows=await crosscheckFreeFixture(fixture,reversed,now,{
   PHOENIX_API_HOCKEY_KEY:'test-key',
 })
 assert.equal(rows.find(x=>x.provider==='API-Hockey').status,'conflict')
})
