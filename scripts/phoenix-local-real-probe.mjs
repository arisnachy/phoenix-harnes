#!/usr/bin/env node
// Opt-in real Ollama inference probe. No automatic pulls, no remote URLs,
// no filesystem mutations. Synthetic tool verifies tool calling + follow-up.
const base = 'http://127.0.0.1:11434'
const tags = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(5000) }).then(r => { if (!r.ok) throw Error('Ollama tags HTTP ' + r.status); return r.json() })
const requested = process.argv.slice(2)
const installed = (tags.models ?? []).map(m => m.name)
const models = requested.length ? requested : installed.filter(n => /qwen|gemma/i.test(n))
if (!models.length) { console.error('No installed Qwen/Gemma tags. Nothing tested.'); process.exitCode = 1 }
for (const model of models) {
  if (!installed.includes(model)) { console.error(JSON.stringify({ model, status: 'not-installed' })); process.exitCode = 1; continue }
  const started = Date.now()
  try {
    const tool = { type: 'function', function: { name: 'phoenix_probe_add', description: 'Add two integers.', parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } } }
    const messages = [{ role: 'user', content: 'Call phoenix_probe_add with a=17 and b=25. Then report the returned integer. Do not calculate it yourself.' }]
    const chat = async () => {
      const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools: [tool], stream: false, options: { num_ctx: 4096, num_predict: 512, temperature: 0 } }), signal: AbortSignal.timeout(600000) })
      if (!r.ok) throw Error('Ollama chat HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300))
      return r.json()
    }
    const first = await chat()
    const calls = first.message?.tool_calls ?? []
    if (calls.length !== 1 || calls[0].function?.name !== 'phoenix_probe_add') throw Error('Expected exactly one actual tool call')
    const { a, b } = calls[0].function.arguments ?? {}
    if (a !== 17 || b !== 25) throw Error('Incorrect tool arguments')
    messages.push(first.message, { role: 'tool', tool_name: 'phoenix_probe_add', content: String(a+b) })
    const final = await chat()
    if (!/\b42\b/.test(final.message?.content ?? '') || final.message?.tool_calls?.length) throw Error('Tool result not consumed')
    console.log(JSON.stringify({ model, status: 'pass', elapsedMs: Date.now()-started, promptTokens: final.prompt_eval_count, outputTokens: final.eval_count }))
  } catch (error) { console.error(JSON.stringify({ model, status: 'fail', error: String(error), elapsedMs: Date.now()-started })); process.exitCode = 1 }
}
