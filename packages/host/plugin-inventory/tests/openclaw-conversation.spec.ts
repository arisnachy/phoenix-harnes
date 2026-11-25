import { describe, expect, it } from 'vitest'
import { readOpenClawStream, validOpenClawEngine } from '../src/openclaw-conversation.ts'
const stream = (...lines: string[]) => new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/event-stream' } })
describe('OpenClaw direct engine', () => {
  it('validates owner engine configuration', () => {
    expect(validOpenClawEngine({ mode: 'direct', agent: 'phoenix-worker', port: 18789 })).toBe(true)
    expect(validOpenClawEngine({ mode: 'hybrid', agent: '../admin', port: 18789 })).toBe(false)
    expect(validOpenClawEngine({ mode: 'direct', agent: 'worker', port: 80 })).toBe(false)
  })
  it('receives partial text and requires terminal confirmation', async () => {
    const partial: string[] = []
    const reply = await readOpenClawStream(stream(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ), text => partial.push(text))
    expect(reply).toBe('Hello world')
    expect(partial).toEqual(['Hello', 'Hello world'])
  })
  it('rejects error frames and truncated streams', async () => {
    await expect(readOpenClawStream(stream('data: {"error":{"message":"private"}}', 'data: [DONE]'), () => {})).rejects.toThrow('unsuccessful')
    await expect(readOpenClawStream(stream('data: {"choices":[{"delta":{"content":"partial"}}]}'), () => {})).rejects.toThrow('not confirmed')
  })
})
