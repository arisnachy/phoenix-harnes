import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sportsMarketAlternatives} from '../src/sports-market-alternatives.ts'
const base={event:'Away vs Home',bookmaker:'Verified Book',source:'Provider',
  freshnessMinutes:4,observation:'market-pricing-only',
  totalBookOverround:.02}
const quote=(name,price,point=null)=>({
  name,price,point,impliedFromQuote:1/price,noVigShare:.5,
})
test('provides verified moneyline, baseball run line and total options without fake cover chance',()=>{
 const markets=[
  {...base,market:'h2h',selections:[quote('Home',1.82),quote('Away',2.10)]},
  {...base,market:'spreads',selections:[quote('Home',2.15,-1.5),quote('Away',1.75,1.5)]},
  {...base,market:'totals',selections:[quote('Over',1.92,8.5),quote('Under',1.90,8.5)]},
 ]
 const result=sportsMarketAlternatives('baseball',markets,5.2,4.2)
 assert.deepEqual(result.alternatives.map(x=>x.family),['winner','run-line','total'])
 assert.ok(result.alternatives.every(x=>x.calibratedEdge===false))
 assert.equal(result.alternatives[1].provisionalLean,null)
 assert.equal(result.alternatives[2].provisionalLean,'Over')
 assert.equal(result.alternatives[1].quotes[0].point,-1.5)
 assert.ok(result.unavailable.some(x=>x.includes('Props de jugador')))
})
test('rejects incomplete or undated quotes instead of inventing a ticket',()=>{
 const markets=[
  {...base,market:'h2h',selections:[quote('Home',1.9)]},
  {...base,market:'spreads',freshnessMinutes:90,
    selections:[quote('Home',1.9,-1.5),quote('Away',1.9,1.5)]},
  {...base,market:'totals',selections:[
    {...quote('Over',1.91,7.5),noVigShare:null},quote('Under',1.90,7.5)]},
 ]
 const r=sportsMarketAlternatives('baseball',markets,null,null)
 assert.equal(r.alternatives.length,0)
 assert.match(r.warning,/NO un boleto aprobado/)
})
