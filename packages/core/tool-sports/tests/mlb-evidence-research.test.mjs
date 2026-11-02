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
function fakeNetwork({missingRoster=false,oldGame=false,fullLineup=false,
  unrelatedGame=false,unknownLineupId=false,pitcherLogs=false,bvpHydration=false,
  futureGameResult=false,futurePitcherLog=false,wrongVenue=false,
  olderReliefLog=false}={}){
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
          away:{team:{id:teamId===101?200:201},score:2}}},
        ...(futureGameResult?[{gamePk:710001,gameDate:'2026-07-01T23:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:teamId},score:20},
            away:{team:{id:779},score:0}}}]:[]),
        ...(unrelatedGame?[{gamePk:710000,gameDate:'2026-06-28T22:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:777},score:8},
            away:{team:{id:778},score:1}}}]:[])]}]}
    }else if(u.pathname.endsWith('/boxscore')){
      data={teams:{home:{battingOrder:fullLineup?[unknownLineupId?999999:1103,1104,...Array.from({length:7},(_,i)=>1301+i)]:[]},
        away:{battingOrder:fullLineup?[2203,2204,...Array.from({length:7},(_,i)=>2301+i)]:[]}}}
    }else if(u.pathname.endsWith('/venues')){
      data={venues:[{id:wrongVenue?999:205,name:wrongVenue?'Other Park':'Test Ballpark',
        location:{defaultCoordinates:{latitude:40.1,longitude:-74.2}},
        fieldInfo:{roofType:'Retractable',turfType:'Grass',leftLine:330,center:400,rightLine:335}}]}
    }else if(u.pathname.includes('/roster')){
      if(u.searchParams.get('rosterType')==='injured'){data={roster:[]}}
      else if(missingRoster)return new Response('unavailable',{status:503})
      else data=roster(u.pathname.includes('/101/')?'home':'away',fullLineup)
    }else if(u.pathname==='/api/v1/people'){
      const hydration=u.searchParams.get('hydrate')??''
      const pitcher=Number(hydration.match(/opposingPlayerId=([0-9]+)/)?.[1])
      data={people:[...u.searchParams.get('personIds').split(',')].map(k=>({
        id:Number(k),batSide:{code:'R'},pitchHand:{code:'L'},
        stats:bvpHydration&&Number(k)===1103&&pitcher===2201?
          [{splits:[{stat:{atBats:12,hits:5,strikeOuts:3,homeRuns:1}}]}]:[],
      }))}
    }else if(u.pathname.includes('/people/')&&u.pathname.endsWith('/stats')){
      const pitching=u.searchParams.get('group')==='pitching'
      if(pitcherLogs&&u.searchParams.get('stats')==='gameLog'){
        const starter=[1101,2201].includes(Number(u.pathname.split('/').at(-2)))
        data={stats:[{splits:[
          ...(futurePitcherLog?[{date:'2026-07-01',opponent:{id:999},
            stat:{gamesStarted:starter?1:0,inningsPitched:'9.0',
              numberOfPitches:130,earnedRuns:0,strikeOuts:20}}]:[]),
          {date:'2026-06-29',opponent:{id:777},stat:{gamesStarted:starter?1:0,
            inningsPitched:'5.2',numberOfPitches:88,earnedRuns:2,strikeOuts:7,baseOnBalls:2}},
          ...(olderReliefLog?[{date:'2026-06-28',opponent:{id:780},
            stat:{gamesStarted:starter?1:0,inningsPitched:'1.0',
              numberOfPitches:17,earnedRuns:0,strikeOuts:2,baseOnBalls:1}}]:[]),
          {date:'2026-06-15',opponent:{id:778},stat:{gamesStarted:starter?1:0,
            inningsPitched:'6.0',numberOfPitches:92,earnedRuns:1,strikeOuts:8,baseOnBalls:1}},
        ]}]}
      }else data={stats:[{splits:[{stat:pitching?{
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
  assert.equal(review.reviewedMarkets[0].status,'blocked')
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


test('unrelated games in a schedule response never contaminate team form',async()=>{
  const mock=fakeNetwork({unrelatedGame:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.teamForm.home.games,1)
  assert.equal(d.teamForm.away.games,1)
  assert.equal(d.teamForm.home.runsFor,6)
  assert.equal(d.teamForm.away.runsFor,6)
})

test('nine boxscore slots with an unknown athlete do not confirm a lineup',async()=>{
  const mock=fakeNetwork({fullLineup:true,unknownLineupId:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.lineupStatus.home,'unconfirmed')
  assert.equal(d.lineupStatus.away,'confirmed')
  assert.equal(d.rosters.home.filter(p=>p.lineupConfirmed).length,0)
  assert.ok(d.missingEvidence.some(x=>x.includes('Alineación local')))
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,false)
})


test('complete research roster still abstains without real sportsbook offers',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.bothRostersVerified,true)
  assert.equal(review.evidenceGates.realOffersVerified,false)
  assert.equal(review.eligibility,'research-only')
  assert.equal(review.decision,'abstain')
  assert.equal(review.reviewedMarkets.length,0)
  assert.equal(review.eligibleForTicket,false)
  assert.ok(review.missingEvidence.some(x=>x.includes('Ofertas reales vigentes')))
})


test('dated game logs distinguish the last starts from three calendar days of relief work',async()=>{
  const mock=fakeNetwork({pitcherLogs:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.starters.home.recentStarts.length,2)
  assert.equal(d.starters.home.recentStarts[0].date,'2026-06-29')
  assert.equal(d.starters.home.recentStarts[0].opponentId,777)
  assert.equal(d.starters.home.recentStarts[0].pitches,'88')
  assert.equal(d.starters.home.recentStarts[0].strikeouts,'7')
  assert.equal(d.bullpen.home[0].recentStarts.length,0)
  assert.equal(d.bullpen.home[0].reliefUsage72h.length,1)
  assert.equal(d.bullpen.home[0].reliefUsage72h[0].date,'2026-06-29')
  assert.ok(d.uiBlock.props.sections.some(x=>x.heading.includes('Abridores')&&
    x.items.some(y=>y.detail.includes('salidas fechadas'))))
})


test('BvP evidence is tied to the explicit opposing pitcher MLB ID',async()=>{
  const mock=fakeNetwork({bvpHydration:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  const pair=d.matchups.find(m=>m.batterId===1103&&m.pitcherId===2201)
  assert.equal(pair.bvp.atBats,'12')
  assert.equal(pair.bvp.hits,'5')
  assert.equal(d.matchups.find(m=>m.batterId===1103&&m.pitcherId===2202).bvp,null)
  assert.ok(mock.calls.some(url=>decodeURIComponent(url).includes('opposingPlayerId=2201')))
  assert.ok(!mock.calls.some(url=>url.includes('stats=vsPlayer&group=hitting')))
})


test('research snapshot excludes future results and same-day undated pitching logs',async()=>{
  const mock=fakeNetwork({futureGameResult:true,pitcherLogs:true,futurePitcherLog:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.teamForm.home.games,1)
  assert.equal(d.teamForm.home.runsFor,6)
  assert.equal(d.starters.home.recentStarts.length,2)
  assert.ok(d.starters.home.recentStarts.every(g=>g.date<'2026-07-01'))
  assert.equal(d.bullpen.home[0].reliefUsage72h.length,1)
  assert.ok(mock.calls.some(url=>url.includes('/standings?')&&
    url.includes('date=2026-06-30')))
})

test('a venue mismatch cannot attach foreign park weather to the MLB fixture',async()=>{
  const mock=fakeNetwork({wrongVenue:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.venue.name,'Test Ballpark')
  assert.equal(d.venue.latitude,null)
  assert.equal(d.venue.longitude,null)
  assert.equal(d.weather,null)
  assert.equal(d.venue.roofType,'unknown')
  assert.equal(d.venue.dimensionsFt.center,null)
  assert.ok(d.missingEvidence.includes('Clima horario no disponible'))
  assert.ok(!mock.calls.some(url=>url.includes('api.open-meteo.com')))
})

test('market research rejects nonfinite lines and quotes without a named market',async()=>{
  const mock=fakeNetwork()
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    time:fixture.gameDate,timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[
    {...quote,point:Number.NaN},{...quote,point:Number.POSITIVE_INFINITY},
    {...quote,market:''},{...quote,selection:''},quote,
  ])
  assert.equal(d.odds.length,1)
  assert.equal(d.odds[0].point,8)
})


test('relief workload is dated to the research snapshot and retains pitcher detail',async()=>{
  const mock=fakeNetwork({pitcherLogs:true,olderReliefLog:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  const relief=d.bullpen.home[0].reliefUsage72h
  assert.equal(relief.length,2)
  assert.equal(relief[0].date,'2026-06-29')
  assert.equal(relief[1].date,'2026-06-28')
  assert.equal(relief[1].opponentId,780)
  assert.equal(relief[1].innings,'1.0')
  assert.equal(relief[1].pitches,'17')
  assert.equal(relief[1].strikeouts,'2')
  assert.equal(relief[1].walks,'1')
  assert.ok(d.uiBlock.props.sections.some(x=>x.heading.includes('Bullpen')&&
    x.items.some(y=>y.detail.includes('17 pitcheos')&&y.detail.includes('2 K'))))
})


test('official park fieldInfo distinguishes roof construction from actual roof position',async()=>{
  const mock=fakeNetwork()
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.venue.roofType,'Retractable')
  assert.equal(d.venue.roof,'unknown')
  assert.equal(d.venue.turfType,'Grass')
  assert.deepEqual(d.venue.dimensionsFt,{leftLine:330,center:400,rightLine:335})
  assert.equal(d.weather.windRelativeToField,'unknown')
  assert.ok(mock.calls.some(url=>url.includes('/venues?')&&
    url.includes('hydrate=location,fieldInfo')))
})
