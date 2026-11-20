import test from 'node:test'
import assert from 'node:assert/strict'
import {formatDailyReport,dailyReportMarkdown} from './daily-ticket-format.mjs'

const base={date:'2026-11-20',slot:'manual',checkedAt:'2026-11-20T12:00:00Z',goal:5}
test('daily report preserves Under, handicap, F5 and player prop market identity',()=>{
  const cases=[
    {market:'total',selection:'Under 5.5',line:'5.5',period:'full-game'},
    {market:'spread',selection:'Team +1.5',line:'+1.5',period:'full-game'},
    {market:'total',selection:'Under 2.5',line:'2.5',period:'F5'},
    {market:'player_prop',selection:'Player over 1.5',line:'1.5',period:'full-game'},
  ]
  for(const row of cases){
    const report=formatDailyReport({card:{props:{legs:[{
      ...row,eventId:'123',bookmaker:'DraftKings',price:1.91,
      observedAt:'2026-11-20T12:01:00Z',
      settlementRules:'Regulation only',priceSource:'ESPN',
    }]}}},base)
    assert.equal(report.legs[0].market,row.market)
    assert.equal(report.legs[0].line,row.line)
    assert.equal(report.legs[0].period,row.period)
    assert.equal(report.legs[0].observedAt,'2026-11-20T12:01:00Z')
    assert.match(dailyReportMarkdown(report),/Regulation only/)
  }
})
test('missing odds and market metadata remain explicit, never invented',()=>{
  const report=formatDailyReport({card:{props:{legs:[{selection:'Pending'}]}}},base)
  assert.equal(report.legs[0].price,null)
  assert.equal(report.legs[0].market,'')
  assert.match(dailyReportMarkdown(report),/No identificado/)
  assert.match(dailyReportMarkdown(report),/Sin hora individual/)
  assert.equal(report.complete,false)
})
