import {test} from 'node:test'
import assert from 'node:assert/strict'
import {investigateEventDeep} from '../src/sports-deep-context.ts'
const now=Date.parse('2026-10-29T12:00:00Z')
const root='https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/'
const fixture={
  header:{competitions:[{date:'2026-10-29T23:00:00Z',competitors:[
    {team:{id:'1',displayName:'Winnipeg Jets',abbreviation:'WPG'}},
    {team:{id:'2',displayName:'Tampa Bay Lightning',abbreviation:'TBL'}},
  ]}]},
  boxscore:{players:[{statistics:[{labels:['Goals'],athletes:[
    {athlete:{displayName:'Athlete X'},stats:['1']},
  ]}]}]},
}
test('research uses actual source fields for NHL news, injuries, roster and second fixture',async()=>{
  const urls=[]
  const fetcher=async url=>{
    const u=String(url);urls.push(u)
    let data={}
    if(u===root+'summary?event=123')data=fixture
    if(u.includes('/news?'))data={articles:[
      {headline:'Winnipeg Jets coach discusses preparation',published:'2026-10-29T10:00:00Z'},
      {headline:'Unrelated football report',published:'2026-10-29T10:00:00Z'},
    ]}
    if(u===root+'injuries')data={injuries:[
      {team:{id:'1'},injuries:[{athlete:{displayName:'Athlete X'},status:'Day-to-day'}]},
      {team:{id:'9'},injuries:[{athlete:{displayName:'Irrelevant'},status:'Out'}]},
    ]}
    if(u.endsWith('/teams/1/roster'))data={athletes:[{displayName:'Athlete X'}]}
    if(u.endsWith('/teams/2/roster'))data={athletes:[{displayName:'Athlete Y'}]}
    if(u==='https://api-web.nhle.com/v1/score/2026-10-29')
      data={games:[{homeTeam:{abbrev:'WPG'},awayTeam:{abbrev:'TBL'}}]}
    return new Response(JSON.stringify(data),{status:200})
  }
  const result=await investigateEventDeep('hockey','nhl','123',fetcher,now)
  assert.equal(result.teams.length,2)
  assert.equal(result.headlines.length,1)
  assert.equal(result.injuries.length,1)
  assert.equal(result.playerStats.length,1)
  assert.equal(result.independentFixtureVerified,true)
  assert.ok(urls.some(x=>x.includes('/roster')))
  assert.match(result.limitations.join(' '),/NO confirman|no confirma/i)
})
test('missing ESPN sources do not create injuries, starters, named players or news',async()=>{
  const fetcher=async url=>new Response(JSON.stringify({}),{status:200})
  const data=await investigateEventDeep('basketball','nba','123',fetcher,now)
  assert.deepEqual(data.headlines,[])
  assert.deepEqual(data.injuries,[])
  assert.deepEqual(data.playerStats,[])
  assert.equal(data.independentFixtureVerified,false)
})
test('IDs and arbitrary leagues cannot become untrusted network requests',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;return new Response('{}')}
  await assert.rejects(()=>investigateEventDeep('hockey','nhl','123&token=1',fetcher,now))
  await assert.rejects(()=>investigateEventDeep('hockey','unknown','123',fetcher,now))
  assert.equal(calls,0)
})
