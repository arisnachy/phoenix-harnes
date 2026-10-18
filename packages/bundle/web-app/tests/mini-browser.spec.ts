import { afterEach, describe, expect, it } from 'vitest'
import {
  captureBrowserFrameSingleFlight,
  captureBrowserFrameWithFallback,
  isVerifiedWebmCapture,
  MiniBrowserCdpSession,
  miniBrowserDescriptorNeedsPublish,
  miniBrowserAutomaticTabId,
  miniBrowserRequestAllowed,
  miniBrowserSingleHeader,
  normalizeMiniBrowserAddress,
} from '../src/mini-browser.ts'

afterEach(() => { /* Pure contracts: no live Chrome or network is required. */ })

type FakeListener = (event: { data?: string }) => void
class FakeSocket {
  readonly sent: string[] = []
  closed = false
  private readonly listeners = new Map<string, FakeListener[]>()

  constructor(private readonly respond = true) {
    queueMicrotask(() => { this.emit('open', {}) })
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(payload: string): void {
    this.sent.push(payload)
    if (!this.respond) return
    const message = JSON.parse(payload) as { id: number; method: string }
    queueMicrotask(() => { this.emit('message', {
      data: JSON.stringify({ id: message.id, result: { method: message.method } }),
    }) })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close', {})
  }

  emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('MiniBrowser CDP session lifecycle', () => {
  it('reuses one socket and multiplexes command ids', async () => {
    const sockets: FakeSocket[] = []
    const session = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 500, () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    })

    const [first, second] = await Promise.all([
      session.send<{ method: string }>('Runtime.evaluate'),
      session.send<{ method: string }>('Page.getNavigationHistory'),
    ])

    expect(sockets).toHaveLength(1)
    expect(first.method).toBe('Runtime.evaluate')
    expect(second.method).toBe('Page.getNavigationHistory')
    expect(new Set(sockets[0]!.sent.map(payload => (JSON.parse(payload) as { id: number }).id)).size).toBe(2)
    session.close()
  })

  it('keeps the viewport setup and capture on the reused socket', async () => {
    const sockets: FakeSocket[] = []
    const session = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 500, () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    })

    await session.send<{ method: string }>('Page.captureScreenshot', { format: 'jpeg' })

    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.sent.map(payload => (JSON.parse(payload) as { method: string }).method))
      .toEqual(['Emulation.setDeviceMetricsOverride', 'Page.captureScreenshot'])
    session.close()
  })

  it('rejects pending work immediately when Chromium closes the socket', async () => {
    const sockets: FakeSocket[] = []
    const session = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 5000, () => {
      const socket = new FakeSocket(false)
      sockets.push(socket)
      return socket
    })
    const pending = session.send('Runtime.evaluate')
    await new Promise(resolve => setTimeout(resolve, 0))
    sockets[0]!.close()

    await expect(pending).rejects.toThrow('CDP_SESSION_CLOSED')
  })

  it('closes the timed-out socket and lets the next session reconnect', async () => {
    const sockets: FakeSocket[] = []
    const session = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 10, () => {
      const socket = new FakeSocket(sockets.length > 0)
      sockets.push(socket)
      return socket
    })
    const timedOut = session.send('Runtime.evaluate')
    const otherPending = session.send('Page.getNavigationHistory')

    await expect(timedOut).rejects.toThrow('Tiempo agotado: Runtime.evaluate')
    await expect(otherPending).rejects.toThrow()
    expect(sockets[0]!.closed).toBe(true)

    const replacement = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 100, () => {
      const socket = new FakeSocket(true)
      sockets.push(socket)
      return socket
    })
    await expect(replacement.send<{ method: string }>('Runtime.evaluate')).resolves.toEqual({ method: 'Runtime.evaluate' })
    expect(sockets).toHaveLength(2)
    replacement.close()
  })

  it('closes the socket when sending a CDP command throws', async () => {
    class ThrowingSocket extends FakeSocket {
      override send(_payload: string): void { throw new Error('socket write failed') }
    }
    let socket!: ThrowingSocket
    const session = new MiniBrowserCdpSession('ws://127.0.0.1/devtools/page/test', 100, () => {
      socket = new ThrowingSocket()
      return socket
    })

    await expect(session.send('Runtime.evaluate')).rejects.toThrow('socket write failed')
    expect(socket.closed).toBe(true)
  })
})

describe('MiniBrowser request coalescing', () => {
  it('shares one in-flight capture for the same target', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let captures = 0
    const capture = async () => {
      captures += 1
      await gate
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    }

    const first = captureBrowserFrameSingleFlight('target-1', capture)
    const second = captureBrowserFrameSingleFlight('target-1', capture)
    release()

    const [one, two] = await Promise.all([first, second])
    expect(captures).toBe(1)
    expect(one).toEqual(two)
  })

  it('does not write a descriptor when endpoint and selected tab are unchanged', () => {
    const current = { pid: 10, endpoint: 'http://127.0.0.1:9222/', selectedTabId: 'tab-1' }
    expect(miniBrowserDescriptorNeedsPublish(current, { ...current })).toBe(false)
    expect(miniBrowserDescriptorNeedsPublish(current, { ...current, endpoint: 'http://127.0.0.1:9222' })).toBe(false)
    expect(miniBrowserDescriptorNeedsPublish(current, { ...current, selectedTabId: 'tab-2' })).toBe(true)
  })
})

describe('MiniBrowser capture recovery', () => {
  it('captures the visible viewport without adding black space beyond a clipped page', async () => {
    const calls: Record<string, unknown>[] = []
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 30 }, () => 1)]).toString('base64')
    const received = await captureBrowserFrameWithFallback(async (options) => {
      calls.push(options)
      return { data: jpeg }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ captureBeyondViewport: false, fromSurface: true })
    expect(calls[0]).not.toHaveProperty('clip')
    expect(received.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  })

  it('uses software capture when the first two methods fail', async () => {
    const methods: unknown[] = []
    const jpeg = Buffer.from([0xff, 0xd8, ...Array.from({ length: 30 }, () => 1)]).toString('base64')
    const received = await captureBrowserFrameWithFallback(async (options) => {
      methods.push(options.fromSurface)
      if (methods.length < 3) throw new Error('target surface missing')
      return { data: jpeg }
    })
    expect(methods).toEqual([true, false, undefined])
    expect(received[0]).toBe(0xff)
  })

  it('returns an actionable failure instead of inventing a screenshot', async () => {
    await expect(captureBrowserFrameWithFallback(async () => { throw new Error('Target closed') }))
      .rejects.toThrow('CDP_CAPTURE_FAILED')
  })
})

describe('MiniBrowser origin and navigation contracts', () => {
  it('rejects repeated HTTP authorization headers instead of treating string arrays as strings', () => {
    expect(miniBrowserSingleHeader('1')).toBe('1')
    expect(miniBrowserSingleHeader(undefined)).toBeUndefined()
    expect(miniBrowserSingleHeader(['1'])).toBeUndefined()
    expect(miniBrowserSingleHeader(['1', '1'])).toBeUndefined()
    expect(miniBrowserRequestAllowed({
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:3080',
      marker: miniBrowserSingleHeader(['1']),
    })).toBe(false)
  })
  const allowed = {
    remoteAddress: '127.0.0.1',
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    marker: '1',
    fetchSite: 'same-origin',
  }
  it('accepts only a deliberate, same-origin loopback browser request', () => {
    expect(miniBrowserRequestAllowed(allowed)).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '::ffff:127.0.0.1' })).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, marker: undefined })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '10.0.0.3' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, host: 'evil.example:3080' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, origin: 'https://evil.example' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, fetchSite: 'cross-site' })).toBe(false)
  })
  it('never auto-selects the Phoenix app inside its own MiniBrowser', () => {
    const tabs = [
      { id: 'self', url: 'http://127.0.0.1:3080/' },
      { id: 'work', url: 'https://example.org/demo' },
      { id: 'blank', url: 'about:blank' },
    ]
    expect(miniBrowserAutomaticTabId(tabs, 'self')).toBe('work')
    expect(miniBrowserAutomaticTabId(tabs, 'work')).toBe('work')
    expect(miniBrowserAutomaticTabId(tabs.slice(0, 1), 'self')).toBeUndefined()
    expect(miniBrowserAutomaticTabId(tabs.slice(0, 2).reverse(), 'work')).toBe('work')
  })

  it('converts hostnames and searches but refuses executable schemes and credential URLs', () => {
    expect(normalizeMiniBrowserAddress('youtube.com')).toBe('https://youtube.com/')
    expect(normalizeMiniBrowserAddress('http://127.0.0.1:3080/test')).toBe('http://127.0.0.1:3080/test')
    expect(normalizeMiniBrowserAddress('Bob Esponja')).toContain('https://www.google.com/search?q=Bob%20Esponja')
    expect(() => normalizeMiniBrowserAddress('https://user:password@example.org')).toThrow('HTTP(S)')
    expect(() => normalizeMiniBrowserAddress('')).toThrow()
    expect(() => normalizeMiniBrowserAddress('http://')).toThrow()
  })
})


describe('User-authorized Chrome tab capture boundary', () => {
  it('rejects empty, oversized and non-WebM capture bytes', () => {
    expect(isVerifiedWebmCapture(Buffer.alloc(128))).toBe(false)
    expect(isVerifiedWebmCapture(Buffer.alloc(24 * 1024 * 1024 + 1))).toBe(false)
    expect(isVerifiedWebmCapture(Buffer.from('arbitrary body'))).toBe(false)
  })
  it('accepts a bounded verified WebM container marker', () => {
    const bytes = Buffer.alloc(256)
    bytes.set([0x1a, 0x45, 0xdf, 0xa3])
    expect(isVerifiedWebmCapture(bytes)).toBe(true)
  })
})
