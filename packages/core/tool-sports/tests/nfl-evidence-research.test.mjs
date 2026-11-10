import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nflSlate,investigateNfl} from '../src/nfl-evidence-research.ts'
import {settleNflScore,settleNflPlayerProp} from '../src/nfl-market-settlement.ts'

const now=Date.parse('2026-11-02T12:00:00Z'),date='2026-11-08'
const game={id:'401999001',date:'2026-11-08T18:00:00Z',
  status:{type:{state:'pre'}},season:{year:2026,type:2},
  competitions:[{venue:{fullName:'Example Stadium'},competitors:[
    {homeAway:'home',team:{id:'10',displayName:'Home Eagles'},records:[{summary:'6-2'}]},
    {homeAway:'away',team:{id:'20',displayName:'Away Ravens'},records:[{summary:'5-3'}]},
  ]}]}
function athletes(team){
  const positions=['QB','RB','WR','WR','TE','LT','LG','C','RG','RT','WR',
    'DE','DT','DL','LB','OLB','MLB','CB','CB','S','FS','SS']
  return positions.map((position,i)=>({id:String(Number(team)*1000+i+1),
    displayName:'Team '+team+' Athlete '+i,position:{abbreviation:position},
    jersey:String(i+1)}))
}
const history={events:[{id:'401998001',date:'2026-10-30T18:00:00Z',
  status:{type:{state:'post',completed:true}},season:{type:2},competitions:[{competitors:[
    {homeAway:'home',team:{id:'10',displayName:'Home Eagles'},score:'27'},
    {homeAway:'away',team:{id:'20',displayName:'Away Ravens'},score:'20'}]}]}]}
function mock({started=false,noRoster=false,offseason=false,officialEleven=true}={}){
  const calls=[]
  const fetcher=async input=>{
    const url=String(input),u=new URL(url);calls.push(url)
    if(u.hostname==='news.google.com')
      return new Response('<?xml version="1.0"?><rss><channel></channel></rss>',
        {status:200,headers:{'content-type':'application/xml'}})
    let payload={}
    if(u.pathname.endsWith('/scoreboard')){
      const dates=u.searchParams.get('dates')??''
      payload=dates==='20261108'?{events:offseason?[]:
        [started?{...game,status:{type:{state:'in'}}}:game]}:history
    }else if(u.pathname.endsWith('/summary')){
      const roster=team=>athletes(team).map((p,i)=>({
        athlete:{id:p.id},starter:officialEleven,
        unit:i<11?'offense':'defense'}))
      payload={rosters:[{team:{id:'10'},roster:roster('10')},
        {team:{id:'20'},roster:roster('20')}],
        header:{competitions:[{venue:{address:{latitude:40,longitude:-75}}}]},
        gameInfo:{officials:[{displayName:'NFL Crew A'}]}}
    }else if(u.pathname.endsWith('/roster')){
      const team=u.pathname.match(/\/teams\/(\d+)\//)?.[1]
      if(noRoster)return new Response('missing',{status:503})
      payload={athletes:athletes(team)}
    }else if(u.pathname.endsWith('/injuries')){
      payload={injuries:[{team:{id:'10'},injuries:[
        {athlete:{id:'10002'},status:'Questionable'},
        {athlete:{id:'999999'},status:'Wrong player'}]}]}
    }else if(u.pathname.endsWith('/news')){
      payload={articles:[{headline:'Home Eagles prepare for Away Ravens',
        published:'2026-11-02T10:00:00Z'}]}
    }else if(u.pathname.endsWith('/statistics')){
      payload={statistics:[{displayName:'Points Per Game',displayValue:'25.5'}]}
    }else if(u.hostname==='api.open-meteo.com'){
      payload={hourly:{time:['2026-11-08T18:00'],temperature_2m:[12],
        wind_speed_10m:[25],precipitation_probability:[35]}}
    }else if(u.pathname.includes('/athletes/')){
      payload={categories:[{statistics:[{displayName:'Passing Yards',displayValue:'200'}]}]}
    }else if(u.pathname.endsWith('/depthcharts'))payload={items:[]}
    else payload={}
    return new Response(JSON.stringify(payload),{status:200,
      headers:{'content-type':'application/json'}})
  }
  return{fetcher,calls}
}
test('NFL verified slate never creates games during source-confirmed offseason',async()=>{
  const normal=await nflSlate(date,mock().fetcher,now,{})
  assert.equal(normal.games.length,1)
  assert.equal(normal.games[0].eventId,'401999001')
  assert.equal(normal.games[0].home.name,'Home Eagles')
  const empty=await nflSlate(date,mock({offseason:true}).fetcher,now,{})
  assert.equal(empty.games.length,0)
  assert.equal(empty.noGamesReported,true)
})
test('NFL full rosters support 11 offense + 11 defense per team, stats bounded to budget',async()=>{
  const api=mock()
  const quote=(home,updatedAt)=>({bookmaker:'House NFL',eventId:'book1',
    home,away:'Away Ravens',sportKey:'americanfootball_nfl',
    time:game.date,timeIso:game.date,updatedAt,market:'totals',
    selection:'Over',point:44.5,price:1.92})
  const d=await investigateNfl(date,'401999001',api.fetcher,now,{},[
    quote('Home Eagles','2026-11-02T11:58:00Z'),
    quote('Wrong Eagles','2026-11-02T11:58:00Z'),
    quote('Home Eagles','2026-10-01T11:58:00Z'),
  ],5)
  assert.equal(d.teams.home.roster.length,22)
  assert.equal(d.teams.away.roster.length,22)
  assert.equal(d.teams.home.offenseConfirmed,11)
  assert.equal(d.teams.home.defenseConfirmed,11)
  assert.equal(d.teams.away.offenseConfirmed,11)
  assert.equal(d.teams.away.defenseConfirmed,11)
  assert.equal(d.coverage.confirmedOffense,22)
  assert.equal(d.coverage.confirmedDefense,22)
  assert.equal(d.teams.home.wins,1)
  assert.ok(api.calls.some(url=>url.includes('/scoreboard?dates=202610')),'monthly historical recovery')
  assert.ok(!api.calls.some(url=>/scoreboard\\?dates=\\d{8}-\\d{8}/u.test(url)),'no deprecated date range')
  assert.equal(d.teams.away.losses,1)
  assert.equal(d.injuries.length,1)
  assert.equal(d.injuries[0].playerId,'10002')
  assert.equal(d.weather.windKmh,25)
  assert.equal(d.markets.length,1)
  assert.equal(d.markets[0].eligibleForTicket,false)
  assert.equal(d.opportunity.calibratedProbability,false)
  assert.ok(d.matchups.some(x=>x.attacker.includes('Team 10')))
  assert.equal(d.uiBlock.component,'sports_espn_dashboard')
  assert.ok(api.calls.filter(s=>s.includes('/athletes/')).length<45)
})
test('NFL roster identity and starter status never inferred from positions or boxscore',async()=>{
  const d=await investigateNfl(date,'401999001',mock({officialEleven:false}).fetcher,now,{},[],4)
  assert.equal(d.teams.home.roster.length,22)
  assert.equal(d.teams.home.offenseConfirmed,0)
  assert.equal(d.teams.home.defenseConfirmed,0)
  assert.ok(d.missingEvidence.some(x=>x.includes('Once ofensivo')))
  assert.equal(d.opportunity.eligibleForTicket,false)
})
test('missing rosters trigger abstention and never fabricate injuries or starters',async()=>{
  const d=await investigateNfl(date,'401999001',mock({noRoster:true}).fetcher,now+601_000,{},[],3)
  assert.equal(d.teams.home.offenseConfirmed,0)
  assert.equal(d.teams.away.offenseConfirmed,0)
  assert.equal(d.injuries.length,0)
  assert.equal(d.opportunity.decision,'abstain')
  assert.ok(d.sources.some(x=>x.status==='error'))
})
test('invalid calendar, wrong event and started game reject pregame research',async()=>{
  await assert.rejects(()=>nflSlate('2026-02-30',mock().fetcher,now,{}),/Fecha/)
  await assert.rejects(()=>investigateNfl(date,'999',mock().fetcher,now),/cartelera/)
  await assert.rejects(()=>investigateNfl(date,'401999001',
    mock({started:true}).fetcher,now),/pregame/)
})
test('spread and totals enforce period, integer push and half line',()=>{
  assert.equal(settleNflScore({home:24,away:20,period:'including_ot',final:true},
    {kind:'total',pick:'over',line:44,period:'including_ot'}).status,'push')
  assert.equal(settleNflScore({home:24,away:20,period:'regulation',final:true},
    {kind:'spread',pick:'home',line:-4,period:'regulation'}).status,'push')
  assert.equal(settleNflScore({home:24,away:20,period:'regulation',final:true},
    {kind:'moneyline',pick:'home',period:'regulation'}).status,'win')
  assert.throws(()=>settleNflScore({home:24,away:20,period:'regulation',final:true},
    {kind:'moneyline',pick:'home',period:'including_ot'}),/Período/)
})
const box={eventId:'401999001',playerId:'10001',league:'nfl',
  period:'including_ot',participation:'played',final:true,
  stats:{passingYards:284,passingTouchdowns:2,rushingYards:17}}
const mk=(kind,line)=>({eventId:'401999001',playerId:'10001',league:'nfl',
  period:'including_ot',kind,pick:'over',line,dnpPolicy:'unknown'})
test('NFL QB passing yards and rushing props settle only by athlete boxscore',()=>{
  assert.equal(settleNflPlayerProp(box,mk('passingYards',279.5)).status,'win')
  assert.equal(settleNflPlayerProp(box,mk('rushingYards',17)).status,'push')
  assert.equal(settleNflPlayerProp(box,mk('receivingYards',10)).status,'pending')
})
test('DNP and cross-event / player props never become imaginary loss or zero',()=>{
  assert.equal(settleNflPlayerProp({...box,participation:'dnp'},mk('passingYards',200)).status,'pending')
  assert.equal(settleNflPlayerProp({...box,participation:'dnp'},
    {...mk('passingYards',200),dnpPolicy:'void'}).status,'void')
  assert.throws(()=>settleNflPlayerProp(box,{...mk('passingYards',200),playerId:'10002'}),/Identidad/)
})

test('NFL preseason results are excluded from the formal dossier',async()=>{
  const api=mock()
  const base=api.fetcher
  const fetcher=async url=>{
    const response=await base(url)
    const path=new URL(String(url))
    const key=path.searchParams.get('dates')??''
    if(path.pathname.endsWith('/scoreboard')&&key==='202610'){
      const payload=await response.json()
      return new Response(JSON.stringify({events:payload.events?.map(e=>({
        ...e,season:{type:1},
      }))??[]}),{status:200})
    }
    return response
  }
  const dossier=await investigateNfl(date,'401999001',fetcher,now,{},[],4)
  assert.equal(dossier.teams.home.recent.length,0)
  assert.ok(dossier.missingEvidence.some(x=>x.includes('temporada regular')))
})
