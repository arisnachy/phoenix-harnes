import {test} from 'node:test'
import assert from 'node:assert/strict'
import {soccerLeagueCatalog,soccerDailySlate,soccerFixture,soccerWorldPage} from '../src/soccer-worldwide-scout.ts'
import {investigateSoccer} from '../src/soccer-worldwide-dossier.ts'

const now=Date.parse('2026-11-02T15:00:00Z')
const date='2026-11-05'
const game=(league='usa.1')=>({
  id:league==='usa.1'?'770001':'880001',
  date:'2026-11-05T19:00:00Z',
  name:league==='usa.1'?'Inter Miami vs Orlando City':'Barcelona vs Sevilla',
  status:{type:{description:'Scheduled',state:'pre'}},
  competitions:[{id:'901',neutralSite:false,
    venue:{fullName:'Test Stadium',address:{latitude:25.7,longitude:-80.2}},
    competitors:[
      {homeAway:'home',team:{id:'101',displayName:league==='usa.1'?'Inter Miami':'Barcelona'},
        records:[{summary:'12-5-3'}]},
      {homeAway:'away',team:{id:'102',displayName:league==='usa.1'?'Orlando City':'Sevilla'},
        records:[{summary:'10-6-4'}]},
    ]}]
})
const players=(side)=>Array.from({length:11},(_,i)=>({
  id:String((side==='home'?1000:2000)+i),
  displayName:(side==='home'?'Home':'Away')+' Player '+(i+1),
  position:{abbreviation:i<2?'F':i===2?'G':i<6?'D':'M'},
  jersey:String(i+1),
}))
const statHistory={
  events:[{
    id:'old-10',date:'2026-10-29T19:00:00Z',
    status:{type:{state:'post',completed:true}},
    competitions:[{competitors:[
      {homeAway:'home',team:{id:'101',displayName:'Inter Miami'},score:'2'},
      {homeAway:'away',team:{id:'102',displayName:'Orlando City'},score:'1'},
    ]}],
  }]
}
function mock({noRosters=false,started=false,confirmed=true}={}){
  const calls=[]
  const fetcher=async(input)=>{
    const url=String(input),u=new URL(url)
    calls.push(url)
    if(u.hostname==='news.google.com')return new Response('not available',{status:503})
    let payload={}
    if(u.pathname==='/v2/sports/soccer/leagues'){
      payload={items:[{slug:'usa.1'},{slug:'esp.1'},{slug:'kor.1'}]}
    }else if(u.pathname.endsWith('/scoreboard')){
      const league=u.pathname.includes('/esp.1/')?'esp.1':'usa.1'
      const searched=u.searchParams.get('dates')??''
      payload=searched.includes('-')?statHistory:{events:[started?
        {...game(league),date:'2026-11-01T19:00:00Z'}:game(league)]}
    }else if(u.pathname.endsWith('/summary')){
      const home=players('home'),away=players('away')
      payload={
        header:{competitions:game().competitions},
        rosters:confirmed?[
          {team:{id:'101'},roster:home.map(a=>({athlete:{id:a.id},starter:true}))},
          {team:{id:'102'},roster:away.map(a=>({athlete:{id:a.id},starter:true}))},
        ]:[],
        gameInfo:{officials:[{displayName:'Test Referee'}]},
        boxscore:{teams:[{team:{id:'101'},statistics:[{displayName:'Shots',displayValue:'14'}]},
          {team:{id:'102'},statistics:[{displayName:'Shots',displayValue:'6'}]}]},
      }
    }else if(u.pathname.endsWith('/roster')){
      if(noRosters)return new Response('none',{status:503})
      payload={athletes:players(u.pathname.includes('/101/')?'home':'away')}
    }else if(u.pathname.endsWith('/injuries')){
      payload={injuries:[{team:{id:'101'},injuries:[{athlete:{id:'1001'},status:'Questionable'},
        {athlete:{id:'666666'},status:'Invalid other team'}]}]}
    }else if(u.pathname.endsWith('/news')){
      payload={articles:[{headline:'Inter Miami prepare for Orlando City',published:'2026-11-02T12:00:00Z'}]}
    }else if(u.hostname==='api.open-meteo.com'){
      payload={hourly:{time:['2026-11-05T19:00'],temperature_2m:[27],wind_speed_10m:[12],
        precipitation_probability:[22]}}
    }else throw new Error('Unmocked URL: '+url)
    return new Response(JSON.stringify(payload),{status:200,
      headers:{'content-type':'application/json'}})
  }
  return{fetcher,calls}
}
test('worldwide ESPN catalog lists verified slugs, without false global completeness',async()=>{
  const api=mock()
  const res=await soccerLeagueCatalog(api.fetcher,now,{})
  assert.ok(res.leagues.includes('usa.1'))
  assert.ok(res.leagues.includes('kor.1'))
  assert.equal(res.worldwideComplete,false)
  assert.equal(res.source,'ESPN Core leagues catalog')
})
test('date-scoped schedule handles multiple competitions without mixed event IDs',async()=>{
  const api=mock()
  const slate=await soccerDailySlate(date,['usa.1','esp.1'],api.fetcher,now,{})
  assert.equal(slate.games.length,2)
  assert.equal(slate.leagues.length,2)
  assert.deepEqual(slate.games.map(x=>x.league),['esp.1','usa.1'])
  assert.equal(slate.games[0].home.id,'101')
  assert.equal(slate.worldwideComplete,false)
  assert.equal(slate.sources.filter(s=>s.status==='observed').length,2)
})
test('invalid league/date/event identifiers fail without requesting arbitrary hosts',async()=>{
  const api=mock()
  await assert.rejects(()=>soccerDailySlate('2026-02-30',['usa.1'],api.fetcher,now),/Fecha/)
  await assert.rejects(()=>soccerDailySlate(date,['../admin'],api.fetcher,now),/ligas válidas/)
  assert.equal(soccerFixture({id:'abc'},'usa.1'),null)
  await assert.rejects(()=>investigateSoccer(date,'usa.1','0000000',api.fetcher,now),/no aparece/)
})
test('source-provenance dossier only joins current roster, eleven starters, injuries and odds',async()=>{
  const api=mock()
  const quote=(home,updatedAt)=>({eventId:'provider-1',bookmaker:'House X',
    market:'totals',selection:'Over',point:2.5,price:1.86,
    home,away:'Orlando City',time:game().date,timeIso:game().date,updatedAt,
    sportKey:'soccer_usa_mls',source:'Test provider'})
  const r=await investigateSoccer(date,'usa.1','770001',api.fetcher,now,{},[
    quote('Inter Miami','2026-11-02T14:55:00Z'),
    quote('Wrong Miami','2026-11-02T14:55:00Z'),
    quote('Inter Miami','2026-10-25T14:55:00Z'),
  ])
  assert.equal(r.teams.home.roster.length,11)
  assert.equal(r.teams.away.roster.length,11)
  assert.equal(r.lineupConfirmed.home,true)
  assert.equal(r.lineupConfirmed.away,true)
  assert.equal(r.teams.home.form.wins,1)
  assert.equal(r.teams.away.form.losses,1)
  assert.ok(r.duels.length>=4)
  assert.ok(r.duels.every(d=>d.againstTeam==='Orlando City'?
    Number(d.playerId)<2000:Number(d.playerId)>=2000))
  assert.equal(r.injuries.length,1)
  assert.equal(r.injuries[0].playerId,'1001')
  assert.equal(r.markets.length,1)
  assert.equal(r.markets[0].approved,false)
  assert.ok(r.markets[0].questions.some(q=>q.includes('línea')))
  assert.equal(r.coverage.level,'B') // No verified xG metric in this fixture
  assert.equal(r.referee,'Test Referee')
  assert.equal(r.weather.windKmh,12)
  assert.equal(r.opportunity.eligibleForTicket,false)
  assert.equal(r.opportunity.probabilitiesEstimated,false)
  assert.equal(r.uiBlock.component,'sports_espn_dashboard')
})
test('missing rosters and lineups are NEVER confirmed or eligible for betting',async()=>{
  const api=mock({noRosters:true})
  const r=await investigateSoccer(date,'usa.1','770001',api.fetcher,now)
  assert.equal(r.teams.home.roster.length,0)
  assert.equal(r.lineupConfirmed.home,false)
  assert.equal(r.coverage.level,'C')
  assert.equal(r.opportunity.recommendation,'abstain')
  assert.equal(r.injuries.length,0)
})
test('an already-started game cannot be researched as pregame',async()=>{
  const api=mock({started:true})
  await assert.rejects(()=>investigateSoccer(date,'usa.1','770001',api.fetcher,now),/futuro/)
})
test('roster presence does not imply an official starting XI',async()=>{
  const api=mock({confirmed:false})
  const r=await investigateSoccer(date,'usa.1','770001',api.fetcher,now)
  assert.equal(r.lineupConfirmed.home,false)
  assert.equal(r.teams.home.roster.filter(x=>x.confirmedStarter).length,0)
  assert.ok(r.missingEvidence.includes('Once local no confirmado'))
})

test('global daily scanner paginates discovered soccer competitions without claiming exhaustiveness',async()=>{
  const api=mock()
  const first=await soccerWorldPage(date,0,2,api.fetcher,now,{})
  assert.equal(first.scannedCount,2)
  assert.equal(first.games.length,2)
  assert.equal(first.nextOffset,2)
  assert.equal(first.worldwideComplete,false)
  const second=await soccerWorldPage(date,2,2,api.fetcher,now,{})
  assert.equal(second.offset,2)
  assert.ok(second.games.every(g=>g.eventId&&g.league))
  await assert.rejects(()=>soccerWorldPage(date,-1,24,api.fetcher,now),/Offset/)
  await assert.rejects(()=>soccerWorldPage(date,0,25,api.fetcher,now),/Límite/)
})
