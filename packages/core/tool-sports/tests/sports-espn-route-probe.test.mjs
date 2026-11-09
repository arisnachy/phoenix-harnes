import {test} from 'node:test'
import assert from 'node:assert/strict'
import {probeExtendedEspnCatalog} from '../src/sports-espn-route-probe.ts'
import {extendedEspnRoutes} from '../src/espn-extra-intelligence.ts'

const fixed=Date.parse('2026-11-02T17:00:00Z')
test('audits every registered route and separates payload from ref-only or errors',async()=>{
 const seen=[]
 const fetcher=async url=>{
   seen.push(url)
   if(url.includes('/roster'))return {athletes:[{id:'123',displayName:'Athlete One'}]}
   if(url.includes('/athletes'))return {items:[{$ref:url+'/1'}]}
   if(url.includes('/statistics'))return {categories:[{stats:[{displayName:'Points',displayValue:'25'}]}]}
   throw Error('HTTP 404')
 }
 const result=await probeExtendedEspnCatalog({sport:'basketball',league:'nba',eventId:'100',
   competitionId:'200',teamId:'5',athleteId:'123',season:2026,seasonType:2,week:1},
   fetcher,fixed)
 assert.equal(result.results.length,Object.keys(extendedEspnRoutes).length)
 assert.equal(result.total,result.results.length)
 assert.ok(result.results.some(x=>x.status==='data'))
 assert.ok(result.results.some(x=>x.status==='ref_only'))
 assert.ok(result.results.some(x=>x.status==='error'))
 const allowedHosts=new Set([
   'sports.core.api.espn.com','site.api.espn.com','site.web.api.espn.com',
   'cdn.espn.com','lm-api-reads.fantasy.espn.com','now.core.api.espn.com',
 ])
 assert.ok(seen.every(raw=>{
   const url=new URL(raw)
   return url.protocol==='https:'&&allowedHosts.has(url.hostname)&&
     !url.username&&!url.password
 }))
 assert.ok(result.results.every(x=>x.observedAt==='2026-11-02T17:00:00.000Z'))
})
test('skips parameterized routes with missing real IDs without network requests',async()=>{
 let calls=0
 const audit=await probeExtendedEspnCatalog({sport:'basketball',league:'nba'},
   async()=>{calls++;throw Error('unavailable')},fixed)
 assert.ok(audit.results.some(x=>x.status==='skipped'))
 assert.ok(audit.results.some(x=>x.status==='error'))
 assert.ok(calls<audit.total)
})

test('HTTP 200 paging metadata and JSON errors are not evidence',async()=>{
 const audit=await probeExtendedEspnCatalog({
   sport:'basketball',league:'nba',eventId:'100',competitionId:'100',
   teamId:'5',athleteId:'123',season:2026,providerId:'58',groupId:'2',query:'lebron',
 },async url=>url.includes('/roster')?{count:0,items:[]}:url.includes('/scoreboard')?
   {message:'Not found',error:'404'}:{count:0,pageIndex:1,pageCount:0},fixed)
 assert.ok(audit.results.some(x=>x.status==='error'))
 assert.ok(audit.results.some(x=>x.status==='empty'))
 assert.equal(audit.available,0)
})
