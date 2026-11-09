import {test} from 'node:test'
import assert from 'node:assert/strict'
import {lookupExactEspnWinner} from '../src/sports-exact-espn-winner.ts'

const now=Date.parse('2026-11-09T18:45:00Z')
const target={
  sportKey:'basketball_nba',date:'2026-11-09',eventId:'401999444',
  home:'Boston Celtics',away:'Milwaukee Bucks',kickoff:'2026-11-10T02:00:00Z',
}
const event=(update='2026-11-09T18:32:00Z',book='DraftKings',kickoff=target.kickoff)=>({
  id:target.eventId,date:kickoff,
  competitions:[{id:target.eventId,competitors:[
    {homeAway:'home',team:{displayName:target.home}},
    {homeAway:'away',team:{displayName:target.away}},
  ],odds:[{provider:{name:book},lastUpdated:update,
    homeTeamOdds:{moneyLine:'-155'},awayTeamOdds:{moneyLine:'+132'}}]}],
})
const mock=async(url)=>{
  if(url.includes('scoreboard?dates=20261109'))return{events:[]}
  if(url.includes('scoreboard?dates=20261110'))return{events:[event()]}
  if(url.includes('/odds'))return{items:[]}
  if(url.includes('/summary?'))return{}
  throw Error('Unexpected route '+url)
}

test('exact ESPN event is found even when the game falls after midnight UTC',async()=>{
  const hits=[]
  const report=await lookupExactEspnWinner(target,async url=>{
    hits.push(url)
    return mock(url)
  },now)
  assert.equal(report.attempted,true)
  assert.equal(report.quotes.length,2)
  assert.ok(report.quotes.every(q=>q.bookmaker==='DraftKings'))
  assert.ok(report.quotes.every(q=>q.time===target.kickoff))
  assert.ok(report.quotes.every(q=>q.market==='h2h'))
  assert.ok(report.quotes.every(q=>q.source.includes('ESPN')))
  assert.ok(hits.some(x=>x.includes('dates=20261109')))
  assert.ok(hits.some(x=>x.includes('dates=20261110')))
})
test('old or undated odds cannot be promoted to live ticket',async()=>{
  for(const stamp of ['2026-11-08T18:00:00Z','']){
    const report=await lookupExactEspnWinner(target,async url=>{
      if(url.includes('scoreboard?dates=20261110'))
        return{events:[event(stamp)]}
      if(url.includes('scoreboard?'))return{events:[]}
      return{items:[]}
    },now)
    assert.equal(report.quotes.length,0)
  }
})
test('same ESPN event id but wrong matchup must never be priced',async()=>{
  const report=await lookupExactEspnWinner({...target,away:'Phoenix Suns'},mock,now)
  assert.equal(report.quotes.length,0)
})
test('a started or invalid ESPN fixture is excluded without calling public endpoints',async()=>{
  for(const input of [{...target,kickoff:'2026-11-09T16:00:00Z'},
    {...target,eventId:'javascript:alert(1)'}]){
    const report=await lookupExactEspnWinner(input,async()=>{
      throw Error('Transport must not be used')
    },now)
    assert.equal(report.attempted,false)
    assert.equal(report.quotes.length,0)
  }
})
test('soccer winner requires same-bookmaker DRAW leg for 1X2, not h2h',async()=>{
  const match={
    ...target,sportKey:'soccer_epl',home:'Arsenal',away:'Chelsea',
  }
  const soccer=(draw)=>({
    id:match.eventId,date:match.kickoff,competitions:[{
      id:match.eventId,competitors:[
        {homeAway:'home',team:{displayName:match.home}},
        {homeAway:'away',team:{displayName:match.away}},
      ],odds:[{provider:{name:'FanDuel'},lastUpdated:'2026-11-09T18:35:00Z',
        homeTeamOdds:{moneyLine:'-120'},awayTeamOdds:{moneyLine:'+205'},
        ...(draw?{drawOdds:'+300'}:{})}],
    }],
  })
  const fake=(draw)=>async url=>url.includes('scoreboard?dates=20261110')?
    {events:[soccer(draw)]}:url.includes('scoreboard?')?{events:[]}:{items:[]}
  assert.equal((await lookupExactEspnWinner(match,fake(false),now)).quotes.length,0)
  const checked=await lookupExactEspnWinner(match,fake(true),now)
  assert.equal(checked.quotes.length,3)
  assert.ok(checked.quotes.every(q=>q.market==='1x2'))
  assert.ok(checked.quotes.some(q=>q.selection==='Draw'))
})
