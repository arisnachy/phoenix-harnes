// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureVoiceAssistantRemote,
  configureVoiceModelRouteResolver,
  createVoiceRecognition,
  getVoiceAssistantSnapshot,
  hasVoiceRecognition,
  interruptVoiceAssistantSpeech,
  isCodexRealtimeVoiceActive,
  isLikelyVoiceAssistantEcho,
  refreshVoiceAssistantRemote,
  setVoiceAssistantActive,
  setVoiceAssistantListening,
  speakVoiceAssistantAttention,
  speakVoiceAssistantResponse,
  streamVoiceAssistantResponse,
  stopCodexRealtimeVoice,
  tryStartCodexRealtimeVoice,
  type VoiceRecognitionLike,
} from '../src/client/voice.ts'

class FakeRecognition implements VoiceRecognitionLike {
  static instance: FakeRecognition | undefined
  lang = ''
  continuous = false
  interimResults = true
  maxAlternatives = 0
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { readonly error?: string }) => void) | null = null
  onresult: VoiceRecognitionLike['onresult'] = null

  constructor() {
    FakeRecognition.instance = this
  }

  start(): void {}
  stop(): void {}
  abort(): void {}
}

describe('browser voice adapter', () => {
  afterEach(() => { setVoiceAssistantActive(false) })

  it('reports unsupported browsers without constructing a recognizer', () => {
    expect(hasVoiceRecognition({})).toBe(false)
    expect(createVoiceRecognition(() => {}, () => {}, 'en-US', {})).toBeUndefined()
  })

  it('allows legacy fallback only for a genuinely non-Codex route', async () => {
    const disposeRoute = configureVoiceModelRouteResolver(async () => ({
      provider: 'deepseek',
      model: 'deepseek-chat',
    }))
    try {
      await expect(tryStartCodexRealtimeVoice('session-non-codex')).resolves.toEqual({
        kind: 'not-codex',
      })
    } finally {
      disposeRoute()
    }
  })

  it('keeps Codex realtime failures explicit instead of silently using fallback speech', async () => {
    const disposeRoute = configureVoiceModelRouteResolver(async () => ({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
    }))
    try {
      await expect(tryStartCodexRealtimeVoice('session-codex')).resolves.toEqual({
        kind: 'failed',
        reason: 'host-realtime-unavailable',
      })
    } finally {
      disposeRoute()
    }
  })


  it('uses native realtime only as speech transport while Phoenix harness owns the answer', async () => {
    class FakeDataChannel {
      static instance: FakeDataChannel | undefined
      readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open'
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      readonly send = vi.fn((_payload: string) => undefined)
      close(): void { this.readyState = 'closed' }
      constructor() { FakeDataChannel.instance = this }
    }
    class FakePeer {
      static instance: FakePeer | undefined
      iceGatheringState = 'complete'
      connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' = 'connected'
      localDescription: { type: 'offer'; sdp: string } | null = null
      ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
      onconnectionstatechange: (() => void) | null = null
      constructor() { FakePeer.instance = this }
      createDataChannel(): FakeDataChannel { return new FakeDataChannel() }
      addTrack(): void {}
      async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
        return { type: 'offer', sdp: 'v=0\r\n' }
      }
      async setLocalDescription(value: { type: 'offer'; sdp: string }): Promise<void> {
        this.localDescription = value
      }
      async setRemoteDescription(): Promise<void> {}
      close(): void { this.connectionState = 'closed' }
    }

    const rtcDescriptor = Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection')
    const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeer,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
          getAudioTracks: () => [{ stop: vi.fn() }],
        })),
      },
    })
    const disposeRoute = configureVoiceModelRouteResolver(async () => ({
      provider: 'openai-codex',
      model: 'gpt-6-luna',
    }))
    const disposeRemote = configureVoiceAssistantRemote({
      conversationStatus: async () => ({
        ok: true,
        value: { enabled: true, natural: false },
      }),
      conversationSpeak: async () => ({
        ok: true,
        value: { accepted: false, reason: 'natural-unavailable' },
      }),
      conversationCancel: async () => ({
        ok: true,
        value: { cancelled: 0 },
      }),
      conversationRealtimeStatus: async () => ({
        ok: true,
        value: {
          enabled: true,
          available: true,
          authenticated: true,
          provider: 'openai-codex',
        },
      }),
      conversationRealtimeStart: async () => ({
        ok: true,
        value: {
          accepted: true,
          threadId: 'thread-harness',
          answerSdp: 'v=0\r\n',
        },
      }),
      conversationRealtimeStop: async () => ({
        ok: true,
        value: { stopped: true },
      }),
    })
    try {
      await expect(tryStartCodexRealtimeVoice('session-harness')).resolves.toEqual({ kind: 'started' })
      const channel = FakeDataChannel.instance
      expect(channel).toBeDefined()
      channel?.onopen?.()
      const sessionUpdate = JSON.parse(String(channel?.send.mock.calls[0]?.[0])) as {
        type: string
        session: { turn_detection: { create_response: boolean } }
      }
      expect(sessionUpdate.type).toBe('session.update')
      expect(sessionUpdate.session.turn_detection.create_response).toBe(false)

      const peer = FakePeer.instance
      expect(peer).toBeDefined()

      // A long Hardness/tool turn can make WebRTC report a transient
      // "disconnected". Native Codex voice must remain the selected transport.
      if (peer !== undefined) {
        peer.connectionState = 'disconnected'
        peer.onconnectionstatechange?.()
      }
      expect(isCodexRealtimeVoiceActive()).toBe(true)
      expect(getVoiceAssistantSnapshot().active).toBe(true)

      // If the data channel is temporarily unwritable when Hardness returns,
      // keep the answer queued for Codex instead of falling back to system TTS.
      if (channel !== undefined) channel.readyState = 'connecting'
      const activatedAt = getVoiceAssistantSnapshot().activatedAt
      streamVoiceAssistantResponse(
        'assistant:harness:1',
        'La tarea terminó correctamente.',
        activatedAt,
        true,
      )
      expect(channel?.send).toHaveBeenCalledTimes(1)

      if (channel !== undefined) channel.readyState = 'open'
      if (peer !== undefined) {
        peer.connectionState = 'connected'
        peer.onconnectionstatechange?.()
      }
      const spoken = JSON.parse(String(channel?.send.mock.calls[1]?.[0])) as {
        type: string
        response: { instructions: string }
      }
      expect(spoken.type).toBe('response.create')
      expect(spoken.response.instructions).toContain('La tarea terminó correctamente.')

      expect(speakVoiceAssistantAttention(
        'Aprobación 550e8400-e29b-41d4-a716-446655440000',
        'Revisa la acción antes de continuar; referencia 123456789 needs attention.',
      )).toBe(true)
      const attention = JSON.parse(String(channel?.send.mock.calls[2]?.[0])) as {
        type: string
        response: { instructions: string }
      }
      expect(attention.type).toBe('response.create')
      expect(attention.response.instructions).not.toContain('550e8400-e29b-41d4-a716-446655440000')
      expect(attention.response.instructions).not.toContain('123456789 needs attention')
      expect(attention.response.instructions).toContain('same voice and persona')

      expect(interruptVoiceAssistantSpeech()).toBe(true)
      expect(JSON.parse(String(channel?.send.mock.calls[3]?.[0]))).toEqual({ type: 'response.cancel' })
    } finally {
      await stopCodexRealtimeVoice()
      disposeRemote()
      disposeRoute()
      pause.mockRestore()
      if (rtcDescriptor === undefined) Reflect.deleteProperty(window, 'RTCPeerConnection')
      else Object.defineProperty(window, 'RTCPeerConnection', rtcDescriptor)
      if (mediaDescriptor === undefined) Reflect.deleteProperty(navigator, 'mediaDevices')
      else Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor)
    }
  })

  it('configures one explicit recognition session and forwards final text', () => {
    const transcripts: string[] = []
    const states: string[] = []
    const recognition = createVoiceRecognition(
      (text) => { transcripts.push(text) },
      (state) => { states.push(state) },
      'es-DO',
      { SpeechRecognition: FakeRecognition },
    )

    expect(recognition).toBe(FakeRecognition.instance)
    expect(recognition).toMatchObject({
      lang: 'es-DO', continuous: true, interimResults: false, maxAlternatives: 1,
    })
    recognition?.onstart?.()
    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: 'interim' } },
        { isFinal: true, 0: { transcript: '  hola ' } },
        { isFinal: true, 0: { transcript: 'Phoenix' } },
      ],
    })
    recognition?.onerror?.({ error: 'not-allowed' })
    recognition?.onend?.()

    expect(transcripts).toEqual(['hola Phoenix'])
    expect(states).toEqual(['listening', 'permission-denied', 'idle'])
  })

  it('maps ordinary recognizer failures to an explicit error state', () => {
    const states: string[] = []
    const recognition = createVoiceRecognition(() => {}, (state) => { states.push(state) }, 'en-US', {
      webkitSpeechRecognition: FakeRecognition,
    })
    recognition?.onerror?.({ error: 'network' })
    expect(states).toEqual(['error'])
  })

  it('streams a stable sentence before turn completion and yields immediately to barge-in', () => {
    class FakeUtterance {
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    const speak = vi.fn<(utterance: FakeUtterance) => void>()
    const cancel = vi.fn()
    const synthesis = { cancel, speak }
    const synthesisDescriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    const utteranceDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance')
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    try {
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt
      streamVoiceAssistantResponse('assistant:1:1', 'Encontré el problema', activatedAt)
      expect(speak).not.toHaveBeenCalled()

      streamVoiceAssistantResponse(
        'assistant:1:1',
        'Encontré el problema. Ahora estoy corrigiéndolo',
        activatedAt,
      )
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0].text).toBe('Encontré el problema.')
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')

      expect(isLikelyVoiceAssistantEcho('Encontré el problema.')).toBe(true)
      expect(isLikelyVoiceAssistantEcho('para, tengo una pregunta')).toBe(false)

      // Starting the recognizer alone must not cancel speech; only an accepted
      // non-echo transcript triggers the interruption.
      setVoiceAssistantListening(true)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')
      expect(interruptVoiceAssistantSpeech()).toBe(true)
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(getVoiceAssistantSnapshot().phase).toBe('listening')

      // A late browser callback from the cancelled utterance is epoch-fenced.
      speak.mock.calls[0]?.[0].onend?.()
      expect(getVoiceAssistantSnapshot().phase).toBe('listening')
    } finally {
      if (synthesisDescriptor === undefined) Reflect.deleteProperty(window, 'speechSynthesis')
      else Object.defineProperty(window, 'speechSynthesis', synthesisDescriptor)
      if (utteranceDescriptor === undefined) Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')
      else Object.defineProperty(window, 'SpeechSynthesisUtterance', utteranceDescriptor)
    }
  })

  it('routes streaming speech to the Host neural voice and cancels it on barge-in', async () => {
    const status = vi.fn(async () => ({
      ok: true as const,
      value: { enabled: true, natural: true, provider: 'phoenix-natural' },
    }))
    const speak = vi.fn(async (_request: {
      readonly key: string
      readonly sequence: number
      readonly text: string
      readonly language?: string
      readonly final?: boolean
    }) => ({
      ok: true as const,
      value: { accepted: true, provider: 'phoenix-natural' },
    }))
    const cancel = vi.fn(async (_request: { readonly key: string }) => ({
      ok: true as const,
      value: { cancelled: 1 },
    }))
    const dispose = configureVoiceAssistantRemote({
      conversationStatus: status,
      conversationSpeak: speak,
      conversationCancel: cancel,
    })
    try {
      expect(await refreshVoiceAssistantRemote()).toBe(true)
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt

      streamVoiceAssistantResponse(
        'assistant:2:1',
        'Encontré el problema. Ahora sigo revisando el flujo',
        activatedAt,
      )
      await Promise.resolve()
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0]).toMatchObject({
        key: 'assistant:2:1',
        sequence: 0,
        text: 'Encontré el problema.',
      })

      expect(interruptVoiceAssistantSpeech()).toBe(true)
      await Promise.resolve()
      expect(cancel).toHaveBeenCalledWith({ key: 'assistant:2:1' })
    } finally {
      setVoiceAssistantActive(false)
      dispose()
    }
  })

  it('keeps an explicit assistant mode active and speaks only newly completed responses', () => {
    class FakeUtterance {
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    const speak = vi.fn<(utterance: FakeUtterance) => void>()
    const synthesis = { cancel: vi.fn(), speak }
    const synthesisDescriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    const utteranceDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance')
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    try {
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt
      speakVoiceAssistantResponse('old', 'old history', activatedAt - 2_000)
      speakVoiceAssistantResponse('new', 'respuesta nueva', activatedAt)
      speakVoiceAssistantResponse('new', 'respuesta duplicada', activatedAt)
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0].text).toBe('respuesta nueva')
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')
      speak.mock.calls[0]?.[0].onend?.()
      expect(getVoiceAssistantSnapshot().phase).toBe('paused')
    } finally {
      if (synthesisDescriptor === undefined) Reflect.deleteProperty(window, 'speechSynthesis')
      else Object.defineProperty(window, 'speechSynthesis', synthesisDescriptor)
      if (utteranceDescriptor === undefined) Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')
      else Object.defineProperty(window, 'SpeechSynthesisUtterance', utteranceDescriptor)
    }
  })
})
