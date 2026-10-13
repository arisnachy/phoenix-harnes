// @vitest-environment jsdom
// Built-graph voice acceptance lane. This deliberately drives the shipped
// AppWebEntry/Loader bundles and only fakes browser WebRTC/media primitives;
// the Remote calls are captured by the opt-in in-memory fixture transport.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, waitForAssembledBoot } from './assembled-boot.ts'

installAssembledBootEnv()

interface FixtureTiming {
  startConversationalTail(id: string): number
  appendConversationalTailText(id: string, value: string): void
  finishConversationalTail(id: string): void
}

interface FixtureVoiceTrace {
  statusCalls: number
  realtimeStatusCalls: number
  starts: Array<{ key: string; offerSdp: string }>
  speaks: Array<{ key: string; text: string }>
  stops: string[]
}

interface VoiceFixtureWindow extends Window {
  __fxTiming?: FixtureTiming
  __fxVoiceTrace?: FixtureVoiceTrace
}

class FakeDataChannel {
  readonly readyState = 'open'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: string[] = []

  send(value: string): void {
    this.sent.push(value)
  }

  close(): void {
    this.onclose?.()
  }
}

class FakePeerConnection {
  static latest: FakePeerConnection | undefined
  readonly channel = new FakeDataChannel()
  readonly connectionState = 'connected'
  readonly iceGatheringState = 'complete'
  localDescription: { type: 'offer'; sdp: string } | null = null
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor() {
    FakePeerConnection.latest = this
  }

  createDataChannel(): FakeDataChannel {
    return this.channel
  }

  addTrack(): void {}

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: 'v=0\\r\\n' }
  }

  async setLocalDescription(description: { type: 'offer'; sdp: string }): Promise<void> {
    this.localDescription = description
  }

  async setRemoteDescription(): Promise<void> {}

  close(): void {
    this.channel.close()
  }
}

function installFakeMedia(): void {
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  })
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
}

async function openFixtureSession(): Promise<void> {
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const session = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(session)
  await screen.findByRole('button', { name: 'Start voice assistant' })
}

it('requests the first native sentence while the assembled turn remains open', async () => {
  installFakeMedia()
  mountAssembledApp('?fixture&fixtureVoice=stream')
  await waitForAssembledBoot()
  await openFixtureSession()

  const fixtureWindow = window as VoiceFixtureWindow
  const trace = fixtureWindow.__fxVoiceTrace
  const timing = fixtureWindow.__fxTiming
  if (trace === undefined || timing === undefined) throw new Error('assembled voice fixture hooks missing')

  fireEvent.click(screen.getByRole('button', { name: 'Start voice assistant' }))
  await waitFor(() => expect(trace.starts).toHaveLength(1), { timeout: 10_000 })
  expect(trace.statusCalls).toBeGreaterThan(0)
  expect(trace.realtimeStatusCalls).toBeGreaterThan(0)
  const channel = FakePeerConnection.latest?.channel
  if (channel === undefined) throw new Error('fake realtime data channel missing')
  channel.onopen?.()

  // This produces real step/start + assistant chunk events through the same
  // mux/fold/AssistantNodeView path the shipped client consumes. The turn is
  // intentionally left open while the first sentence is requested.
  const streamingTurn = timing.startConversationalTail('fx-alpha')
  await waitFor(() => expect(trace.speaks.length).toBeGreaterThan(0), { timeout: 10_000 })
  expect(trace.speaks[0]?.key).toBe('fx-alpha')
  expect(trace.speaks[0]?.text).toMatch(/[.!?]$/u)
  expect(trace.speaks[0]?.text).toContain('Primera oración.')

  // Complete the active native segment before allowing the next cursor to
  // advance. The second sentence is appended while the same turn is open.
  channel.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
  timing.appendConversationalTailText('fx-alpha', ' Segunda oración.')
  await waitFor(() => expect(trace.speaks.length).toBeGreaterThan(1), { timeout: 10_000 })
  expect(trace.speaks[1]?.text).toContain('Segunda oración.')
  expect(trace.stops).toHaveLength(0)

  timing.finishConversationalTail('fx-alpha')
  await waitFor(() => expect(document.querySelector(`[data-turn-tail="${streamingTurn}"]`)).not.toBeNull())
  channel.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
  await waitFor(() => expect(trace.speaks).toHaveLength(2))
  // The observed call trace is the assertion surface; no synthetic latency
  // is measured here, only the ordering required for pre-close speech.
  expect({
    hasStatusProbes: trace.statusCalls > 0,
    hasRealtimeStatusProbes: trace.realtimeStatusCalls > 0,
    started: trace.starts.length,
    spokenBeforeClose: trace.speaks.slice(0, 2).map(({ key, text }) => ({ key, text })),
    stopped: trace.stops.length,
  }).toMatchInlineSnapshot(`
    {
      "hasRealtimeStatusProbes": true,
      "hasStatusProbes": true,
      "spokenBeforeClose": [
        {
          "key": "fx-alpha",
          "text": "Primera oración.",
        },
        {
          "key": "fx-alpha",
          "text": "Segunda oración.",
        },
      ],
      "started": 1,
      "stopped": 0,
    }
  `)
})
