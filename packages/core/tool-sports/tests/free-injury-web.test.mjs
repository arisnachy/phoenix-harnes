import {test} from 'node:test'
import assert from 'node:assert/strict'
import {KEYLESS_INJURY_CATALOG,parseKeylessInjuryRows,
  discoverNbaOfficialReport,inspectKeylessInjurySources} from '../src/free-injury-web.ts'

const game={sport:'basketball',league:'nba',home:'Minnesota Timberwolves',
  away:'Chicago Bulls',date:'2026-11-14',kickoff:'2026-11-15T02:00:00Z'}
const row=(team,player,status,reason='Knee')=>
  '<tr><td>11/14/26</td><td>'+team+'</td><td>'+player+
  '</td><td>'+reason+'</td><td>'+status+'</td></tr>'

test('NBA official report is discovered from actual links, excluding future PDFs',()=>{
  const html=[
    'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-14_02_15PM.pdf',
    'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-14_11_30PM.pdf',
    'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_04_15PM.pdf',
  ].map(h=>'<a href="'+h+'">Report</a>').join('')
  const link=discoverNbaOfficialReport(html,'2026-11-14',
    Date.parse('2026-11-14T20:00:00Z'))
  assert.match(link??'',/2026-11-14_02_15PM\.pdf$/)
  assert.equal(discoverNbaOfficialReport(html,'2026-11-12',
    Date.parse('2026-11-14T20:00:00Z')),null)
  assert.equal(discoverNbaOfficialReport(
    '<a href="https://evil.example/referee/injury/Injury-Report_2026-11-14_02_15PM.pdf"></a>',
    '2026-11-14',Date.parse('2026-11-14T20:00:00Z')),null)
})
test('only exact team/player/status rows count, never page-wide proximity',()=>{
  const html='<h3>Minnesota Timberwolves</h3><table>'+
    row('Minnesota Timberwolves','Anthony Edwards','Out','Right knee')+
    row('Minnesota Timberwolves','Donte DiVincenzo','Out','Achilles')+
    row('Chicago Bulls','Norman Powell','Questionable','Rest')+
    row('Atlanta Hawks','Trae Young','Out')+
    '<tr><td>Chicago Bulls</td><td>Out</td><td>Injury report</td></tr>'+
    '</table>'
  const findings=parseKeylessInjuryRows(html,game,'https://test.invalid/injuries')
  assert.equal(findings.length,3)
  assert.deepEqual(findings.map(x=>[x.team,x.athlete,x.status]),[
    ['Minnesota Timberwolves','Anthony Edwards','Out'],
    ['Minnesota Timberwolves','Donte DiVincenzo','Out'],
    ['Chicago Bulls','Norman Powell','Questionable'],
  ])
  assert.equal(parseKeylessInjuryRows(
    '<h1>Minnesota Timberwolves</h1><table><tr><td>Anthony Edwards</td><td>Out</td><td>Knee</td></tr></table>',
    game,'https://test.invalid').length,0,'missing team in same row is not evidence')
})
test('source catalog needs no credential and reports a linked PDF separately from data',async()=>{
  const html='<a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-14_02_15PM.pdf">PDF</a>'
  const table='<table>'+row('Minnesota Timberwolves','Anthony Edwards','Out')+'</table>'
  const seen=[]
  const fetcher=async url=>{
    seen.push(String(url))
    return new Response(String(url).includes('official.nba.com')?html:table,{
      status:200,headers:{'Content-Type':'text/html; charset=utf-8'}})
  }
  const results=await inspectKeylessInjurySources(game,fetcher,
    Date.parse('2026-11-14T20:00:00Z'))
  assert.equal(results.length,4)
  assert.equal(results[0].state,'linked')
  assert.match(results[0].note,/NO interpretado/)
  assert.equal(results[1].state,'matched')
  assert.deepEqual(results[1].players.map(x=>x.athlete),['Anthony Edwards'])
  assert.equal(seen.length,4)
  assert.ok(KEYLESS_INJURY_CATALOG.every(x=>/^https:\/\//u.test(x.url)))
})
test('retrospective tickets never consume current public HTML as past evidence',async()=>{
  let called=0
  const results=await inspectKeylessInjurySources(game,async()=>{
    called++;throw Error('should not fetch')
  },Date.parse('2026-11-15T03:00:00Z'))
  assert.equal(called,0)
  assert.ok(results.every(x=>x.state==='skipped'))
})
test('unavailable and JS-only pages are not treated as healthy reports',async()=>{
  const results=await inspectKeylessInjurySources(game,async url=>{
    if(String(url).includes('foxsports'))throw Error('blocked')
    return new Response('<div>Loading...</div>',{status:200,
      headers:{'content-type':'text/html'}})
  },Date.parse('2026-11-14T20:00:00Z'))
  assert.ok(results.some(x=>x.state==='unavailable'))
  assert.ok(results.some(x=>x.state==='readable'))
  assert.equal(results.flatMap(x=>x.players).length,0)
})
