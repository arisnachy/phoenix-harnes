import { describe, expect, it } from 'vitest'
import { getLocalModel } from '../src/local-model/catalog.js'
import { rewriteOllamaOpenAiBody } from '../src/local-model/proxy.js'

const qwen = getLocalModel('qwen3.5-2b-ollama-q4-k-m')
const native = getLocalModel('gemma-4-e2b-it-q4-0')

function encode(input: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(JSON.stringify(input), 'utf8')
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  bytes.set(raw)
  return bytes
}

function decode(body: Uint8Array<ArrayBuffer> | undefined): Record<string, unknown> {
  expect(body).toBeDefined()
  return JSON.parse(Buffer.from(body!).toString('utf8')) as Record<string, unknown>
}

describe('Phoenix Local Ollama proxy', () => {
  it('maps the generic Phoenix model to the installed tag while preserving tool calls and streaming', () => {
    const tools = [{ type: 'function', function: { name: 'sumar', parameters: { type: 'object' } } }]
    const request = encode({
      model: 'phoenix-local', stream: true, max_tokens: 900,
      reasoning_effort: 'high',
      tools, messages: [{ role: 'user', content: 'Suma 17 y 25.' }],
    })
    const result = decode(rewriteOllamaOpenAiBody('/chat/completions', request, qwen))
    expect(result).toMatchObject({
      model: 'qwen3.5:2b-q4_K_M',
      stream: true,
      max_tokens: 768,
      reasoning_effort: 'none',
      tools,
    })
  })

  it('does not forward a competing max_completion_tokens cap to Ollama', () => {
    const result = decode(rewriteOllamaOpenAiBody('/chat/completions', encode({
      model: 'phoenix-local',
      messages: [{ role: 'user', content: 'hola' }],
      max_completion_tokens: 1,
      max_tokens: 256,
      stream: true,
    }), qwen))
    expect(result.max_tokens).toBe(768)
    expect(result).not.toHaveProperty('max_completion_tokens')
    expect(result.reasoning_effort).toBe('none')
  })

  it('maps an OpenAI-only max_completion_tokens setting into the Ollama field', () => {
    const result = decode(rewriteOllamaOpenAiBody('/chat/completions', encode({
      model: 'phoenix-local', messages: [], max_completion_tokens: 96,
    }), qwen))
    expect(result.max_tokens).toBe(96)
    expect(result).not.toHaveProperty('max_completion_tokens')
  })

  it('respects a stricter client limit rather than expanding short responses', () => {
    const response = decode(rewriteOllamaOpenAiBody('/chat/completions', encode({
      model: 'placeholder', max_tokens: 80, messages: [],
    }), qwen))
    expect(response['max_tokens']).toBe(80)
  })

  it('disables thinking for Ollama Responses requests', () => {
    const response = decode(rewriteOllamaOpenAiBody('/responses', encode({
      model: 'placeholder', input: 'Hola', max_output_tokens: 512,
    }), qwen))
    expect(response).toMatchObject({
      model: 'qwen3.5:2b-q4_K_M',
      think: false,
      max_output_tokens: 512,
      reasoning: { effort: 'none' },
    })
  })

  it('does not rewrite native llama-server or unrelated requests', () => {
    const raw = encode({ model: 'native-model', messages: [] })
    expect(rewriteOllamaOpenAiBody('/chat/completions', raw, native)).toBe(raw)
    expect(rewriteOllamaOpenAiBody('/models', raw, qwen)).toBe(raw)
  })
})
