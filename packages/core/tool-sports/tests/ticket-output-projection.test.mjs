import test from 'node:test'
import assert from 'node:assert/strict'
import { projectDirectedTicketResearch,projectPricedTicketForModel } from '../src/ticket-output-projection.ts'

test('directed recovery publishes bilateral findings when the dossier stays partial',()=>{
  const fixture={eventId:'401909308',sport:'basketball',league:'nba',date:'2026-11-20',
    home:'Detroit Pistons',away:'Toronto Raptors',kickoff:'2026-11-21T00:30:00Z'}
  const team=(name,result)=>({name,recentResults:[result],teamStats:[],players:[]})
  const injury={athlete:'Cade Cunningham',status:'Questionable',reportedAt:'2026-11-20T18:08:00Z'}
  const report=projectDirectedTicketResearch(fixture,{
    ...fixture,status:'incomplete',checkedAt:'2026-11-20T18:30:00Z',
    verifiedSteps:['Resultados ESPN'],pendingSteps:[],
    teamComparison:{home:team(fixture.home,'109–102'),away:team(fixture.away,'101–113')},
    injuryAudit:{status:'partial',source:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
      home:{injuries:[injury]},away:{injuries:[]}},
  })
  assert.equal(report.complete,false)
  assert.equal(report.state,'partial')
  assert.equal(report.uiBlock.component,'sports_research_table')
  assert.deepEqual(report.uiBlock.props.rows[0],{
    label:'Resultados recientes',home:'109–102',away:'101–113',
  })
  assert.match(report.uiBlock.props.rows.find(row=>row.label==='Disponibilidad reportada').home,
    /Cade Cunningham.*Questionable/)
})

test('six-leg model output preserves verified prices, evidence, and alternatives without full dossiers',()=>{
  const huge='Información extensa '.repeat(2000)
  const fixtures=Array.from({length:7},(_,index)=>({
    eventId:String(401234+index),sport:'basketball',league:'nba',
    home:'Local '+index,away:'Visitante '+index,kickoff:'2026-11-20T01:00:00Z',date:'2026-11-19',
  }))
  const chosen=fixtures.slice(0,6)
  const source='ESPN Site/Core'
  const dataCounts={eventsFound:6,quotedLegs:6,researchedLegs:5,approvedForBetting:0}
  const report=projectPricedTicketForModel({
    card:{component:'sports_ticket_card',version:1,props:{
      title:'Ticket de investigación',source,requestedLegs:6,combinedOdds:'18.5',note:huge,dataCounts,
      legs:chosen.map(({eventId,home,away})=>({
        eventId,event:away+' vs '+home,selection:home,price:'1.6',bookmaker:'DraftKings',
        quoteSource:source,quoteEventId:eventId,quoteAcceptedByBookmaker:false,
        rationale:huge,pendingEvidence:[huge],specialistResearch:huge,
      })),
      modelComparisonBriefs:fixtures.map(fixture=>({...fixture,teamComparison:huge})),
      selectedBilateralDossiers:huge,chatNarrative:huge,
    }},
    researchFixtures:chosen,
    specialistChecks:chosen.map(({eventId})=>({
      eventId,status:'researched',verifiedSteps:[huge],pendingSteps:[huge],
      sourceChecks:[{provider:'NBA',status:'verified',url:'https://www.nba.com/news/report',detail:huge}],
    })),
    sourceAudit:[{source,status:'ok',error:huge}],
  })
  assert.ok(Buffer.byteLength(JSON.stringify(report))<25_000)
  assert.deepEqual(report.uiBlock.props.dataCounts,dataCounts)
  assert.deepEqual(report.uiBlock.props.legs.map(leg=>leg.eventId),chosen.map(fixture=>fixture.eventId))
  assert.ok(report.uiBlock.props.legs.every(leg=>leg.quoteSource===source&&leg.quoteAcceptedByBookmaker===false))
  assert.ok(report.uiBlock.props.legs.every(leg=>!('specialistResearch' in leg)))
  assert.deepEqual(report.researchFixtures,chosen)
  assert.equal(report.modelComparisonBriefs[0].eventId,fixtures[6].eventId)
  assert.equal(report.specialistChecks[0].sourceChecks[0].url,'https://www.nba.com/news/report')
})

test('model projection retains bounded bilateral evidence for selected fixtures',()=>{
  const fixture={eventId:'401234',sport:'basketball',league:'nba',date:'2026-11-19',
    home:'Local 0',away:'Visitante 0',kickoff:'2026-11-20T01:00:00Z'}
  const report=projectPricedTicketForModel({
    card:{component:'sports_ticket_card',version:1,props:{
      title:'Ticket',source:'ESPN',requestedLegs:1,combinedOdds:'1.6',note:'n',
      dataCounts:{eventsFound:1,quotedLegs:1,researchedLegs:1,approvedForBetting:0},
      legs:[{
        eventId:fixture.eventId,price:'1.14286',
        rationale:'Forma reciente. '.repeat(16)+'Contexto completo.',
        decisionReview:{verdict:'hold',bookmakerBreakEvenPct:87.5},
        narrative:{
          eventId:fixture.eventId,selectionWhy:'Comparación bilateral.',
          favorable:['Mejor defensa'],contradictions:['Dos titulares ausentes'],
          explanationForChat:'Expediente extenso '.repeat(1000),
        },
      }],modelComparisonBriefs:[],selectedBilateralDossiers:[{
        eventId:fixture.eventId,sport:fixture.sport,league:fixture.league,
        home:fixture.home,away:fixture.away,kickoff:fixture.kickoff,
        selectedSide:'home',verifiedFacts:['roster loaded','form loaded'],
        unresolvedFacts:['official lineup pending'],
        qualitativeAvailability:{
          selectedAvailability:[{athlete:'Home Star',status:'Out',
            reportedAt:'2026-11-19T17:00:00Z',source:'roster-reconciled'}],
          rest:{selectedHours:22,opposingHours:48},
          criticalUnknowns:['official lineup pending'],
        },
        teamComparison:{
          home:{name:fixture.home,recentResults:['win'],teamStats:[{name:'wins',value:'8'}],
            players:[{name:'Home Star',role:'guard',dataStatus:'observed',starterConfirmed:true,
              stats:[{name:'pts',value:'25'}],recent:['bad-shape'],splits:['home']}]},
          away:{name:fixture.away,recentResults:['loss'],teamStats:[{name:'wins',value:'4'}],
            players:[{name:'Away Star',role:'guard',dataStatus:'observed',starterConfirmed:false,
              stats:[{name:'pts',value:'19'}],recent:['good-shape'],splits:['away']}]},
        },
      }],
    }},
    researchFixtures:[fixture],
    specialistChecks:[{eventId:fixture.eventId,status:'researched',verifiedSteps:['roster'],pendingSteps:[]}],
    sourceAudit:[],
  })
  assert.equal(report.selectedResearchBriefs.length,1)
  const brief=report.selectedResearchBriefs[0]
  assert.equal(brief.eventId,fixture.eventId)
  assert.equal(brief.teamComparison.home.rosterCount,1)
  assert.equal(brief.teamComparison.home.playersWithMetrics,1)
  assert.equal(brief.teamComparison.away.rosterCount,1)
  assert.equal(brief.teamComparison.away.playersWithMetrics,1)
  assert.deepEqual(brief.unresolvedFacts,['official lineup pending'])
  assert.equal('playerMatchups' in brief,false)
  assert.equal(brief.fullDossierAvailable,true)
  const [leg]=report.uiBlock.props.legs
  assert.ok(leg.rationale.endsWith('Contexto completo.'))
  assert.equal(leg.bookmakerBreakEvenPct,87.5)
  assert.equal(leg.decisionVerdict,'hold')
  assert.deepEqual(leg.narrative.contradictions,['Dos titulares ausentes'])
  assert.equal(leg.narrative.explanationForChat,'Comparación bilateral.')
  assert.equal(brief.availability.selected[0].athlete,'Home Star')
  assert.equal(brief.availability.rest.selectedHours,22)
})
