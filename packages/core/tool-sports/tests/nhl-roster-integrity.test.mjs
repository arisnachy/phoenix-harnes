import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildNhlFullRosterAudit,reconcileNhlRosterAvailability}
  from '../src/nhl-roster-integrity.ts'
const now=Date.parse('2026-11-16T15:00:00Z')
const kickoff='2026-11-17T01:00:00Z'
const player=(id,team,name,role='forward',provider='NHL')=>({
  id:String(id),team,name,role,idProvider:provider,stats:{},
  last5:[],starterConfirmed:false,
})
const roster={home:[
  player(10,'UTA','Clayton Keller'),
  player(11,'UTA','Karel Vejmelka','goalie'),
  player(12,'UTA','Roster Unknown')],
  away:[
    player(20,'VAN','Elias Pettersson'),
    player(21,'VAN','Kevin Lankinen','goalie'),
    player(22,'VAN','Prospect From ESPN','defense','ESPN')]}
const stat=(playerId,rest)=>({playerId,...rest})
const raw={
  home:{skaters:[
    stat(10,{gamesPlayed:20,goals:10,assists:14,points:24,shots:55,
      plusMinus:-3,powerPlayGoals:6,avgTimeOnIcePerGame:1210,
      faceoffWinPctg:.5,shootingPctg:18.2,penaltyMinutes:8}),
    stat(999,{gamesPlayed:21,points:99})],
    goalies:[stat(11,{gamesPlayed:15,gamesStarted:14,wins:8,losses:4,
      overtimeLosses:2,savePctg:.911,shotsAgainst:399,saves:362,
      goalsAgainstAverage:2.37,shutouts:1})]},
  away:{skaters:[stat(20,{gamesPlayed:20,goals:8,assists:12,points:20,
      shots:45,avgTimeOnIcePerGame:1123})],
    goalies:[stat(21,{gamesPlayed:11,gamesStarted:10,wins:4,losses:6,
      savePercentage:91.2,shotsAgainst:320,saves:292,
      goalsAgainstAverage:3.1})]},
}
const injury={
  status:'verified',league:'nhl',checkedAt:new Date(now).toISOString(),
  feedUpdatedAt:'2026-11-16T14:00:00Z',source:'ESPN NHL league injuries',
  officialSource:null,notes:[],
  home:{name:'Mammoth',matched:true,injuries:[
    {team:'Utah Mammoth',athlete:'Clayton Keller',athleteId:'espn-10',
      status:'Out',reportedAt:'2026-11-16T12:00:00Z',
      details:'Upper body',returnDate:null,source:'ESPN NHL league injuries'},
    {team:'Utah Mammoth',athlete:'Person Not In Roster',athleteId:null,
      status:'Questionable',reportedAt:'2026-11-16T12:00:00Z',
      details:'',returnDate:null,source:'ESPN NHL league injuries'},
  ]},
  away:{name:'Canucks',matched:true,injuries:[
    {team:'Vancouver Canucks',athlete:'Elias Pettersson',athleteId:'987654',
      status:'Questionable',reportedAt:'2026-11-16T13:00:00Z',
      details:'Upper body',returnDate:null,source:'ESPN NHL league injuries'},
    {team:'Vancouver Canucks',athlete:'Kevin Lankinen',athleteId:'999',
      status:'IR',reportedAt:'2026-11-18T13:00:00Z',
      details:'future report',returnDate:null,source:'ESPN NHL league injuries'},
  ]},
}
test('complete roster returns every member, not just the top 8 skaters',()=>{
  const a=buildNhlFullRosterAudit(roster,raw,null,now,kickoff)
  assert.equal(a.home.count,3)
  assert.equal(a.away.count,3)
  assert.equal(a.home.matchedStats,2)
  assert.equal(a.home.missingSeasonStats,1)
  assert.equal(a.away.matchedStats,2)
  assert.equal(a.away.missingSeasonStats,1)
  const star=a.home.players[0]
  assert.equal(star.seasonMetrics.points,24)
  assert.equal(star.seasonMetrics.plusMinus,-3)
  assert.equal(star.seasonMetrics.powerPlayGoals,6)
  assert.equal(star.seasonMetrics.faceoffWinPctg,.5)
  assert.equal(star.seasonMetrics.shootingPctg,.182)
  const goalie=a.home.players[1]
  assert.equal(goalie.seasonMetrics.savePctg,.911)
  assert.equal(goalie.seasonMetrics.gamesStarted,14)
  assert.equal(goalie.seasonMetrics.shotsAgainst,399)
  assert.equal(a.away.players[1].seasonMetrics.savePctg,.912)
  assert.equal(a.away.players[2].seasonStatStatus,'foreign-namespace')
  assert.equal(a.home.players[2].seasonMetrics.points,undefined)
  assert.equal(a.allPlayerStatsCovered,false)
  assert.equal(a.allAvailabilityConfirmed,false)
})
test('ESPn injury reports are joined by team/name and never by cross-provider IDs',()=>{
  const base=buildNhlFullRosterAudit(roster,raw,null,now,kickoff)
  const a=reconcileNhlRosterAvailability(base,injury,now,kickoff)
  assert.equal(a.home.players[0].availability,'reported-out')
  assert.equal(a.home.players[0].impactIfAbsent,'high')
  assert.equal(a.home.players[0].officialInactiveConfirmed,false)
  assert.equal(a.away.players[0].availability,'reported-questionable')
  assert.equal(a.away.players[1].availability,'not-reported')
  assert.equal(a.home.players[1].availability,'not-reported')
  assert.equal(a.home.reportedOut,1)
  assert.equal(a.away.reportedQuestionable,1)
  assert.equal(a.home.unmatchedInjuries.length,1)
  assert.equal(a.away.unmatchedInjuries.length,1)
  assert.equal(a.home.players[0].seasonMetrics.points,24)
})
test('injury report timestamp after decision cutoff is ignored, never time-travelled',()=>{
  const base=buildNhlFullRosterAudit(roster,raw,null,now,kickoff)
  const future={...injury,feedUpdatedAt:'2026-11-17T03:00:00Z'}
  const x=reconcileNhlRosterAvailability(base,future,now,kickoff)
  assert.equal(x.home.players[0].availability,'feed-unavailable')
  assert.equal(x.home.reportedOut,0)
})
test('conflicting duplicate same-name injury records remain ambiguous',()=>{
  const base=buildNhlFullRosterAudit(roster,raw,null,now,kickoff)
  const doubled={...injury,home:{...injury.home,injuries:[
    injury.home.injuries[0],
    {...injury.home.injuries[0],status:'Probable'}
  ]}}
  const a=reconcileNhlRosterAvailability(base,doubled,now,kickoff)
  assert.equal(a.home.players[0].availability,'ambiguous-report')
  assert.equal(a.home.reportedOut,0)
})
