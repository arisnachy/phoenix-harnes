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
  olderReliefLog=false,futureNews=false,sameDayFinal=false,duplicateGame=false}={}){
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
        ...(duplicateGame?[{gamePk:709999,gameDate:'2026-06-29T22:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:teamId},score:6},
            away:{team:{id:teamId===101?200:201},score:2}}}]:[]),
        ...(sameDayFinal?[{gamePk:710002,gameDate:'2026-07-01T08:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:teamId},score:21},
            away:{team:{id:779},score:0}}}]:[]),
        ...(futureGameResult?[{gamePk:710001,gameDate:'2026-07-01T23:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:teamId},score:20},
            away:{team:{id:779},score:0}}}]:[]),
        ...(unrelatedGame?[{gamePk:710000,gameDate:'2026-06-28T22:00:00Z',
          status:{abstractGameState:'Final'},teams:{home:{team:{id:777},score:8},
            away:{team:{id:778},score:1}}}]:[])]}]}
    }else if(u.pathname.endsWith('/boxscore')){
      data={teams:{home:{battingOrder:fullLineup?[unknownLineupId?999999:1103,1104,...Array.from({length:7},(_,i)=>1301+i)]:[]},
        away:{battingOrder:fullLineup?[2203,2204,...Array.from({length:7},(_,i)=>2301+i)]:[]}}}
    }else if(/^\/api\/v1\/venues\/\d+$/u.test(u.pathname)){
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
        published:futureNews?'2026-07-01T13:00:00Z':'2026-07-01T10:00:00Z'}]}
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

test('as-of form excludes hindsight finals from the same day and repeated gamePk',async()=>{
  const mock=fakeNetwork({sameDayFinal:true,duplicateGame:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.teamForm.home.games,1)
  assert.equal(d.teamForm.home.wins,1)
  assert.equal(d.teamForm.home.runsFor,6)
  assert.equal(d.teamForm.away.games,1)
  assert.ok(d.teamForm.home.lastResults.every(g=>g.date<'2026-07-01'))
  assert.ok(!d.teamForm.home.lastResults.some(g=>g.scored===21))
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
  assert.ok(mock.calls.some(url=>url.includes('/venues/205?')&&
    url.includes('hydrate=location,fieldInfo')))
})


test('market review abstains when fixture status is no longer pregame',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const q={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[q])
  assert.equal(reviewMlbResearch(d).decision,'investigate')
  d.fixture.status='Final'
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.scheduledFuture,false)
  assert.equal(review.decision,'abstain')
  assert.equal(review.eligibility,'insufficient')
  assert.equal(review.reviewedMarkets[0].status,'blocked')
  assert.equal(review.eligibleForTicket,false)
})

test('nine roster entries with a duplicated ID cannot pass nine-player verification',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  const hitters=d.rosters.home.filter(p=>p.role==='batter')
  d.rosters.home=d.rosters.home.filter(p=>p.id!==hitters[8].id)
  d.rosters.home.push({...hitters[0]})
  assert.equal(d.rosters.home.filter(p=>p.role==='batter').length,9)
  assert.equal(reviewMlbResearch(d).evidenceGates.bothRostersVerified,false)
})

test('market comparisons preserve bookmaker, selection, line, price and timestamp',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote=(bookmaker,selection,point,price)=>({eventId:'book-4',bookmaker,
    market:'totals',selection,point,price,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'})
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[
    quote('Book A','Over',8,1.91),quote('Book A','Over',8.5,2.02),
    quote('Book B','Under',8,1.85),
  ])
  const review=reviewMlbResearch(d)
  assert.equal(review.marketComparisons.length,2)
  assert.deepEqual(review.marketComparisons[0].offers.map(x=>[x.selection,x.line,x.price]),
    [['Over',8,1.91],['Over',8.5,2.02]])
  assert.equal(review.marketComparisons[1].bookmaker,'Book B')
  assert.equal(review.marketComparisons[1].offers[0].updatedAt,'2026-07-01T11:55:00Z')
  assert.equal(review.reviewedMarkets.length,3)
  assert.equal(review.probabilitiesEstimated,false)
  assert.equal(review.eligibleForTicket,false)
})


test('MLB dossier rejects otherwise matching odds from another sport',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote=sportKey=>({eventId:'book-4',bookmaker:'Verified House',
    market:'totals',selection:'Over',point:8,price:1.91,
    home:'Home Giants',away:'Away Bears',timeIso:fixture.gameDate,
    updatedAt:'2026-07-01T11:55:00Z',sportKey})
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[
    quote('basketball_nba'),quote('baseball_mlb'),
  ])
  assert.equal(d.odds.length,1)
  assert.equal(d.odds[0].sportKey,'baseball_mlb')
  assert.equal(reviewMlbResearch(d).reviewedMarkets.length,1)
})

test('news published after checkedAt is not treated as known pregame evidence',async()=>{
  const mock=fakeNetwork({futureNews:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(d.news.length,0)
  assert.ok(d.missingEvidence.some(x=>x.includes('Noticias específicas')))
})


test('cross-book prices compare only identical market, selection and run line',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote=(bookmaker,selection,point,price)=>({eventId:'book-4',bookmaker,
    market:'totals',selection,point,price,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z',
    sportKey:'baseball_mlb'})
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[
    quote('Book A','Over',8,1.91),quote('Book B','Over',8,1.96),
    quote('Book B','Over',8.5,2.08),quote('Book A','Under',8,1.84),
  ])
  const review=reviewMlbResearch(d)
  assert.equal(review.crossBookComparisons.length,3)
  const over8=review.crossBookComparisons.find(x=>x.market==='totals'&&
    x.selection==='Over'&&x.line===8)
  assert.deepEqual(over8.quotes.map(x=>[x.bookmaker,x.price]),
    [['Book A',1.91],['Book B',1.96]])
  assert.equal(over8.settlementComparable,false)
  assert.equal(review.evidenceGates.crossBookSettlementComparable,false)
  assert.match(over8.note,/NO comparable/)
  assert.ok(review.reviewedMarkets.every(m=>m.missingEvidence.some(x=>x.includes('equivalencia del período'))))
  assert.ok(!over8.quotes.some(x=>x.price===2.08||x.price===1.84))
  assert.equal(review.probabilitiesEstimated,false)
  assert.equal(review.eligibleForTicket,false)
})

test('a confirmed lineup flag cannot substitute for nine distinct verified starters',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,true)
  const hitter=d.rosters.home.find(p=>p.role==='batter'&&p.lineupConfirmed)
  hitter.lineupConfirmed=false
  assert.equal(d.lineupStatus.home,'confirmed')
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,false)
  hitter.lineupConfirmed=true
  hitter.teamId=999
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,false)
})

test('market gate rejects a missing batter versus bullpen matchup even with nine confirmed hitters',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',selection:'Over',
    point:8,price:1.91,home:'Home Giants',away:'Away Bears',timeIso:fixture.gameDate,
    updatedAt:'2026-07-01T11:55:00Z',sportKey:'baseball_mlb'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[quote])
  assert.equal(reviewMlbResearch(d).evidenceGates.rosterMatchupsReviewed,true)
  const hitter=d.rosters.home.find(p=>p.role==='batter'&&p.lineupConfirmed)
  const reliever=d.bullpen.away[0]
  d.matchups=d.matchups.filter(m=>!(m.batterId===hitter.id&&m.pitcherId===reliever.id))
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.lineupsConfirmed,true)
  assert.equal(review.evidenceGates.rosterMatchupsReviewed,false)
  assert.equal(review.reviewedMarkets.length,1)
  assert.ok(review.reviewedMarkets.every(m=>m.missingEvidence.some(x=>x.includes('Matriz completa'))))
  assert.equal(review.eligibility,'insufficient')
  assert.equal(review.decision,'abstain')
  assert.equal(review.eligibleForTicket,false)
})

test('roster matchup evidence abstains when either opposing bullpen is absent',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(reviewMlbResearch(d).evidenceGates.rosterMatchupsReviewed,true)
  d.bullpen.away=[]
  let review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.rosterMatchupsReviewed,false)
  assert.equal(review.decision,'abstain')
  assert.equal(review.eligibleForTicket,false)
  d.bullpen.home=[]
  review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.rosterMatchupsReviewed,false)
  assert.equal(review.eligibleForTicket,false)
})

test('confirmed MLB lineup requires nine distinct batting-order slots from 1 through 9',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,true)
  const hitters=d.rosters.home.filter(p=>p.role==='batter'&&p.lineupConfirmed)
  assert.equal(hitters.length,9)
  hitters[8].lineupOrder=hitters[0].lineupOrder
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,false)
  hitters[8].lineupOrder=9
  assert.equal(reviewMlbResearch(d).evidenceGates.lineupsConfirmed,true)
  hitters[8].lineupOrder=null
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.lineupsConfirmed,false)
  assert.equal(review.eligibleForTicket,false)
})


test('review rechecks cached odds freshness and excludes stale quotes from comparisons',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z',
    sportKey:'baseball_mlb'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[quote])
  assert.equal(reviewMlbResearch(d).evidenceGates.realOffersVerified,true)
  d.checkedAt='2026-07-01T14:00:00Z'
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.realOffersVerified,false)
  assert.equal(review.decision,'abstain')
  assert.equal(review.marketComparisons.length,0)
  assert.equal(review.crossBookComparisons.length,0)
  assert.ok(review.reviewedMarkets[0].missingEvidence.some(x=>x.includes('Cotización vencida')))
  assert.equal(review.eligibleForTicket,false)
})


test('explicit review time invalidates cached offers without rewriting historical dossier',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z',
    sportKey:'baseball_mlb'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[quote])
  assert.equal(reviewMlbResearch(d,'2026-07-01T12:05:00Z').evidenceGates.realOffersVerified,true)
  const stale=reviewMlbResearch(d,'2026-07-01T13:05:00Z')
  assert.equal(stale.evidenceGates.realOffersVerified,false)
  assert.equal(stale.decision,'abstain')
  assert.equal(stale.crossBookComparisons.length,0)
  assert.ok(stale.reviewedMarkets[0].missingEvidence.some(x=>x.includes('Cotización vencida')))
  assert.equal(reviewMlbResearch(d,'invalid').evidenceGates.reviewTimestampValid,false)
  assert.equal(reviewMlbResearch(d,'2026-07-01T11:00:00Z').decision,'abstain')
  assert.equal(reviewMlbResearch(d).evidenceGates.realOffersVerified,true)
  assert.equal(stale.eligibleForTicket,false)
})

test('cached pregame dossier abstains when reviewed after scheduled first pitch',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  const original=reviewMlbResearch(d)
  assert.equal(original.evidenceGates.scheduledFuture,true)
  const later=reviewMlbResearch(d,'2026-07-02T22:01:00Z')
  assert.equal(later.evidenceGates.reviewTimestampValid,true)
  assert.equal(later.evidenceGates.scheduledFuture,false)
  assert.equal(later.eligibility,'insufficient')
  assert.equal(later.decision,'abstain')
  assert.equal(later.eligibleForTicket,false)
})


test('capped MLB review prioritizes current offers over forty expired quotes',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z',
    sportKey:'baseball_mlb'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[quote])
  const live=d.odds[0]
  d.odds=[
    ...Array.from({length:40},(_,i)=>({...live,bookmaker:'Expired '+i,
      updatedAt:'2026-07-01T09:00:00Z'})),
    live,
  ]
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.realOffersVerified,true)
  assert.equal(review.reviewedMarkets.length,40)
  assert.equal(review.reviewedMarkets[0].bookmaker,'Verified House')
  assert.equal(review.reviewedMarkets[0].status,'blocked')
  assert.ok(review.reviewedMarkets[0].missingEvidence.every(x=>
    !x.includes('Cotización vencida')))
  assert.deepEqual(review.marketComparisons.map(x=>x.bookmaker),['Verified House'])
  assert.deepEqual(review.crossBookComparisons[0].quotes.map(x=>x.bookmaker),['Verified House'])
  assert.equal(review.eligibleForTicket,false)
})

test('MLB comparisons retain every fresh quote beyond the forty-row review display cap',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const quote={eventId:'book-4',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z',
    sportKey:'baseball_mlb'}
  const d=await researchMlbCase(date,812345,mock.fetcher,at,{},[quote])
  const live=d.odds[0]
  d.odds=[
    ...Array.from({length:40},(_,i)=>({...live,bookmaker:'Book '+i})),
    {...live,bookmaker:'Book 40',price:2.05},
  ]
  const review=reviewMlbResearch(d)
  assert.equal(review.reviewedMarkets.length,40)
  assert.equal(review.reviewedMarkets.some(x=>x.bookmaker==='Book 40'),false)
  assert.equal(review.evidenceGates.realOffersVerified,true)
  assert.equal(review.marketComparisons.length,41)
  assert.ok(review.marketComparisons.some(x=>x.bookmaker==='Book 40'&&
    x.offers[0].price===2.05))
  const over8=review.crossBookComparisons.find(x=>x.market==='totals'&&
    x.selection==='Over'&&x.line===8)
  assert.equal(over8.quotes.length,41)
  assert.ok(over8.quotes.some(x=>x.bookmaker==='Book 40'&&x.price===2.05))
  assert.equal(over8.settlementComparable,false)
  assert.equal(review.eligibleForTicket,false)
})

test('MLB dossier retains every verified quote beyond the 40-row display cap',async()=>{
  const mock=fakeNetwork()
  const base={eventId:'book-mlb',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    time:fixture.gameDate,timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'}
  const quotes=Array.from({length:41},(_,i)=>({...base,bookmaker:'House '+i,
    price:1.8+i/1000}))
  const dossier=await researchMlbCase(date,812345,mock.fetcher,at,{},quotes)
  assert.equal(dossier.odds.length,41)
  assert.equal(dossier.odds[40].bookmaker,'House 40')
  const review=reviewMlbResearch(dossier)
  assert.equal(review.reviewedMarkets.length,40)
  assert.equal(review.marketComparisons.length,41)
  assert.ok(review.crossBookComparisons.some(group=>
    group.quotes.length===41&&group.quotes.some(q=>q.bookmaker==='House 40')))
  assert.equal(review.eligibleForTicket,false)
})


test('MLB dashboard paginates full matchup and market evidence without hiding rows',async()=>{
  const mock=fakeNetwork()
  const base={eventId:'book-mlb',bookmaker:'Verified House',market:'totals',
    selection:'Over',point:8,price:1.91,home:'Home Giants',away:'Away Bears',
    time:fixture.gameDate,timeIso:fixture.gameDate,updatedAt:'2026-07-01T11:55:00Z'}
  const quotes=Array.from({length:41},(_,i)=>({...base,bookmaker:'House '+i,
    price:1.8+i/1000}))
  const dossier=await researchMlbCase(date,812345,mock.fetcher,at,{},quotes)
  const markets=dossier.uiBlock.props.sections.filter(s=>s.heading.startsWith('Mercados de casas'))
  assert.equal(markets.length,2)
  assert.equal(markets.reduce((n,s)=>n+s.items.length,0),41)
  assert.ok(markets.some(s=>s.items.some(i=>i.label.startsWith('House 40'))))
  assert.ok(markets.every(s=>s.items.length<=40))
  const matchupSections=dossier.uiBlock.props.sections.filter(s=>
    s.heading.startsWith('Matriz roster contra abridores y bullpen'))
  assert.equal(matchupSections.reduce((n,s)=>n+s.items.length,0),dossier.matchups.length)
  assert.ok(matchupSections.every(s=>s.items.length<=40))
})


test('recent relief usage must be evidenced for both bullpens, not just one',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  // Force one side to have verified usage to isolate the asymmetric gate.
  assert.ok(d.bullpen.home.length>0&&d.bullpen.away.length>0)
  d.bullpen.home[0].reliefUsage72h=[{date:'2026-06-30',opponentId:123,
    innings:'1.0',pitches:'15',earnedRuns:'0',strikeouts:'1',walks:'0'}]
  d.bullpen.away.forEach(p=>{p.reliefUsage72h=[]})
  const review=reviewMlbResearch(d)
  assert.equal(review.evidenceGates.reliefUsageObserved,false)
  assert.ok(review.reviewedMarkets.every(m=>m.missingEvidence.some(x=>
    x.includes('Uso reciente del bullpen'))))
  assert.equal(review.eligibleForTicket,false)
})


test('MLB global evidence summary reports blockers even with zero market offers',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const dossier=await researchMlbCase(date,812345,mock.fetcher,at)
  dossier.odds=[]
  const review=reviewMlbResearch(dossier)
  assert.equal(review.reviewedMarkets.length,0)
  assert.equal(review.evidenceGates.realOffersVerified,false)
  assert.equal(review.decision,'abstain')
  assert.ok(review.missingEvidence.some(x=>x.includes('Estado del techo')))
  assert.ok(review.missingEvidence.some(x=>x.includes('liquidación entre casas')))
  assert.ok(review.missingEvidence.some(x=>x.includes('Picks externos')))
  assert.ok(review.missingEvidence.some(x=>x.includes('Ofertas reales vigentes')))
  assert.equal(review.eligibleForTicket,false)
})

test('MLB global evidence rejects invalid as-of review even without quotes',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const dossier=await researchMlbCase(date,812345,mock.fetcher,at)
  dossier.odds=[]
  for(const reviewAt of ['not-a-date','2026-07-01T11:00:00Z']){
    const review=reviewMlbResearch(dossier,reviewAt)
    assert.equal(review.evidenceGates.reviewTimestampValid,false)
    assert.equal(review.eligibility,'insufficient')
    assert.equal(review.decision,'abstain')
    assert.ok(review.missingEvidence.some(x=>x.includes('Fecha de revisión inválida')))
    assert.equal(review.eligibleForTicket,false)
  }
})

test('global review exposes asymmetric bullpen and lineup gaps without quotes',async()=>{
  const mock=fakeNetwork({fullLineup:true})
  const d=await researchMlbCase(date,812345,mock.fetcher,at)
  d.odds=[]
  assert.ok(d.bullpen.home.length>0&&d.bullpen.away.length>0)
  d.bullpen.home[0].reliefUsage72h=[{date:'2026-06-30',opponentId:123,
    innings:'1.0',pitches:'15',earnedRuns:'0',strikeouts:'1',walks:'0'}]
  d.bullpen.away.forEach(p=>{p.reliefUsage72h=[]})
  const hitter=d.rosters.home.find(p=>p.role==='batter'&&p.lineupConfirmed)
  assert.ok(hitter)
  hitter.lineupConfirmed=false
  const review=reviewMlbResearch(d)
  assert.equal(review.reviewedMarkets.length,0)
  assert.equal(review.evidenceGates.reliefUsageObserved,false)
  assert.equal(review.evidenceGates.lineupsConfirmed,false)
  assert.ok(review.missingEvidence.some(x=>x.includes('bullpen de ambos equipos')))
  assert.ok(review.missingEvidence.some(x=>x.includes('Alineación confirmada')))
  assert.ok(review.missingEvidence.some(x=>x.includes('Evaluación probabilística')))
  assert.equal(review.decision,'abstain')
  assert.equal(review.eligibleForTicket,false)
})
