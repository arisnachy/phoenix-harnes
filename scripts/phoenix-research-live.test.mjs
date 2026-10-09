import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchEvidenceFromEvents } from './phoenix-research-live.mjs'

test('counts only successful actual web_fetch tool receipts, not verbal promises', () => {
  const input = [
    { type: 'tool/call', data: { callId: 'f1', name: 'web_fetch',
      arguments: JSON.stringify({ url: 'https://research.example.com/paper?apikey=private#section' }) } },
    { type: 'tool/result', data: { message: { source: { callId: 'f1' },
      content: [{ type: 'tool-result', toolCallId: 'f1', isError: false }] } } },
    { type: 'tool/call', data: { callId: 'f2', name: 'web_fetch',
      arguments: JSON.stringify({ url: 'https://blocked.example.com/report' }) } },
    { type: 'tool/result', data: { error: { code: 'WEB_ABORTED' },
      message: { source: { callId: 'f2' },
        content: [{ type: 'tool-result', toolCallId: 'f2', isError: true }] } } },
    { type: 'assistant/message', data: {
      usage: { inputTokens: 120, outputTokens: 30 },
      message: { content: [{ type: 'text', text: 'Confirmé esta fuente.' }] },
    } },
  ]
  const out = researchEvidenceFromEvents(input)
  assert.deepEqual(out.observedWebFetchUrls, ['https://research.example.com/paper'])
  assert.equal(out.fetches, 2)
  assert.equal(out.observedToolCalls, 2)
  assert.equal(out.answer, 'Confirmé esta fuente.')
  assert.equal(out.promptTokens, 120)
  assert.equal(out.completionTokens, 30)
})

test('search snippets are not source-reading receipts; repetitive queries count as wasted work', () => {
  const input = [
    { type: 'tool/call', data: { callId: 's1', name: 'web_search', arguments: { queries: ['study effect'] } } },
    { type: 'tool/call', data: { callId: 's2', name: 'web_search', arguments: { queries: [' Study Effect ', 'new result'] } } },
    { type: 'tool/result', data: { message: { source: { callId: 's2' },
      content: [{ type: 'tool-result', toolCallId: 's2', isError: false }] } } },
    { type: 'assistant/message', data: {
      message: { content: [{ type: 'text', text: 'No pude leer las fuentes.' }] },
    } },
  ]
  const out = researchEvidenceFromEvents(input)
  assert.equal(out.searches, 2)
  assert.equal(out.duplicateSearches, 1)
  assert.deepEqual(out.observedWebFetchUrls, [])
  assert.equal(out.promptTokens, null)
  assert.equal(out.completionTokens, null)
})

test('URL with embedded credentials and non-HTTP URL never enters evidence report', () => {
  const urls = ['https://user:secret@research.example.com/x', 'file:///etc/hosts']
  const events = urls.flatMap((url, index) => {
    const callId = `f-${index}`
    return [
      { type: 'tool/call', data: { callId, name: 'web_fetch', arguments: { url } } },
      { type: 'tool/result', data: { message: { source: { callId },
        content: [{ type: 'tool-result', toolCallId: callId, isError: false }] } } },
    ]
  })
  assert.deepEqual(researchEvidenceFromEvents(events).observedWebFetchUrls, [])
})
