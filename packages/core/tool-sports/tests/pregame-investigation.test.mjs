import {test} from 'node:test'
import assert from 'node:assert/strict'
import {investigatePregame} from '../src/pregame-investigation.ts'

const events=[
  {sport:'hockey',league:'nhl',eventId:'101'},
  {sport:'hockey',league:'nhl',eventId:'102'},
]
test('pregame research probes league injuries once and distinct event summaries',async()=>{
  const urls=[]
  const fetcher=async url=>{
    urls.push(String(url))
    if(String(url).endsWith('/injuries'))return new Response(JSON.stringify({injuries:[]}))
    if(String(url).includes('event=101'))return new Response(JSON.stringify({
      header:{competitions:[{competitors:[{id:'1'},{id:'2'}]}]},
    }))
    return new Response(JSON.stringify({}))
  }
  const result=await investigatePregame(events,fetcher)
  assert.equal(urls.filter(u=>u.endsWith('/injuries')).length,1)
  assert.equal(urls.filter(u=>u.includes('/summary?event=')).length,2)
  assert.equal(result.get('hockey|nhl|101').summaryVerified,true)
  assert.equal(result.get('hockey|nhl|101').injuryReportVerified,true)
  assert.equal(result.get('hockey|nhl|102').summaryVerified,false)
  assert.match(result.get('hockey|nhl|101').limitations.join(' '),/Titulares/)
})
test('no news, empty response or unavailable medical data is never interpreted as healthy or verified',async()=>{
  const fetcher=async url=>new Response(JSON.stringify(
    String(url).endsWith('/injuries')?{}:{header:{}}))
  const result=await investigatePregame(events,fetcher)
  assert.equal(result.get('hockey|nhl|101').summaryVerified,false)
  assert.equal(result.get('hockey|nhl|101').injuryReportVerified,false)
  assert.match(result.get('hockey|nhl|101').limitations.join(' '),/no verificable/)
})
test('scout refuses unvalidated sports/event IDs and makes no arbitrary network calls',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;return new Response('{}')}
  const result=await investigatePregame([
    {sport:'hockey',league:'nhl',eventId:'101&unsafe=true'},
    {sport:'evil/host',league:'nhl',eventId:'123'},
  ],fetcher)
  assert.equal(result.size,0)
  assert.equal(calls,0)
})
