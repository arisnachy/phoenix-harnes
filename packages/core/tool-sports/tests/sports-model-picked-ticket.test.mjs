import {test} from 'node:test'
import assert from 'node:assert/strict'
import {quoteKiraChosenTicket,ticketResearchChecklist,ticketExpertEvidenceChecklist} from '../src/sports-model-picked-ticket.ts'

const now=Date.parse('2026-11-17T17:00:00Z')
const leg=(eventId,overrides={})=>({
  sport:'basketball',league:'nba',eventId,date:'2026-11-17',
  home:'Home Team',away:'Away Team',kickoff:'2026-11-18T01:00:00Z',
  pick:'home',reason:'Kira contrastó jugadores, lesiones y resultados publicados.',
  ...overrides,
})
test('model controls choice; no quote must never create a priced ticket',async()=>{
  const fetcher=async()=>new Response(JSON.stringify({events:[]}),{
    status:200,headers:{'content-type':'application/json'}})
  const result=await quoteKiraChosenTicket([leg('40100')],fetcher,now)
  assert.equal(result.placed,false)
  assert.equal(result.priced,false)
  assert.equal(result.complete,false)
  assert.deepEqual(result.quotes,[])
  assert.equal(result.missing.length,1)
  assert.equal(result.uiBlock.props.legs[0].selection,'Home Team')
  assert.equal(result.uiBlock.props.legs[0].quoteStatus,'unpriced')
  assert.match(result.uiBlock.props.note,/TICKET INCOMPLETO/u)
})
test('cannot invent five picks from one or duplicates or wrong event state',async()=>{
  const never=async()=>{throw Error('No network expected')}
  await assert.rejects(quoteKiraChosenTicket([leg('40100'),leg('40100')],
    never,now),/únicos/)
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    kickoff:'2026-11-15T01:00:00Z'})],never,now),/justificación/)
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    reason:'Gana'})],never,now),/justificación/)
})
test('Kira must explicitly choose home or away without numerical ranking',async()=>{
  const never=async()=>{throw Error('No network expected')}
  await assert.rejects(quoteKiraChosenTicket([leg('40100',{
    pick:'favourite'})],never,now),/justificación/)
})

test('final research checklist rejects five odds without source-level rebuttals',()=>{
  const legs=Array.from({length:5},(_,i)=>leg(String(40100+i)))
  const errors=ticketResearchChecklist(legs)
  assert.ok(errors.some(x=>/dos publicaciones leídas/.test(x)))
  assert.ok(errors.some(x=>/falta refutación/.test(x)))
  assert.ok(errors.some(x=>/riesgos críticos/.test(x)))
  const withEvidence=legs.map(l=>({...l,
    sourceUrls:['https://www.nhl.com/news/report','https://www.dailyfaceoff.com/news/report'],
    counterEvidence:'El adversario dispone de superioridad en el juego reciente.',
    criticalPending:[],
  }))
  assert.deepEqual(ticketResearchChecklist(withEvidence),[])
  assert.ok(ticketResearchChecklist(withEvidence.slice(0,4))
    .some(x=>/cinco o seis/.test(x)))
})
test('duplicate website citations do not fake a second independent source',()=>{
  const checked=leg('40100',{
    sourceUrls:['https://www.nhl.com/news/a','https://www.nhl.com/news/b'],
    criticalPending:[],
    counterEvidence:'El adversario puede dominar en situaciones especiales.',
  })
  assert.ok(ticketResearchChecklist([checked]).some(x=>/dos publicaciones/.test(x)))
})

test('expert gate requires a read bilateral dossier before a final decision',()=>{
  const legs=Array.from({length:5},(_,i)=>leg(String(40100+i),{
    sourceUrls:['https://www.nba.com/news/report','https://www.espn.com/nba/report'],
    counterEvidence:'El adversario puede castigar la defensa interior y el descanso corto.',
    criticalPending:[],
  }))
  assert.ok(ticketExpertEvidenceChecklist(legs).some(x=>/expediente bilateral leído/.test(x)))
  const evidence={eventId:'40100',homeRosterCount:13,awayRosterCount:14,
    reviewedStages:['teams','rosters','availability','context','news'],
    observedFacts:['forma reciente contrastada','roles y estadísticas contrastadas','noticias contrastadas']}
  const checked=legs.map((item,index)=>({...item,researchEvidence:{...evidence,
    eventId:String(40100+index)}}))
  assert.deepEqual(ticketExpertEvidenceChecklist(checked),[])
})

test('a model-declared receipt cannot claim final readiness without trusted runtime evidence',async()=>{
  const baseEvidence={homeRosterCount:13,awayRosterCount:14,
    reviewedStages:['teams','rosters','availability','context','news'],
    observedFacts:['forma contrastada de ambos','roles y estadísticas observadas','noticias fechadas contrastadas']}
  const chosen=Array.from({length:5},(_,index)=>leg(String(40150+index),{
    sourceUrls:['https://www.nba.com/news/report','https://www.espn.com/nba/report'],
    counterEvidence:'El rival tiene mejor rebote y puede aprovechar la rotación corta.',
    criticalPending:[],
    researchEvidence:{...baseEvidence,eventId:String(40150+index)},
  }))
  const fetcher=async input=>{
    const events=chosen.map(item=>({id:item.eventId,date:item.kickoff,
      competitions:[{id:item.eventId,competitors:[
        {homeAway:'home',team:{displayName:item.home}},
        {homeAway:'away',team:{displayName:item.away}},
      ],odds:[{provider:{name:'DraftKings'},homeTeamOdds:{moneyLine:'-155'},
        awayTeamOdds:{moneyLine:'+132'}}]}]}))
    return Response.json({events,items:[]})
  }
  const result=await quoteKiraChosenTicket(chosen,fetcher,now,5)
  assert.equal(result.finalReady,false)
  assert.match(result.finalizationMissing.join(' '),/evidencia de etapas confiable/u)
})

test('keeps usable same-book prices and the original six-leg target when one pick or quote is missing',async()=>{
  const chosen=Array.from({length:5},(_,i)=>leg(String(40110+i),{
    sourceUrls:['https://www.nba.com/news/report','https://www.espn.com/nba/report'],
    counterEvidence:'El adversario mostró mejor rendimiento defensivo en los últimos juegos.',
    criticalPending:[],
  }))
  const fetcher=(splitBook=false)=>async input=>{
    const events=chosen.map((pick,index)=>({
      id:pick.eventId,date:pick.kickoff,
      competitions:[{id:pick.eventId,competitors:[
        {homeAway:'home',team:{displayName:pick.home}},
        {homeAway:'away',team:{displayName:pick.away}},
      ],odds:[{provider:{name:splitBook&&index===4?'FanDuel':'DraftKings'},
        homeTeamOdds:{moneyLine:'-155'},awayTeamOdds:{moneyLine:'+132'}}]}],
    }))
    return Response.json(String(input).includes('scoreboard?dates=20261118')?{events}:{items:[]})
  }
  const short=await quoteKiraChosenTicket(chosen,fetcher(),now,6)
  assert.equal(short.uiBlock.props.requestedLegs,6)
  assert.equal(short.quotes.length,5)
  assert.equal(short.finalReady,false)
  assert.equal(short.complete,false)
  assert.equal(short.uiBlock.props.combinedOdds,'No disponible')

  const split=await quoteKiraChosenTicket(chosen,fetcher(true),now,5)
  assert.equal(split.quotes.length,4)
  assert.equal(split.bookmaker,'DraftKings')
  assert.equal(split.missing.length,1)
  assert.equal(split.complete,false)
})
