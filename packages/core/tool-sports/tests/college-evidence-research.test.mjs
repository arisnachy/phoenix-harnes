import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collegeSlate,collegeInvestigate,collegeSpec} from '../src/college-evidence-research.ts'

const date='2026-11-06',now=Date.parse('2026-11-02T12:00:00Z')
const identity=league=>league==='college-football'?{
  eventId:'401999100',sport:'football',home:'College Eagles',away:'College Tigers'}:{
  eventId:'401999200',sport:'basketball',home:'Campus Hawks',away:'Campus Bears'}
const athletes=(team,league)=>{
  const positions=league==='college-football'?[
    'QB','RB','WR','WR','TE','LT','LG','C','RG','RT','WR',
    'DE','DT','DL','LB','LB','OLB','CB','CB','S','FS','SS']:
    ['PG','SG','SF','PF','C','G','F']
  return positions.map((p,i)=>({id:String(Number(team)*1000+i+1),
    displayName:'Player '+team+'-'+i,position:{abbreviation:p}}))
}
function mock(league,{started=false,noRoster=false,noStarters=false}={}){
  const meta=identity(league),n=league==='college-football'?22:5
  const event={id:meta.eventId,date:'2026-11-06T19:00:00Z',
    status:{type:{state:started?'in':'pre'}},
    competitions:[{venue:{fullName:'Campus Stadium'},competitors:[
      {homeAway:'home',team:{id:'10',displayName:meta.home}},
      {homeAway:'away',team:{id:'20',displayName:meta.away}},
    ]}]}
  const fetcher=async input=>{
    const url=String(input),p=new URL(url)
    if(!p.pathname.includes('/'+meta.sport+'/'+league+'/'))
      throw Error('Wrong NCAA league '+url)
    let body={}
    if(p.pathname.endsWith('/scoreboard'))
      body={events:[event]}
    else if(p.pathname.endsWith('/summary'))
      body={rosters:['10','20'].map(team=>({team:{id:team},roster:
        athletes(team,league).slice(0,n).map((a,i)=>({
          athlete:{id:a.id},starter:!noStarters,
          unit:league==='college-football'?(i<11?'offense':'defense'):undefined
        }))}))}
    else if(p.pathname.endsWith('/roster')){
      if(noRoster)return new Response('missing',{status:404})
      const team=p.pathname.match(/\/teams\/(\d+)\//)?.[1]
      body={athletes:athletes(team,league)}
    }else if(p.pathname.endsWith('/statistics'))
      body={statistics:[{displayName:'Efficiency',displayValue:'101.5'}]}
    else if(p.pathname.endsWith('/injuries'))
      body={injuries:[{team:{id:'10'},injuries:[
        {athlete:{id:'10001'},status:'Questionable'},
        {athlete:{id:'9999'},status:'Ineligible'}]}]}
    else if(p.pathname.includes('/athletes/')||p.pathname.endsWith('/depthcharts'))
      body={statistics:[]}
    else throw Error('Unrecognized NCAA url '+url)
    return new Response(JSON.stringify(body),{status:200,
      headers:{'content-type':'application/json'}})
  }
  return fetcher
}
test('NCAA Football and NCAA Basketball are different rulesets and schedules',async()=>{
  for(const league of ['college-football','mens-college-basketball']){
    const spec=collegeSpec(league)
    assert.equal(spec.minutes,league==='college-football'?60:40)
    assert.ok(spec.format.includes(league==='college-football'?'15':'20'))
    const r=await collegeSlate(league,date,mock(league),now,{})
    assert.equal(r.games.length,1)
    assert.equal(r.games[0].eventId,identity(league).eventId)
  }
})
test('College football confirms 11 offense and 11 defense per TEAM only by explicit source',async()=>{
  const league='college-football'
  const quotes=(home,updatedAt)=>({eventId:'book101',bookmaker:'College Book',
    market:'totals',selection:'Over',point:51.5,price:1.92,
    time:'2026-11-06T19:00:00Z',timeIso:'2026-11-06T19:00:00Z',
    home,away:'College Tigers',sportKey:'americanfootball_ncaaf',updatedAt})
  const d=await collegeInvestigate(league,date,'401999100',mock(league),now,{},[
    quotes('College Eagles','2026-11-02T11:59:00Z'),
    quotes('Wrong College','2026-11-02T11:59:00Z'),
    quotes('College Eagles','2026-10-10T11:59:00Z')])
  assert.equal(d.teams.home.players.length,22)
  assert.equal(d.teams.away.players.length,22)
  assert.equal(d.teams.home.verifiedStarters,22)
  assert.equal(d.teams.away.verifiedStarters,22)
  assert.equal(d.injuries.length,1)
  assert.equal(d.injuries[0].playerId,'10001')
  assert.equal(d.markets.length,1)
  assert.equal(d.markets[0].eligibleForTicket,false)
  assert.equal(d.opportunity.calibratedProbability,false)
  assert.equal(d.uiBlock.component,'sports_espn_dashboard')
})
test('College men's basketball confirms exactly five, not NBA starters or 48 min',async()=>{
  const league='mens-college-basketball'
  const d=await collegeInvestigate(league,date,'401999200',mock(league),now,{},[])
  assert.equal(d.teams.home.players.length,7)
  assert.equal(d.teams.home.verifiedStarters,5)
  assert.equal(d.teams.away.verifiedStarters,5)
  assert.equal(d.opportunity.eligibleForTicket,false)
})
test('Depthchart or roster without explicit starter flags NEVER confirms starter',async()=>{
  const league='college-football'
  const d=await collegeInvestigate(league,date,'401999100',
    mock(league,{noStarters:true}),now,{},[])
  assert.equal(d.teams.home.verifiedStarters,0)
  assert.ok(d.missingEvidence.some(v=>v.includes('Titulares')))
})
test('Missing roster must fail closed even when generic stats adapter returns data',async()=>{
  const league='college-football'
  const d=await collegeInvestigate(league,date,'401999100',
    mock(league,{noRoster:true}),now+700_000,{},[])
  assert.equal(d.teams.home.players.length,0)
  assert.equal(d.opportunity.decision,'abstain')
})
test('Pregame excludes already started and foreign event ID, rejects impossible dates',async()=>{
  await assert.rejects(()=>collegeSlate('college-football','2026-02-30',
    mock('college-football'),now,{}),/Fecha/)
  await assert.rejects(()=>collegeInvestigate('college-football',date,'401999200',
    mock('college-football'),now,{}),/cartelera/)
  await assert.rejects(()=>collegeInvestigate('college-football',date,'401999100',
    mock('college-football',{started:true}),now,{}),/pregame/)
})
