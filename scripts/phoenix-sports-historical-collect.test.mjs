import {test} from 'node:test'
import assert from 'node:assert/strict'
import {historicalJob} from './phoenix-sports-historical-collect.mjs'
const now=Date.parse('2026-10-29T13:00:00Z')
test('SportsbookReview historical CLI runs with the real flags and bounded year range',()=>{
  const a=historicalJob({source:'sportsbookreview',sport:'nhl',startYear:'2020',endYear:'2021'},now)
  assert.equal(a.folder,'sportsbookreview-scraper')
  assert.equal(a.script,'cli.py')
  assert.deepEqual(a.args,['--sport','nhl','--start','2020','--end','2021',
    '--filename','phoenix_nhl_2020_2021','--format','json'])
  assert.throws(()=>historicalJob({source:'sportsbookreview',sport:'nhl',startYear:'2022'},now),/2007-2021/)
  assert.throws(()=>historicalJob({source:'sportsbookreview',sport:'nhl',startYear:'2010',endYear:'2020'},now),/máximo/)
  assert.throws(()=>historicalJob({source:'sportsbookreview',sport:'soccer',startYear:'2021'},now),/NBA/)
})
test('Arnav MLB scraper runs moneyline, pointspread and totals for bounded past days',()=>{
  const a=historicalJob({source:'mlb',startDate:'2026-10-23',endDate:'2026-10-24'},now)
  assert.deepEqual(a.args,['2026-10-23','2026-10-24','-t',
    'moneyline','pointspread','totals','-c','2','-o','phoenix-mlb-2026-10-23-2026-10-24.json'])
  assert.equal(a.folder,'mlb-odds-scraper')
  assert.throws(()=>historicalJob({source:'mlb',startDate:'2026-10-23',endDate:'2026-11-05'},now),/máximo/)
  assert.throws(()=>historicalJob({source:'mlb',startDate:'2026-10-29'},now),/pasadas/)
  assert.throws(()=>historicalJob({source:'mlb',startDate:'2026-10-27',markets:'arbitrary'},now),/inválidos/)
})
