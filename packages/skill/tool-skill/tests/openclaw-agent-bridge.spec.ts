import { describe, expect, it, vi } from 'vitest'
import { delegateOpenClawAgent, inspectOpenClawAgent } from '../src/openclaw-agent-bridge.ts'

const token = 'test-operator-token-for-bridge'
const opts = { token, port: 18789, agent: 'phoenix-worker' }
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const inventory = () => json({ data: [{ id: 'openclaw/phoenix-worker' }] })
const reply = () => json({ choices: [{ finish_reason: 'stop', message: { content: 'Verified external answer' } }] })

describe('OpenClaw agent delegation', () => {
  it('uses only the configured agent and loopback endpoint, never an arbitrary session', async () => {
    const fetcher = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(inventory()).mockResolvedValueOnce(reply())
    const result = await delegateOpenClawAgent('Summarize this sample', { ...opts, fetcher })
    expect(result).toEqual({ agent: opts.agent, reply: 'Verified external answer' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[1]!
    expect(url).toBe('http://127.0.0.1:18789/v1/chat/completions')
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'openclaw/phoenix-worker', stream: false,
      messages: [{ role: 'user', content: 'Summarize this sample' }],
    })
  })

  it('fails closed for missing agent or an invalid port or identity', async () => {
    const fetcher = vi.fn(async () => json({ data: [] }))
    await expect(delegateOpenClawAgent('task', { ...opts, fetcher })).rejects.toThrow('not available')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(inspectOpenClawAgent({ ...opts, agent: '../admin', fetcher })).rejects.toThrow('dedicated')
    await expect(inspectOpenClawAgent({ ...opts, port: 1, fetcher })).rejects.toThrow('port')
    await expect(delegateOpenClawAgent(token, { ...opts, fetcher })).rejects.toThrow('credential')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not replay a timed out execution or disclose private error bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(inventory()).mockRejectedValueOnce(new Error(token))
    await expect(delegateOpenClawAgent('task', { ...opts, fetcher })).rejects.toThrow('Do not automatically retry')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const denied = vi.fn(async () => new Response(token, { status: 403 }))
    await expect(inspectOpenClawAgent({ ...opts, fetcher: denied })).rejects.toThrow('HTTP 403')
  })

  it('rejects incomplete replies and redacts the exact gateway credential from results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(inventory()).mockResolvedValueOnce(json({
      choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
    }))
    await expect(delegateOpenClawAgent('task', { ...opts, fetcher })).rejects.toThrow('complete text')
    const redacted = vi.fn<typeof fetch>().mockResolvedValueOnce(inventory()).mockResolvedValueOnce(json({
      choices: [{ finish_reason: 'stop', message: { content: 'secret: ' + token } }],
    }))
    expect((await delegateOpenClawAgent('task', { ...opts, fetcher: redacted })).reply).toBe('secret: [REDACTED]')
  })
})
