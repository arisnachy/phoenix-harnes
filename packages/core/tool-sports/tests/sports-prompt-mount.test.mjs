import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.ts'

test('mounted sports guidance covers evidence and ESPN odds only for sports requests', () => {
  const sections = []
  const registeredTools = []
  const ctx = {
    systemPrompt: { section: section => sections.push(section) },
    tools: { register: tool => registeredTools.push(tool) },
    effect() {},
    get() { throw new Error('tool execution is not expected during apply') },
  }

  apply(ctx)

  const section = sections.find(item => item.name === 'tool:sports')
  assert.ok(section)
  assert.equal(section.order, 118)

  const sportsGuidance = section.text({
    incomingUserText: 'Dame un ticket de fútbol',
    agent: { session: { events: [] } },
  })
  assert.match(sportsGuidance, /INVESTIGACIÓN POR PATA/u)
  assert.match(sportsGuidance, /VALIDACIÓN ESPN ODDS/u)
  assert.match(sportsGuidance, /sports_chat_ticket_evidence_priced_auto/u)
  assert.match(sportsGuidance, /MODO TABLAS VISIBLES POR DEFECTO/u)
  assert.match(sportsGuidance, /número exacto pedido, 5 si no se especifica/u)
  assert.match(sportsGuidance, /no elijas por fórmula, puntos, cuota/u)
  assert.match(sportsGuidance, /borrador rápido usa sports_chat_ticket_evidence_priced_auto una vez/u)
  assert.doesNotMatch(sportsGuidance, /solo cuando se solicite un atajo rápido/u)
  assert.match(sportsGuidance, /no permite garantizar un ganador/u)

  assert.equal(section.text({
    incomingUserText: 'Arregla el historial del router',
    agent: { session: { events: [] } },
  }), '')
  assert.ok(registeredTools.some(tool => tool.name === 'sports_chat_ticket_evidence_priced_auto'))
})

test('expert closure cannot count a stage executed in a different session',async t=>{
  const registered=[]
  apply({systemPrompt:{section(){}},tools:{register(tool){registered.push(tool)}},
    effect(){},get(){return undefined}})
  const stage=registered.find(tool=>tool.name==='sports_chat_research_stage')
  const quote=registered.find(tool=>tool.name==='sports_chat_ticket_model_chosen')
  const fixture={sport:'basketball',league:'nba',eventId:'4010002',
    date:'2026-11-19',home:'Home Team',away:'Away Team',kickoff:'2026-11-20T01:00:00Z'}
  t.mock.method(Date,'now',()=>Date.parse('2026-11-19T12:00:00Z'))
  t.mock.method(globalThis,'fetch',async input=>String(input).includes('/summary?')
    ?Response.json({header:{competitions:[{date:fixture.kickoff,competitors:[
      {homeAway:'home',team:{id:'1',displayName:fixture.home}},
      {homeAway:'away',team:{id:'2',displayName:fixture.away}},
    ]}]}}):Response.json({events:[]}))
  const sessionA={agent:{session:{}},signal:new AbortController().signal}
  const sessionB={agent:{session:{}},signal:new AbortController().signal}
  await stage.execute({...fixture,stage:'teams'},sessionA)
  const request={requestedCount:5,legs:[{...fixture,pick:'home',
    reason:'Análisis cualitativo de los datos recibidos.',
    researchEvidence:{eventId:fixture.eventId,homeRosterCount:10,awayRosterCount:10,
      reviewedStages:['teams','rosters','availability','context','news'],
      observedFacts:['Primer hecho declarado','Segundo hecho declarado','Tercer hecho declarado']},
  }]}
  const first=JSON.parse(await quote.execute(request,sessionA))
  const second=JSON.parse(await quote.execute(request,sessionB))
  const gaps=result=>result.finalizationMissing.find(item=>item.includes('herramientas'))
  assert.match(gaps(first),/rosters, availability, context, news/u)
  assert.doesNotMatch(gaps(first),/teams/u)
  assert.match(gaps(second),/teams, rosters, availability, context, news/u)
  assert.equal(second.finalReady,false)
})
