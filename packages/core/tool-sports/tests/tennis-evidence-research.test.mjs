import {test} from 'node:test'
import assert from 'node:assert/strict'
import {tennisSlate,investigateTennis} from '../src/tennis-evidence-research.ts'
import {settleTennisMarket} from '../src/tennis-market-settlement.ts'
const now=Date.parse('2026-11-02T12:00:00Z')
const date='2026-11-05'
function match(tour='atp'){
  return{id:tour==='atp'?'9011':'8011',date:'2026-11-05T15:00:00Z',
    status:{type:{state:'pre'}},round:'Quarterfinal',surface:{name:'Hard'},
    typeOfMatch:'singles',bestOf:3,competitors:[
      {athlete:{id:tour==='atp'?'1001':'3001',displayName:'Athlete Alpha'},
        rank:5,seed:2},
      {athlete:{id:tour==='atp'?'1002':'3002',displayName:'Athlete Beta'},
        rank:9,seed:5}]}
}
function tournament(tour='atp',missingClock=false){
  const m=match(tour)
  return{id:tour==='atp'?'9001':'8001',name:'Demo ATP/WTA Tournament',
    date:'2026-11-01T08:00:00Z',surface:{name:'Hard'},
    competitions:[missingClock?{...m,date:undefined}:m,{
      id:'9999',date:undefined,competitors:[
        {athlete:{id:'9001',displayName:'Other A'}},
        {athlete:{id:'9002',displayName:'Other B'}}]}]}
}
function past(id){
  const rival=id.endsWith('1')?id.slice(0,-1)+'2':id.slice(0,-1)+'1'
  return{events:[{id:'10000',date:'2026-10-28T14:00:00Z',
    status:{type:{state:'post'}},competitions:[{competitors:[
      {athlete:{id},winner:true},
      {athlete:{id:rival,displayName:'Previous Rival'},winner:false}]}]},
    {id:'10001',date:'2026-11-10T14:00:00Z',
      status:{type:{state:'post'}},competitions:[{competitors:[
        {athlete:{id},winner:true},{athlete:{id:rival}}]}]}]}
}
function fake({tour='atp',notStarted=false,missingProfile=false,clockMissing=false}={}){
  const calls=[]
  const fetcher=async input=>{
    const url=String(input),u=new URL(url);calls.push(url)
    if(!u.pathname.includes('/tennis/'+tour+'/'))
      throw Error('Wrong tour '+u.pathname)
    let result={}
    if(u.pathname.endsWith('/scoreboard'))
      result={events:[{...tournament(tour,clockMissing),
        ...(notStarted?{competitions:[
          {...match(tour),status:{type:{state:'in'}}}]}:{})}]}
    else if(u.pathname.includes('/athletes/')&&u.pathname.endsWith('/statistics'))
      result={statistics:{aces:7,firstServePercentage:0.67,
        doubleFaults:2,breakPointsSaved:4}}
    else if(u.pathname.includes('/athletes/')&&u.pathname.endsWith('/eventlog')){
      const athlete=u.pathname.match(/athletes\/(\d+)\//)?.[1]??''
      result=past(athlete)
    }else if(u.pathname.includes('/athletes/')){
      if(missingProfile)return new Response('missing',{status:404})
      const athlete=u.pathname.split('/').pop()
      result={athlete:{id:athlete,rank:7,displayName:'Athlete'}}
    }else throw Error('Unexpected tennis path '+u.pathname)
    return new Response(JSON.stringify(result),{status:200,
      headers:{'content-type':'application/json'}})
  }
  return{calls,fetcher}
}
test('ATP and WTA slates preserve match-level competition IDs, two players and real start',async()=>{
  for(const tour of ['atp','wta']){
    const mock=fake({tour})
    const r=await tennisSlate(tour,date,mock.fetcher,now,{})
    assert.equal(r.matches.length,1)
    const m=r.matches[0]
    assert.equal(m.tour,tour)
    assert.equal(m.matchId,tour==='atp'?'9011':'8011')
    assert.equal(m.start,match(tour).date)
    assert.equal(m.surface,'Hard')
    assert.equal(m.bestOf,3)
    assert.equal(m.players.length,2)
    assert.equal(m.players[0].ranking,5)
    assert.equal(r.missingMatchClocks,1)
    assert.ok(mock.calls.every(x=>x.includes('/tennis/'+tour+'/')))
  }
})
test('Tournament date never substitutes a missing match-level start time',async()=>{
  const r=await tennisSlate('atp',date,fake({clockMissing:true}).fetcher,now,{})
  assert.equal(r.matches.length,0)
  assert.equal(r.missingMatchClocks,2)
})
test('Tennis dossier retrieves serve/return facts, historical athlete log without future leak',async()=>{
  const api=fake()
  const q=(home,away,updatedAt,tour='atp')=>({
    bookmaker:'Real Book',market:'h2h',selection:'Athlete Alpha',
    home,away,time:match().date,timeIso:match().date,
    updatedAt,price:1.95,point:null,sportKey:'tennis_'+tour,eventId:'bookMatch'})
  const d=await investigateTennis('atp',date,'9011',api.fetcher,now,{},[
    q('Athlete Beta','Athlete Alpha','2026-11-02T11:59:00Z'),
    q('Athlete Beta','Other Person','2026-11-02T11:59:00Z'),
    q('Athlete Beta','Athlete Alpha','2026-10-01T11:59:00Z'),
    q('Athlete Beta','Athlete Alpha','2026-11-02T11:59:00Z','wta')])
  assert.equal(d.players.length,2)
  assert.equal(d.players[0].player.id,'1001')
  assert.equal(d.players[1].player.id,'1002')
  assert.equal(d.players[0].statistics.some(m=>m.name==='aces'),true)
  assert.equal(d.players[0].lastMatches.length,1)
  assert.equal(d.players[0].lastMatches[0].result,'W')
  assert.equal(d.markets.length,1)
  assert.equal(d.markets[0].eligibleForTicket,false)
  assert.equal(d.opportunity.calibratedProbability,false)
  assert.ok(d.missingEvidence.some(x=>x.includes('H2H')))
  assert.equal(d.uiBlock.component,'sports_espn_dashboard')
})
test('Unavailable profile and statistics do not become zero or imaginary ranking',async()=>{
  const api=fake({missingProfile:true})
  const d=await investigateTennis('atp',date,'9011',api.fetcher,now,{},[])
  assert.equal(d.players[0].profileAvailable,false)
  assert.ok(d.sources.some(s=>s.status==='error'))
  assert.equal(d.players[0].statistics.some(m=>m.name==='aces'),true)
  assert.equal(d.opportunity.eligibleForTicket,false)
})
test('Unknown tournament, bad match ID and started match cannot pass pregame',async()=>{
  await assert.rejects(()=>tennisSlate('atp','2026-02-30',fake().fetcher,now,{}),/Fecha/)
  await assert.rejects(()=>investigateTennis('atp',date,'12345',fake().fetcher,now),/cartelera/)
  await assert.rejects(()=>investigateTennis('atp',date,'9011',
    fake({notStarted:true}).fetcher,now),/prepartido/)
})
const result={playerAId:'1001',playerBId:'1002',
  sets:[{aGames:6,bGames:4,kind:'regular'},
    {aGames:7,bGames:6,kind:'regular'}],
  winnerId:'1001',status:'completed',official:true}
test('Tennis winner and game totals never confuse set wins, games and point score',()=>{
  assert.equal(settleTennisMarket(result,{kind:'match_winner',playerId:'1001',
    retirementRule:'unknown'}).status,'win')
  assert.equal(settleTennisMarket(result,{kind:'total_games',pick:'over',line:23,
    retirementRule:'unknown',matchTiebreakRule:'exclude'}).status,'push')
  assert.equal(settleTennisMarket(result,{kind:'total_games',pick:'under',line:23.5,
    retirementRule:'unknown',matchTiebreakRule:'exclude'}).status,'win')
  assert.equal(settleTennisMarket(result,{kind:'game_handicap',playerId:'1002',line:3,
    retirementRule:'unknown',matchTiebreakRule:'exclude'}).status,'push')
})
test('Tennis retirements, walkovers and super-tiebreak require explicit house rules',()=>{
  const total={kind:'total_games',pick:'over',line:22.5,
    retirementRule:'unknown',matchTiebreakRule:'pending'}
  assert.equal(settleTennisMarket({...result,status:'retired'},total).status,'pending')
  assert.equal(settleTennisMarket({...result,status:'walkover'},total).status,'pending')
  assert.equal(settleTennisMarket({...result,status:'retired'},
    {...total,retirementRule:'void'}).status,'void')
  assert.equal(settleTennisMarket({...result,sets:[
    ...result.sets,{aGames:10,bGames:8,kind:'match_tiebreak'}]},total).status,'pending')
})
test('Tennis quote and settlement identities never accept arbitrary athlete or invalid lines',()=>{
  assert.throws(()=>settleTennisMarket(result,{kind:'match_winner',playerId:'9999',
    retirementRule:'unknown'}),/Identidad/)
  assert.throws(()=>settleTennisMarket(result,{kind:'game_handicap',
    playerId:'1001',line:-2.25,retirementRule:'unknown',
    matchTiebreakRule:'exclude'}),/Línea/)
})
