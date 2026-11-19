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

test('news stage exposes the verified event-bound ESPN preview excerpt',async()=>{
  const newsSource=async input=>{
    const url=String(input),response=await source(input)
    if(!url.includes('/summary?'))return response
    const body=await response.json()
    body.article={gameId:fixture.eventId,headline:'Event preview',
      description:'Bilateral pregame context',published:'2026-11-17T14:00:00Z',
      source:'ESPN Preview',story:'<p>Recent form and injuries are discussed.</p>',
      links:{api:{self:{href:'https://content.core.api.espn.com/v1/sports/news/99'}}}}
    return Response.json(body)
  }
  const result=await progressiveSportsStage(fixture,'news','injury report',newsSource,now,{})
  assert.equal(result.evidence.eventArticle.status,'event-bound')
  assert.equal(result.uiBlock.props.rows[0].label,'ESPN · artículo vinculado al evento')
  assert.match(result.uiBlock.props.rows[0].note,/Recent form and injuries/)
  assert.equal(result.uiBlock.props.rows[0].url,
    'https://content.core.api.espn.com/v1/sports/news/99')
})

test('an empty NBA player dossier is explicitly pending and escalates outside ESPN',async()=>{
  const result=await progressiveSportsStage(fixture,'rosters',
    'get both teams season stats and gamelogs',source,now,{})
  const rows=result.uiBlock.props.rows
  assert.equal(result.stage,'rosters')
  assert.equal(rows[1]?.label,'Jugadores con estadísticas individuales observadas')
  assert.equal(rows[1]?.state,'pending')
  assert.ok(result.missing.some(x=>/Estadísticas individuales/u.test(x)))
  assert.ok(result.sourceEscalation?.mustOpenOriginals)
  assert.ok(result.sourceEscalation?.targets.length>0)
  assert.equal(result.nextStage,'availability')
})

test('roster pages preserve all recovered player identities and do not advance early',async()=>{
  const rosterSource=async input=>{
    if(String(input).includes('/scoreboard?'))return Response.json({events:[{
      id:fixture.eventId,date:fixture.kickoff,
      status:{type:{state:'pre'}},
      competitions:[{id:fixture.eventId,date:fixture.kickoff,competitors:[
        {homeAway:'home',team:{id:'1',displayName:fixture.home}},
        {homeAway:'away',team:{id:'2',displayName:fixture.away}},
      ]}],
    }]})
    const team=String(input).match(/\/teams\/(1|2)\/roster/u)?.[1]
    if(!team)return source(input)
    return Response.json({athletes:[{items:Array.from({length:8},(_,i)=>({
      id:team+String(i),displayName:'Player '+team+' '+String(i+1),
      position:{abbreviation:'F'},
    }))}]})
  }
  const first=await progressiveSportsStage(fixture,'rosters',undefined,rosterSource,now,{})
  assert.equal(first.nextStage,'rosters')
  assert.equal(first.nextPlayerOffset,6)
  assert.equal(first.evidence.teamComparison.home.players.length,6)
  const last=await progressiveSportsStage(fixture,'rosters',undefined,rosterSource,now,{},6)
  assert.equal(last.nextStage,'availability')
  assert.equal(last.nextPlayerOffset,null)
  assert.deepEqual(last.evidence.teamComparison.home.players.map(p=>p.name),['Player 1 7','Player 1 8'])
})
