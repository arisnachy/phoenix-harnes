import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nhlSlate,investigateNhl,parseNhlSpecialTeams} from '../src/nhl-evidence-research.ts'
import {settleNhlMarket} from '../src/nhl-market-settlement.ts'
import {withNhlDeadline,compactNhlChatDossier} from '../src/nhl-chat-performance.ts'
import {getFeed} from '../src/sports.ts'
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
function fake({started=false,missingAway=false,empty=false,withSpecial=false,
  seasonRoutesOnly=false}={}){
  const calls=[]
  const fetcher=async x=>{
    const url=String(x),u=new URL(url);calls.push(url)
    let body
    if(u.pathname==='/v1/score/'+date)
      body={games:empty?[]:[started?{...game,gameState:'LIVE'}:game]}
    else if(seasonRoutesOnly&&u.pathname==='/v1/roster/TOR/20262027')
      body=mkRoster('TOR',10000)
    else if(seasonRoutesOnly&&u.pathname==='/v1/roster/MTL/20262027'){
      if(missingAway)return new Response('unavailable',{status:503})
      body=mkRoster('MTL',20000)
    }
    else if(u.pathname==='/v1/roster/TOR/current')body=mkRoster('TOR',10000)
    else if(u.pathname==='/v1/roster/MTL/current'){
      if(missingAway)return new Response('unavailable',{status:503})
      body=mkRoster('MTL',20000)
    }else if(u.pathname.includes('/v1/club-schedule-season/')&&
      (!seasonRoutesOnly||u.pathname.endsWith('/20262027'))){
      body={games:[{id:2026020101,startTimeUTC:'2026-11-01T23:00:00Z',
        gameState:'OFF',homeTeam:{abbrev:'TOR',score:4},
        awayTeam:{abbrev:'MTL',score:2}},
        {id:2026020201,startTimeUTC:game.startTimeUTC,gameState:'FUT',
          homeTeam:{abbrev:'TOR'},awayTeam:{abbrev:'MTL'}}]}
    }else if(u.pathname==='/v1/standings/'+date)
      body={standings:[{teamAbbrev:{default:'TOR'},wins:11,losses:4,otLosses:2},
        {teamAbbrev:{default:'MTL'},wins:9,losses:6,otLosses:1}]}
    else if(u.hostname==='api.nhle.com'&&withSpecial){
      const powerplay=u.pathname.endsWith('/powerplay')
      body={data:[{teamId:10,[powerplay?'powerPlayPct':'penaltyKillPct']:
        powerplay?0.251:0.838},
        {teamId:20,[powerplay?'powerPlayPct':'penaltyKillPct']:
          powerplay?0.19:0.77}]}
    }
    else if(u.pathname.includes('/player/')&&
      u.pathname.includes('/game-log/20262027/2'))
      body={gameLog:[
        {gameId:2026020101,gameDate:'2026-11-01',homeRoadFlag:'H',
          opponentAbbrev:'BOS',goals:1,assists:1,points:2,shots:4,
          shotsAgainst:35,saves:32,savePctg:0.914,goalsAgainst:3},
        {gameId:2026020090,gameDate:'2026-10-27',homeRoadFlag:'R',
          opponentAbbrev:'NYR',goals:0,assists:2,points:2,shots:2,
          shotsAgainst:30,saves:29,savePctg:0.966,goalsAgainst:1},
      ]}
    else if(u.pathname.includes('/player/')&&u.pathname.endsWith('/landing'))
      body={featuredStats:{regularSeason:{subSeason:{goals:10,assists:7,
        points:17,shots:42,savePctg:0.916,goalsAgainstAvg:2.4}}},
        last5Games:[{gameDate:'2026-11-01',goals:1,assists:1,shots:4,
          shotsAgainst:35,saves:32,savePctg:0.914,goalsAgainst:3}]}
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
  assert.ok(d.goalieCandidates.home[0].last5[0].summary.includes('saves: 32'))
  assert.equal(d.goalieCandidates.home[0].last20.length,2)
  assert.equal(d.goalieCandidates.home[0].homeRoadSplits.home.games,1)
  assert.equal(d.goalieCandidates.home[0].homeRoadSplits.away.games,1)
  assert.equal(d.goalieCandidates.home[0].homeRoadSplits.home.averages.saves,32)
  assert.ok(api.calls.some(u=>u.includes('/game-log/20262027/2')))
  assert.ok(d.players.home.some(p=>p.stats.goals==='10'))
  assert.equal(d.possibleMatchups.length,20)
  assert.ok(d.possibleMatchups.every(x=>Number(x.attackerId)<20000?
    x.againstGoalies.every(y=>y.includes('MTL')):
    x.againstGoalies.every(y=>y.includes('TOR'))))
  assert.equal(d.markets.length,1)
  assert.equal(d.markets[0].approved,false)
  assert.equal(d.standings.home,'11 V · 4 D · 2 OT')
  assert.equal(d.form.home.wins,1)
  assert.equal(d.form.away.losses,1)
  assert.equal(d.form.home.homeGames,1)
  assert.equal(d.form.home.last10.length,1)
  assert.ok(d.form.home.restHours>80)
  assert.equal(d.opportunity.eligibleForTicket,false)
  assert.equal(d.opportunity.calibratedProbability,false)
  assert.equal(d.uiBlock.component,'sports_espn_dashboard')
})
test('season-specific NHL roster and calendar recover all players and game forms',async()=>{
  const api=fake({seasonRoutesOnly:true})
  const d=await investigateNhl(date,'2026020201',api.fetcher,now,[],2)
  assert.equal(d.players.home.length,20)
  assert.equal(d.players.away.length,20)
  assert.equal(d.form.home.last5.length,1)
  assert.equal(d.form.home.last10.length,1)
  assert.equal(d.form.home.last20.length,1)
  assert.equal(d.form.home.last20[0].location,'home')
  assert.ok(api.calls.includes('https://api-web.nhle.com/v1/roster/TOR/20262027'))
  assert.ok(api.calls.includes('https://api-web.nhle.com/v1/club-schedule-season/MTL/20262027'))
  assert.equal(api.calls.some(x=>x.includes('/roster/TOR/current')),false)
  assert.equal(api.calls.some(x=>x.includes('/club-schedule-season/TOR/now')),false)
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

test('NHL official season PP and PK are measured for both teams without inventing xG',async()=>{
  const api=fake({withSpecial:true})
  const result=await investigateNhl(date,'2026020201',api.fetcher,now,[],2)
  assert.equal(result.specialTeams.complete,true)
  assert.equal(result.specialTeams.home.powerPlayPct,25.1)
  assert.equal(result.specialTeams.home.penaltyKillPct,83.8)
  assert.equal(result.specialTeams.away.powerPlayPct,19)
  assert.equal(result.specialTeams.away.penaltyKillPct,77)
  assert.ok(api.calls.some(u=>u.includes('/team/powerplay?')))
  assert.ok(api.calls.some(u=>u.includes('/team/penaltykill?')))
  assert.ok(result.missingEvidence.some(x=>x.includes('5v5 xG')))
  assert.equal(result.goalieCandidates.home[0].starterConfirmed,false)
})
test('NHL special-teams metrics require same official team ids and all four values',()=>{
  const fixture={home:{id:'10'},away:{id:'20'}}
  const report=parseNhlSpecialTeams(fixture,
    {data:[{teamId:10,powerPlayPct:0.25},{teamId:99,powerPlayPct:0.9}]},
    {data:[{teamId:20,penaltyKillPct:0.78}]},now)
  assert.equal(report.complete,false)
  assert.equal(report.home.powerPlayPct,25)
  assert.equal(report.away.powerPlayPct,null)
  assert.equal(report.home.penaltyKillPct,null)
  assert.equal(report.away.penaltyKillPct,78)
  assert.equal(parseNhlSpecialTeams(fixture,null,null,now).complete,false)
})

test('NHL 307 follows only same-host HTTPS season path, never redirects to foreign hosts',async()=>{
  const calls=[]
  const fetcher=async url=>{
    calls.push(String(url))
    return calls.length===1?new Response(null,{status:307,headers:{
      location:'/v1/roster/TBL/20262027'}}):
      new Response(JSON.stringify({forwards:[{id:1}]}),{status:200})
  }
  const x=await getFeed('https://api-web.nhle.com/v1/roster/TBL/current',fetcher)
  assert.equal(x.forwards[0].id,1)
  assert.equal(calls.length,2)
  assert.equal(calls[1],'https://api-web.nhle.com/v1/roster/TBL/20262027')
  let attempts=0
  await assert.rejects(()=>getFeed('https://api-web.nhle.com/v1/roster/TBL/current',
    async()=>{attempts++;return new Response(null,{status:307,headers:{
      location:'https://127.0.0.1/private'}})}),/Redirección NHL fuera/)
  assert.equal(attempts,1)
})

test('NHL chat deadline cancels pending work instead of trapping Kira',async()=>{
  let aborted=false
  await assert.rejects(()=>withNhlDeadline(signal=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>{aborted=true;resolve('late')},{once:true})
  }),15),/NHL_TIMEOUT/)
  assert.equal(aborted,true)
  assert.equal(await withNhlDeadline(async()=>42,250),42)
})

test('NHL player research stops optional requests at budget but retains team evidence',async()=>{
  const api=fake()
  const d=await investigateNhl(date,'2026020201',api.fetcher,now,[],15,Date.now()-1)
  assert.equal(d.standings.home,'11 V · 4 D · 2 OT')
  assert.equal(d.players.home.length,20)
  assert.equal(d.form.home.wins,1)
  assert.equal(d.form.home.last10.length,1)
  assert.equal(api.calls.some(u=>u.includes('/player/')),false)
  assert.equal(d.opportunity.calibratedProbability,false)
})

test('NHL model-facing report is compact; full game logs remain internal',async()=>{
  const api=fake({withSpecial:true})
  const d=await investigateNhl(date,'2026020201',api.fetcher,now,Promise.resolve([]),6)
  const c=compactNhlChatDossier(d)
  assert.equal(c.uiBlock.component,'sports_espn_dashboard')
  assert.equal(c.standings.home,d.standings.home)
  assert.equal(c.goalieCandidates.home[0].starterConfirmed,false)
  assert.equal(c.specialTeams.home.powerPlayPct,25.1)
  assert.ok(c.players.home.length<=12)
  assert.ok(c.uiBlock.props.sections.every(s=>s.items.length<=12))
  assert.ok(c.players.home.every(p=>!Object.hasOwn(p,'last20')))
  assert.ok(JSON.stringify(c).length*2<JSON.stringify(d).length)
})
