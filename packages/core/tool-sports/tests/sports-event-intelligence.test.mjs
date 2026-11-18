import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sportsEventInsights,observedEventProjection} from '../src/sports-event-intelligence.ts'

const now=Date.parse('2026-11-01T20:00:00Z')
const summary={
 header:{competitions:[{id:'881',date:'2026-11-02T01:30:00Z',
  competitors:[
   {homeAway:'home',team:{displayName:'Warriors',abbreviation:'GS'},records:[{name:'overall',summary:'5-2'}]},
   {homeAway:'away',team:{displayName:'Clippers',abbreviation:'LAC'},records:[{name:'overall',summary:'2-5'}]},
  ]}]},
 boxscore:{teams:[{team:{abbreviation:'GS'},statistics:[
   {label:'Rebounds',displayValue:'45'}, {label:'Assists',displayValue:'27'}]}]},
}
test('compact dossier displays real team stats, prices and independent reference probability',()=>{
 const quote={provider:{name:'Sportsbook A'},lastUpdated:'2026-11-01T19:55:00Z',
   homeTeamOdds:{moneyLine:-120},awayTeamOdds:{moneyLine:105},overUnder:220.5}
 const input={eventId:'876',summary,coreOdds:[quote],
   predictor:{homeTeam:{gameProjection:0.63},awayTeam:{gameProjection:0.37}},now}
 const result=sportsEventInsights(input)
 assert.equal(result.quotes,2)
 assert.equal(result.projected,true)
 assert.ok(result.sections.some(s=>s.heading==='Estadísticas verificadas'&&
   s.items.some(i=>i.value==='45')))
 assert.ok(result.sections.some(s=>s.heading==='Cuotas y mercados'&&
   s.items.some(i=>i.value.startsWith('1.83'))))
 assert.ok(result.sections.some(s=>s.heading==='Proyección de referencia'&&
   s.items.some(i=>i.value==='63.0%')))
 assert.ok(result.sections.every(s=>s.items.every(i=>!i.label.includes('Sportsbook A'))))
})
test('empty Core references and partial summary never invent an available market',()=>{
 const result=sportsEventInsights({eventId:'876',summary,coreOdds:[{$ref:'https://sports.core.api.espn.com/reference'}],
   predictor:{},now})
 assert.equal(result.quotes,0)
 assert.equal(result.projected,false)
 assert.equal(result.sections.some(s=>s.heading==='Cuotas y mercados'),false)
})
test('reference projections reject malformed and out of range probabilities',()=>{
 assert.equal(observedEventProjection({homeTeam:{gameProjection:200}}),null)
 assert.deepEqual(observedEventProjection({homeTeam:{gameProjection:0.5}})?.items.map(i=>i.value),['50.0%'])
})
