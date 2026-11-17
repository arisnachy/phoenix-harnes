import {test} from 'node:test'
import assert from 'node:assert/strict'
import {classifySpecialistCoverage,investigateTicketSpecialist,
  investigateTicketSpecialists,resolveNhlTicketMatch,visibleMlbBvpDuels} from '../src/ticket-specialist-gate.ts'

const fixture=(sport,league='nfl',eventId='123')=>({
  sport,league,eventId,date:'2026-11-08',
  home:'Verified Home',away:'Verified Away',
  kickoff:'2026-11-08T21:00:00Z',
})

test('coverage from BOTH rivals and two investigated dimensions required',()=>{
  assert.equal(classifySpecialistCoverage('B',true,['roster','form'],[]).status,'researched')
  assert.equal(classifySpecialistCoverage('C',true,['roster','form'],[]).status,'incomplete')
  assert.equal(classifySpecialistCoverage('A',false,['roster','form'],[]).status,'incomplete')
  assert.equal(classifySpecialistCoverage('A',true,['roster'],[]).status,'incomplete')
})

test('even extensively researched bets remain unapproved without calibrated models',()=>{
  const review=classifySpecialistCoverage('A',true,
    ['starting lineup','injuries','individual matchups'],['forecast not calibrated'])
  assert.equal(review.status,'researched')
  assert.equal(review.approvedForBetting,false)
  assert.match(review.pendingSteps.join(' '),/not calibrated/)
})

test('missing data never turns into an approved or researched pick',()=>{
  const review=classifySpecialistCoverage(null,false,[],['missing QB'])
  assert.equal(review.status,'incomplete')
  assert.equal(review.approvedForBetting,false)
  assert.match(review.pendingSteps.join(' '),/missing QB/)
})

test('unknown sport is rejected without fetching or fabricating quotes',async()=>{
  const result=await investigateTicketSpecialist(fixture('golf','pga'),
    async()=>{throw Error('must not fetch')})
  assert.equal(result.status,'unavailable')
  assert.equal(result.approvedForBetting,false)
  assert.match(result.pendingSteps.join(' '),/Sin especialista/)
})

test('multiple unsupported fixtures retain exact identity and order',async()=>{
  const games=[fixture('golf','pga','123'),fixture('cricket','test','456')]
  const checks=await investigateTicketSpecialists(games,
    async()=>{throw Error('must not fetch')})
  assert.deepEqual(checks.map(x=>x.eventId),['123','456'])
  assert.deepEqual(checks.map(x=>x.status),['unavailable','unavailable'])
  assert.ok(checks.every(x=>x.approvedForBetting===false))
})

test('NHL gameId cannot cross from Devils-Jets to Panthers-Columbus',()=>{
  const slate=[
    {id:'2026020222',date:'2026-11-11T00:30:00Z',
      home:{name:'Columbus Blue Jackets'},away:{name:'Florida Panthers'}},
    {id:'2026020221',date:'2026-11-11T00:00:00Z',
      home:{name:'Winnipeg Jets'},away:{name:'New Jersey Devils'}},
  ]
  const target={home:'Winnipeg Jets',away:'New Jersey Devils',kickoff:'2026-11-11T00:00:00Z'}
  assert.equal(resolveNhlTicketMatch(slate,target)?.id,'2026020221')
  assert.equal(resolveNhlTicketMatch([slate[0]],target),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,
    home:'New Jersey Devils',away:'Winnipeg Jets'}),null)
  assert.equal(resolveNhlTicketMatch([slate[1],slate[1]],target),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,kickoff:'2026-11-11T07:00:00Z'}),null)
})


test('official NHL nicknames match ESPN full franchise names only with both sides and kickoff',()=>{
  const slate=[{id:'2026020101',date:'2026-11-12T17:00:00Z',
    home:{name:'Kraken'},away:{name:'Hurricanes'}},
    {id:'2026020102',date:'2026-11-12T21:00:00Z',
    home:{name:'Islanders'},away:{name:'Kings'}}]
  const target={home:'Seattle Kraken',away:'Carolina Hurricanes',
    kickoff:'2026-11-12T17:00:00Z'}
  assert.equal(resolveNhlTicketMatch(slate,target)?.id,'2026020101')
  assert.equal(resolveNhlTicketMatch(slate,{...target,home:'New York'}),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,away:'Columbus Blue Jackets'}),null)
  assert.equal(resolveNhlTicketMatch(slate,{...target,kickoff:'2026-11-12T22:00:00Z'}),null)
  assert.equal(resolveNhlTicketMatch([slate[0],slate[0]],target),null)
})


test('NHL actual specialist accepts official nickname at both checks, no cross-provider ID reuse',async()=>{
  const now=Date.parse('2026-11-02T12:00:00Z'),date='2026-11-05'
  const kickoff='2026-11-05T23:00:00Z'
  const event={id:2026020201,startTimeUTC:kickoff,season:20262027,
    gameState:'FUT',
    homeTeam:{id:10,abbrev:'TOR',name:{default:'Maple Leafs'}},
    awayTeam:{id:20,abbrev:'MTL',name:{default:'Canadiens'}},
    venue:{default:'Test Arena'}}
  const mkRoster=(abbr,id)=>({
    forwards:[{id,firstName:{default:'Test'},lastName:{default:abbr+' Player'}}],
    goalies:[{id:id+1,firstName:{default:'Test'},lastName:{default:abbr+' Goalie'}}],
  })
  const transport=async input=>{
    const url=String(input),u=new URL(url)
    let body={}
    if(u.pathname==='/v1/score/'+date)body={games:[event]}
    else if(u.pathname==='/v1/roster/TOR/current')body=mkRoster('TOR',10100)
    else if(u.pathname==='/v1/roster/MTL/current')body=mkRoster('MTL',20100)
    else if(u.pathname==='/v1/standings/'+date)body={standings:[]}
    else if(u.pathname.includes('/player/')&&u.pathname.endsWith('/landing'))
      body={featuredStats:{regularSeason:{subSeason:{gamesPlayed:10}}},last5Games:[]}
    return new Response(JSON.stringify(body),{status:200})
  }
  const result=await investigateTicketSpecialist({
    sport:'hockey',league:'nhl',eventId:'401892696',date,
    home:'Toronto Maple Leafs',away:'Montreal Canadiens',kickoff,
  },transport,now,{},[])
  assert.notEqual(result.status,'unavailable')
  assert.ok(result.checklist?.fullSteps?.length>=12)
  assert.ok(result.verifiedSteps.some(x=>x.includes('Rosters')))
  assert.ok(!result.pendingSteps.some(x=>x.includes('otro partido')))
})

test('deep dossier budgets above old 90s cap are accepted without broadening approvals',async()=>{
  const result=await investigateTicketSpecialists([
    fixture('golf','pga','540'),fixture('cricket','test','541'),
  ],async()=>{throw Error('never fetch unknown league')},
  Date.parse('2026-11-08T17:00:00Z'),{},[],180_000)
  assert.deepEqual(result.map(x=>x.eventId),['540','541'])
  assert.ok(result.every(x=>x.approvedForBetting===false))
  await assert.rejects(()=>investigateTicketSpecialists([
    fixture('golf','pga')],fetch,Date.now(),{},[],240_001),/fuera de rango/)
})
test('timed out NBA dossier recovers fresh bilateral injury evidence independently',async()=>{
  const at=Date.parse('2026-11-08T21:00:00Z')
  const game={sport:'basketball',league:'nba',eventId:'401909949',
    date:'2026-11-08',home:'Boston Celtics',away:'Milwaukee Bucks',
    kickoff:'2026-11-09T02:00:00Z'}
  const injury=(name,status,team)=>({status,date:'2026-11-08T19:48:00Z',
    athlete:{id:team==='Boston Celtics'?'123':'456',displayName:name,
      team:{displayName:team}}})
  const fetcher=async input=>{
    const url=String(input)
    if(url.endsWith('/basketball/nba/injuries'))return Response.json({
      timestamp:'2026-11-08T20:12:00Z',injuries:[
        {id:'2',displayName:'Boston Celtics',injuries:[
          injury('Player Alpha','Questionable','Boston Celtics')]},
        {id:'15',displayName:'Milwaukee Bucks',injuries:[
          injury('Player Beta','Out','Milwaukee Bucks')]},
      ],
    })
    // Simulate a provider that ignores AbortSignal for the expensive NBA
    // slate/roster; the tool must still surface the independent injury feed.
    return new Promise(()=>{})
  }
  const [result]=await investigateTicketSpecialists([game],fetcher,at,{},[],45)
  assert.equal(result.status,'incomplete')
  assert.equal(result.injuryAudit.status,'verified')
  assert.equal(result.injuryAudit.home.injuries[0].athlete,'Player Alpha')
  assert.equal(result.injuryAudit.away.injuries[0].status,'Out')
  assert.equal(result.approvedForBetting,false)
  assert.match(result.pendingSteps.join(' '),/Límite de investigación/)
  assert.ok(result.verifiedSteps.some(x=>/ESPN reporte de lesiones/.test(x)))
})

test('MLB BvP comparisons distinguish measured AB from candidate pitcher encounters',()=>{
  const build=(batterId,atBats)=>({batterId,batter:'Batter '+batterId,
    pitcherId:101,pitcher:'Starter',pitcherRole:'probable-starter',
    batterSide:'R',pitcherHand:'L',observations:atBats?
      ['BvP registrado: AB '+atBats+', H 2, K 1, HR 0']:[],
    bvp:atBats?{atBats:String(atBats),hits:'2'}:null,missing:[],
    assessment:'requires-review'})
  const rows=visibleMlbBvpDuels([build(10,5),build(20,0)],
    new Set([10]),new Set([20]))
  assert.equal(rows.length,2)
  assert.equal(rows[0].status,'observed')
  assert.match(rows[0].detail,/AB 5/)
  assert.equal(rows[1].status,'candidate')
  assert.match(rows[1].detail,/sin turnos BvP/)
})
