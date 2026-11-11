import {test} from 'node:test'
import assert from 'node:assert/strict'
import {scoutDailySports} from '../src/daily-sports-scout.ts'

const day='2026-11-02'
const now=Date.parse('2026-11-02T12:00:00Z')
const kickoff='2026-11-02T19:00:00Z'
const game=(id,sport='team',date=kickoff,status='pre')=>({
  id:String(id),date,status:{type:{state:status}},
  competitions:[{competitors:[
    {homeAway:'home',[sport]:{id:String(id)+'1',displayName:'Home '+id}},
    {homeAway:'away',[sport]:{id:String(id)+'2',displayName:'Away '+id}},
  ]}],
})
const calls=[]
const fetcher=async url=>{
  const u=String(url)
  calls.push(u)
  const events=u.includes('/basketball/nba/')?[game(1),game(2),game(3)]:
    u.includes('/baseball/mlb/')?[game(4)]:
      u.includes('/soccer/eng.1/')?[game(5),game(6)]:
        u.includes('/tennis/atp/')?[game(7,'athlete')]:[]
  return new Response(JSON.stringify({events}),{status:200})
}

test('one bounded daily scan covers the real leagues and diversifies sports',async()=>{
  calls.length=0
  const report=await scoutDailySports(day,5,fetcher,now)
  assert.ok(calls.length>=report.coverage.length*2)
  assert.equal(report.totalEligible,6)
  assert.equal(report.events.length,5)
  assert.equal(new Set(report.events.map(x=>x.sport)).size,3)
  assert.ok(report.events.every(x=>x.status==='scheduled'&&x.source==='ESPN Site API'))
  assert.ok(report.events.every(x=>x.home.id&&x.away.id&&x.eventId))
  assert.ok(report.coverage.some(x=>x.sport==='basketball'&&x.league==='wnba'&&x.status==='empty'))
  assert.match(report.warning,/NO ranking/)
  assert.ok(!('probability' in report.events[0]))
  assert.ok(!('price' in report.events[0]))
})

test('unconfirmed games, started games, malformed IDs and incomplete participants never qualify',async()=>{
  const invalid=async url=>{
    const events=String(url).includes('/basketball/nba/')?[
      game(1,'team','2026-11-02T09:00:00Z','pre'),
      game(2,'team',kickoff,'in'),
      game('evil-id'),
      {id:'24',date:kickoff,status:{type:{state:'pre'}},competitions:[{competitors:[
        {homeAway:'home',team:{id:'241',displayName:'Home'}},
      ]}]},
      game(3),
    ]:[]
    return new Response(JSON.stringify({events}))
  }
  const report=await scoutDailySports(day,8,invalid,now)
  assert.deepEqual(report.events.map(x=>x.eventId),['3'])
  assert.equal(report.totalEligible,1)
})

test('provider permission and malformed scan controls are enforced',async()=>{
  await assert.rejects(()=>scoutDailySports('2026-02-30',5,fetcher,now),/Fecha inválida/)
  await assert.rejects(()=>scoutDailySports(day,37,fetcher,now),/1 a 36/)
  await assert.rejects(()=>scoutDailySports(day,5,fetcher,now,{PHOENIX_SPORTS_ESPN_DISABLED:'1'}),/ESPN deshabilitado/)
})

test('one provider error cannot be promoted as an empty or verified league',async()=>{
  const partial=async url=>{
    if(String(url).includes('/soccer/eng.1/'))throw Error('network down')
    return new Response(JSON.stringify({events:[]}))
  }
  const report=await scoutDailySports(day,3,partial,now)
  assert.equal(report.events.length,0)
  assert.equal(report.coverage.find(x=>x.league==='eng.1')?.status,'unavailable')
  assert.equal(report.coverage.find(x=>x.league==='nba')?.status,'empty')
})
test('daily market search keeps as many as 36 real upcoming candidates, not only 12',async()=>{
  const large=async url=>{
    const u=String(url)
    const events=u.includes('/basketball/nba/')?
      Array.from({length:24},(_,i)=>game(100+i)):
      u.includes('/soccer/eng.1/')?
        Array.from({length:24},(_,i)=>game(200+i)):[]
    return new Response(JSON.stringify({events}),{status:200})
  }
  const report=await scoutDailySports(day,36,large,now)
  assert.equal(report.totalEligible,48)
  assert.equal(report.events.length,36)
  assert.equal(new Set(report.events.map(x=>x.sport)).size,2)
  assert.equal(new Set(report.events.map(x=>x.sport+'|'+x.league+'|'+x.eventId)).size,36)
  assert.equal(report.coverage.find(x=>x.league==='nba')?.futureEvents,24)
  assert.ok(report.events.every(x=>Date.parse(x.kickoff)===Date.parse(kickoff)))
})

test('the requested day is Santo Domingo local, including games after UTC midnight',async()=>{
  const boundary=async url=>{
    const events=String(url).includes('/basketball/nba/')?[
      game(11,'team','2026-11-03T02:30:00Z','pre'),
      game(12,'team','2026-11-03T05:30:00Z','pre'),
    ]:[]
    return new Response(JSON.stringify({events}))
  }
  const result=await scoutDailySports(day,5,boundary,now)
  assert.deepEqual(result.events.map(x=>x.eventId),['11'])
  assert.equal(result.totalEligible,1)
  assert.equal(result.coverage.find(x=>x.league==='nba')?.futureEvents,1)
})

test('late Santo Domingo kickoff is found even when ESPN returns it only in the next UTC partition',async()=>{
  const calls=[]
  const partitioned=async url=>{
    const u=String(url);calls.push(u)
    const events=u.includes('/basketball/nba/')&&u.includes('dates=20261103')?
      [game(71,'team','2026-11-03T02:45:00Z','pre')]:[]
    return new Response(JSON.stringify({events}))
  }
  const report=await scoutDailySports(day,5,partitioned,now)
  assert.deepEqual(report.events.map(e=>e.eventId),['71'])
  assert.equal(report.events[0].kickoff,'2026-11-03T02:45:00.000Z')
  assert.equal(report.totalEligible,1)
  assert.ok(calls.length>=report.coverage.length*2)
})
test('one failed UTC partition cannot masquerade as full empty league coverage',async()=>{
  const partial=async url=>{
    const u=String(url)
    if(u.includes('/basketball/nba/')&&u.includes('dates=20261103'))
      return new Response('outage',{status:503})
    return new Response(JSON.stringify({events:[]}))
  }
  const report=await scoutDailySports(day,5,partial,now)
  assert.equal(report.coverage.find(x=>x.league==='nba')?.status,'unavailable')
  assert.match(report.coverage.find(x=>x.league==='nba')?.reason??'',/Cobertura parcial/)
})

test('a permanently stalled ESPN endpoint cannot freeze the daily scan',async()=>{
  const never= new Promise(()=>{})
  const fast=async url=>{
    if(String(url).includes('/basketball/nba/'))return never
    const events=String(url).includes('/football/nfl/')?[game(908)]:[]
    return new Response(JSON.stringify({events}),{status:200})
  }
  const started=Date.now()
  const report=await scoutDailySports(day,5,fast,now,
    {PHOENIX_SPORTS_SCAN_TIMEOUT_MS:'45'})
  assert.ok(Date.now()-started<1800,'a hanging provider must be isolated')
  assert.equal(report.coverage.find(x=>x.league==='nba')?.status,'unavailable')
  assert.ok(report.events.some(e=>e.league==='nfl'&&e.eventId==='908'))
  assert.equal(report.diagnostics.requestTimeoutMs,45)
  assert.equal(report.diagnostics.requestedPartitions,report.coverage.length*2)
  assert.ok(report.diagnostics.unavailableLeagues>=1)
})
test('a partial ESPN date timeout preserves verified events and reports incomplete coverage',async()=>{
  const fetcher=async url=>{
    const u=String(url)
    if(u.includes('/basketball/nba/')&&u.includes('dates=20261103'))
      return new Promise(()=>{})
    return new Response(JSON.stringify({events:u.includes('/basketball/nba/')?
      [game(77)]:[]}))
  }
  const result=await scoutDailySports(day,8,fetcher,now,
    {PHOENIX_SPORTS_SCAN_TIMEOUT_MS:'35'})
  assert.ok(result.events.some(e=>e.eventId==='77'))
  const league=result.coverage.find(c=>c.league==='nba')
  assert.equal(league?.status,'available')
  assert.match(league?.reason??'',/Cobertura parcial/)
  assert.ok(result.diagnostics.partialLeagues>=1)
})

test('calendar-first scan limits calls to requested sports and recognizes womens Champions League',async()=>{
  const seen=[]
  const targeted=async url=>{
    const value=String(url);seen.push(value)
    const events=value.includes('/soccer/uefa.wchampions/')?
      [game(992,'team',kickoff)]:[]
    return new Response(JSON.stringify({events}))
  }
  const report=await scoutDailySports(day,5,targeted,now,{},['soccer'])
  assert.equal(seen.length,report.coverage.length*2)
  assert.ok(seen.every(url=>url.includes('/soccer/')))
  assert.ok(report.events.some(x=>x.eventId==='992'&&x.league==='uefa.wchampions'))
  assert.equal(report.diagnostics.requestedPartitions,report.coverage.length*2)
  await assert.rejects(()=>scoutDailySports(day,5,targeted,now,{},['bad-sport']),
    /fuera del calendario/)
})
