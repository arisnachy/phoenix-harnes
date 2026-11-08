import {test} from 'node:test'
import assert from 'node:assert/strict'
import {basketballSlate,regulationMinutes,settleBasketballScore} from '../src/basketball-research-core.ts'
import {researchBasketballCase} from '../src/basketball-evidence-dossier.ts'

const date='2026-11-05',now=Date.parse('2026-11-02T12:00:00Z')
const game=(league='nba')=>({
  id:league==='nba'?'700100':'700200',date:'2026-11-05T22:00:00Z',
  status:{type:{state:'pre',description:'Scheduled'}},
  competitions:[{venue:{fullName:'Test Arena'},competitors:[
    {homeAway:'home',team:{id:league==='nba'?'10':'30',
      displayName:league==='nba'?'Home NBA':'Home WNBA'},records:[{summary:'10-5'}]},
    {homeAway:'away',team:{id:league==='nba'?'20':'40',
      displayName:league==='nba'?'Away NBA':'Away WNBA'},records:[{summary:'8-7'}]},
  ]}]
})
const squad=(tid)=>Array.from({length:5},(_,i)=>({
  id:String(Number(tid)*100+i+1),displayName:'Player '+tid+'-'+i,
  position:{abbreviation:['PG','SG','SF','PF','C'][i]},jersey:String(i+1)}))
const history=(league)=>({events:[{
  id:'600100',date:'2026-10-29T22:00:00Z',
  status:{type:{state:'post',completed:true}},competitions:[{competitors:[
    {homeAway:'home',team:{id:league==='nba'?'10':'30',displayName:'Prior Home'},score:'110'},
    {homeAway:'away',team:{id:league==='nba'?'20':'40',displayName:'Prior Away'},score:'102'},
  ]}]
}]})
function mock({league='nba',offseason=false,noRoster=false,started=false,noLineup=false}={}){
  const calls=[],home=league==='nba'?'10':'30',away=league==='nba'?'20':'40'
  const fetcher=async input=>{
    const url=String(input),u=new URL(url);calls.push(url)
    if(u.hostname==='news.google.com')
      return new Response('<?xml version="1.0"?><rss><channel></channel></rss>',
        {status:200,headers:{'content-type':'text/xml'}})
    let data={}
    if(u.pathname.endsWith('/scoreboard')){
      const days=u.searchParams.get('dates')??''
      data=days==='202610'?history(league):{events:days.length===6?[]:offseason?[]:[started?
        {...game(league),status:{type:{state:'in'}}}:game(league)]}
    }else if(u.pathname.endsWith('/summary')){
      data={rosters:noLineup?[]:[home,away].map(tid=>({team:{id:tid},
        roster:squad(tid).map(p=>({athlete:{id:p.id},starter:true}))})),
        gameInfo:{officials:[{displayName:'Official Referee'}]}}
    }else if(u.pathname.endsWith('/injuries')){
      data={injuries:[{team:{id:home},injuries:[
        {athlete:{id:squad(home)[1].id},status:'Questionable'},
        {athlete:{id:'999999'},status:'Out; unverified roster'}]}]}
    }else if(u.pathname.endsWith('/news')){
      data={articles:[{headline:(league==='nba'?'Home NBA':'Home WNBA')+
        ' prepare for next matchup',published:'2026-11-02T10:00:00Z'}]}
    }else if(u.pathname.endsWith('/roster')){
      const tid=u.pathname.match(/\/teams\/(\d+)\//)?.[1]
      if(noRoster)return new Response('missing',{status:503})
      data={athletes:squad(tid)}
    }else if(u.pathname.endsWith('/statistics')){
      data={statistics:[{displayName:'Offensive Rating',displayValue:'110.2'},
        {displayName:'Defensive Rating',displayValue:'106.3'},
        {displayName:'Pace',displayValue:'98.1'}]}
    }else if(u.pathname.endsWith('/depthcharts')){
      data={items:[]}
    }else if(u.pathname.includes('/athletes/')&&u.pathname.endsWith('/stats')){
      data={categories:[{statistics:[{displayName:'Points Per Game',displayValue:'18.4'},
        {displayName:'Rebounds Per Game',displayValue:'6.1'}]}]}
    }else if(u.pathname.includes('/athletes/')&&u.pathname.endsWith('/gamelog')){
      data={categories:[{statistics:[{displayName:'Last 5',displayValue:'Recent games'}]}]}
    }else if(u.pathname.includes('/athletes/')&&u.pathname.endsWith('/splits')){
      data={statistics:[{displayName:'Home',displayValue:'16.5'}]}
    }else throw new Error('unexpected URL '+url)
    return new Response(JSON.stringify(data),{status:200,
      headers:{'content-type':'application/json'}})
  }
  return{fetcher,calls}
}
test('NBA and WNBA have independent schedules, 48 vs 40 regulation and verified IDs',async()=>{
  for(const league of ['nba','wnba']){
    const network=mock({league}),r=await basketballSlate(league,date,network.fetcher,now,{})
    assert.equal(r.games.length,1)
    assert.equal(r.games[0].eventId,league==='nba'?'700100':'700200')
    assert.equal(regulationMinutes(league),league==='nba'?48:40)
    assert.ok(network.calls.every(s=>!s.includes('/basketball/'+(league==='nba'?'wnba':'nba')+'/')))
  }
})
test('WNBA offseason without a published game never reuses NBA fixtures',async()=>{
  const network=mock({league:'wnba',offseason:true})
  const r=await basketballSlate('wnba',date,network.fetcher,now,{})
  assert.equal(r.games.length,0)
  assert.equal(r.offseason,true)
})
test('research case verifies 5-on-5 IDs, injury identity and same-book timestamped prices',async()=>{
  const network=mock({league:'nba'})
  const quote=(home,updatedAt)=>({eventId:'book-123',bookmaker:'Book One',
    market:'totals',selection:'Over',point:220.5,price:1.9,
    home,away:'Away NBA',time:game('nba').date,timeIso:game('nba').date,
    updatedAt,source:'verified provider',sportKey:'basketball_nba'})
  const casefile=await researchBasketballCase('nba',date,'700100',network.fetcher,now,{},[
    quote('Home NBA','2026-11-02T11:58:00Z'),
    quote('Wrong Home','2026-11-02T11:58:00Z'),
    quote('Home NBA','2026-10-02T11:58:00Z'),
  ],5)
  assert.equal(casefile.regulationMinutes,48)
  assert.equal(casefile.teams.home.roster.length,5)
  assert.equal(casefile.teams.away.roster.length,5)
  assert.equal(casefile.teams.home.quintetConfirmed,true)
  assert.equal(casefile.teams.away.quintetConfirmed,true)
  assert.equal(casefile.matchups.length,10)
  assert.ok(casefile.matchups.every(x=>x.teamId==='10'?x.opponents.every(y=>Number(y.id)>=2000):
    x.opponents.every(y=>Number(y.id)<2000)))
  assert.equal(casefile.injuries.length,1)
  assert.equal(casefile.injuries[0].playerId,'1002')
  assert.equal(casefile.markets.length,1)
  assert.equal(casefile.markets[0].status,'research-only')
  assert.equal(casefile.opportunity.eligibleForTicket,false)
  assert.equal(casefile.opportunity.probabilitiesCalculated,false)
  assert.equal(casefile.referee,'Official Referee')
  assert.equal(casefile.uiBlock.component,'sports_espn_dashboard')
})
test('WNBA investigation enforces 40-minute rules, roster and injury identity independently',async()=>{
  const network=mock({league:'wnba'})
  const d=await researchBasketballCase('wnba',date,'700200',network.fetcher,now,{},[],5)
  assert.equal(d.regulationMinutes,40)
  assert.equal(d.fixture.league,'wnba')
  assert.equal(d.teams.home.quintetConfirmed,true)
  assert.equal(d.injuries[0].playerId,'3002')
  assert.equal(d.markets.length,0)
  assert.equal(d.opportunity.eligibleForTicket,false)
})
test('roster and lineups absent cannot become verified starters or approved picks',async()=>{
  const network=mock({league:'nba',noRoster:true})
  const later=Date.parse('2026-11-03T12:00:00Z')
  const d=await researchBasketballCase('nba',date,'700100',network.fetcher,later,{},[],5)
  assert.equal(d.teams.home.roster.length,0)
  assert.equal(d.teams.home.quintetConfirmed,false)
  assert.equal(d.matchups.length,0)
  assert.equal(d.coverage.level,'C')
  assert.equal(d.opportunity.decision,'abstain')
})
test('official starting XI equivalent needs exactly five flagged verified athletes',async()=>{
  const network=mock({league:'wnba',noLineup:true})
  const later=Date.parse('2026-11-03T13:00:00Z')
  const d=await researchBasketballCase('wnba',date,'700200',network.fetcher,later,{},[],5)
  assert.equal(d.teams.away.quintetConfirmed,false)
  assert.equal(d.matchups.length,0)
  assert.ok(d.missingEvidence.some(s=>s.includes('Quinteto titular')))
})
test('pregame safety rejects started events, invalid dates and cross-league event IDs',async()=>{
  await assert.rejects(()=>basketballSlate('nba','2026-02-30',mock().fetcher,now,{}),/Fecha/)
  await assert.rejects(()=>researchBasketballCase('nba',date,'700200',
    mock().fetcher,now,{}),/no identificado/)
  await assert.rejects(()=>researchBasketballCase('wnba',date,'700200',
    mock({league:'wnba',started:true}).fetcher,now,{}),/prepartido/)
})
test('regulation vs including OT, integer pushes and half lines stay distinct',()=>{
  assert.equal(settleBasketballScore(110,110,{kind:'total',pick:'over',line:220},'regulation').status,'push')
  assert.equal(settleBasketballScore(111,110,{kind:'total',pick:'over',line:220.5},'including_ot').status,'win')
  assert.equal(settleBasketballScore(110,109,{kind:'spread',team:'home',line:-1},'regulation').status,'push')
  assert.equal(settleBasketballScore(110,109,{kind:'spread',team:'away',line:1.5},'including_ot').status,'win')
  assert.throws(()=>settleBasketballScore(110,109,{kind:'total',pick:'over',line:220.25},'regulation'),/Línea/)
})
