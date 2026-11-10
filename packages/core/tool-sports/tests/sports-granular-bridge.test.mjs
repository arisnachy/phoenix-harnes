import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nflDeepSignals,nhlDeepSignals,mlbDeepSignals,
 soccerDeepSignals,tennisDeepSignals} from '../src/sports-granular-bridge.ts'

test('NHL candidate goalie is not verified starting goalie',()=>{
 const x=nhlDeepSignals({
  fixture:{id:'102',date:'2026-11-11T01:00:00Z',venue:'Arena',
   home:{name:'Club A'},away:{name:'Club B'}},
  form:{home:{games:5,wins:3,losses:2,homeGames:4,restHours:72},
   away:{games:6,wins:4,losses:2,awayGames:3,restHours:48}},
  players:{home:[{name:'Player'}],away:[{name:'Player'}]},
  goalieCandidates:{home:[{name:'Candidate G'}],away:[{name:'Candidate H'}]},
  markets:[],
 })
 assert.equal(x.H01.state,'verified')
 assert.equal(x.H07.state,'partial')
 assert.match(x.H07.detail,/NINGUNO confirmado/)
 assert.equal(x.U08.state,'missing')
})
test('MLB pitcher and 72h bullpen usage remain partial until complete proof',()=>{
 const x=mlbDeepSignals({
  fixture:{gamePk:5432,date:'2026-10-15T22:10:00Z',
   venue:{name:'Ballpark'},home:{name:'Home'},away:{name:'Away'}},
  teamForm:{home:{games:6,home:{wins:3}},away:{games:8,away:{wins:5}}},
  starters:{home:{name:'Pitcher A',season:{era:'3.50',whip:'1.16'}},
   away:{name:'Pitcher B',season:{era:'3.90',whip:'1.31'}}},
  rosters:{home:[{name:'Batter A'}],away:[{name:'Batter B'}]},
  matchups:[{bvp:null}],bullpen:{
   home:[{reliefUsage72h:[{date:'2026-10-14'}]}],
   away:[{reliefUsage72h:[{date:'2026-10-14'}]}]},
  lineupStatus:{home:'unconfirmed',away:'confirmed'},
  venue:{name:'Ballpark',roofType:'Open'},weather:null,
  injuries:[],odds:[],
 })
 assert.equal(x.M01.state,'verified')
 assert.equal(x.M04.state,'partial')
 assert.match(x.M04.detail,/ERA 3.50/)
 assert.equal(x.M08.state,'partial')
 assert.equal(x.M09.state,'missing')
 assert.equal(x.U08.state,'missing')
})
test('NFL verified identity does not certify QB CPOE or 44 starters',()=>{
 const x=nflDeepSignals({
  event:{eventId:'8111',scheduledAt:'2026-11-11T01:00:00Z',
   venue:'Covered Stadium',home:{name:'Home'},away:{name:'Away'}},
  teams:{home:{name:'Home',recent:[1,2,3],
     teamStats:[{name:'EPA/play',value:'0.15'}],
     roster:[{role:'quarterback',name:'QB One',
       confirmedOffense:false,statistics:[]}],
     offenseConfirmed:3,defenseConfirmed:2},
   away:{name:'Away',recent:[1,2,3],teamStats:[],
     roster:[{role:'quarterback',name:'QB Two',
       confirmedOffense:false,statistics:[]}],
     offenseConfirmed:4,defenseConfirmed:5}},
  matchups:[{attacker:'WR'}],injuries:[],weather:null,
  markets:[],news:[],editorial:[],
 })
 assert.equal(x.N01.state,'verified')
 assert.equal(x.N03.state,'partial')
 assert.equal(x.N04.state,'partial')
 assert.equal(x.N05.state,'partial')
 assert.equal(x.U08.state,'missing')
})
test('soccer xG single observation does not certify both sides xG/xGA',()=>{
 const x=soccerDeepSignals({
  fixture:{eventId:'101',home:{name:'Home'},away:{name:'Away'}},
  opportunity:{scheduledAt:'2026-11-11T20:00:00Z'},
  stadium:'Stadium',teams:{home:{recent:Array(5).fill({}),roster:[{}],
   form:{homeWdl:'3-1-1'}},away:{recent:Array(6).fill({}),
   roster:[{}],form:{awayWdl:'2-2-2'}}},
  teamStatistics:[{label:'xG',value:'1.2'}],
  duels:[],lineupConfirmed:{home:false,away:false},
  injuries:[],referee:null,weather:null,markets:[],headlines:[],editorial:[],
 })
 assert.equal(x.S01.state,'verified')
 assert.equal(x.S04.state,'partial')
 assert.match(x.S04.detail,/ambos equipos por cotejar/)
 assert.equal(x.U08.state,'missing')
})
test('tennis ranking and service facts never imply calibrated model',()=>{
 const x=tennisDeepSignals({
  match:{matchId:'881',start:'2026-11-11T16:00:00Z',
   tournament:'Tournament',round:'Round of 16',surface:'hard',
   players:[{name:'A'},{name:'B'}]},
  coverage:{rankCount:2},
  players:[{lastMatches:Array(5).fill({}),
   statistics:[{name:'First serve points won',value:'70%'}]},
   {lastMatches:Array(5).fill({}),
   statistics:[{name:'First serve points won',value:'69%'}]}],
  markets:[],
 })
 assert.equal(x.T01.state,'verified')
 assert.equal(x.T03.state,'partial')
 assert.equal(x.T04.state,'partial')
 assert.equal(x.U08.state,'missing')
})
