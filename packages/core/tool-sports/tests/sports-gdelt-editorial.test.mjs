import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverGdeltTicketNews} from '../src/sports-gdelt-editorial.ts'
const now=Date.parse('2026-11-09T16:00:00Z')
const games=[
  {eventId:'123',home:'Toronto Maple Leafs',away:'Montreal Canadiens'},
  {eventId:'456',home:'Los Angeles Lakers',away:'Boston Celtics'},
]
const json=v=>new Response(JSON.stringify(v),{status:200,
  headers:{'content-type':'application/json'}})
test('one batch finds independent event-linked articles and no invented picks',async()=>{
  const urls=[]
  const fetcher=async url=>{
    urls.push(String(url))
    return json({articles:[
      {title:'Maple Leafs and Canadiens preview injury headlines',
        url:'https://example.org/hockey/preview',seendate:'20261109T150000Z',
        domain:'example.org',socialimage:'https://example.org/copyrighted.jpg'},
      {title:'Lakers against Boston Celtics tonight',
        url:'https://news.example.com/nba',seendate:'20261109T143000Z',
        domain:'news.example.com'},
      {title:'Toronto other sport rumor',
        url:'https://example.org/other',seendate:'20261109T143000Z',
        domain:'example.org'},
    ]})
  }
  const result=await discoverGdeltTicketNews(games,fetcher,now)
  assert.equal(urls.length,1)
  assert.match(urls[0],/api\.gdeltproject\.org\/api\/v2\/doc\/doc/)
  assert.match(urls[0],/maxrecords=75/)
  assert.equal(result.status,'observed')
  assert.equal(result.byEvent['123'].length,1)
  assert.equal(result.byEvent['456'].length,1)
  assert.equal(result.byEvent['123'][0].status,'indexed-only')
  assert.equal(result.byEvent['123'][0].indexedAt,'2026-11-09T15:00:00.000Z')
  assert.equal(Object.hasOwn(result.byEvent['123'][0],'socialimage'),false)
  assert.equal(result.byEvent['123'][0].provider,'GDELT DOC 2.0')
})
test('rejects outdated, future and unsafe news without treating rumor as source',async()=>{
  const result=await discoverGdeltTicketNews([games[0]],async()=>json({articles:[
    {title:'Maple Leafs Canadiens old',url:'https://example.org/old',
      seendate:'20260101T000000Z'},
    {title:'Maple Leafs Canadiens future',url:'https://example.org/future',
      seendate:'20301109T150000Z'},
    {title:'Maple Leafs Canadiens exploit',url:'javascript:alert(1)',
      seendate:'20261109T150000Z'},
  ]}),now)
  assert.equal(result.status,'empty')
  assert.deepEqual(result.byEvent,{})
})
test('rate-limited request does not block ticket or fabricate news',async()=>{
  const fetcher=async()=>new Response('Over quota',{status:429})
  const result=await discoverGdeltTicketNews([games[0]],fetcher,now)
  assert.equal(result.status,'unavailable')
  assert.equal(result.byEvent['123'],undefined)
})
