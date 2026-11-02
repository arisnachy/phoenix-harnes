import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverMlbDay,researchMlbCase,mlbResearch} from '../src/mlb-evidence-research.ts'
import {reviewMlbResearch} from '../src/mlb-market-research-review.ts'

const at=Date.parse('2026-07-01T12:00:00Z')
const date='2026-07-02'
const fixture={gamePk:812345,gameDate:'2026-07-02T22:00:00Z',
  status:{abstractGameState:'Preview'},venue:{id:205,name:'Test Ballpark'},
  teams:{home:{team:{id:101,name:'Home Giants'},probablePitcher:{id:1101,fullName:'Home Ace'}},
    away:{team:{id:102,name:'Away Bears'},probablePitcher:{id:2201,fullName:'Away Ace'}}}}
const roster=(side,fullLineup=false)=>({roster:[
  {person:{id:side==='home'?1101:2201,fullName:side==='home'?'Home Ace':'Away Ace'},position:{type:'Pitcher',abbreviation:'P'}},
  {person:{id:side==='home'?1102:2202,fullName:side==='home'?'Home Reliever':'Away Reliever'},position:{type:'Pitcher',abbreviation:'P'}},
  {person:{id:side==='home'?1103:2203,fullName:side==='home'?'Home Star':'Away Star'},position:{type:'Outfielder',abbreviation:'OF'}},
  {person:{id:side==='home'?1104:2204,fullName:side==='home'?'Home Backup':'Away Backup'},position:{type:'Infielder',abbreviation:'IF'}},
  ...(fullLineup?Array.from({length:7},(_,i)=>({person:{id:(side==='home'?1301:2301)+i,
    fullName:(side==='home'?'Home':'Away')+' Batter '+(i+3)},
    position:{type:'Infielder',abbreviation:'IF'}})):[]),
]})
function fakeNetwork({missingRoster=false,oldGame=false,fullLineup=false}={}){
  const calls=[]
  const fetcher=async(input)=>{
    const url=String(input)
    calls.push(url)
    const u=new URL(url)
    let data={}
    if(u.pathname.endsWith('/schedule')&&u.searchParams.has('date')){
      data={dates:[{games:[oldGame?{...fixture,gameDate:'2026-06-30T22:00:00Z'}:fixture]}]}
    }else if(u.pathname.endsWith('/schedule')){
      const teamId=Number(u.searchParams.get('teamId'))
      data={dates:[{games:[{gamePk:709999,gameDate:'2026-06-29T22:00:00Z',
        status:{abstractGameState:'Final'},teams:{
          home:{team:{id:teamId},score:6},
          away:{team:{id:teamId===101?200:201},score:2}}}]}]}
    }else if(u.pathname.endsWith('/boxscore')){
      data={teams:{home:{battingOrder:fullLineup?[1103,1104,...Array.from({length:7},(_,i)=>1301+i)]:[]},
        away:{battingOrder:fullLineup?[2203,2204,...Array.from({length:7},(_,i)=>2301+i)]:[]}}}
    }else if(u.pathname.endsWith('/venues')){
      data={venues:[{name:'Test Ballpark',location:{defaultCoordinates:{latitude:40.1,longitude:-74.2}}}]}
    }else if(u.pathname.includes('/roster')){
      if(u.searchParams.get('rosterType')==='injured'){data={roster:[]}}
      else if(missingRoster)return new Response('unavailable',{status:503})
      else data=roster(u.pathname.includes('/101/')?'home':'away',fullLineup)
    }else if(u.pathname==='/api/v1/people'){
      data={people:[...u.searchParams.get('personIds').split(',')].map(k=>({
        id:Number(k),batSide:{code:'R'},pitchHand:{code:'L'}}))}
    }else if(u.pathname.includes('/people/')&&u.pathname.endsWith('/stats')){
      const pitching=u.searchParams.get('group')==='pitching'
      data={stats:[{splits:[{stat:pitching?{
        era:'3.20',whip:'1.08',strikeOuts:130,gamesStarted:10,wins:6,losses:2
      }:{avg:'.301',ops:'.902',hits:80,homeRuns:14,strikeOuts:35}}]}]}
    }else if(u.hostname==='api.open-meteo.com'){
      data={hourly:{time:['2026-07-02T22:00'],temperature_2m:[29],
        wind_speed_10m:[17],wind_direction_10m:[180],
        relative_humidity_2m:[65],precipitation_probability:[20]}}
    }else if(u.pathname.endsWith('/standings')){
      data={records:[{teamRecords:[{team:{id:101},wins:45,losses:40},
        {team:{id:102},wins:40,losses:45}]}]}
    }else if(u.pathname.endsWith('/news')){
      data={articles:[{headline:'Home Giants prepare to face Away Bears',
        published:'2026-07-01T10:00:00Z'}]}
    }else throw new Error('Unexpected request '+url)
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
  }
  return{fetcher,calls}
}
test('official MLB slate provides verified gamePk, team IDs, stadium, no invented odds',async()=>{
  const mock=fakeNetwork()
  const r=await discoverMlbDay(date,mock.fetcher,at)
  assert.equal(r.fixtures.length,1)
  assert.equal(r.fixtures[0].gamePk,812345)
  assert.equal(r.fixtures[0].home.id,101)
  assert.equal(r.fixtures[0].away.id,102)
  assert.equal(r.fixtures[0].venue.name,'Test Ballpark')
  const board=await mlbResearch(date,undefined,mock.fetcher,at)
  assert.equal(board.mode,'schedule')
})
test('dossier uses current roster IDs and crosses every known batter only with opposing pitchers',async()=>{
  const mock=fakeNetwork()
  const r=await researchMlbCase(date,812345,mock.fetcher,at,{},[])
  assert.equal(r.rosters.home.length,4)
  assert.equal(r.rosters.away.length,4)
  assert.equal(r.starters.home.id,1101)
  assert.equal(r.starters.away.id,2201)
  assert.equal(r.bullpen.home.length,1)
  assert.equal(r.matchups.length,8)
  const x=r.matchups.find(row=>row.batterId===1103&&row.pitcherId===2201)
  assert.ok(x)
  assert.equal(x.pitcherRole,'probable-starter')
  assert.equal(x.batterSide,'R')
  assert.equal(x.pitcherHand,'L')
  assert.ok(!r.matchups.some(m=>m.batterId===1103&&m.pitcherId===1101))
  assert.equal(r.lineupStatus.home,'unconfirmed')
  assert.ok(r.missingEvidence.some(x=>x.includes('alineación')||x.includes('Alineación')))
  assert.equal(r.opportunity.state,'investigate')
  assert.equal(r.opportunity.priced,false)
  assert.equal(r.news.length,1)
  assert.equal(r.injuries.length,0)
  assert.equal(r.weather?.windSpeedKmh,17)
  assert.equal(r.weather?.windRelativeToField,'unknown')
  assert.equal(r.uiBlock.component,'sports_espn_dashboard')
})
test('a quote must match both clubs, date, and update within one hour',async()=>{
  const mock=fakeNetwork()
  const quote=(home,updatedAt)=>({
    eventId:'book-4',bookmaker:'Test Sportsbook',market:'totals',selection:'Over',
    point:8,price:1.9,home,away:'Away Bears',time:'not-a-time',
    timeIso:fixture.gameDate,updatedAt,source:'Actual market',sportKey:'baseball_mlb',
  })
  const r=await researchMlbCase(date,812345,mock.fetcher,at,{},[
    quote('Home Giants','2026-07-01T11:55:00Z'),
    quote('Other Giants','2026-07-01T11:55:00Z'),
    quote('Home Giants','2026-06-01T11:55:00Z'),
  ])
  assert.equal(r.odds.length,1)
  assert.equal(r.opportunity.marketResearchReady,true)
  assert.equal(r.opportunity.state,'investigate')
})
test('missing roster or invalid game cannot produce invented athletes or selections',async()=>{
  const mock=fakeNetwork({missingRoster:true})
  const r=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(r.rosters.home.filter(x=>x.role==='batter').length,0)
  assert.ok(r.missingEvidence.some(x=>x.includes('Rosters')))
  assert.equal(r.opportunity.marketResearchReady,false)
  assert.equal(r.opportunity.state,'abstain')
  await assert.rejects(()=>researchMlbCase(date,899999,mock.fetcher,at),/no aparece/)
  await assert.rejects(()=>discoverMlbDay('2026-02-30',mock.fetcher,at),/Fecha/)
})
test('started games are excluded from pregame investigation',async()=>{
  const mock=fakeNetwork({oldGame:true})
  await assert.rejects(()=>researchMlbCase(date,812345,mock.fetcher,at),/futuro/)
})

test('research review explains totals integer-line pushes and blocks ticket without proof',async()=>{
  const mock=fakeNetwork()
  const q={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,
    home:'Home Giants',away:'Away Bears',time:fixture.gameDate,
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[q])
  const review=reviewMlbResearch(d)
  assert.equal(review.eligibility,'insufficient') // only two hitters per team in fixture
  assert.equal(review.probabilitiesEstimated,false)
  assert.equal(review.eligibleForTicket,false)
  assert.equal(review.reviewedMarkets.length,1)
  assert.ok(review.reviewedMarkets[0].researchQuestions.some(t=>t.includes('exactamente 8')))
  assert.ok(review.reviewedMarkets[0].contradictoryEvidence.some(t=>t.includes('reglas')))
  assert.equal(review.evidenceGates.lineupsConfirmed,false)
  assert.equal(review.evidenceGates.bothRostersVerified,false)
})

test('nine verified batters per team cross every opposing starter and available bullpen pitcher',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const r=await researchMlbCase(date,812345,mock.fetcher,at,{},[])
  assert.equal(r.lineupStatus.home,'confirmed')
  assert.equal(r.lineupStatus.away,'confirmed')
  const hb=r.rosters.home.filter(x=>x.lineupConfirmed)
  const ab=r.rosters.away.filter(x=>x.lineupConfirmed)
  assert.equal(hb.length,9)
  assert.equal(ab.length,9)
  assert.equal(r.matchups.length,36)
  assert.equal(new Set(r.matchups.map(x=>x.batterId+':'+x.pitcherId)).size,36)
  assert.ok(r.matchups.every(x=>x.pitcherId<2000 ? x.batterId>2000 : x.batterId<2000))
  const report=reviewMlbResearch(r)
  assert.equal(report.evidenceGates.bothRostersVerified,true)
  assert.equal(report.evidenceGates.lineupsConfirmed,true)
  assert.equal(report.eligibility,'research-only')
  assert.equal(report.eligibleForTicket,false)
})
