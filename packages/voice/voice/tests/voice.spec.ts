import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import VoiceRuntime, {
  displayOutputToVoiceText,
  phoenixMessagesToCodexRealtimeInitialItems,
  localizedImportantSpeech,
  sessionEventToVoiceEvent,
  voiceLanguageForPanel,
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

  it('uses Kokoro then the platform voice for hands-free conversation fallback', async () => {
    const { voice } = await mountVoice({ ttsProvider: 'phoenix-natural' })
    const natural = vi.fn(() => Promise.resolve())
    const kokoro = vi.fn(() => Promise.reject(new Error('kokoro unavailable for this utterance')))
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('phoenix-natural', natural, 300))
    voice.registerTextToSpeechProvider(provider('system', system, 10))
    voice.registerTextToSpeechProvider(provider('kokoro', kokoro, 100))

    await expect(voice.conversationStatus()).resolves.toEqual({
      enabled: true,
      natural: true,
      provider: 'kokoro',
    })
    await expect(voice.conversationSpeak({
      key: 'assistant:fallback',
      sequence: 0,
      text: 'La tarea terminó.',
      final: true,
    })).resolves.toEqual({
      accepted: true,
      provider: 'system',
    })

    expect(kokoro).toHaveBeenCalledTimes(1)
    expect(system).toHaveBeenCalledTimes(1)
    expect(natural).not.toHaveBeenCalled()
  })

  it('never mixes fallback TTS into an active native Codex realtime call', async () => {
    const { voice } = await mountVoice()
    const speak = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('system', speak))
    const internal = voice as unknown as {
      codexRealtime?: { hasActiveSession(): boolean; close(): void }
    }
    internal.codexRealtime = { hasActiveSession: () => true, close: () => {} }

    expect(voice.announce({
      kind: 'blocked',
      displayOutput: 'I need your attention before I can continue.',
    })).toMatchObject({
      accepted: false,
      reason: 'native-realtime',
    })
    await Promise.resolve()
    expect(speak).not.toHaveBeenCalled()
  })

  it('prefers Kokoro for notifications and falls back to platform when it fails', async () => {
    const { voice } = await mountVoice({ ttsProvider: 'phoenix-natural' })
    const natural = vi.fn(() => Promise.resolve())
    const kokoro = vi.fn(() => Promise.reject(new Error('kokoro temporarily unavailable')))
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('system', system, 10))
    voice.registerTextToSpeechProvider(provider('kokoro', kokoro, 100))
    voice.registerTextToSpeechProvider(provider('phoenix-natural', natural, 300))

    voice.announce({ kind: 'discovery', displayOutput: 'Encontré la causa.' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(natural).not.toHaveBeenCalled()
    expect(kokoro).toHaveBeenCalledTimes(1)
    expect(system).toHaveBeenCalledTimes(1)
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
  it('reports active native realtime ownership without exposing thread details', () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as { sessions: Map<string, string> }
    expect(bridge.hasActiveSession()).toBe(false)
    internal.sessions.set('session-a', 'thread-a')
    expect(bridge.hasActiveSession()).toBe(true)
    internal.sessions.clear()
    expect(bridge.hasActiveSession()).toBe(false)
    bridge.close()
  })

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

  it('routes finalized realtime user and assistant transcripts to the owning Phoenix call', () => {
    const bridge = new CodexRealtimeBridge()
    const received: unknown[] = []
    const internal = bridge as unknown as {
      transcriptListeners: Map<string, (value: unknown) => void>
      routeMessage(value: unknown): void
    }
    internal.transcriptListeners.set('thread-chat', (value) => { received.push(value) })
    internal.routeMessage({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 'thread-other', role: 'assistant', text: 'ignore me' },
    })
    internal.routeMessage({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 'thread-chat', role: 'user', text: '  Hola Kira  ' },
    })
    internal.routeMessage({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 'thread-chat', role: 'assistant', text: 'Hola, te escucho.' },
    })
    expect(received).toEqual([
      { role: 'user', text: 'Hola Kira' },
      { role: 'assistant', text: 'Hola, te escucho.' },
    ])
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
    expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({
      key: 'session-without-injected-store',
      offerSdp: 'v=0\\r\\noffer\\r\\n',
      model: 'gpt-6-luna',
      assistantName: 'KIRA',
      assistantGender: 'feminine',
      voice: 'juniper',
    }))
  })
})

describe('Codex realtime harness dispatch', () => {
  it('does not duplicate browser-admitted Live speech through the app-server transcript', async () => {
    const { ctx, voice } = await mountVoice()
    const followup = vi.fn()
    const context = ctx as unknown as { get(name: string): unknown }
    const nativeGet = context.get.bind(context)
    vi.spyOn(context, 'get').mockImplementation((name) => {
      if (name === 'agents') {
        return {
          get: (id: string) => id === 'session-harness-voice' ? { followup } : undefined,
        }
      }
      return nativeGet(name)
    })

    const internal = voice as unknown as {
      appendRealtimeTranscript(
        key: string,
        model: string | undefined,
        transcript: { role: 'user' | 'assistant'; text: string },
      ): void
    }
    internal.appendRealtimeTranscript(
      'session-harness-voice',
      'gpt-6-luna',
      { role: 'user', text: '  revisa el proyecto y ejecuta la tarea  ' },
    )
    internal.appendRealtimeTranscript(
      'session-harness-voice',
      'gpt-6-luna',
      { role: 'assistant', text: 'respuesta paralela del realtime' },
    )

    expect(followup).not.toHaveBeenCalled()
  })
})

describe('Codex realtime profile identity', () => {
  it('uses the persisted assistant name and masculine voice presentation', async () => {
    const { ctx, voice } = await mountVoice()
    const context = ctx as unknown as { get(name: string): unknown }
    const nativeGet = context.get.bind(context)
    vi.spyOn(context, 'get').mockImplementation((name) => {
      if (name === 'userProfile') {
        return { getAssistantIdentity: () => ({ name: 'Marco', gender: 'masculine' }) }
      }
      return nativeGet(name)
    })

    const internal = voice as unknown as {
      codexRealtimeBridge(): {
        probe(): Promise<{ available: boolean; authenticated: boolean }>
        start(input: Record<string, unknown>): Promise<{ threadId: string; answerSdp: string }>
      }
    }
    const start = vi.fn(async () => ({ threadId: 'thread-profile', answerSdp: 'v=0\\r\\nanswer' }))
    vi.spyOn(internal, 'codexRealtimeBridge').mockReturnValue({
      probe: vi.fn(async () => ({ available: true, authenticated: true })),
      start,
    })

    await expect(voice.conversationRealtimeStart({
      key: 'session-profile',
      offerSdp: 'v=0\\r\\noffer\\r\\n',
      model: 'gpt-6-luna',
    })).resolves.toMatchObject({ accepted: true })

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      assistantName: 'Marco',
      assistantGender: 'masculine',
      voice: 'cove',
    }))
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

describe('locale-aligned notification speech', () => {
  it('uses the PHOENIX panel locale instead of the system default', () => {
    expect(voiceLanguageForPanel('es')).toBe('es-DO')
    expect(voiceLanguageForPanel('en')).toBe('en-US')
    expect(voiceLanguageForPanel('zh')).toBe('zh-CN')
    expect(voiceLanguageForPanel(undefined)).toBe('es-DO')
  })

  it('localizes deterministic completion and approval notices', () => {
    expect(sessionEventToVoiceEvent({
      type: 'goal/judge', data: { goalId: 'done', verdict: 'pass' },
    })?.displayOutput).toBe('La tarea está lista y ha pasado la revisión.')
    expect(sessionEventToVoiceEvent({
      type: 'approval/asked', data: { id: 'step' },
    }, 'en-US')?.displayOutput).toBe('I need your approval before I can continue.')
    expect(sessionEventToVoiceEvent({
      type: 'goal/supervisor', data: { status: 'blocked' },
    }, 'zh-CN')?.displayOutput).toBe('我需要你的帮助才能继续执行任务。')
  })

  it('never reads untagged English summaries as Spanish notifications', () => {
    const event = sessionEventToVoiceEvent({
      type: 'goal/judge',
      data: { goalId: 'mission', verdict: 'pass', summary: 'Everything is ready.' },
    }, 'es-DO')
    expect(event?.displayOutput).toBe('La tarea está lista y ha pasado la revisión.')
    expect(localizedImportantSpeech({
      kind: 'mission-completed', displayOutput: 'Everything is ready.',
    }, 'es-DO')).toBe('La tarea está lista y ha pasado la revisión.')
    expect(localizedImportantSpeech({
      kind: 'discovery', displayOutput: 'Encontré la causa.',
    }, 'es-DO')).toBe('Encontré la causa.')
  })

  it('keeps explicitly language-tagged summaries only when they match the panel', () => {
    const event = sessionEventToVoiceEvent({
      type: 'goal/judge', data: {
        goalId: 'mission', verdict: 'pass', summary: 'La tarea está terminada.',
        language: 'es',
      },
    }, 'es-DO')
    expect(event?.displayOutput).toBe('La tarea está terminada.')
  })
})

describe('session-event voice mapping', () => {
  it('announces only authorization, verified completion, and real blocking', () => {
    expect(sessionEventToVoiceEvent({ type: 'approval/asked', data: { toolName: 'home-control' } })).toMatchObject({ kind: 'authorization' })
    expect(sessionEventToVoiceEvent({ type: 'goal/judge', data: { goalId: 'g1', verdict: 'pass' } })).toMatchObject({ kind: 'mission-completed' })
    expect(sessionEventToVoiceEvent({ type: 'goal/supervisor', data: { goalId: 'g1', status: 'blocked' } })).toMatchObject({ kind: 'blocked' })
    expect(sessionEventToVoiceEvent({ type: 'tool/result', data: { ok: false } })).toBeUndefined()
  })

  it('keeps machine ids and the literal needs-attention phrase out of spoken alerts', () => {
    const goalId = '550e8400-e29b-41d4-a716-446655440000'
    const blocked = sessionEventToVoiceEvent({
      type: 'goal/judge',
      data: {
        goalId,
        revision: 47,
        verdict: 'blocked',
        summary: `Waiting for your decision on ${goalId}, reference 123456789.`,
      },
    })
    expect(blocked).toMatchObject({ kind: 'blocked' })
    expect(blocked?.displayOutput).not.toContain(goalId)
    expect(blocked?.displayOutput).not.toContain('123456789')
    expect(blocked?.displayOutput.toLowerCase()).not.toContain('needs attention')

    const supervisor = sessionEventToVoiceEvent({
      type: 'goal/supervisor',
      data: { goalId, revision: 47, status: 'blocked' },
    })
    expect(supervisor?.displayOutput).not.toContain(goalId)
    expect(supervisor?.displayOutput.toLowerCase()).not.toContain('needs attention')
  })
})
