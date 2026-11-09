import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inspectDepthPayload,readNbaNflDepthPreviews,compareNbaNflCandidate,compareIndividualMetrics,
  nbaNflPublicSources} from '../src/nba-nfl-keyless-closure.ts'

const team=(name,wins,losses,margin=null,rest=72,starter=false)=>({
  name,wins,losses,games:wins+losses,netMarginPerGame:margin,restHours:rest,
  confirmedStarter:starter,
})
const json=(x,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{'content-type':'application/json'}})

test('Bills 3-1 against 3-1 is not enough to recommend a winner',()=>{
  const x=compareNbaNflCandidate('nfl',
    team('Buffalo Bills',3,1),team('Opponent',3,1),'home')
  assert.equal(x.decision,'discard')
  assert.equal(x.argumentsFor.length,0)
  assert.match(x.argumentsAgainst.join(' '),/3-1 vs 3-1|3-1 vs 3-1/u)
  assert.ok(x.missing.some(y=>/QB1/.test(y)))
  assert.equal(x.approvedForBetting,false)
})

test('two independent comparative edges still leave uncertain starters explicit',()=>{
  const x=compareNbaNflCandidate('nba',
    team('Wolves',8,2,10,96),team('Jazz',2,8,-9,48),'home')
  assert.equal(x.decision,'consider')
  assert.ok(x.argumentsFor.length>=2)
  assert.ok(x.missing.some(y=>/Quintetos/.test(y)))
  assert.equal(x.calibrated,false)
})

test('inferior form never becomes a positive recommendation without other evidence',()=>{
  const x=compareNbaNflCandidate('nfl',
    team('Weak',1,7,-14,30),team('Strong',7,1,9,108),'home')
  assert.equal(x.decision,'discard')
  assert.ok(x.argumentsAgainst.length>=2)
})

test('projected QB from ESPN remains a PROJECTION, not confirmed',()=>{
  const payload={team:{id:'2'},depthchart:[
    {position:{abbreviation:'QB'},athletes:[
      {rank:1,athlete:{displayName:'Projected Quarterback'}},
      {rank:2,athlete:{displayName:'Backup QB'}},
    ]},
  ]}
  const found=inspectDepthPayload(payload,'nfl','2')
  assert.equal(found.state,'observed')
  assert.equal(found.qb,'Projected Quarterback')
  assert.equal(inspectDepthPayload(payload,'nfl','3').state,'schema-mismatch')
  assert.ok(nbaNflPublicSources.some(s=>s.id==='nfl-official-injuries'
    &&s.kind==='official-reference'))
  assert.ok(nbaNflPublicSources.some(s=>s.id==='nba-live-scoreboard'))
})

test('both depth chart endpoints are fetched and neither proves lineup',async()=>{
  const called=[]
  const mock=async u=>{
    called.push(String(u))
    if(String(u).endsWith('/teams/2/depthcharts'))return json({
      team:{id:'2'},depthcharts:[{position:'PG',athletes:[
        {rank:1,athlete:{displayName:'Point Guard'}}]}]})
    if(String(u).endsWith('/teams/15/depthcharts'))return json({
      team:{id:'15'},depthcharts:[{position:'C',athletes:[
        {rank:1,athlete:{displayName:'Center'}}]}]})
    return json({},503)
  }
  const [home,away]=await readNbaNflDepthPreviews('nba',['2','15'],mock)
  assert.equal(called.length,2)
  assert.equal(home.state,'observed')
  assert.equal(away.state,'observed')
  assert.equal(home.confirmedStarters,false)
  assert.equal(away.confirmedStarters,false)
  assert.match(home.url,/basketball\/nba\/teams\/2\/depthcharts$/)
})

test('HTTP 403/429 and empty JSON do not turn into verified players',async()=>{
  const forbidden=await readNbaNflDepthPreviews('nfl',['2','15'],
    async(u)=>json({},String(u).includes('/2/')?403:429))
  assert.deepEqual(forbidden.map(x=>x.state),['unavailable','unavailable'])
  assert.deepEqual(forbidden.map(x=>x.httpStatus),[403,429])
  const empty=await readNbaNflDepthPreviews('nba',['2','15'],
    async()=>json({}))
  assert.deepEqual(empty.map(x=>x.state),['empty','empty'])
  assert.ok(empty.every(x=>x.potentialNames.length===0))
})

test('invalid team ids never produce arbitrary URLs or network calls',async()=>{
  const rows=await readNbaNflDepthPreviews('nfl',['../secrets','x'],
    async()=>{throw Error('must not access external endpoints')})
  assert.ok(rows.every(x=>x.state==='unavailable'))
  assert.ok(rows.every(x=>x.url===''))
})

test('unselected team cannot be assigned its opponent statistics',()=>{
  const x=compareNbaNflCandidate('nba',
    team('Home',7,2,10),team('Away',2,7,-12),null)
  assert.equal(x.decision,'pending')
  assert.ok(x.argumentsFor.length===0)
  assert.ok(x.missing.length>0)
})

test('athlete stats require same named metric on both rival rosters',()=>{
  const home=[{name:'Home Guard',position:'PG',stats:[
    {name:'Points per game',value:'28.2'}]}]
  const away=[{name:'Away Guard',position:'PG',stats:[
    {name:'Points per game',value:'20.5'}]}]
  const data=compareIndividualMetrics('nba',home,away)
  assert.equal(data.observations.length,1)
  assert.match(data.observations[0],/28.2 vs Away Guard 20.5/)
  assert.ok(data.missing.length===0)
})
test('individual NBA points total is not falsely compared to PPG',()=>{
  const data=compareIndividualMetrics('nba',[
    {name:'Home',position:'SG',stats:[{name:'Points',value:'100'}]},
  ],[{name:'Away',position:'SG',stats:[{name:'Points per game',value:'25'}]}])
  assert.deepEqual(data.observations,[])
  assert.equal(data.missing.length,1)
})
test('NFL quarterback season passer rating can only be compared with same metric',()=>{
  const data=compareIndividualMetrics('nfl',[
    {name:'Home QB',position:'QB',stats:[{name:'Passer Rating',value:'105.8'}]},
  ],[{name:'Away QB',position:'QB',stats:[{name:'Passer Rating',value:'95.2'}]}])
  assert.equal(data.observations.length,1)
  assert.match(data.observations[0],/105.8/)
})
