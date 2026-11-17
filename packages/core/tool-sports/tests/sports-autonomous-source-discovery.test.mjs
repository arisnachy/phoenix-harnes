import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverAutonomousSportsSources} from '../src/sports-autonomous-source-discovery.ts'
const now=Date.parse('2026-11-17T14:00:00Z')
const teams={home:'Golden State Warriors',away:'New Orleans Pelicans'}
const article=(title,url,seen='20261117T130000Z',domain='sports.example')=>
  ({title,url,seendate:seen,domain})
test('model chooses missing question and searches diverse publishers, not a fixed ESPN list',async()=>{
  let queried=''
  const fetcher=async url=>{
    queried=String(url)
    return new Response(JSON.stringify({articles:[
      article('Curry out as Warriors face Pelicans','https://teamnews.example/a',
        '20261117T110000Z','teamnews.example'),
      article('Team releases the inactive roster','https://nbasite.example/1',
        '20261117T120000Z','nbasite.example'),
    ]}),{headers:{'content-type':'application/json'}})
  }
  const result=await discoverAutonomousSportsSources(teams,
    'Stephen Curry injury roster',fetcher,now)
  assert.equal(result.status,'observed')
  assert.equal(result.articles.length,2)
  assert.ok(queried.startsWith('https://api.gdeltproject.org/api/v2/doc/doc?'))
  assert.match(new URL(queried).searchParams.get('query'),/Stephen Curry injury roster/)
  assert.match(new URL(queried).searchParams.get('query'),/ OR /)
  assert.ok(result.articles.every(row=>row.status==='indexed-only'))
  assert.match(result.limitation,/no artículos leídos/)
})
test('do not turn future, missing, duplicated, or insecure articles into facts',async()=>{
  const response={articles:[
    article('Report','http://unsafe.example/first'),
    article('Tomorrow','https://news.example/late','20261118T130000Z'),
    article('Current','https://news.example/a'),
    article('Duplicate','https://news.example/a'),
  ]}
  const result=await discoverAutonomousSportsSources(teams,'coach lineup',
    async()=>new Response(JSON.stringify(response)),now)
  assert.equal(result.articles.length,1)
  assert.equal(result.articles[0].title,'Current')
})
test('a blocked external provider is reported, not replaced with invented headlines',async()=>{
  const result=await discoverAutonomousSportsSources(teams,'injuries and starters',
    async()=>new Response('Denied',{status:429}),now)
  assert.equal(result.status,'unavailable')
  assert.deepEqual(result.articles,[])
  assert.match(result.limitation,/HTTP 429/)
})
test('invalid question cannot inject external host or request expression',async()=>{
  await assert.rejects(discoverAutonomousSportsSources(teams,'<>',
    async()=>{throw Error('should not request')},now),
  /pregunta deportiva/)
})
