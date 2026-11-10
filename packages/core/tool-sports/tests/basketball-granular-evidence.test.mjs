import {test} from 'node:test'
import assert from 'node:assert/strict'
import {auditBasketballGranularEvidence}
  from '../src/basketball-granular-evidence.ts'

const team=(name,stats,number=8)=>({
 name,wins:5,losses:3,
 lastGames:Array.from({length:number},(_,i)=>({
  eventId:String(i+1),date:'2026-11-0'+(i+1),opponent:'Test opponent',
  pts:110,allowed:105,location:'home'})),
 teamStats:stats.map(([name,value])=>({name,value})),
 roster:[{name:'Real Player',stats:[{name:'Points',value:'25.0'}],
   lastGames:[{name:'Recent Game',value:'PTS 25'}]}],
 quintetConfirmed:false,
})
const all=[['Offensive Rating','116.7'],['Defensive Rating','111.2'],
 ['Net Rating','5.5'],['Pace','99.5'],
 ['Points Per Game','118.9'],['Effective Field Goal Percentage','54.0']]
const dossier=(a=all,b=all)=>({
 fixture:{eventId:'401999001',start:'2026-11-11T00:30:00Z'},
 venue:'Madison Square Garden',
 teams:{home:team('New York Knicks',a),away:team('Milwaukee Bucks',b)},
 context:{restHours:{home:72,away:48},
   h2h:{games:2,homeWins:1,awayWins:1}},
 matchups:[{attacker:'Point guard',opponents:[]}],
 news:[{headline:'Team news'}],editorial:[],markets:[{bookmaker:'DraftKings'}],
})
test('only exact four metrics on both sides complete original B04',()=>{
 const x=auditBasketballGranularEvidence(dossier())
 assert.equal(x.U01.state,'verified')
 assert.equal(x.B01.state,'verified')
 assert.equal(x.B04.state,'verified')
 assert.match(x.B04.detail,/Offensive Rating 116.7/)
 assert.match(x.B04.detail,/Pace 99.5/)
 assert.equal(x.B05.state,'partial','missing other shooting/allowed stats')
 assert.equal(x.B06.state,'partial','individual partial is not all-stars approval')
 assert.equal(x.B07.state,'partial','roster is never proof of on-off/lineups')
 assert.equal(x.B11.state,'missing','no calibrated ML+spread+total model')
 assert.equal(x.U08.state,'missing')
 assert.equal(x.U02.state,'partial','schedule strength not independently observed')
 assert.equal(x.B02.state,'partial','less than 20 recent games')
})
test('one rival missing Pace cannot get the verified checkmark',()=>{
 const y=auditBasketballGranularEvidence(dossier(all,all.filter(x=>x[0]!=='Pace')))
 assert.equal(y.B04.state,'partial')
 assert.match(y.B04.detail,/pace=sin dato/)
})
test('unknown venue and absent individual metrics remain visibly incomplete',()=>{
 const o=dossier([],[])
 o.venue='Sede sin verificar'
 o.teams.home.roster=[]
 o.teams.away.roster=[]
 o.context.restHours={home:null,away:null}
 o.markets=[]
 const x=auditBasketballGranularEvidence(o)
 assert.equal(x.U01.state,'partial')
 assert.equal(x.B04.state,'missing')
 assert.equal(x.B05.state,'missing')
 assert.equal(x.B06.state,'missing')
 assert.equal(x.B09.state,'missing')
})
