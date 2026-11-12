import {test} from 'node:test'
import assert from 'node:assert/strict'
import {lookupExactEspnWinner,sameEspnTeam} from '../src/sports-exact-espn-winner.ts'

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
  assert.ok(report.quotes.every(q=>Date.parse(q.time)===Date.parse(target.kickoff)))
  assert.ok(report.quotes.every(q=>q.market==='h2h'))
  assert.ok(report.quotes.every(q=>q.source.includes('ESPN')))
  assert.ok(hits.some(x=>x.includes('dates=20261109')))
  assert.ok(hits.some(x=>x.includes('dates=20261110')))
})
test('old or undated ESPN quotes are usable as observed prices, not bookmaker updates',async()=>{
  for(const stamp of ['2026-11-08T18:00:00Z','']){
    const report=await lookupExactEspnWinner(target,async url=>{
      if(url.includes('scoreboard?dates=20261110'))
        return{events:[event(stamp)]}
      if(url.includes('scoreboard?'))return{events:[]}
      return{items:[]}
    },now)
    assert.equal(report.quotes.length,2)
    assert.ok(report.quotes.every(x=>x.observedAt===new Date(now).toISOString()&&
      x.bookmaker==='DraftKings'))
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

test('verified unknown soccer league uses ESPN event ID without inventing an odds route',async()=>{
  const targetUnknown={...target,sportKey:'soccer_espn_dynamic',espnLeague:'mex.w.1',
    home:'Tigres UANL',away:'Pumas UNAM'}
  const urls=[]
  const fixture={id:target.eventId,date:target.kickoff,competitions:[{
    id:target.eventId,competitors:[
      {homeAway:'home',team:{displayName:targetUnknown.home}},
      {homeAway:'away',team:{displayName:targetUnknown.away}},
    ],odds:[{provider:{name:'DraftKings'},lastUpdated:'2026-11-09T18:35:00Z',
      homeTeamOdds:{moneyLine:'-120'},awayTeamOdds:{moneyLine:'+205'},
      drawOdds:'+300'}],
  }]}
  const fetcher=async url=>{
    urls.push(url)
    if(url.includes('/soccer/mex.w.1/scoreboard?dates=20261110'))
      return{events:[fixture]}
    if(url.includes('scoreboard?'))return{events:[]}
    return{items:[]}
  }
  const result=await lookupExactEspnWinner(targetUnknown,fetcher,now)
  assert.equal(result.quotes.length,3)
  assert.ok(result.quotes.every(x=>x.bookmaker==='DraftKings'&&x.market==='1x2'))
  assert.ok(urls.some(url=>url.includes('/soccer/mex.w.1/scoreboard?')))
  assert.ok(!urls.some(url=>url.includes('epl')||url.includes('/eng.1/')))
})

test('undated official ESPN DraftKings prices are exposed as fresh source observations',async()=>{
  const unknown={...target,sportKey:'soccer_espn_dynamic',espnLeague:'mex.w.1',
    home:'Tigres UANL',away:'Pumas UNAM'}
  const fake=async url=>url.includes('scoreboard?dates=20261110')?
    {events:[{id:target.eventId,date:target.kickoff,competitions:[{
      id:target.eventId,competitors:[
        {homeAway:'home',team:{displayName:unknown.home}},
        {homeAway:'away',team:{displayName:unknown.away}},
      ],odds:[{provider:{name:'DraftKings'},
        homeTeamOdds:{moneyLine:'-135'},awayTeamOdds:{moneyLine:'+115'},
        drawOdds:'+280'}],
    }]}]}:url.includes('scoreboard?')?{events:[]}:{items:[]}
  const found=await lookupExactEspnWinner(unknown,fake,now)
  assert.equal(found.quotes.length,3)
  assert.equal(found.referenceCount,0)
  assert.ok(found.quotes.every(q=>q.bookmaker==='DraftKings'&&
    q.updatedAt==='No indicada por ESPN'&&
    q.observedAt===new Date(now).toISOString()))
  const wrong=await lookupExactEspnWinner({...unknown,away:'Monterrey'},fake,now)
  assert.equal(wrong.referenceCount,0)
})

test('dynamic soccer route cannot be used with unsafe league slugs',async()=>{
  const result=await lookupExactEspnWinner({...target,sportKey:'soccer_espn_dynamic',
    espnLeague:'mex.w.1/../../bad'},async()=>{throw Error('No network')},now)
  assert.equal(result.attempted,false)
  assert.equal(result.quotes.length,0)
  assert.equal(result.referenceOdds.length,0)
})

test('known NHL nickname aliases reconcile to the exact franchise, never a wrong club',()=>{
  assert.equal(sameEspnTeam('Pittsburgh Penguins','Penguins','icehockey_nhl'),true)
  assert.equal(sameEspnTeam('San Jose Sharks','Sharks','icehockey_nhl'),true)
  assert.equal(sameEspnTeam('Vegas Golden Knights','Golden Knights','icehockey_nhl'),true)
  assert.equal(sameEspnTeam('Pittsburgh Penguins','Sharks','icehockey_nhl'),false)
  assert.equal(sameEspnTeam('New York Rangers','New York','icehockey_nhl'),false)
  assert.equal(sameEspnTeam('Boston Celtics','Celtics','basketball_nba'),false)
})
test('exact NHL ESPN event pricing accepts team nicknames but rejects wrong rival',async()=>{
  const hockey={...target,sportKey:'icehockey_nhl',eventId:'401892695',
    home:'Pittsburgh Penguins',away:'San Jose Sharks'}
  const nhlEvent={id:hockey.eventId,date:hockey.kickoff,competitions:[{
    id:hockey.eventId,competitors:[
      {homeAway:'home',team:{displayName:'Penguins'}},
      {homeAway:'away',team:{displayName:'Sharks'}},
    ],odds:[{provider:{name:'DraftKings'},
      homeTeamOdds:{moneyLine:'-135'},awayTeamOdds:{moneyLine:'+114'}}],
  }]}
  const fake=async url=>url.includes('scoreboard?dates=20261110')?
    {events:[nhlEvent]}:url.includes('scoreboard?')?{events:[]}:{items:[]}
  const found=await lookupExactEspnWinner(hockey,fake,now)
  assert.equal(found.quotes.length,2)
  assert.ok(found.quotes.every(q=>q.bookmaker==='DraftKings'&&q.observedAt))
  assert.equal((await lookupExactEspnWinner({...hockey,home:'Vegas Golden Knights'},
    fake,now)).quotes.length,0)
})

test('exact ESPN accepts a very old bookmaker update when freshly fetched, never changes the observed timestamp',async()=>{
  const ancient=event('2026-10-01T02:00:00Z')
  const report=await lookupExactEspnWinner(target,async url=>
    url.includes('scoreboard?dates=20261110')?{events:[ancient]}:
      url.includes('scoreboard?')?{events:[]}:{items:[]},now)
  assert.equal(report.quotes.length,2)
  assert.ok(report.quotes.every(q=>q.updatedAt==='2026-10-01T02:00:00Z'))
  assert.ok(report.quotes.every(q=>q.observedAt===new Date(now).toISOString()))
  assert.equal(report.attempted,true)
})
