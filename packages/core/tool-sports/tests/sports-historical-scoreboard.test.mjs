import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readHistoricalScoreboard} from '../src/sports-historical-scoreboard.ts'
const root='https://site.api.espn.com/apis/site/v2/sports/soccer/por.1/'
const game=(id,date)=>({id,date,status:{type:{state:'post'}},
  competitions:[{competitors:[
    {homeAway:'home',team:{id:'1',displayName:'Home'},score:'2'},
    {homeAway:'away',team:{id:'2',displayName:'Away'},score:'1'}]}]})
test('month-only ESPN history replaces broken range and keeps actual games',async()=>{
  const calls=[]
  const f=async url=>{
    calls.push(url)
    if(url.includes('dates=202609'))return {events:[game('101','2026-09-20T18:00:00Z')]}
    if(url.includes('dates=202610'))return {events:[game('102','2026-10-14T18:00:00Z')]}
    return {events:[game('103','2026-11-06T18:00:00Z')]}
  }
  const x=await readHistoricalScoreboard(root,'2026-09-15','2026-11-07',f)
  assert.equal(x.status,'verified')
  assert.deepEqual(x.events.map(v=>v.id),['101','102','103'])
  assert.equal(x.monthlyQueries,3)
  assert.equal(x.dailyQueries,0)
  assert.ok(calls.every(x=>! /dates=\d{8}-\d{8}/u.test(x)))
})
test('400 on YYYYMM falls back to day evidence and never declares provider empty',async()=>{
  const calls=[]
  const f=async url=>{
    calls.push(url)
    if(url.includes('dates=202611&'))return null
    const day=url.match(/dates=(\d{8})/u)?.[1]
    if(day==='20261101')return {events:[game('201','2026-11-01T19:00:00Z')]}
    if(day==='20261106')return {events:[game('206','2026-11-06T19:00:00Z')]}
    return {events:[]}
  }
  const x=await readHistoricalScoreboard(root,'2026-11-01','2026-11-06',f)
  assert.equal(x.status,'verified')
  assert.equal(x.monthlySuccesses,0)
  assert.equal(x.dailySuccesses,6)
  assert.deepEqual(x.events.map(v=>v.id),['201','206'])
  assert.ok(calls.some(url=>url.includes('dates=20261101')))
  assert.ok(calls.every(url=>!/dates=\d{8}-\d{8}/u.test(url)))
})
test('source down on month and day returns unavailable without fictional events',async()=>{
  let calls=0
  const x=await readHistoricalScoreboard(root,'2026-11-01','2026-11-15',
    async()=>{calls++;throw Error('HTTP 401')})
  assert.equal(x.status,'unavailable')
  assert.equal(x.events.length,0)
  assert.equal(calls,3) // 1 monthly query and two boundary probes
})
test('no event without numeric provider ID, real UTC timestamp, or correct date',async()=>{
  const x=await readHistoricalScoreboard(root,'2026-11-01','2026-11-09',async()=>({
    events:[game('101','2026-11-02T18:00:00Z'),
      game('101','2026-11-02T18:00:00Z'),
      game('fake','2026-11-02T18:00:00Z'),
      game('401','2026-09-02T18:00:00Z'),
      game('900','missing-date')]}))
  assert.deepEqual(x.events.map(v=>v.id),['101'])
})
test('invalid date interval and arbitrary host are rejected',async()=>{
  const f=async()=>({events:[]})
  await assert.rejects(readHistoricalScoreboard('https://evil.example/', '2026-11-01','2026-11-08',f))
  await assert.rejects(readHistoricalScoreboard(root,'2026-11-10','2026-11-01',f))
  await assert.rejects(readHistoricalScoreboard(root,'2026-01-01','2026-11-07',f))
})


test('team schedule is third independent path after ESPN month/day outage',async()=>{
  const root='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
  const f=async url=>url.includes('/teams/5/schedule')?{
    events:[game('511','2026-11-05T19:00:00Z')]}:null
  const x=await readHistoricalScoreboard(root,'2026-11-01','2026-11-06',f,['5'])
  assert.equal(x.status,'partial')
  assert.equal(x.dailySuccesses,0)
  assert.equal(x.scheduleSuccesses,1)
  assert.deepEqual(x.events.map(e=>e.id),['511'])
})

test('a broken league archive reaches three different fixtures with a strict six-team fallback cap',async()=>{
  const calls=[]
  const read=async url=>{
    calls.push(url)
    if(url.includes('/teams/'))return {events:[game(
      '9'+(url.match(/teams\/(\d+)/u)?.[1]??'0'),
      '2026-11-05T19:00:00Z',
    )]}
    return null
  }
  const teamIds=['101','102','201','202','301','302','401','402']
  const audit=await readHistoricalScoreboard(root,'2026-11-01','2026-11-06',
    read,teamIds)
  assert.equal(audit.scheduleQueries,6)
  assert.equal(audit.scheduleSuccesses,6)
  assert.equal(audit.status,'partial')
  assert.equal(calls.filter(url=>url.includes('/teams/')).length,6)
  assert.ok(!calls.some(url=>url.includes('/teams/401/')))
})
