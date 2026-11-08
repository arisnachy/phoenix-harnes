import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchEspnInjuryBackup,espnInjuryFeedUrl,espnInjuryCatalog}
  from '../src/espn-injury-backup.ts'
const now=Date.parse('2026-11-08T21:00:00Z')
const fixture={sport:'basketball',league:'nba',
  home:'Boston Celtics',away:'Milwaukee Bucks',
  date:'2026-11-08',eventId:'401909949',kickoff:'2026-11-09T02:00:00Z'}
const injury=(player,status,team)=>({
  status,date:'2026-11-08T19:48:00Z',shortComment:'Listed with calf soreness',
  athlete:{id:player==='Player Alpha'?'123':'456',displayName:player,
    team:{displayName:team}},
  details:{type:'Calf',returnDate:'2026-11-09'},
})
const groups=(time='2026-11-08T20:12:00Z')=>({
  timestamp:time,status:'success',
  injuries:[
    {id:'2',displayName:'Boston Celtics',injuries:[
      injury('Player Alpha','Questionable','Boston Celtics')]},
    {id:'15',displayName:'Milwaukee Bucks',injuries:[
      injury('Player Beta','Out','Milwaukee Bucks')]},
  ],
})
const board={events:[{id:'401909949',competitions:[{competitors:[
  {homeAway:'home',team:{id:'2',displayName:'Boston Celtics'}},
  {homeAway:'away',team:{id:'15',displayName:'Milwaukee Bucks'}},
]}]}]}
const json=x=>new Response(JSON.stringify(x),{status:200,
  headers:{'content-type':'application/json'}})
test('ESPN public injury routes include NBA WNBA NFL MLB NHL, not soccer',()=>{
  assert.equal(espnInjuryCatalog.length,5)
  assert.equal(espnInjuryFeedUrl('basketball','nba'),
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')
  for(const [sport,league] of [['football','nfl'],['baseball','mlb'],
    ['hockey','nhl'],['basketball','wnba']])
    assert.match(espnInjuryFeedUrl(sport,league),/\/injuries$/)
  assert.equal(espnInjuryFeedUrl('soccer','eng.1'),null)
})
test('verify team-specific ESPN injuries against official scoreboard identity',async()=>{
  const visited=[]
  const response=async url=>{
    const u=String(url);visited.push(u)
    if(u.includes('/scoreboard?'))return json(board)
    if(u.endsWith('/teams/2/injuries'))return json({
      timestamp:'2026-11-08T20:12:00Z',injuries:[groups().injuries[0]]})
    if(u.endsWith('/teams/15/injuries'))return json({
      timestamp:'2026-11-08T20:12:00Z',injuries:[groups().injuries[1]]})
    throw Error('Unexpected endpoint '+u)
  }
  const r=await fetchEspnInjuryBackup(fixture,response,now)
  assert.equal(r.status,'verified')
  assert.equal(r.home.matched,true)
  assert.equal(r.away.matched,true)
  assert.equal(r.home.injuries[0].athlete,'Player Alpha')
  assert.equal(r.home.injuries[0].status,'Questionable')
  assert.equal(r.away.injuries[0].status,'Out')
  assert.equal(r.home.injuries[0].athleteId,'123')
  assert.equal(r.home.injuries[0].returnDate,'2026-11-09T00:00:00.000Z')
  assert.equal(visited.length,3,'team routes avoid huge league-wide report')
  assert.ok(r.officialSource.includes('official.nba.com'))
  assert.ok(r.notes.some(x=>x.includes('no es alineación')))
})
test('league-wide fallback preserves injury observations without an event ID',async()=>{
  const r=await fetchEspnInjuryBackup({
    ...fixture,eventId:undefined,date:undefined
  },async url=>{
    assert.equal(String(url),espnInjuryFeedUrl('basketball','nba'))
    return json(groups())
  },now)
  assert.equal(r.status,'verified')
  assert.equal(r.home.injuries.length,1)
  assert.equal(r.away.injuries.length,1)
  assert.equal(r.home.injuries[0].details,'Calf')
})
test('stale injury report must not be called a confirmed current absence',async()=>{
  const r=await fetchEspnInjuryBackup({...fixture,eventId:undefined},
    async()=>json(groups('2026-11-03T09:00:00Z')),now)
  assert.equal(r.status,'stale')
  assert.ok(r.notes.some(x=>x.includes('desactualizado')))
})
test('missing team never means healthy, and 403 never forges reports',async()=>{
  const onlyOne=groups()
  onlyOne.injuries=onlyOne.injuries.slice(0,1)
  const partial=await fetchEspnInjuryBackup({...fixture,eventId:undefined},
    async()=>json(onlyOne),now)
  assert.equal(partial.status,'partial')
  assert.equal(partial.away.matched,false)
  assert.ok(partial.notes.some(x=>x.includes('NO significa')))
  const forbidden=await fetchEspnInjuryBackup({...fixture,eventId:undefined},
    async()=>new Response('blocked',{status:403}),now)
  assert.equal(forbidden.status,'unavailable')
  assert.deepEqual(forbidden.home.injuries,[])
  assert.deepEqual(forbidden.away.injuries,[])
})
test('freshly crawled offseason WNBA injury list is not a verified game-day report',async()=>{
  const off={...groups(),season:{type:4,name:'Off Season'}}
  const result=await fetchEspnInjuryBackup({
    ...fixture,league:'wnba',eventId:undefined
  },async()=>json(off),now)
  assert.equal(result.status,'stale')
  assert.ok(result.notes.some(x=>x.includes('fuera de temporada')))
})
test('unknown sports return unsupported without network access',async()=>{
  const response=await fetchEspnInjuryBackup({...fixture,
    sport:'soccer',league:'usa.1'},async()=>{throw Error('must not fetch')},now)
  assert.equal(response.status,'unsupported')
  assert.equal(response.source,'')
})
test('explicit Active status remains Active and is not reinterpreted as Out',async()=>{
  const active=groups()
  active.injuries[0].injuries[0].status='Active'
  const result=await fetchEspnInjuryBackup({...fixture,eventId:undefined},
    async()=>json(active),now)
  assert.equal(result.home.injuries[0].status,'Active')
  assert.equal(result.status,'verified')
})
