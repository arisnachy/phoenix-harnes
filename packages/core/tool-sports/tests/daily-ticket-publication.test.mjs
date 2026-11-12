import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formatDailyReport,dailyReportMarkdown} from '../scripts/daily-ticket-format.mjs'

const args={date:'2026-11-11',slot:'morning',checkedAt:'2026-11-11T10:05:00Z',goal:5}
test('publishes a daily audit even when sports pipeline cannot produce picks',()=>{
  const report=formatDailyReport(null,{...args,error:'ESPN HTTP 503'})
  assert.equal(report.status,'error')
  assert.equal(report.published,true)
  assert.equal(report.complete,false)
  assert.equal(report.placed,false)
  assert.equal(report.approvedForBetting,false)
  assert.match(dailyReportMarkdown(report),/No existen selecciones justificadas/)
})
test('priced five-leg report retains real quotes, risk notes and transparent status',()=>{
  const ticket={priced:true,complete:true,quotedLegs:5,verifiedEvents:5,
    discoveredEvents:8,sourceAudit:[{source:'ESPN Site/Core',status:'observed',offers:10}],
    card:{props:{legs:Array.from({length:5},(_,i)=>({
      eventId:String(i+1),homeTeam:'Equipo A',awayTeam:'Equipo B',
      selection:'Equipo A',bookmaker:'DraftKings',price:'1.6',
      legProbabilitySource:'bookmaker-market-no-vig',
      researchStatus:'conditional',rationale:'Expediente parcial.',
      riskNotes:['Titulares pendientes'],
    }))}}
  }
  const report=formatDailyReport(ticket,args)
  assert.equal(report.status,'priced-research-ticket')
  assert.equal(report.legs.length,5)
  assert.equal(report.legs[0].price,1.6)
  assert.equal(report.conditional,false)
  assert.equal(report.legs[0].probabilitySource,'bookmaker-market-no-vig')
  assert.ok(dailyReportMarkdown(report).includes('Titulares pendientes'))
})
test('partial reports do not manufacture a five-leg parlay',()=>{
  const ticket={priced:false,complete:false,quotedLegs:0,verifiedEvents:0,
    discoveryAudit:{discoveredEvents:6},
    card:{props:{pricePreview:[{eventId:'42',home:'Local',
      away:'Visita',options:[{bookmaker:'ESPN',selection:'Local',
        market:'h2h',price:1.72}]}]}}}
  const report=formatDailyReport(ticket,args)
  assert.equal(report.status,'partial-research-report')
  assert.equal(report.discoveredEvents,6)
  assert.equal(report.legs.length,0)
  assert.equal(report.marketPreviews.length,1)
  assert.match(dailyReportMarkdown(report),/no aprobadas/)
})
test('rejects invalid schedule metadata',()=>{
  assert.throws(()=>formatDailyReport(null,{...args,goal:7}),/inválidos/)
  assert.throws(()=>formatDailyReport(null,{...args,date:'2026-02-30'}),/inválidos/)
})
