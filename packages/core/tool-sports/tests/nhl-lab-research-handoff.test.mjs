import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildNhlResearchHandoff,readNhlResearchHandoff} from '../src/nhl-lab-research-handoff.ts'
const makeDossier=()=>({
  fixture:{id:'2026020255',date:'2026-11-16T00:00:00Z',
    state:'FUT',season:'20262027',venue:'Test Arena',
    home:{id:'1',abbrev:'NJD',name:'New Jersey Devils'},
    away:{id:'10',abbrev:'TOR',name:'Toronto Maple Leafs'}},
  checkedAt:'2026-11-15T18:00:00Z',
  sources:[{url:'https://api-web.nhle.com/v1/score/2026-11-15',
    status:'verified',checkedAt:'2026-11-15T18:00:00Z'}],
  specialTeams:{complete:true,source:'NHL Stats REST',
    checkedAt:'2026-11-15T18:00:00Z',
    home:{powerPlayPct:21,penaltyKillPct:80},
    away:{powerPlayPct:19,penaltyKillPct:78}},
  players:{
    home:[{id:'8470001',team:'NJD',name:'Home A',role:'forward',
      stats:{},last5:[],starterConfirmed:false}],
    away:[{id:'8470002',team:'TOR',name:'Away A',role:'forward',
      stats:{},last5:[],starterConfirmed:false}]},
  goalieCandidates:{
    home:[{id:'8470003',team:'NJD',name:'Goalie H',role:'goalie',
      stats:{},last5:[],starterConfirmed:false}],
    away:[{id:'8470004',team:'TOR',name:'Goalie A',role:'goalie',
      stats:{},last5:[],starterConfirmed:false}]},
  possibleMatchups:[{attackerId:'8470001',attacker:'Home A',
    againstGoalies:['Goalie A'],source:'roster-only'}],
  standings:{home:'10-4-2',away:'9-5-1'},
  form:{home:{games:10,wins:7,losses:3,homeGames:6,awayGames:4,restHours:72,
      last5:[],last10:[],last20:[]},
    away:{games:10,wins:6,losses:4,homeGames:5,awayGames:5,restHours:48,
      last5:[],last10:[],last20:[]}},
  markets:[{bookmaker:'Example',market:'moneyline',selection:'NJD',
    point:null,odds:1.7,updatedAt:'2026-11-15T17:30:00Z',
    verifiedEvent:true,approved:false,reason:'research-only'}],
  scenarios:[],missingEvidence:['5v5 xG','official starters'],
  opportunity:{sport:'hockey',league:'nhl',eventId:'2026020255',
    decision:'investigate',eligibleForTicket:false,calibratedProbability:false},
})
test('A-Q NHL evidence maps correctly and keeps 17 modules',()=>{
  const snapshot=buildNhlResearchHandoff(makeDossier())
  const game=snapshot.games[0]
  assert.equal(snapshot.schema,'phoenix.nhl.read-model.v1')
  assert.equal(Object.keys(game.evidenceModules).length,17)
  assert.equal(game.evidenceModules.A.state,'verified')
  assert.equal(game.evidenceModules.L.state,'verified')
  assert.equal(game.evidenceModules.F.state,'missing')
  assert.equal(game.evidenceModules.P.state,'missing')
  assert.equal(game.evidenceModules.Q.state,'missing')
  assert.equal(game.evidenceModules.O.state,'partial')
  assert.equal(game.evidenceModules.O.data[0].liveVerified,false)
  assert.equal(game.gate.eligibleForTicket,false)
  assert.equal(game.captureBeforeTipoff,true)
  assert.ok(game.missingResearch.some(x=>x.module==='G'))
  assert.equal(readNhlResearchHandoff(snapshot)[0].eventId,'2026020255')
})
test('goalie candidates do not count as confirmed starters',()=>{
  const game=buildNhlResearchHandoff(makeDossier()).games[0]
  assert.equal(game.evidenceModules.G.state,'partial')
  assert.equal(game.evidenceModules.G.data.confirmed,null)
  assert.equal(game.checklistObservations.goalies.state,'partial')
})
test('official two-goalie evidence confirms only goalie module, not ticket',()=>{
  const starter={state:'confirmed',
    url:'https://api-web.nhle.com/v1/gamecenter/2026020255/boxscore',
    checkedAt:'2026-11-15T18:00:00Z',
    homeGoalie:'Confirmed Home',awayGoalie:'Confirmed Away'}
  const game=buildNhlResearchHandoff(makeDossier(),starter).games[0]
  assert.equal(game.evidenceModules.G.state,'verified')
  assert.equal(game.gate.eligibleForTicket,false)
  assert.equal(game.evidenceModules.P.state,'missing')
})
test('postgame snapshots never become pregame predictions',()=>{
  const dossier=makeDossier()
  dossier.checkedAt='2026-11-16T02:00:00Z'
  dossier.fixture.state='LIVE'
  const snapshot=buildNhlResearchHandoff(dossier)
  assert.equal(snapshot.games[0].captureBeforeTipoff,false)
  snapshot.games[0].captureBeforeTipoff=true
  assert.equal(readNhlResearchHandoff(snapshot)[0].captureBeforeTipoff,false)
})
test('read rejects operational/pick and historical odds elevation',()=>{
  for(const mutate of [
    s=>{s.operational=true},
    s=>{s.games[0].gate.eligibleForTicket=true},
    s=>{s.games[0].gate.quotedOddsLive=true},
    s=>{s.games[0].gate.modelCalibrated=true},
    s=>{s.games[0].evidenceModules.O.state='verified'},
    s=>{s.games[0].evidenceModules.Q.state='verified'},
  ]){
    const snapshot=buildNhlResearchHandoff(makeDossier())
    mutate(snapshot)
    assert.throws(()=>readNhlResearchHandoff(snapshot),/NHL handoff/)
  }
})
test('read rejects missing modules, duplicate or swapped team identities',()=>{
  const s=buildNhlResearchHandoff(makeDossier())
  delete s.games[0].evidenceModules.J
  assert.throws(()=>readNhlResearchHandoff(s),/A-Q/)
  const repeat=buildNhlResearchHandoff(makeDossier())
  repeat.games.push(structuredClone(repeat.games[0]))
  assert.throws(()=>readNhlResearchHandoff(repeat),/duplicate/)
  const invalid=buildNhlResearchHandoff(makeDossier())
  invalid.games[0].away.id=invalid.games[0].home.id
  assert.throws(()=>readNhlResearchHandoff(invalid),/invalid fixture/)
})
test('new NHL handoff never invents xG, GSAx or injury confirmations',()=>{
  const game=buildNhlResearchHandoff(makeDossier()).games[0]
  for(const k of ['F','J','K','N','P','Q'])
    assert.equal(game.evidenceModules[k].state,'missing')
  assert.equal(game.evidenceModules.H.state,'partial')
  assert.equal(game.checklistObservations.injuries.state,'missing')
})
test('invalid official NHL ID and dates are rejected',()=>{
  const d=makeDossier()
  d.fixture.id='401909985'
  assert.throws(()=>buildNhlResearchHandoff(d),/identity/)
  const bad=makeDossier()
  bad.checkedAt='not-a-time'
  assert.throws(()=>buildNhlResearchHandoff(bad),/timestamps/)
})

test('NHL league injury report becomes dated PARTIAL evidence, never club-confirmed',()=>{
  const injuries={status:'verified',source:'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries',
    feedUpdatedAt:'2026-11-15T15:00:00Z',checkedAt:'2026-11-15T18:00:00Z',
    home:{name:'New Jersey Devils',matched:true,injuries:[
      {athlete:'Player H',status:'Out',reportedAt:'2026-11-15T14:00:00Z'}]},
    away:{name:'Toronto Maple Leafs',matched:true,injuries:[
      {athlete:'Player A',status:'Questionable',reportedAt:'2026-11-15T14:00:00Z'}]}}
  const game=buildNhlResearchHandoff(makeDossier(),null,injuries).games[0]
  assert.equal(game.evidenceModules.J.state,'partial')
  assert.equal(game.evidenceModules.J.data.officialClubConfirmation,false)
  assert.equal(game.evidenceModules.J.data.home.injuries[0].athlete,'Player H')
  assert.equal(game.checklistObservations.injuries.state,'partial')
  assert.equal(game.gate.eligibleForTicket,false)
})
test('NHL post-snapshot injury report cannot leak into an earlier pregame dossier',()=>{
  const injuries={status:'verified',source:'ESPN NHL',
    feedUpdatedAt:'2026-11-15T20:30:00Z',checkedAt:'2026-11-15T20:30:00Z',
    home:{matched:true,injuries:[]},away:{matched:true,injuries:[]}}
  const game=buildNhlResearchHandoff(makeDossier(),null,injuries).games[0]
  assert.equal(game.evidenceModules.J.state,'missing')
  assert.equal(game.evidenceModules.J.data,null)
})
