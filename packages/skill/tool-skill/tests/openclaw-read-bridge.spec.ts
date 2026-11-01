import { describe, expect, it, vi } from 'vitest'
import { invokeOpenClawRead } from '../src/openclaw-read-bridge.ts'

const secret = 'test-operator-token-for-unit-tests'

describe('optional OpenClaw Gateway read bridge', () => {
  it('allows only a fixed memory search through loopback with a bounded query', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: { matches: [{ title: 'Note' }] } }), { status: 200 }))
    const result = await invokeOpenClawRead('memory', 'clinical notes', { token: secret, fetcher: fetcher as typeof fetch })
    expect(result).toEqual({ source: 'memory', result_json: '{"matches":[{"title":"Note"}]}' })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:18789/tools/invoke')
    expect(JSON.parse(String(init?.body))).toEqual({ tool: 'memory_search', args: { query: 'clinical notes' } })
    expect(init?.headers).toMatchObject({ authorization: 'Bearer ' + secret })
  })

  it('does not let a caller inject arbitrary tool names or remote Gateway hosts', async () => {
    const fetcher = vi.fn()
    await expect(invokeOpenClawRead('exec' as never, 'whoami', { token: secret, fetcher })).rejects.toThrow('Unsupported')
    await expect(invokeOpenClawRead('web', 'x\nmalformed', { token: secret, fetcher })).rejects.toThrow('printable')
    await expect(invokeOpenClawRead('web', 'hi', { token: secret, port: 1, fetcher })).rejects.toThrow('port')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails without leaking a private Gateway error response', async () => {
    const fetcher = vi.fn(async () => new Response('credential=sensitive', { status: 403 }))
    await expect(invokeOpenClawRead('web', 'example', { token: secret, fetcher: fetcher as typeof fetch }))
      .rejects.toThrow('HTTP 403')
  })
})
