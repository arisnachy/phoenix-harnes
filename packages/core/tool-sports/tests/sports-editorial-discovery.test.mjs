import {test} from 'node:test'
import assert from 'node:assert/strict'
import {editorialIndexUrl,parseEditorialIndex,discoverEditorialResearch}
 from '../src/sports-editorial-discovery.ts'

const now=Date.parse('2026-11-01T20:00:00Z')
const item=(host,title='Warriors injury analysis',published='Sun, 01 Nov 2026 19:00:00 GMT')=>`
  <item><title>${title}</title><link>https://news.google.com/rss/articles/123</link>
  <pubDate>${published}</pubDate><source url="https://www.${host}">${host}</source></item>`
test('strictly pins publisher identity and index hostname, not arbitrary title',()=>{
 const xml='<rss><channel>'+item('covers.com','Warriors &amp; Clippers')
   +item('untrusted.example','Sportsbook article')+'</channel></rss>'
 const rows=parseEditorialIndex(xml,'covers',now)
 assert.equal(rows.length,1)
 assert.equal(rows[0].headline,'Warriors & Clippers')
 assert.equal(rows[0].source,'covers')
 assert.equal(rows[0].quoteUpdatedAt,null)
 assert.equal(rows[0].status,'indexed-headline-only')
})
test('does not treat syndicated headlines as portal pages or sportsbook quotes',()=>{
 const url=editorialIndexUrl('vegasinsider','Warriors vs Clippers')
 const parsed=new URL(url)
 assert.equal(parsed.hostname,'news.google.com')
 assert.match(parsed.searchParams.get('q'),/site:vegasinsider.com/)
 assert.throws(()=>editorialIndexUrl('evil','Clippers'),/desconocida/)
 assert.equal(parseEditorialIndex('<rss>'+item('covers.com')+'</rss>','vegasinsider',now).length,0)
 assert.equal(parseEditorialIndex('<rss>'+item('covers.com','Old','Sun, 01 Sep 2024 19:00:00 GMT')+'</rss>','covers',now).length,0)
})
test('bounded provider failures are visible and never fabricate external opinion',async()=>{
 const fetcher=async()=>new Response('upstream unavailable',{status:429,headers:{'content-type':'text/xml'}})
 const result=await discoverEditorialResearch('NBA conference', ['covers','vegasinsider'],fetcher,now)
 assert.equal(result.status,'unavailable')
 assert.equal(result.hits.length,0)
 assert.equal(result.diagnostics.length,2)
 assert.ok(result.diagnostics.every(x=>x.status==='unavailable'))
})
test('indexed stories are limited and do not reveal private picks',async()=>{
 const rss='<rss><channel>'+Array.from({length:8},(_,i)=>
  item('scoresandodds.com','Article '+i)).join('')+'</channel></rss>'
 const fetcher=async()=>new Response(rss,{headers:{'content-type':'application/rss+xml'}})
 const result=await discoverEditorialResearch('NBA Warriors Clippers',['scoresandodds'],fetcher,now)
 assert.equal(result.status,'observed')
 assert.equal(result.hits.length,5)
 assert.ok(result.hits.every(x=>x.discoveryUrl.startsWith('https://news.google.com/')))
})
