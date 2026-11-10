import {test} from 'node:test'
import assert from 'node:assert/strict'
import {composeTicketLegNarrative,enrichSpecialistNarrative} from '../src/sports-ticket-narrative.ts'

const event={eventId:'901',sport:'hockey',league:'nhl',
  home:'Montreal Canadiens',away:'Toronto Maple Leafs',
  kickoff:'2026-11-10T23:00:00Z',pick:'home'}
const leg={rationale:'Montreal 7V-3D ante rivales recientes en muestra ESPN.',
  legWinProbabilityPercent:64.4,legProbabilitySource:'exploratory-recent-form',
  historicalContext:{opponentGames:2,opponentWins:1,opponentLosses:1,
    venueName:'Bell Centre',venueGames:3,venueWins:2,venueLosses:1,scannedRecent:5}}

test('narrative shows measured venue / H2H samples, not invented referee favor',()=>{
  const result=composeTicketLegNarrative(event,leg)
  assert.equal(result.selected,'Montreal Canadiens')
  assert.equal(result.venue.name,'Bell Centre')
  assert.equal(result.venue.venueSplit,'verified')
  assert.equal(result.venue.games,3)
  assert.equal(result.directOpponentHistory.games,2)
  assert.equal(result.directOpponentHistory.wins,1)
  assert.equal(result.referee.bias,'not-assessed')
  assert.equal(result.weather.status,'unavailable')
  assert.equal(result.percentage.kind,'exploratory-recent-form')
  assert.equal(result.percentage.value,64.4)
  assert.match(result.explanationForChat,/H2H|Historial ante este oponente/)
  assert.match(result.explanationForChat,/no predicci.n|historial parcial/iu)
  assert.equal(result.status,'conditional')
})

test('empty or contradictory context never generates images, injuries or percentages',()=>{
  const result=composeTicketLegNarrative(event,{rationale:'Prueba'},
    {eventId:'DIFFERENT',sport:'hockey',league:'nhl',
      venue:{name:'Fake arena',city:'Bad'},headlines:[{
        headline:'False',published:'2026-11-09T09:00:00Z',source:'ESPN News',
        articleUrl:'https://evil.example/story',imageUrl:'https://evil.example/photo'
      }]})
  assert.equal(result.news.length,0)
  assert.equal(result.venue.name,null)
  assert.equal(result.imagery.imageUrl,null)
  assert.equal(result.percentage.value,null)
  assert.equal(result.status,'conditional')
})
test('safe ESPN article and image carry attribution, not a confirmed external pick',()=>{
  const context={eventId:'901',sport:'hockey',league:'nhl',
    venue:{name:'Bell Centre',city:'Montreal'},
    officials:[{name:'Verified Referee',role:'Referee'}],
    weather:{status:'not-applicable',description:'Arena indoors'},
    sources:[{name:'ESPN match summary',status:'verified',records:2}],
    headlines:[
      {headline:'NHL match preview',published:'2026-11-09T08:00:00Z',
        source:'ESPN News',articleUrl:'https://www.espn.com/nhl/story/_/id/10000',
        imageUrl:'https://a.espncdn.com/photo/2026/1109/hockey.jpg'},
      {headline:'Untrusted photo',published:'2026-11-09T08:00:00Z',
        source:'ESPN News',articleUrl:'javascript:alert(1)',
        imageUrl:'http://unsafe.example/photo.jpg'},
    ]}
  const result=composeTicketLegNarrative(event,leg,context)
  assert.equal(result.news.length,2)
  assert.equal(result.news[0].articleUrl,'https://www.espn.com/nhl/story/_/id/10000')
  assert.match(result.imagery.imageUrl,/espncdn\.com/)
  assert.equal(result.imagery.attribution,'ESPN News')
  assert.equal(result.news[1].imageUrl,null)
  assert.equal(result.news[1].articleUrl,null)
  assert.deepEqual(result.referee.names,['Verified Referee'])
  assert.equal(result.referee.bias,'not-assessed')
  assert.equal(result.sources[0].status,'verified')
})
test('specialist critical gaps remain conditional and market share never claims calibration',()=>{
  const prior=composeTicketLegNarrative(event,leg)
  const specialist={eventId:'901',sport:'hockey',league:'nhl',
    status:'incomplete',verifiedSteps:['Power play checked'],
    pendingSteps:['No confirmed starting goalie'],checklist:{
      complete:false,criticalPending:['Two confirmed goalies']},
    sourceChecks:[{status:'conflict',detail:'Opposite team found',provider:'TheSportsDB'}]}
  const updated=enrichSpecialistNarrative(prior,specialist,58.1)
  assert.equal(updated.percentage.kind,'market-no-vig')
  assert.equal(updated.percentage.value,58.1)
  assert.match(updated.percentage.warning,/no probabilidad de acierto calibrada/i)
  assert.equal(updated.status,'conditional')
  assert.ok(updated.contradictions.some(x=>/confirmed|goalie|portero/i.test(x)))
  assert.match(updated.explanationForChat,/Especialista:/)
  assert.match(updated.explanationForChat,/58\.1%/)
})
test('a complete checklist without a verified availability report stays conditional',()=>{
  const original=composeTicketLegNarrative(event,{rationale:'Forma previa verificada'})
  const specialist={eventId:'901',sport:'hockey',league:'nhl',
    status:'researched',verifiedSteps:['Goalies confirmed'],pendingSteps:[],
    checklist:{complete:true,criticalPending:[]},sourceChecks:[]}
  const final=enrichSpecialistNarrative(original,specialist)
  assert.equal(final.status,'conditional')
  assert.match(final.explanationForChat,/Disponibilidad del elegido:/)
  assert.equal(final.percentage.value,null)
  assert.match(final.explanationForChat,/no disponible/)
  assert.equal(final.referee.bias,'not-assessed')
})

test('NBA injury statuses and both teams are visible in the selection defence',()=>{
  const cleveland={eventId:'9001',sport:'basketball',league:'nba',
    home:'Charlotte Hornets',away:'Cleveland Cavaliers',
    kickoff:'2026-11-09T23:00:00Z',pick:'away'}
  const prior=composeTicketLegNarrative(cleveland,
    {rationale:'Cleveland is favored by recent results; injuries must be checked.'})
  const specialist={eventId:'9001',sport:'basketball',league:'nba',
    status:'researched',verifiedSteps:['Rosters verificados'],pendingSteps:[],
    checklist:{complete:false,criticalPending:['Lesiones e inactivos']},sourceChecks:[],
    injuryAudit:{status:'verified',league:'nba',checkedAt:'2026-11-09T18:00:00Z',
      feedUpdatedAt:'2026-11-09T17:59:00Z',
      source:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
      officialSource:'https://official.nba.com/nba-injury-report-2026-27-season/',
      home:{name:'Charlotte Hornets',matched:true,injuries:[{
        team:'Charlotte Hornets',athlete:'Brandon Miller',athleteId:'2',
        status:'Out',reportedAt:'2026-11-09T17:00:00Z',
        details:'Hip',returnDate:null,source:'ESPN'}]},
      away:{name:'Cleveland Cavaliers',matched:true,injuries:[{
        team:'Cleveland Cavaliers',athlete:'Jarrett Allen',athleteId:'1',
        status:'Questionable',reportedAt:'2026-11-09T17:00:00Z',
        details:'Knee',returnDate:null,source:'ESPN'}]},
      notes:['Uno de los titulares es cuestionable']}}
  const updated=enrichSpecialistNarrative(prior,specialist)
  assert.match(updated.explanationForChat,/Jarrett Allen \(Questionable/)
  assert.match(updated.explanationForChat,/Brandon Miller \(Out/)
  assert.match(updated.explanationForChat,/Fuente de disponibilidad: ESPN verified/)
  assert.ok(updated.contradictions.some(x=>/Jarrett Allen/u.test(x)))
  assert.equal(updated.status,'conditional')
  assert.ok(updated.sources.some(x=>/ESPN lesiones de ambos/u.test(x.name)))
})

test('specialist checklist preserves the exact observed stats and ranked sources for Kira',()=>{
  const prior=composeTicketLegNarrative({
    eventId:'4',sport:'basketball',league:'nba',
    home:'Charlotte Hornets',away:'Cleveland Cavaliers',
    kickoff:'2026-11-11T01:00:00Z',pick:'away',
  },{rationale:'Form research with injuries evaluated'})
  const updated=enrichSpecialistNarrative(prior,{
    eventId:'4',sport:'basketball',league:'nba',status:'researched',
    verifiedSteps:['stats observed'],pendingSteps:['starting five'],
    checklist:{complete:false,criticalPending:['Starting five'],steps:[
      {key:'form',title:'Forma reciente',critical:true,state:'verified',
        detail:'Cleveland 4V/1D; Charlotte 2V/3D',
        sources:['ESPN scoreboard historical']},
      {key:'injuries',title:'Lesiones',critical:true,state:'verified',
        detail:'Cleveland 4; Charlotte 3',
        sources:['ESPN basketball/nba/injuries','NBA official injury report PDF']},
      {key:'starters',title:'Quintetos',critical:true,state:'partial',
        detail:'Dos quintetos sin confirmar',
        sources:['ESPN summary']},
    ]},
  })
  assert.equal(updated.researchSteps.length,3)
  assert.deepEqual(updated.researchSteps[1].sources,
    ['ESPN basketball/nba/injuries','NBA official injury report PDF'])
  assert.match(updated.explanationForChat,/Cleveland 4; Charlotte 3/)
  assert.match(updated.explanationForChat,/Rutas: ESPN basketball\/nba\/injuries/)
  assert.equal(updated.status,'conditional')
})
