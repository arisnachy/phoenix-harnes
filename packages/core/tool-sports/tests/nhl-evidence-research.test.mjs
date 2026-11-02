import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nhlSlate,investigateNhl} from '../src/nhl-evidence-research.ts'
import {settleNhlMarket} from '../src/nhl-market-settlement.ts'
const now=Date.parse('2026-11-02T11:00:00Z'),date='2026-11-05'
const game={id:2026020201,startTimeUTC:'2026-11-05T23:00:00Z',gameState:'FUT',
  season:20262027,homeTeam:{id:10,abbrev:'TOR',name:{default:'Toronto Maple Leafs'}},
  awayTeam:{id:20,abbrev:'MTL',name:{default:'Montreal Canadiens'}},
  venue:{default:'Test Arena'}}
const mkRoster=(abbr,offset)=>({
  forwards:Array.from({length:12},(_,i)=>({id:offset+i+1,firstName:{default:'Forward'},
    lastName:{default:abbr+' '+i},positionCode:'C'})),
  defensemen:Array.from({length:6},(_,i)=>({id:offset+20+i,firstName:{default:'Defense'},
    lastName:{default:abbr+' '+i},positionCode:'D'})),
  goalies:Array.from({length:2},(_,i)=>({id:offset+50+i,firstName:{default:'Goalie'},
    lastName:{default:abbr+' '+i},positionCode:'G'})),
})
function fake({started=false,missingAway=false,empty=false}={}){
  const calls=[]
  const fetcher=async x=>{
    const url=String(x),u=new URL(url);calls.push(url)
    let body
    if(u.pathname==='/v1/score/'+date)
      body={games:empty?[]:[started?{...game,gameState:'LIVE'}:game]}
    else if(u.pathname==='/v1/roster/TOR/current')body=mkRoster('TOR',10000)
    else if(u.pathname==='/v1/roster/MTL/current'){
      if(missingAway)return new Response('unavailable',{status:503})
      body=mkRoster('MTL',20000)
    }else if(u.pathname==='/v1/standings/'+date)
      body={standings:[{teamAbbrev:{default:'TOR'},wins:11,losses:4,otLosses:2},
        {teamAbbrev:{default:'MTL'},wins:9,losses:6,otLosses:1}]}
    else if(u.pathname.includes('/player/')&&u.pathname.endsWith('/landing'))
      body={featuredStats:{regularSeason:{subSeason:{goals:10,assists:7,
        points:17,shots:42,savePctg:0.916,goalsAgainstAvg:2.4}}},
        last5Games:[{gameDate:'2026-11-01',goals:1,assists:1,shots:4}]}
    else throw new Error('Unexpected NHL API '+url)
    return new Response(JSON.stringify(body),{status:200,headers:{
      'content-type':'application/json'}})
  }
  return{fetcher,calls}
}
test('NHL official fixture lookup, identity and score by date',async()=>{
  const api=fake(),r=await nhlSlate(date,api.fetcher,now)
  assert.equal(r.games.length,1)
  assert.equal(r.games[0].id,'2026020201')
  assert.equal(r.games[0].home.name,'Toronto Maple Leafs')
  assert.equal(r.games[0].away.abbrev,'MTL')
  assert.equal(r.globalCoverage,false)
  assert.equal(r.sources[0].status,'verified')
})
test('roster forwards/defense/goalies stay distinct; no starting goalie asserted',async()=>{
  const api=fake()
  const q={eventId:'book-test',sportKey:'icehockey_nhl',bookmaker:'Verified Book',
    home:'Toronto Maple Leafs',away:'Montreal Canadiens',
    time:game.startTimeUTC,timeIso:game.startTimeUTC,
    updatedAt:'2026-11-02T10:55:00Z',market:'totals',
    selection:'Over',price:1.9,point:5.5,source:'verified market'}
  const d=await investigateNhl(date,'2026020201',api.fetcher,now,[q,
    {...q,home:'Not Toronto'},{...q,updatedAt:'2026-10-30T10:55:00Z'}],3)
  assert.equal(d.players.home.length,20)
  assert.equal(d.players.away.length,20)
  assert.equal(d.goalieCandidates.home.length,2)
  assert.equal(d.goalieCandidates.away.length,2)
  assert.ok(d.goalieCandidates.home.every(g=>g.starterConfirmed===false))
  assert.ok(d.players.home.some(p=>p.stats.goals==='10'))
  assert.equal(d.possibleMatchups.length,20)
  assert.ok(d.possibleMatchups.every(x=>Number(x.attackerId)<20000?
    x.againstGoalies.every(y=>y.includes('MTL')):
    x.againstGoalies.every(y=>y.includes('TOR'))))
  assert.equal(d.markets.length,1)
  assert.equal(d.markets[0].approved,false)
  assert.equal(d.standings.home,'11 V · 4 D · 2 OT')
  assert.equal(d.opportunity.eligibleForTicket,false)
  assert.equal(d.opportunity.calibratedProbability,false)
  assert.equal(d.uiBlock.component,'sports_espn_dashboard')
})
test('missing opponent roster triggers explicit abstention and source error',async()=>{
  const d=await investigateNhl(date,'2026020201',fake({missingAway:true}).fetcher,now,[],2)
  assert.equal(d.goalieCandidates.away.length,0)
  assert.equal(d.opportunity.decision,'abstain')
  assert.ok(d.sources.some(s=>s.status==='error'))
  assert.ok(d.missingEvidence.some(s=>s.includes('rosters')))
})
test('invalid date, non-slate NHL id and started game cannot pass pregame gate',async()=>{
  await assert.rejects(()=>nhlSlate('2026-02-30',fake().fetcher,now),/Fecha/)
  await assert.rejects(()=>investigateNhl(date,'90000000',fake().fetcher,now),/cartelera/)
  await assert.rejects(()=>investigateNhl(date,'2026020201',
    fake({started:true}).fetcher,now),/pregame/)
})
const final={regulationHome:2,regulationAway:2,finalHome:3,finalAway:2,
  winner:'home',completed:true,winnerVerified:true}
test('60 min tie is not equivalent to NHL moneyline including overtime',()=>{
  assert.equal(settleNhlMarket(final,{kind:'regulation_3way',pick:'draw'}).status,'win')
  assert.equal(settleNhlMarket(final,{kind:'regulation_3way',pick:'home'}).status,'loss')
  assert.equal(settleNhlMarket(final,{kind:'winner_with_ot',pick:'home'}).status,'win')
  assert.equal(settleNhlMarket({...final,winnerVerified:false},
    {kind:'winner_with_ot',pick:'home'}).status,'pending')
})
test('puck line and totals handle regulation period and half/whole lines',()=>{
  assert.equal(settleNhlMarket(final,{kind:'total',period:'regulation',
    pick:'over',line:4}).status,'push')
  assert.equal(settleNhlMarket(final,{kind:'total',period:'including_ot',
    pick:'over',line:4.5}).status,'win')
  assert.equal(settleNhlMarket(final,{kind:'puck_line',period:'including_ot',
    pick:'home',line:-1.5}).status,'loss')
  assert.throws(()=>settleNhlMarket(final,{kind:'total',period:'regulation',
    pick:'over',line:4.25}),/Línea/)
})
