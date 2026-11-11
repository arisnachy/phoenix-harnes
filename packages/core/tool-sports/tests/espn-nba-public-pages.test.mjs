import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ESPN_NBA_PUBLIC_PAGES,ESPN_NBA_API_STARTING_POINTS} from '../src/espn-nba-public-pages.ts'

test('human pages are labeled references and never counted as verified evidence',()=>{
  assert.equal(ESPN_NBA_PUBLIC_PAGES.length,5)
  assert.ok(ESPN_NBA_PUBLIC_PAGES.every(x=>
    x.status==='reference-only'&&new URL(x.url).hostname==='www.espn.com.do'))
  assert.ok(ESPN_NBA_PUBLIC_PAGES.some(x=>x.kind==='celtics-roster-example'))
  assert.ok(ESPN_NBA_PUBLIC_PAGES.some(x=>x.kind==='injuries'))
})

test('roster API is the primary data source rather than scraping protected HTML',()=>{
  const roster=ESPN_NBA_API_STARTING_POINTS.find(x=>x.kind==='team-roster')
  assert.ok(roster)
  assert.equal(roster?.status,'endpoint-template')
  assert.match(roster?.pattern??'',/site\.api\.espn\.com.*\/roster/u)
  assert.ok(ESPN_NBA_API_STARTING_POINTS.some(x=>x.kind==='athlete-overview'))
})
