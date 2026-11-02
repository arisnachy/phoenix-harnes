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
  assert.equal(calls.length,12)
  assert.equal(report.totalEligible,7)
  assert.equal(report.events.length,5)
  assert.equal(new Set(report.events.map(x=>x.sport)).size,4)
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
  await assert.rejects(()=>scoutDailySports(day,21,fetcher,now),/1 a 20/)
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
