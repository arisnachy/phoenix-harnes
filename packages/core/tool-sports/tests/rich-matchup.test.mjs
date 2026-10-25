import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chatGames} from '../src/sports.ts'
import {enrichMlbMatch} from '../src/mlb-matchup.ts'
import {researchMlbTrend} from '../src/mlb-research.ts'

const fixture=(value)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}})
const schedule={dates:[{games:[{gamePk:849802,gameDate:'2026-10-25T00:00:00Z',
  seriesDescription:'World Series',seriesGameNumber:2,status:{detailedState:'Pre-Game',abstractGameState:'Preview'},
  venue:{name:'American Family Field'},teams:{
    away:{team:{id:139,name:'Tampa Bay Rays'},score:0,probablePitcher:{id:678021,fullName:'Starter Away'}},
    home:{team:{id:158,name:'Milwaukee Brewers'},score:0,probablePitcher:{id:678022,fullName:'Starter Home'}},
  }}]}]}
const box={teams:{away:{battingOrder:[101,102],players:{
  ID101:{person:{id:101,fullName:'Bateador A'},position:{abbreviation:'DH'},seasonStats:{batting:{avg:'.302',homeRuns:21,rbi:77}}},
  ID102:{person:{id:102,fullName:'Bateador B'},position:{abbreviation:'LF'},seasonStats:{batting:{avg:'.280'}}}}},
home:{battingOrder:[103],players:{ID103:{person:{id:103,fullName:'Bateador C'},position:{abbreviation:'SS'}}}}}}
const roster={roster:[{person:{id:678021,fullName:'Starter Away'},position:{type:'Pitcher'}},{person:{id:678032,fullName:'Reliever A'},position:{type:'Pitcher'}},{person:{id:678033,fullName:'Reliever B'},position:{type:'Pitcher'}}]}
const pitching={stats:[{splits:[{stat:{era:'2.91',whip:'1.02',strikeOuts:159,inningsPitched:'153.1'}}]}]}
const request=async url=>{
  if(url.includes('/schedule?'))return fixture(schedule)
  if(url.includes('/boxscore'))return fixture(box)
  if(url.includes('/roster?'))return fixture(roster)
  if(url.includes('/stats?'))return fixture(pitching)
  return fixture({events:[]})
}
test('ESPN-inspired MLB: logos, 2 pitcher portraits, confirmed-only boxscore and bullpen metrics',async()=>{
  const out=await chatGames('baseball','mlb','2026-10-24',{},request)
  assert.equal(out.count,1)
  const card=out.items[0]
  assert.equal(card.component,'sports_game_card')
  assert.equal(card.props.home.label,'Milwaukee Brewers')
  assert.equal(card.props.away.label,'Tampa Bay Rays')
  assert.equal(card.props.home.score,undefined,'no synthetic 0:0 for a pregame event')
  assert.equal(card.props.status,'Pre-Game')
  assert.equal(card.props.subtitle,'World Series · Juego 2')
  assert.match(card.props.home.logo,/www.mlbstatic.com\/team-logos\/158.svg/)
  assert.match(card.props.away.logo,/www.mlbstatic.com\/team-logos\/139.svg/)
  assert.equal(card.props.pitchers.length,2)
  assert.match(card.props.pitchers[0].image,/img.mlbstatic.com/)
  assert.match(card.props.pitchers[0].stats,/WHIP 1.02/)
  assert.equal(card.props.lineups.length,2)
  assert.equal(card.props.lineups[0].players[0].name,'Bateador A')
  assert.equal(card.props.lineups[0].confirmed,false,'two batters do not imply official nine-player lineup')
  assert.equal(card.props.bullpen.length,2)
  assert.ok(card.props.bullpen[0].pitchers[0].stats.includes('ERA'))
  assert.ok(!JSON.stringify(card).includes('Equipo visitante · ID'),'remove technical filler IDs')
})
test('partial MLB feed: no invented lineup or bullpen and operator disable media',async()=>{
  const empty=async url=>{
    if(url.includes('/schedule?'))return fixture(schedule)
    return new Response('{}',{status:503})
  }
  const out=await chatGames('baseball','mlb','2026-10-24',{PHOENIX_SPORTS_IMAGES_DISABLED:'1'},empty)
  const card=out.items[0]
  assert.equal(card.props.home.logo,undefined)
  assert.equal(card.props.pitchers[0]?.image,undefined)
  assert.equal(card.props.lineups[0]?.confirmed,false)
  assert.deepEqual(card.props.bullpen[0].pitchers,[])
  assert.match(card.props.note,/Alineaciones/)
})
test('direct match enrichment does not trust arbitrary IDs or treat missing facts as confirmed',async()=>{
  const report=await enrichMlbMatch(-12,158,139,'Home','Away',{},2026,{},request)
  assert.equal(report.pitchers.length,0)
  assert.match(report.notes[0],/inválido/)
})

test('untrusted MLB roster and repeated batting IDs do not create invented players or a confirmed lineup',async()=>{
  const badBox={teams:{away:{battingOrder:Array(9).fill(101),players:{
    ID101:{person:{id:101,fullName:'Único bateador'},position:{abbreviation:'DH'}},
  }},home:{battingOrder:[],players:{}}}}
  const badRoster={roster:[
    {person:{id:678032},position:{type:'Pitcher'}},
    {person:{id:678033,fullName:'Relevista identificado'},position:{type:'Pitcher'}},
  ]}
  const badSource=async url=>{
    if(url.includes('/boxscore'))return fixture(badBox)
    if(url.includes('/roster?'))return fixture(badRoster)
    if(url.includes('/stats?'))return fixture(pitching)
    return fixture({})
  }
  const report=await enrichMlbMatch(849802,158,139,'Local','Visita',{},2026,{},badSource)
  assert.equal(report.lineups[0].confirmed,false,'nine repeated IDs must not confirm a lineup')
  assert.equal(report.lineups[0].players.length,1,'each published batter appears only once')
  assert.deepEqual(report.bullpen[0].pitchers.map(p=>p.name),['Relevista identificado'])
  assert.ok(!JSON.stringify(report).includes('No confirmado'),'do not synthesize anonymous roster entries')
})

test('MLB trends require complete published season statistics and never invent a favorite',async()=>{
  const complete={records:[{teamRecords:[
    {team:{id:139},wins:92,losses:70,runsScored:780,runsAllowed:665},
    {team:{id:158},wins:70,losses:92,runsScored:640,runsAllowed:770},
  ]}]}
  const trend=await researchMlbTrend(139,158,2026,'Local','Visita',async()=>fixture(complete))
  assert.equal(trend.favorite,'Local')
  assert.match(trend.method,/no es una predicción calibrada/)
  assert.equal(trend.evidence.length,2)
  const missing={records:[{teamRecords:[
    {team:{id:139},wins:0,losses:0,runsScored:780,runsAllowed:665},
    {team:{id:158},wins:70,losses:92,runsScored:640,runsAllowed:770},
  ]}]}
  const unavailable=await researchMlbTrend(139,158,2026,'Local','Visita',async()=>fixture(missing))
  assert.equal(unavailable,undefined,'0-0 standings cannot support a numeric trend')
})
