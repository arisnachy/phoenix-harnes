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
  assert.match(sportsGuidance, /no permite garantizar un ganador/u)

  assert.equal(section.text({
    incomingUserText: 'Arregla el historial del router',
    agent: { session: { events: [] } },
  }), '')
  assert.ok(registeredTools.some(tool => tool.name === 'sports_chat_ticket_evidence_priced_auto'))
})
