import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sportsPromptNeeded } from '../src/sports-prompt.ts'

const human = text => ({
  type: 'user/message',
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
})

test('sports prose is absent for unrelated requests without disabling sports tools', () => {
  assert.equal(sportsPromptNeeded('Arregla el historial del router', []), false)
  assert.equal(sportsPromptNeeded('Hola', [human('Busquemos partidos de MLB')]), false)
  assert.equal(sportsPromptNeeded(undefined, []), false)
})

test('sports prose is available before first user-message commit and on subsequent steps', () => {
  assert.equal(sportsPromptNeeded('Dame un ticket de fútbol', []), true)
  assert.equal(sportsPromptNeeded('Analiza la MLB', [human('Consulta GitHub')]), true)
  assert.equal(sportsPromptNeeded(undefined, [human('Revisa partidos de NBA')]), true)
  assert.equal(sportsPromptNeeded('Busca cuotas y mercados', []), true)
})

test('short followups keep relevant sports context, unrelated new tasks replace it', () => {
  assert.equal(sportsPromptNeeded('dale', [human('Investiga fútbol')]), true)
  assert.equal(sportsPromptNeeded(undefined, [human('Deportes'), human('dale')]), false)
  assert.equal(sportsPromptNeeded(undefined, [human('Deportes'), human('dale')].reverse()), true)
  assert.equal(sportsPromptNeeded('Arregla el updater de Windows', [human('NBA')]), false)
})
