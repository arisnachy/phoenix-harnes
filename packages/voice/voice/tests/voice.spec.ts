import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import VoiceRuntime, {
  displayOutputToVoiceText,
  phoenixMessagesToCodexRealtimeInitialItems,
  sessionEventToVoiceEvent,
  type VoiceImportantEvent,
  type VoiceTextToSpeechProvider,
} from '../src/index.ts'
import {
  CodexRealtimeBridge, codexLiveRepairPhase, codexLiveCurrentCliVersion, codexRealtimeEnvironment, codexRealtimeLaunchCommand,
  codexRealtimeNeedsLogin, findManagedCodexRealtimeBin, isCodexQuicksilverV2Required,
  queueCodexLiveRepair, realtimeVoiceForGender,
} from '../src/codex-realtime.ts'

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

  it('never pronounces trademark labels or invisible formatting as invented words', () => {
    expect(displayOutputToVoiceText('Phoenix®™℠© está listo.')).toBe('Phoenix está listo.')
    expect(displayOutputToVoiceText('Kira\u200b terminó el trabajo.')).toBe('Kira terminó el trabajo.')
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

  it('passes the selected feminine presentation to fallback synthesis', async () => {
    const { voice } = await mountVoice()
    const genders: (string | undefined)[] = []
    voice.registerTextToSpeechProvider({
      id: 'kokoro',
      priority: 100,
      available: () => true,
      speak: async (request) => { genders.push(request.gender) },
    })
    await voice.conversationSpeak({
      key: 'assistant:gender',
      sequence: 0,
      text: 'Ya terminé.',
      language: 'es-DO',
      final: true,
    })
    expect(genders).toEqual(['feminine'])
  })

  it('switches to masculine fallback after the assistant profile is changed', async () => {
    const { ctx, voice } = await mountVoice()
    const context = ctx as unknown as { get(name: string): unknown }
    const originalGet = context.get.bind(context)
    let selectedGender: 'feminine' | 'masculine' = 'feminine'
    vi.spyOn(context, 'get').mockImplementation((name) => {
      if (name === 'userProfile') {
        return { getAssistantIdentity: () => ({ name: 'Kira', gender: selectedGender }) }
      }
      return originalGet(name)
    })
    const genders: Array<string | undefined> = []
    voice.registerTextToSpeechProvider({
      id: 'kokoro',
      priority: 100,
      available: () => true,
      speak: async (request) => { genders.push(request.gender) },
    })
    await voice.conversationSpeak({
      key: 'assistant:before',
      sequence: 0,
      text: 'Hola, preparada.',
      language: 'es-DO',
      final: true,
    })
    selectedGender = 'masculine'
    await voice.conversationSpeak({
      key: 'assistant:after',
      sequence: 0,
      text: 'Hola, preparado.',
      language: 'es-DO',
      final: true,
    })
    expect(genders).toEqual(['feminine', 'masculine'])
  })

  it('defaults legacy Spanish conversation requests to Dominican Spanish', async () => {
    const { voice } = await mountVoice()
    const languages: string[] = []
    voice.registerTextToSpeechProvider({
      id: 'kokoro',
      priority: 100,
      available: () => true,
      speak: async request => { languages.push(request.language) },
    })
    await expect(voice.conversationSpeak({
      key: 'assistant:spanish-default',
      sequence: 0,
      text: 'La tarea está lista.',
      final: true,
    })).resolves.toMatchObject({ accepted: true, provider: 'kokoro' })
    expect(languages).toEqual(['es-DO'])
  })

  it('prefers a configured natural neural voice over Kokoro for conversation', async () => {
    const { voice } = await mountVoice()
    const natural = vi.fn(() => Promise.resolve())
    const kokoro = vi.fn(() => Promise.resolve())
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('phoenix-natural', natural, 300))
    voice.registerTextToSpeechProvider(provider('kokoro', kokoro, 100))
    voice.registerTextToSpeechProvider(provider('system', system, 10))
    await expect(voice.conversationStatus()).resolves.toMatchObject({
      enabled: true,
      natural: true,
      provider: 'phoenix-natural',
    })
    await expect(voice.conversationSpeak({
      key: 'assistant:natural-voice',
      sequence: 0,
      text: 'La tarea terminó.',
      final: true,
    })).resolves.toEqual({ accepted: true, provider: 'phoenix-natural' })
    expect(natural).toHaveBeenCalledTimes(1)
    expect(kokoro).not.toHaveBeenCalled()
    expect(system).not.toHaveBeenCalled()
  })

  it('falls back from a broken neural voice to Kokoro, never robotic Windows SAPI', async () => {
    const { voice } = await mountVoice()
    const natural = vi.fn(() => Promise.reject(new Error('neural startup unavailable')))
    const kokoro = vi.fn(() => Promise.reject(new Error('Kokoro model unavailable')))
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('phoenix-natural', natural, 300))
    voice.registerTextToSpeechProvider(provider('kokoro', kokoro, 100))
    voice.registerTextToSpeechProvider(provider('system', system, 10))
    await expect(voice.conversationSpeak({
      key: 'assistant:no-robot',
      sequence: 0,
      text: 'Estoy lista.',
      language: 'es-DO',
      final: true,
    })).resolves.toMatchObject({ accepted: false, reason: 'natural-unavailable' })
    expect(natural).toHaveBeenCalledTimes(1)
    expect(kokoro).toHaveBeenCalledTimes(1)
    expect(system).not.toHaveBeenCalled()
  })

  it('reports no host conversation voice when only a robotic system voice exists', async () => {
    const { voice } = await mountVoice()
    voice.registerTextToSpeechProvider(provider('system', vi.fn(), 10))
    await expect(voice.conversationStatus()).resolves.toEqual({ enabled: true, natural: false })
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
  it('expires an orphaned Codex call even if Telegram/browser never sends hangup', async () => {
    vi.useFakeTimers()
    const bridge = new CodexRealtimeBridge()
    try {
      const internal = bridge as unknown as {
        sessions: Map<string, string>
        armCallExpiry(key: string): void
        callTimers: Map<string, ReturnType<typeof setTimeout>>
      }
      internal.sessions.set('telegram-call', 'thread-remote')
      internal.armCallExpiry('telegram-call')
      expect(bridge.hasActiveSession()).toBe(true)
      await vi.advanceTimersByTimeAsync(60 * 60_000 + 1)
      expect(bridge.hasActiveSession()).toBe(false)
      expect(internal.callTimers.size).toBe(0)
    } finally {
      bridge.close()
      vi.useRealTimers()
    }
  })

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

describe('Codex managed runtime voice recovery', () => {
  it('finds the same managed runtime installed for Phoenix Codex model discovery', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-voice-managed-'))
    try {
      const runtime = join(home, 'codex-cli')
      mkdirSync(runtime, { recursive: true })
      writeFileSync(join(runtime, 'codex.js'), '// managed Codex entrypoint')
      writeFileSync(join(runtime, 'active.json'), JSON.stringify({
        schema: 1, version: '1.2.3', bin: 'codex.js',
      }))
      expect(findManagedCodexRealtimeBin(home)).toBe(join(runtime, 'codex.js'))
      // A poisoned marker must not escape the trusted managed directory.
      writeFileSync(join(runtime, 'active.json'), JSON.stringify({
        schema: 1, version: '1.2.3', bin: '../../external.js',
      }))
      expect(findManagedCodexRealtimeBin(home)).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses PATH only when the managed marker is missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-voice-unmanaged-'))
    try {
      expect(findManagedCodexRealtimeBin(home)).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('Codex Live on-demand updater', () => {
  it('reports progress from verified updater state, not from a stale repair request', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-live-progress-'))
    const dir = join(home, 'codex-cli')
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const requested = new Date(now - 10_000).toISOString()
    const newer = new Date(now - 5_000).toISOString()
    const requestFile = join(dir, 'live-repair-request.json')
    const stateFile = join(dir, 'update-state.json')
    const activeFile = join(dir, 'active.json')
    const write = (path: string, value: Record<string, unknown>): void => {
      writeFileSync(path, JSON.stringify(value))
    }
    try {
      expect(codexLiveRepairPhase(home, now)).toBe('idle')
      write(requestFile, { schema: 1, reason: 'quicksilver-v2', requestedAt: requested })
      expect(codexLiveRepairPhase(home, now)).toBe('checking')
      write(stateFile, { schema: 1, status: 'applied', mode: 'auto', checkedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('checking')
      write(activeFile, { schema: 1, version: '0.300.0', activatedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('ready')
      write(stateFile, { schema: 1, status: 'waiting-upstream', mode: 'auto', checkedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('waiting-upstream')
      write(stateFile, { schema: 1, status: 'available', mode: 'auto', checkedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('updating')
      write(stateFile, { schema: 1, status: 'blocked', mode: 'auto', checkedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('blocked')
      write(stateFile, { schema: 1, status: 'current', mode: 'off', checkedAt: newer })
      expect(codexLiveRepairPhase(home, now)).toBe('disabled')
      write(requestFile, { schema: 1, reason: 'quicksilver-v2', requestedAt: new Date(now - 31 * 60_000).toISOString() })
      expect(codexLiveRepairPhase(home, now)).toBe('idle')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('queues an immediate repair once and throttles identical failures', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-live-auto-update-'))
    try {
      expect(queueCodexLiveRepair(home, 'auto')).toBe('queued')
      expect(queueCodexLiveRepair(home, 'auto')).toBe('recent')
      expect(queueCodexLiveRepair(home, 'off')).toBe('disabled')
      const marker = JSON.parse(readFileSync(join(home, 'codex-cli', 'live-repair-request.json'), 'utf8'))
      expect(marker.schema).toBe(1)
      expect(marker.reason).toBe('quicksilver-v2')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('releases the idle app-server after the managed CLI binary changes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-live-managed-swap-'))
    const marker = join(home, 'codex-cli', 'active.json')
    const firstBin = join(home, 'codex-cli', 'versions', '0.100.0', 'codex.js')
    const newerBin = join(home, 'codex-cli', 'versions', '0.101.0', 'codex.js')
    mkdirSync(join(firstBin, '..'), { recursive: true })
    mkdirSync(join(newerBin, '..'), { recursive: true })
    writeFileSync(firstBin, '')
    writeFileSync(newerBin, '')
    const select = (version: string) => writeFileSync(marker, JSON.stringify({
      schema: 1, version, bin: 'versions/' + version + '/codex.js',
    }))
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      child?: { killed: boolean }
      launchedManagedCodexBin?: string
      ensureStarted(): Promise<void>
      startProcess(): Promise<void>
      close(): void
    }
    try {
      vi.stubEnv('DSH_HOME', home)
      select('0.100.0')
      internal.child = { killed: true }
      internal.launchedManagedCodexBin = firstBin
      const close = vi.spyOn(internal, 'close').mockImplementation(() => {
        delete internal.child
        delete internal.launchedManagedCodexBin
      })
      const start = vi.spyOn(internal, 'startProcess').mockResolvedValue(undefined)
      await internal.ensureStarted()
      expect(close).not.toHaveBeenCalled()
      select('0.101.0')
      await internal.ensureStarted()
      expect(close).toHaveBeenCalledTimes(1)
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      delete internal.child
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('Codex Live Quicksilver local diagnostics', () => {
  it('recognizes fresh managed CLI status and ignores stale or damaged snapshots', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-live-version-'))
    const state = join(home, 'codex-cli', 'update-state.json')
    mkdirSync(join(state, '..'), { recursive: true })
    try {
      writeFileSync(state, JSON.stringify({
        currentVersion: '0.162.1', latestVersion: '0.162.1',
        checkedAt: new Date().toISOString(),
      }))
      expect(codexLiveCurrentCliVersion(home)).toBe('0.162.1')
      writeFileSync(state, JSON.stringify({
        currentVersion: '0.162.1', latestVersion: '0.163.0',
        checkedAt: new Date().toISOString(),
      }))
      expect(codexLiveCurrentCliVersion(home)).toBeUndefined()
      writeFileSync(state, '{incomplete')
      expect(codexLiveCurrentCliVersion(home)).toBeUndefined()
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

describe('Codex realtime voice protocol compatibility', () => {
  it('uses supported gender-specific voices on V3 WebRTC', () => {
    expect(realtimeVoiceForGender('feminine', 'v3')).toBe('marin')
    expect(realtimeVoiceForGender('masculine', 'v3')).toBe('cedar')
    expect(realtimeVoiceForGender('neutral', 'v3')).toBe('alloy')
    expect(realtimeVoiceForGender('feminine', 'v1')).toBe('juniper')
  })

  it('detects Quicksilver v2 protocol rejection without mistaking it for expired login', () => {
    const header = 'AVAS requires OpenAI-Alpha: quicksilver=v2.'
    expect(isCodexQuicksilverV2Required(new Error(header))).toBe(true)
    expect(isCodexQuicksilverV2Required(new Error('invalid_quicksilver_alpha_header'))).toBe(true)
    expect(isCodexQuicksilverV2Required(new Error('401 Unauthorized'))).toBe(false)
    expect(isCodexQuicksilverV2Required(new Error('connect ETIMEDOUT'))).toBe(false)
  })

  it('requests official client-managed V3 handoffs for explicit Phoenix speech', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      negotiateRealtime(
        threadId: string,
        options: { offerSdp: string; assistantGender: 'feminine' },
        version: 'v3',
      ): Promise<string>
      request(method: string, params: Record<string, unknown>): Promise<unknown>
      waitForNotification(
        method: string,
        predicate: (params: unknown) => boolean,
        timeoutMs: number,
      ): { promise: Promise<unknown>; cancel: () => void }
    }
    const request = vi.spyOn(internal, 'request').mockResolvedValue({})
    const cancel = vi.fn()
    const never = new Promise<unknown>(() => {})
    vi.spyOn(internal, 'waitForNotification').mockImplementation(method => ({
      promise: method === 'thread/realtime/sdp'
        ? Promise.resolve({ threadId: 'thread-client-owned', sdp: 'v=answer\\r\\n' })
        : never,
      cancel,
    }))
    try {
      await expect(internal.negotiateRealtime(
        'thread-client-owned', { offerSdp: 'v=offer\\r\\n', assistantGender: 'feminine' }, 'v3',
      )).resolves.toBe('v=answer\\r\\n')
      expect(request).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledWith('thread/realtime/start', expect.objectContaining({
        threadId: 'thread-client-owned',
        clientManagedHandoffs: true,
        outputModality: 'audio',
        version: 'v3',
        transport: { type: 'webrtc', sdp: 'v=offer\\r\\n' },
      }))
      expect(cancel).toHaveBeenCalledTimes(3)
    } finally { bridge.close() }
  })

  it('negotiates V3 first on the initial microphone activation', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      ensureStarted(): Promise<void>; stop(key: string): Promise<boolean>
      startVoiceThread(model?: string): Promise<string>
      negotiateRealtime(id: string, options: unknown, version: 'v3' | 'v1'): Promise<string>
    }
    vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    vi.spyOn(internal, 'stop').mockResolvedValue(false)
    const startThread = vi.spyOn(internal, 'startVoiceThread').mockResolvedValue('v3-thread')
    const negotiated = vi.spyOn(internal, 'negotiateRealtime').mockResolvedValue('v=0')
    try {
      await expect(bridge.start({ key: 'kira-live', offerSdp: 'v=0', assistantGender: 'feminine' }))
        .resolves.toMatchObject({ threadId: 'v3-thread' })
      expect(startThread).toHaveBeenCalledTimes(1)
      expect(negotiated.mock.calls.map(call => call[2])).toEqual(['v3'])
    } finally { bridge.close() }
  })

  it('recovers a stale app-server only once per runtime and diagnoses current Codex 0.162.1', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      ensureStarted(): Promise<void>; stop(key: string): Promise<boolean>
      startVoiceThread(model?: string): Promise<string>
      negotiateRealtime(id: string, options: unknown, version: 'v3' | 'v1'): Promise<string>
      request(method: string, params?: unknown): Promise<unknown>
      launchedManagedCodexBin?: string
    }
    const ensureStarted = vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    vi.spyOn(internal, 'stop').mockResolvedValue(false)
    const started = vi.spyOn(internal, 'startVoiceThread').mockResolvedValue('stale-cli-thread')
    const negotiated = vi.spyOn(internal, 'negotiateRealtime').mockRejectedValue(
      new Error('Codex realtime startup failed: {"error":{"message":"AVAS requires OpenAI-Alpha: quicksilver=v2.","code":"invalid_quicksilver_alpha_header"}}'),
    )
    const requests = vi.spyOn(internal, 'request').mockResolvedValue({})
    const home = mkdtempSync(join(tmpdir(), 'phoenix-quicksilver-test-'))
    const state = join(home, 'codex-cli', 'update-state.json')
    mkdirSync(join(state, '..'), { recursive: true })
    writeFileSync(state, JSON.stringify({
      schema: 1, status: 'current', currentVersion: '0.162.1',
      latestVersion: '0.162.1', checkedAt: new Date().toISOString(),
    }))
    const binary = join(home, 'codex-cli', 'versions', '0.162.1', 'codex.js')
    mkdirSync(join(binary, '..'), { recursive: true })
    writeFileSync(binary, '')
    writeFileSync(join(home, 'codex-cli', 'active.json'), JSON.stringify({
      schema: 1, version: '0.162.1', bin: 'versions/0.162.1/codex.js',
    }))
    ensureStarted.mockImplementation(async () => { internal.launchedManagedCodexBin = binary })
    vi.stubEnv('DSH_HOME', home)
    try {
      await expect(bridge.start({ key: 'kira', offerSdp: 'v=0' }))
        .rejects.toThrow('CLI 0.162.1 gestionado ya está actualizado')
      expect(started).toHaveBeenCalledTimes(2)
      expect(negotiated.mock.calls.map(call => call[2])).toEqual(['v3', 'v3'])
      expect(requests).toHaveBeenCalledWith('thread/realtime/stop', { threadId: 'stale-cli-thread' })
      await expect(bridge.start({ key: 'kira', offerSdp: 'v=0' }))
        .rejects.toThrow('CLI 0.162.1 gestionado ya está actualizado')
      expect(started).toHaveBeenCalledTimes(3)
      expect(negotiated.mock.calls.map(call => call[2])).toEqual(['v3', 'v3', 'v3'])
      expect(existsSync(join(home, 'codex-cli', 'live-repair-request.json'))).toBe(false)
    } finally {
      bridge.close()
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('falls back once to V1 only when V3 itself is explicitly unsupported', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      ensureStarted(): Promise<void>; stop(key: string): Promise<boolean>
      startVoiceThread(model?: string): Promise<string>
      negotiateRealtime(id: string, options: unknown, version: 'v3' | 'v1'): Promise<string>
      request(method: string, params?: unknown): Promise<unknown>
    }
    vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    vi.spyOn(internal, 'stop').mockResolvedValue(false)
    const started = vi.spyOn(internal, 'startVoiceThread')
      .mockResolvedValueOnce('v3-unsupported').mockResolvedValueOnce('legacy-thread')
    const negotiated = vi.spyOn(internal, 'negotiateRealtime')
      .mockRejectedValueOnce(new Error('realtime version v3 unsupported'))
      .mockResolvedValueOnce('v=0')
    vi.spyOn(internal, 'request').mockResolvedValue({})
    try {
      await expect(bridge.start({ key: 'kira', offerSdp: 'v=0' }))
        .resolves.toMatchObject({ threadId: 'legacy-thread' })
      expect(started).toHaveBeenCalledTimes(2)
      expect(negotiated.mock.calls.map(call => call[2])).toEqual(['v3', 'v1'])
    } finally { bridge.close() }
  })

  it('never downgrades on 400, 403, login failure or SDP timeout', async () => {
    for (const errorMessage of ['400 Bad Request', '403 Forbidden',
      'not authenticated', 'notification timed out: thread/realtime/sdp']) {
      const bridge = new CodexRealtimeBridge()
      const internal = bridge as unknown as {
        ensureStarted(): Promise<void>; stop(key: string): Promise<boolean>
        startVoiceThread(model?: string): Promise<string>
        negotiateRealtime(id: string, options: unknown, version: 'v3' | 'v1'): Promise<string>
        request(method: string, params?: unknown): Promise<unknown>
      }
      vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
      vi.spyOn(internal, 'stop').mockResolvedValue(false)
      vi.spyOn(internal, 'startVoiceThread').mockResolvedValue('thread')
      const negotiated = vi.spyOn(internal, 'negotiateRealtime')
        .mockRejectedValue(new Error(errorMessage))
      vi.spyOn(internal, 'request').mockResolvedValue({})
      try {
        await expect(bridge.start({ key: 'kira', offerSdp: 'v=0' }))
          .rejects.toThrow(errorMessage)
        expect(negotiated.mock.calls.map(call => call[2])).toEqual(['v3'])
      } finally { bridge.close() }
    }
  })
})

describe('Codex Live authentication recovery', () => {
  it('detects an expired native Codex token but not transient network failures', () => {
    expect(codexRealtimeNeedsLogin(new Error(
      'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
    ))).toBe(true)
    expect(codexRealtimeNeedsLogin(new Error('refresh token has expired'))).toBe(true)
    expect(codexRealtimeNeedsLogin(new Error('refresh_token_has_expired'))).toBe(true)
    expect(codexRealtimeNeedsLogin(new Error('connect ETIMEDOUT'))).toBe(false)
    expect(codexRealtimeNeedsLogin(new Error('429 Too Many Requests'))).toBe(false)
  })

  it('does not report Live authenticated when a successful Codex account refresh returns no grant', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      child?: { killed: boolean }
      ensureStarted(): Promise<void>
      request(method: string, params?: unknown): Promise<unknown>
    }
    internal.child = { killed: true }
    vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    const read = vi.spyOn(internal, 'request').mockResolvedValue({ account: null })
    try {
      await expect(bridge.probe()).resolves.toMatchObject({
        available: true, authenticated: false, reason: 'codex-login-required',
      })
      expect(read).toHaveBeenCalledWith('account/read', { refreshToken: true })
    } finally {
      bridge.close()
    }
  })

  it('classifies expired credentials as reconnect-needed on explicit Live probe', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      child?: { killed: boolean }
      ensureStarted(): Promise<void>
      request(method: string, params?: unknown): Promise<unknown>
    }
    internal.child = { killed: true }
    vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    const read = vi.spyOn(internal, 'request').mockRejectedValue(
      new Error('refresh token has expired. Please log out and sign in again'),
    )
    try {
      await expect(bridge.probe()).resolves.toMatchObject({
        available: true, authenticated: false, reason: 'codex-login-required',
      })
      expect(read).toHaveBeenCalledWith('account/read', { refreshToken: true })
    } finally {
      bridge.close()
    }
  })
})

describe('Codex CLI voice startup diagnostics', () => {
  it('shows a useful failure reason without leaking authentication tokens', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as { ensureStarted(): Promise<void> }
    vi.spyOn(internal, 'ensureStarted').mockRejectedValue(
      new Error('realtime feature disabled, Bearer abc-private-token-value'),
    )
    try {
      const result = await bridge.probe()
      expect(result.reason).toBe('experimental-unavailable')
      expect(result.detail).toContain('realtime feature disabled')
      expect(result.detail).not.toContain('abc-private-token-value')
    } finally {
      bridge.close()
    }
  })
})

describe('Codex original Kira voice selection', () => {
  it('prefers Quicksilver V3 for Kira voice sessions', async () => {
    const bridge = new CodexRealtimeBridge()
    const internal = bridge as unknown as {
      ensureStarted(): Promise<void>
      stop(key: string): Promise<boolean>
      startVoiceThread(model?: string): Promise<string>
      negotiateRealtime(threadId: string, options: unknown, version: 'v3' | 'v1'): Promise<string>
    }
    vi.spyOn(internal, 'ensureStarted').mockResolvedValue(undefined)
    vi.spyOn(internal, 'stop').mockResolvedValue(false)
    vi.spyOn(internal, 'startVoiceThread').mockResolvedValue('original-voice')
    const negotiate = vi.spyOn(internal, 'negotiateRealtime').mockResolvedValue('v=0')
    try {
      await expect(bridge.start({
        key: 'kira-original',
        offerSdp: 'v=0',
        assistantGender: 'feminine',
      })).resolves.toMatchObject({ threadId: 'original-voice' })
      expect(negotiate.mock.calls.map(call => call[2])).toEqual(['v3'])
    } finally {
      bridge.close()
    }
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

describe('Codex Live launch regression', () => {
  it('uses the working Codex account stdio initialization contract on Windows', () => {
    const launch = codexRealtimeLaunchCommand(undefined, 'win32', 'C:\\Windows\\System32\\cmd.exe')
    expect(launch.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(launch.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(launch.args).toHaveLength(4)
    expect(launch.args[3]).toContain('codex -c')
    expect(launch.args[3]).toContain('features.plugins=false')
    expect(launch.args[3]).toContain('app-server --stdio')
    expect(launch.args[3]).not.toContain('--listen stdio://')
    // cmd.exe strips TOML quotation marks, so never embed a quoted Windows
    // file path inside its command string. The env supplies the SQLite home.
    const withSqliteHome = codexRealtimeLaunchCommand(
      undefined, 'win32', 'C:\\Windows\\System32\\cmd.exe', 'C:\\Users\\Phoenix Voice',
    )
    expect(withSqliteHome.args[3]).not.toContain('sqlite_home=')
  })

  it('keeps the same authenticated home and SQLite root as working Codex account probes', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-codex-voice-home-'))
    try {
      const env = codexRealtimeEnvironment({
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: 'C:\\stale-runtime\\voice',
        PHOENIX_CODEX_SQLITE_HOME: 'C:\\stale-runtime',
        OPENAI_API_KEY: 'must-never-be-used',
        PATH: 'C:\\Windows',
      })
      expect(env.CODEX_HOME).toBe(home)
      expect(env.CODEX_SQLITE_HOME).toBe(home)
      expect(env.PHOENIX_CODEX_SQLITE_HOME).toBeUndefined()
      expect(env.OPENAI_API_KEY).toBeUndefined()
      expect(env.PATH).toBe('C:\\Windows')
      const launch = codexRealtimeLaunchCommand('C:\\managed\\codex.js', 'win32', undefined, home)
      expect(launch.command).toBe(process.execPath)
      expect(launch.args[0]).toBe('C:\\managed\\codex.js')
      expect(launch.args).toContain(`sqlite_home=${JSON.stringify(home)}`)
      expect(launch.args.slice(-2)).toEqual(['app-server', '--stdio'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('initializes a managed Codex stdio child without acquiring any API key', async () => {
    const dsh = mkdtempSync(join(tmpdir(), 'phoenix-live-managed-'))
    const codexHome = join(dsh, 'codex-home')
    const managed = join(dsh, 'codex-cli')
    mkdirSync(managed, { recursive: true })
    mkdirSync(codexHome, { recursive: true })
    const script = join(managed, 'codex-mock.cjs')
    writeFileSync(script, [
      "let input = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => {",
      "  input += chunk",
      "  while (input.includes('\\n')) {",
      "    const end = input.indexOf('\\n')",
      "    const line = input.slice(0, end); input = input.slice(end + 1)",
      "    if (!line.trim()) continue",
      "    const request = JSON.parse(line)",
      "    if (request.id === undefined) continue",
      "    const args = process.argv.slice(2)",
      "    if (request.method === 'initialize') {",
      "      const valid = process.env.CODEX_SQLITE_HOME === process.env.CODEX_HOME",
      "        && args.includes('sqlite_home=' + JSON.stringify(process.env.CODEX_HOME))",
      "        && args.slice(-2).join(',') === 'app-server,--stdio'",
      "        && process.env.OPENAI_API_KEY === undefined",
      "        && request.params.capabilities.requestAttestation === false",
      "      process.stdout.write(JSON.stringify({id: request.id, ...(valid ? {result: {}} : {error: {message: 'invalid startup'}})}) + '\\n')",
      "    } else if (request.method === 'account/read') {",
      "      process.stdout.write(JSON.stringify({id: request.id, result: {account: {type: 'chatgpt'}}}) + '\\n')",
      "    }",
      "  }",
      "})",
    ].join('\n'))
    writeFileSync(join(managed, 'active.json'), JSON.stringify({
      schema: 1, version: '1.2.3', bin: 'codex-mock.cjs',
    }))
    vi.stubEnv('DSH_HOME', dsh)
    vi.stubEnv('CODEX_HOME', codexHome)
    vi.stubEnv('CODEX_SQLITE_HOME', 'C:\\stale-runtime\\voice')
    vi.stubEnv('PHOENIX_CODEX_SQLITE_HOME', 'C:\\stale-runtime')
    vi.stubEnv('OPENAI_API_KEY', 'not-allowed')
    const bridge = new CodexRealtimeBridge()
    try {
      await expect(bridge.probe()).resolves.toMatchObject({
        available: true, authenticated: true,
      })
    } finally {
      bridge.close()
      vi.unstubAllEnvs()
      rmSync(dsh, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  })

  it('uses Codex official appendSpeech for the owning active realtime thread only', async () => {
    const bridge = new CodexRealtimeBridge()
    const internals = bridge as unknown as {
      sessions: Map<string, string>
      child: object | undefined
      request: (method: string, params: unknown) => Promise<unknown>
    }
    const request = vi.spyOn(internals, 'request').mockResolvedValue({})
    internals.sessions.set('session-a', 'thread-123')
    internals.child = { killed: true }
    try {
      await expect(bridge.speak('not-owner', 'Hola')).resolves.toBe(false)
      expect(request).not.toHaveBeenCalled()
      await expect(bridge.speak('session-a', '  Ya terminé.  ')).resolves.toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledWith('thread/realtime/appendSpeech', {
        threadId: 'thread-123', text: 'Ya terminé.',
      })
    } finally {
      internals.child = undefined
      bridge.close()
    }
  })

  it('rejects native Codex speech when the live call is not owned by the browser', async () => {
    const { voice } = await mountVoice()
    await expect(voice.conversationRealtimeSpeak({ key: 'unknown', text: 'Hola.' })).resolves.toEqual({
      accepted: false, reason: 'no-session',
    })
    const internals = voice as unknown as { codexRealtime: CodexRealtimeBridge | undefined }
    const bridge = new CodexRealtimeBridge()
    const active = vi.spyOn(bridge, 'hasActiveSession').mockReturnValue(true)
    const speak = vi.spyOn(bridge, 'speak').mockResolvedValue(true)
    internals.codexRealtime = bridge
    try {
      await expect(voice.conversationRealtimeSpeak({ key: 'session-a', text: 'Kira ha terminado.' }))
        .resolves.toEqual({ accepted: true })
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak).toHaveBeenCalledWith('session-a', 'Kira ha terminado.')
      await expect(voice.conversationRealtimeSpeak({ key: 'session-a', text: '' })).resolves.toEqual({
        accepted: false, reason: 'invalid',
      })
    } finally {
      internals.codexRealtime = undefined
      active.mockRestore()
      speak.mockRestore()
      bridge.close()
    }
  })

  it('preserves direct managed and non-Windows launching', () => {
    expect(codexRealtimeLaunchCommand('C:\\managed\\codex.js', 'win32').args[0])
      .toBe('C:\\managed\\codex.js')
    expect(codexRealtimeLaunchCommand(undefined, 'linux').command).toBe('codex')
  })
})
