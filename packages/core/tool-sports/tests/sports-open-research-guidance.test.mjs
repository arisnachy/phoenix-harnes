import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SPORTS_OPEN_RESEARCH_GUIDANCE} from '../src/sports-open-research-guidance.ts'

test('sports ticket compares evidence, validates live ESPN quotes, and ends once',()=>{
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/resultados recientes terminados de ambos equipos/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/favorable, evidencia en contra/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/observedAt/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/menos de 15 minutos/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sports_chat_ticket_evidence_priced_auto una sola vez/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/No encadenes barridos diarios/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sin bucles infinitos/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sports_ticket_card/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/no permite garantizar un ganador/u)
})

test('Kira seeks independent missing facts and compares original rosters instead of weighted scores',()=>{
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sports_chat_autonomous_sources/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sports_chat_ticket_dossier_recheck/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/modelComparisonBriefs/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/estadísticas originales por jugador/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/puntuaciones artificiales|PUNTUACIONES ARTIFICIALES/u)
})

test('independent discovery and decisive NBA/NFL pregame checks are mandatory guidance',()=>{
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/NUNCA el límite de la búsqueda/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/por iniciativa propia fuentes públicas/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/segunda fuente independiente/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/back-to-back/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/quarterback titular y sustituto confirmados/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/mejor razón por la que podría PERDER/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/NO lo llames definitivo/u)
})
