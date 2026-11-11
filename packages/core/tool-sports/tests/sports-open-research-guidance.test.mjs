import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SPORTS_OPEN_RESEARCH_GUIDANCE} from '../src/sports-open-research-guidance.ts'

test('sports research discovers beyond the starting providers and verifies claims',()=>{
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/PUNTOS DE PARTIDA, nunca una lista cerrada/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/búsqueda y lectura web/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/factores a favor Y en contra/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/observedAt/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/enlaces clicables/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/sports_ticket_card/u)
  assert.match(SPORTS_OPEN_RESEARCH_GUIDANCE,/no afirmes que el ticket inteligente se mostró/u)
})
