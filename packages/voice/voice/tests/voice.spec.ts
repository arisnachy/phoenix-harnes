import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import VoiceRuntime, {
  displayOutputToVoiceText,
  phoenixMessagesToCodexRealtimeInitialItems,
  sessionEventToVoiceEvent,
  type VoiceImportantEvent,
  type VoiceTextToSpeechProvider,
} from '../src/index.ts'
import { CodexRealtimeBridge } from '../src/codex-realtime.ts'

async function mountVoice(config: ConstructorParameters<typeof VoiceRuntime>[1] = {}): Promise<{
  ctx: Context
  voice: VoiceRuntime
}> {
  const ctx = new Context()
  await ctx.plugin(VoiceRuntime, config)
  return { ctx, voice: ctx.voice }
}

function provider(
  id: string,
  speak: (text: string, signal?: AbortSignal) => Promise<void>,
  priority = 0,
): VoiceTextToSpeechProvider {
  return { id, priority, available: () => true, speak: request => speak(request.text, request.signal) }
}

describe('display-to-voice adaptation', () => {
  it('keeps natural prose while removing visual-only content and sensitive tokens', () => {
    expect(displayOutputToVoiceText(
      '# Resultado ✅\n\nLa **misión** está lista. [Abrir informe](https://example.com/a)\n```ts\nsecret code\n```\napi_key=hidden-value',
    )).toBe('Resultado La misión está lista. Abrir informe redacted')
  })

  it('caps long announcements without cutting the middle of a sentence', () => {
    expect(displayOutputToVoiceText('Primera frase completa. Segunda frase que ya no cabe.', 24)).toBe('Primera frase completa.')
  })
})

describe('VoiceRuntime event gate and asynchronous queue', () => {
  it('does not enqueue ordinary execution events', async () => {
    const { voice } = await mountVoice()
    const speak = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('system', speak))

    expect(voice.announce({ kind: 'progress' as VoiceImportantEvent['kind'], displayOutput: 'Tool finished' })).toMatchObject({
      accepted: false,
      reason: 'not-important',
    })
    await Promise.resolve()
    expect(speak).not.toHaveBeenCalled()
  })

  it('returns before a local provider finishes speaking', async () => {
    const { voice } = await mountVoice()
    let resolveSpeech!: () => void
    const speaking = new Promise<void>((resolve) => { resolveSpeech = resolve })
    const speak = vi.fn(() => speaking)
    voice.registerTextToSpeechProvider(provider('system', speak))

    const receipt = voice.announce({ kind: 'discovery', displayOutput: 'Encontré un archivo importante.' })
    expect(receipt).toMatchObject({ accepted: true })
    await Promise.resolve()
    expect(speak).toHaveBeenCalledWith('Encontré un archivo importante.', expect.anything())
    resolveSpeech()
    await speaking
  })

  it('cancels queued announcements without stopping Phoenix execution', async () => {
    const { voice } = await mountVoice({ maxQueue: 2 })
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const spoken: string[] = []
    voice.registerTextToSpeechProvider(provider('system', async (text) => {
      spoken.push(text)
      if (spoken.length === 1) await first
    }))

    const firstReceipt = voice.announce({ kind: 'discovery', displayOutput: 'Uno.' })
    const secondReceipt = voice.announce({ kind: 'help', displayOutput: 'Dos.' })
    expect(voice.cancel(secondReceipt.id)).toBe(true)
    release()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(firstReceipt.accepted).toBe(true)
    expect(spoken).toEqual(['Uno.'])
  })

  it('prefers Kokoro when it is available and falls back to another local provider', async () => {
    const { voice } = await mountVoice({ ttsProvider: 'kokoro' })
    const kokoro = vi.fn(() => Promise.resolve())
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider({ ...provider('system', system, 10), available: () => true })
    voice.registerTextToSpeechProvider({ ...provider('kokoro', kokoro, 100), available: () => true })
    voice.announce({ kind: 'mission-completed', displayOutput: 'Completado.' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(kokoro).toHaveBeenCalled()
    expect(system).not.toHaveBeenCalled()
  })

  it('falls back when the preferred provider fails during synthesis', async () => {
    const { voice } = await mountVoice({ ttsProvider: 'phoenix-natural' })
    const natural = vi.fn(() => Promise.reject(new Error('engine warming failed')))
    const kokoro = vi.fn(() => Promise.resolve())
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('system', system, 10))
    voice.registerTextToSpeechProvider(provider('kokoro', kokoro, 100))
    voice.registerTextToSpeechProvider(provider('phoenix-natural', natural, 300))

    voice.announce({ kind: 'discovery', displayOutput: 'Encontré la causa.' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(natural).toHaveBeenCalledTimes(1)
    expect(kokoro).toHaveBeenCalledTimes(1)
    expect(system).not.toHaveBeenCalled()
  })
})

describe('Codex realtime compact context', () => {
  it('keeps only recent visible user and assistant prose in chronological order', () => {
    const items = phoenixMessagesToCodexRealtimeInitialItems([
      { role: 'system', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'large system context' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Primera pregunta.' }] },
      { role: 'assistant', source: { kind: 'model' }, content: [
        { type: 'reasoning', text: 'private reasoning' },
        { type: 'text', text: 'Primera respuesta.' },
      ] },
      { role: 'user', source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool noise' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Pregunta actual.' }] },
    ])
    expect(items).toEqual([
      { role: 'user', text: 'Primera pregunta.' },
      { role: 'assistant', text: 'Primera respuesta.' },
      { role: 'user', text: 'Pregunta actual.' },
    ])
  })

  it('bounds history to six role-bearing items', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      source: { kind: index % 2 === 0 ? 'user' : 'model' },
      content: [{ type: 'text', text: `mensaje-${index}` }],
    }))
    expect(phoenixMessagesToCodexRealtimeInitialItems(history).map(item => item.text)).toEqual([
      'mensaje-4', 'mensaje-5', 'mensaje-6', 'mensaje-7', 'mensaje-8', 'mensaje-9',
    ])
  })
})

describe('Codex realtime app-server notifications', () => {
  it('surfaces an async startup error immediately instead of waiting for a missing SDP', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      waitForNotification(
        method: string,
        predicate: (params: unknown) => boolean,
        timeoutMs: number,
      ): { readonly promise: Promise<unknown>; readonly cancel: () => void }
      routeMessage(value: unknown): void
    }
    const expected = { threadId: 'thread-voice', message: 'realtime backend rejected the call' }
    const wait = internal.waitForNotification(
      'thread/realtime/error',
      params => typeof params === 'object' && params !== null
        && 'threadId' in params && params.threadId === expected.threadId,
      1_000,
    )
    internal.routeMessage({ method: 'thread/realtime/error', params: expected })
    await expect(wait.promise).resolves.toEqual(expected)
    wait.cancel()
    bridge.close()
  })

  it('keeps unrelated realtime notifications isolated by thread', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      waitForNotification(
        method: string,
        predicate: (params: unknown) => boolean,
        timeoutMs: number,
      ): { readonly promise: Promise<unknown>; readonly cancel: () => void }
      routeMessage(value: unknown): void
    }
    const wait = internal.waitForNotification(
      'thread/realtime/sdp',
      params => typeof params === 'object' && params !== null
        && 'threadId' in params && params.threadId === 'thread-target',
      1_000,
    )
    internal.routeMessage({
      method: 'thread/realtime/sdp',
      params: { threadId: 'thread-other', sdp: 'wrong' },
    })
    internal.routeMessage({
      method: 'thread/realtime/sdp',
      params: { threadId: 'thread-target', sdp: 'v=0' },
    })
    await expect(wait.promise).resolves.toEqual({ threadId: 'thread-target', sdp: 'v=0' })
    wait.cancel()
    bridge.close()
  })
})

describe('Codex realtime optional session context', () => {
  it('starts native Codex Realtime even when SessionStore is not injected into the voice plugin', async () => {
    const { voice } = await mountVoice()
    const internal = voice as unknown as {
      codexRealtimeBridge(): {
        probe(): Promise<{ available: boolean; authenticated: boolean }>
        start(input: {
          key: string
          offerSdp: string
          model?: string
          initialItems?: readonly unknown[]
        }): Promise<{ threadId: string; answerSdp: string }>
      }
    }
    const bridge = {
      probe: vi.fn(async () => ({ available: true, authenticated: true })),
      start: vi.fn(async () => ({ threadId: 'thread-native-voice', answerSdp: 'v=0\\r\\nanswer' })),
    }
    vi.spyOn(internal, 'codexRealtimeBridge').mockReturnValue(bridge)

    await expect(voice.conversationRealtimeStart({
      key: 'session-without-injected-store',
      offerSdp: 'v=0\\r\\noffer\\r\\n',
      model: 'gpt-6-luna',
    })).resolves.toEqual({
      accepted: true,
      threadId: 'thread-native-voice',
      answerSdp: 'v=0\\r\\nanswer',
    })
    expect(bridge.probe).toHaveBeenCalledTimes(1)
    expect(bridge.start).toHaveBeenCalledWith({
      key: 'session-without-injected-store',
      offerSdp: 'v=0\\r\\noffer\\r\\n',
      model: 'gpt-6-luna',
    })
  })
})

describe('Codex realtime safety gate', () => {
  it('stays fully disabled without starting Codex when the feature is turned off', async () => {
    const { voice } = await mountVoice({ codexRealtime: false })
    await expect(voice.conversationRealtimeStatus()).resolves.toEqual({
      enabled: false,
      available: false,
      authenticated: false,
      provider: 'openai-codex',
      reason: 'disabled',
    })
    await expect(voice.conversationRealtimeStart({
      key: 'session-voice-test',
      offerSdp: 'v=0',
    })).resolves.toEqual({ accepted: false, reason: 'disabled' })
  })

  it('preserves terminal CRLF in browser SDP instead of trimming the offer', async () => {
    const { voice } = await mountVoice()
    const internal = voice as unknown as {
      codexRealtimeBridge(): {
        probe(): Promise<{ available: boolean; authenticated: boolean }>
        start(input: {
          key: string
          offerSdp: string
        }): Promise<{ threadId: string; answerSdp: string }>
      }
    }
    const start = vi.fn(async () => ({ threadId: 'thread-sdp', answerSdp: 'v=0\\r\\nanswer\\r\\n' }))
    vi.spyOn(internal, 'codexRealtimeBridge').mockReturnValue({
      probe: vi.fn(async () => ({ available: true, authenticated: true })),
      start,
    })

    const offerSdp = 'v=0\\r\\no=- 1 2 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\n'
    await expect(voice.conversationRealtimeStart({
      key: 'session-sdp',
      offerSdp,
    })).resolves.toMatchObject({ accepted: true })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ offerSdp }))
  })

  it('rejects malformed WebRTC starts before touching the Codex sidecar', async () => {
    const { voice } = await mountVoice()
    await expect(voice.conversationRealtimeStart({
      key: '',
      offerSdp: 'v=0',
    })).resolves.toEqual({ accepted: false, reason: 'invalid' })
  })
})

describe('session-event voice mapping', () => {
  it('announces only authorization, verified completion, and real blocking', () => {
    expect(sessionEventToVoiceEvent({ type: 'approval/asked', data: { toolName: 'home-control' } })).toMatchObject({ kind: 'authorization' })
    expect(sessionEventToVoiceEvent({ type: 'goal/judge', data: { goalId: 'g1', verdict: 'pass' } })).toMatchObject({ kind: 'mission-completed' })
    expect(sessionEventToVoiceEvent({ type: 'goal/supervisor', data: { goalId: 'g1', status: 'blocked' } })).toMatchObject({ kind: 'blocked' })
    expect(sessionEventToVoiceEvent({ type: 'tool/result', data: { ok: false } })).toBeUndefined()
  })
})
