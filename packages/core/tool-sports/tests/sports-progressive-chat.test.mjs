import {test} from 'node:test'
import assert from 'node:assert/strict'
import {progressiveSportsStage,summarizeSportsPlayer} from '../src/sports-progressive-chat.ts'
const now=Date.parse('2026-11-17T15:00:00Z')
const fixture={sport:'basketball',league:'nba',eventId:'4010001',
  date:'2026-11-17',home:'Home Team',away:'Away Team',
  kickoff:'2026-11-18T01:00:00Z'}
const logo='https://a.espncdn.com/i/teamlogos/nba/500/abc.png'
const headshot='https://a.espncdn.com/i/headshots/nba/players/full/4.png'
const source=async(input)=>{
  const url=String(input)
  const teams=[{homeAway:'home',team:{id:'1',displayName:'Home Team',
    abbreviation:'HOM',logo}},
  {homeAway:'away',team:{id:'2',displayName:'Away Team',
    abbreviation:'AWY'}}]
  let payload={}
  if(url.includes('/summary?'))payload={header:{competitions:[{
    date:fixture.kickoff,competitors:teams}]},gameInfo:{
      venue:{fullName:'Indoor Arena',indoor:true,address:{city:'Test City'}}}}
  if(url.includes('/teams/1/roster'))payload={athletes:[{athlete:{
    id:'4',displayName:'Real Player',position:{abbreviation:'PG'},
    headshot:{href:headshot}}}]}
  if(url.includes('/teams/2/roster'))payload={athletes:[{athlete:{
    id:'5',displayName:'Other Player',position:{abbreviation:'C'}}}]}
  return new Response(JSON.stringify(payload),{status:200,
    headers:{'content-type':'application/json'}})
}
test('first stage publishes source-grounded bilateral team table without scores',async()=>{
  const result=await progressiveSportsStage(fixture,'teams',undefined,source,now,{})
  assert.equal(result.uiBlock.component,'sports_research_table')
  assert.equal(result.stage,'teams')
  assert.equal(result.nextStage,'rosters')
  assert.equal(result.uiBlock.props.home.logo,logo)
  assert.equal(result.uiBlock.props.rows[0].home,'Home Team')
  assert.equal(result.uiBlock.props.rows[0].away,'Away Team')
  assert.match(result.uiBlock.props.note,/No se|no demuestra|no afecta/i)
  assert.equal('confidence' in result.uiBlock.props,false)
  assert.equal('winner' in result.uiBlock.props,false)
})
test('past fixtures cannot request modern injury/odds as if they were pregame',async()=>{
  const old={...fixture,kickoff:'2026-11-16T01:00:00Z'}
  await assert.rejects(progressiveSportsStage(old,'teams',undefined,source,now,{}),
    /partido futuro/)
})
test('invalid stage and unverified IDs cannot be used to invent a table',async()=>{
  await assert.rejects(progressiveSportsStage(
    {...fixture,eventId:'fake'},'teams',undefined,source,now,{}),/ID ESPN/)
  await assert.rejects(progressiveSportsStage(
    fixture,'winner-scores',undefined,source,now,{}),/ID ESPN/)
})

test('athlete rows expose original stats, verified starter state and home/away splits',()=>{
  const value=summarizeSportsPlayer({
    name:'Jugador Oficial',role:'PG',dataStatus:'Disponible en roster',
    starterConfirmed:false,
    stats:[{name:'PTS',value:'21'},{name:'AST',value:'7'},
      {name:'REB',value:'5'},{name:'MIN',value:'32'}],
    splits:[{name:'Home PTS',value:'24'},{name:'Away PTS',value:'19'}],
    recent:[{name:'Game 1',value:'23 PTS'}],
  })
  assert.match(value,/titular sin confirmar/)
  for(const expected of ['PTS: 21','AST: 7','REB: 5','MIN: 32',
    'Home PTS: 24','Away PTS: 19','Game 1: 23 PTS'])
    assert.ok(value.includes(expected),'falta '+expected)
})

test('availability with missing primary data publishes a research escalation',async()=>{
  const result=await progressiveSportsStage(fixture,'availability',
    'confirm injury report and starting five',source,now,{})
  assert.equal(result.stage,'availability')
  assert.equal(result.uiBlock.component,'sports_research_table')
  assert.ok(result.sourceEscalation)
  assert.equal(result.sourceEscalation.mustOpenOriginals,true)
  assert.ok(result.sourceEscalation.targets.some(x=>x.provider==='NBA oficial'))
  assert.match(result.instruction,/sourceEscalation/)
})
