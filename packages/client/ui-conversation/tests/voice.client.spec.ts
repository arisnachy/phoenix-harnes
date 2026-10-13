// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { spokenLanguage } from '../src/client/speech-output.ts'
import {
  configureCodexRealtimeUserTranscriptHandler,
  configureVoiceAssistantRemote,
  configureVoiceModelRouteResolver,
  codexRealtimeStatusFailureReason, codexRealtimeRequiresLogin, codexLiveRepairFromStatus,
  isCodexLiveRepairPending, openCodexReconnection, waitForCodexLiveRepair,
  createVoiceRecognition,
  getVoiceAssistantSnapshot,
  hasVoiceRecognition,
  hasApprovedVoiceFallback,
  setApprovedVoiceFallback,
  interruptVoiceAssistantSpeech,
  isCodexRealtimeVoiceActive,
  isLikelyVoiceAssistantEcho,
  refreshVoiceAssistantRemote,
  setVoiceAssistantActive,
  setVoiceAssistantListening,
  speakVoiceAssistantAttention,
  speakVoiceAssistantResponse,
  cancelVoiceAssistantSentenceStream,
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
  it('uses Spanish for the panel and text rather than a hidden Host English default', () => {
    expect(spokenLanguage('Completado.', 'es')).toBe('es-DO')
    expect(spokenLanguage('He encontrado el problema. Voy a corregirlo.', 'en')).toBe('es-DO')
    expect(spokenLanguage('The task is complete and ready.', 'es')).toBe('en-US')
    expect(spokenLanguage('Hola, todo está listo.', 'en')).toBe('es-DO')
    expect(spokenLanguage('您好。', 'zh-CN')).toBe('zh-CN')
  })

  afterEach(() => { setVoiceAssistantActive(false) })

  it('requires prior explicit opt-in before reusing a browser-vendor voice backup', () => {
    const source = new Map<string, string>()
    const storage = {
      getItem: (name: string) => source.get(name) ?? null,
      setItem: (name: string, value: string) => { source.set(name, value) },
      removeItem: (name: string) => { source.delete(name) },
    }
    expect(hasApprovedVoiceFallback(storage)).toBe(false)
    setApprovedVoiceFallback(true, storage)
    expect(hasApprovedVoiceFallback(storage)).toBe(true)
    setApprovedVoiceFallback(false, storage)
    expect(hasApprovedVoiceFallback(storage)).toBe(false)
    expect(hasApprovedVoiceFallback({
      getItem: () => { throw new Error('Storage blocked') },
    })).toBe(false)
    expect(() => setApprovedVoiceFallback(true, {
      setItem: () => { throw new Error('Storage blocked') },
      removeItem: () => {},
    })).not.toThrow()
  })

  it('reports unsupported browsers without constructing a recognizer', () => {
    expect(hasVoiceRecognition({})).toBe(false)
    expect(createVoiceRecognition(() => {}, () => {}, 'en-US', {})).toBeUndefined()
  })

  it('reads optional Codex status diagnostics with stale generated Remote types', () => {
    // The source Host supports `detail` but an incremental client may still
    // see the previous generated Remote declaration with only `reason`.
    const legacyStatus = { reason: 'experimental-unavailable' } as const
    expect(codexRealtimeStatusFailureReason(legacyStatus)).toBe('experimental-unavailable')
    const extendedStatus = {
      reason: 'experimental-unavailable',
      detail: 'Codex CLI native realtime feature is unavailable',
    } as const
    expect(codexRealtimeStatusFailureReason(extendedStatus))
      .toBe('Codex CLI native realtime feature is unavailable')
    expect(codexRealtimeStatusFailureReason({
      reason: 'codex-login-required',
      detail: '  ',
    })).toBe('codex-login-required')
    expect(codexRealtimeStatusFailureReason({})).toBe('codex-realtime-unavailable')
  })

  it('decodes updater progress from newer and older Host Remote contracts', () => {
    expect(isCodexLiveRepairPending('codex-live-repair-pending')).toBe(true)
    expect(isCodexLiveRepairPending('refresh token expired')).toBe(false)
    expect(codexLiveRepairFromStatus({ repair: 'ready' })).toBe('ready')
    expect(codexLiveRepairFromStatus({ repair: 'waiting-upstream' })).toBe('waiting-upstream')
    expect(codexLiveRepairFromStatus({ repair: 'blocked' })).toBe('blocked')
    expect(codexLiveRepairFromStatus({ reason: 'experimental-unavailable' })).toBeUndefined()
    expect(codexLiveRepairFromStatus({ repair: 'unknown-version' })).toBeUndefined()
    expect(codexLiveRepairFromStatus(null)).toBeUndefined()
  })

  it('stops the repair spinner immediately when the updater is waiting on official support', async () => {
    const remote = {
      conversationStatus: vi.fn(async () => ({
        ok: true as const, value: { enabled: true, natural: false },
      })),
      conversationSpeak: vi.fn(async () => ({
        ok: true as const, value: { accepted: false, reason: 'disabled' as const },
      })),
      conversationCancel: vi.fn(async () => ({
        ok: true as const, value: { cancelled: 0 },
      })),
      conversationRealtimeStatus: vi.fn(async () => ({
        ok: true as const,
        value: {
          enabled: true, available: false, authenticated: false,
          provider: 'openai-codex' as const, repair: 'waiting-upstream' as const,
        },
      })),
    }
    const dispose = configureVoiceAssistantRemote(remote)
    try {
      await expect(waitForCodexLiveRepair(new AbortController().signal, {
        timeoutMs: 100, pollMs: 1,
      })).resolves.toBe('waiting-upstream')
      expect(remote.conversationRealtimeStatus).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
  })

  it('opens the existing Codex connector window for expired credentials only', () => {
    const seen: unknown[] = []
    const onFeature = (event: Event) => { seen.push((event as CustomEvent).detail) }
    window.addEventListener('phoenix:open-feature', onFeature)
    try {
      expect(codexRealtimeRequiresLogin('codex-login-required')).toBe(true)
      expect(codexRealtimeRequiresLogin('refresh token has expired')).toBe(true)
      expect(codexRealtimeRequiresLogin('refresh token has expired')).toBe(true)
      expect(codexRealtimeRequiresLogin('refresh_token_has_expired')).toBe(true)
      expect(codexRealtimeRequiresLogin('experimental-unavailable')).toBe(false)
      expect(codexRealtimeRequiresLogin('ETIMEDOUT')).toBe(false)
      openCodexReconnection()
      expect(seen).toEqual([{ destination: 'connectors', label: 'Reconectar Codex' }])
    } finally {
      window.removeEventListener('phoenix:open-feature', onFeature)
    }
  })

  it('attempts Codex voice for a Phoenix Auto/non-Codex task route instead of skipping it', async () => {
    const disposeRoute = configureVoiceModelRouteResolver(async () => ({
      provider: 'phoenix-auto',
      model: 'phoenix-auto',
    }))
    try {
      // This fixture has no Host remote: the failure must describe the missing
      // voice service, NOT reject the selected Phoenix Auto execution model.
      await expect(tryStartCodexRealtimeVoice('session-auto')).resolves.toEqual({
        kind: 'failed',
        reason: 'host-realtime-unavailable',
      })
    } finally {
      disposeRoute()
    }
  })

  it('probes Codex voice even without an optional text-model resolver', async () => {
    await expect(tryStartCodexRealtimeVoice('session-no-route')).resolves.toEqual({
      kind: 'failed',
      reason: 'host-realtime-unavailable',
    })
  })

  it('starts the Codex voice probe without waiting for an unrelated model catalog', async () => {
    const dispose = configureVoiceModelRouteResolver(async () => new Promise<undefined>(() => {}))
    try {
      await expect(tryStartCodexRealtimeVoice('voice-catalog-slow')).resolves.toEqual({
        kind: 'failed',
        reason: 'host-realtime-unavailable',
      })
    } finally {
      dispose()
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
    const transcript = vi.fn<(text: string) => void>()
    const disposeTranscript = configureCodexRealtimeUserTranscriptHandler(transcript)
    const disposeRoute = configureVoiceModelRouteResolver(async () => ({
      provider: 'phoenix-auto',
      model: 'phoenix-auto',
    }))
    const realtimeStart = vi.fn(async (_request: {
      readonly key: string
      readonly offerSdp: string
      readonly model?: string
    }) => ({
      ok: true as const,
      value: {
        accepted: true,
        threadId: 'thread-harness',
        answerSdp: 'v=0\r\n',
      },
    }))
    let rejectNativeSpeech = false
    type NativeReceipt = { ok: true; value: { accepted: boolean; reason?: 'disabled' } }
    let delayedNativeSpeech: Promise<NativeReceipt> | undefined
    const realtimeSpeak = vi.fn(async (_request: { readonly key: string; readonly text: string }) => {
      if (delayedNativeSpeech !== undefined) {
        const pending = delayedNativeSpeech
        delayedNativeSpeech = undefined
        return pending
      }
      if (rejectNativeSpeech) {
        return {
          ok: true as const,
          value: { accepted: false as const, reason: 'disabled' as const },
        }
      }
      return {
        ok: true as const,
        value: { accepted: true as const },
      }
    })
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
      conversationRealtimeStart: realtimeStart,
      conversationRealtimeSpeak: realtimeSpeak,
      conversationRealtimeStop: async () => ({
        ok: true,
        value: { stopped: true },
      }),
    })
    try {
      await expect(tryStartCodexRealtimeVoice('session-harness')).resolves.toEqual({ kind: 'started' })
      // Phoenix Auto's text model must never be forced into Codex's voice thread.
      expect(realtimeStart).toHaveBeenCalledWith({
        key: 'session-harness',
        offerSdp: 'v=0\r\n',
      })
      const channel = FakeDataChannel.instance
      expect(channel).toBeDefined()
      const audio = document.querySelector<HTMLAudioElement>('[data-phoenix-codex-voice]')
      expect(audio?.muted).toBe(true)
      channel?.onopen?.()
      const sessionUpdate = JSON.parse(String(channel?.send.mock.calls[0]?.[0])) as {
        type: string
        session: { turn_detection: { create_response: boolean } }
      }
      expect(sessionUpdate.type).toBe('session.update')
      expect(sessionUpdate.session.turn_detection.create_response).toBe(false)

      // The same Live data channel is the canonical microphone/transcript
      // source. V3 and V1 final-user events both feed the composer handler.
      channel?.onmessage?.({
        data: JSON.stringify({
          type: 'turn.done',
          turn: { role: 'user', transcript: '  usa el harness y escribe en el chat  ' },
        }),
      })
      channel?.onmessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: 'usa el harness y escribe en el chat',
        }),
      })
      channel?.onmessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: 'segunda orden',
        }),
      })
      expect(transcript.mock.calls).toEqual([
        ['usa el harness y escribe en el chat'],
        ['segunda orden'],
      ])

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

      const activatedAt = getVoiceAssistantSnapshot().activatedAt

      if (channel !== undefined) channel.readyState = 'open'
      if (peer !== undefined) {
        peer.connectionState = 'connected'
        peer.onconnectionstatechange?.()
      }
      await Promise.resolve()
      // A durable conversational-tail answer speaks its first sentence while
      // the remaining text is still arriving. Each later sentence waits for
      // the preceding native response.done; the final full tail adds no copy.
      const streamed = 'Primera frase. Segunda frase.'
      streamVoiceAssistantResponse(
        'assistant:harness:stream', streamed, activatedAt, false, false, true,
      )
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenLastCalledWith({
        key: 'session-harness', text: 'Primera frase.',
      })
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenLastCalledWith({
        key: 'session-harness', text: 'Segunda frase.',
      })
      streamVoiceAssistantResponse(
        'assistant:harness:stream', streamed, activatedAt, true, false, true,
      )
      expect(realtimeSpeak).toHaveBeenCalledTimes(2)
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(2)

      // A rewrite cancels the in-flight native response but waits for its
      // terminal event before reusing the channel. This prevents the old
      // response.done from advancing the corrected sentence cursor.
      streamVoiceAssistantResponse(
        'assistant:harness:rewrite', 'Borrador inicial. Segunda parte.', activatedAt, false, false, true,
      )
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(3)
      streamVoiceAssistantResponse(
        'assistant:harness:rewrite', 'Versión corregida.', activatedAt, false, false, true,
      )
      expect(JSON.parse(String(channel?.send.mock.calls.at(-1)?.[0]))).toEqual({ type: 'response.cancel' })
      expect(realtimeSpeak).toHaveBeenCalledTimes(3)
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenLastCalledWith({
        key: 'session-harness', text: 'Versión corregida.',
      })
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()

      // A permanently rejected native append restores the cursor and reports
      // the error, but must not spin an unbounded microtask retry loop.
      rejectNativeSpeech = true
      streamVoiceAssistantResponse(
        'assistant:harness:rejected', 'La voz fue rechazada.', activatedAt, false, false, true,
      )
      await Promise.resolve()
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(5)
      rejectNativeSpeech = false

      // If the data channel is temporarily unwritable when Hardness returns,
      // keep the answer queued for Codex instead of falling back to system TTS.
      if (channel !== undefined) channel.readyState = 'connecting'
      // A settled step can precede a browser tool; Live must wait for
      // the actual completed Turn, never narrate premature progress.
      streamVoiceAssistantResponse(
        'assistant:harness:interim',
        'Sigo en ello.',
        activatedAt,
        true,
      )
      speakVoiceAssistantResponse(
        'assistant:harness:1',
        'La tarea terminó correctamente.',
        activatedAt,
      )
      expect(channel?.send).toHaveBeenCalledTimes(2)

      if (channel !== undefined) channel.readyState = 'open'
      if (peer !== undefined) {
        peer.connectionState = 'connected'
        peer.onconnectionstatechange?.()
      }
      await Promise.resolve()
      // V3 uses the authenticated Codex app-server appendSpeech RPC: a
      // response.create with ad hoc instructions on the raw datachannel is
      // not the official pathway for client-selected speech.
      expect(realtimeSpeak).toHaveBeenCalledWith({
        key: 'session-harness', text: 'La tarea terminó correctamente.',
      })
      expect(document.documentElement.dataset.phoenixVoiceSpeechStatus).toBe('accepted')
      expect(channel?.send).toHaveBeenCalledTimes(2)
      expect(audio?.muted).toBe(false)
      // V3 may surface first audio frames before the response.created event.
      // A harness-approved utterance must never stay accidentally muted.
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.output_audio.delta' }) })
      expect(audio?.muted).toBe(false)
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.created' }) })
      expect(audio?.muted).toBe(false)

      // A second spoken event queues until the real completion of the
      // first response; keep the same Codex V3 speech channel serialized.
      expect(speakVoiceAssistantAttention(
        'Aprobación 550e8400-e29b-41d4-a716-446655440000',
        'Revisa la acción antes de continuar; referencia 123456789 needs attention.',
      )).toBe(true)
      expect(realtimeSpeak).toHaveBeenCalledTimes(6)
      // User turn markers must not complete the assistant's speech.
      channel?.onmessage?.({ data: JSON.stringify({ type: 'turn.done', turn: { role: 'user' } }) })
      expect(realtimeSpeak).toHaveBeenCalledTimes(6)
      // V3 completes spoken output using assistant turn.done.
      channel?.onmessage?.({ data: JSON.stringify({ type: 'turn.done', turn: { role: 'assistant' } }) })
      // Generation is finished, but the WebRTC speaker may still be draining
      // previously buffered audio. Keep Kira audible until an explicit cancel.
      expect(audio?.muted).toBe(false)
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(7)
      const attention = realtimeSpeak.mock.calls
        .map(call => call[0])
        .find(request => request.text.includes('Revisa la acción'))
      expect(attention).toBeDefined()
      expect(attention?.text).not.toContain('550e8400-e29b-41d4-a716-446655440000')
      expect(attention?.text).not.toContain('123456789 needs attention')
      expect(attention?.text).toContain('Revisa la acción')

      expect(interruptVoiceAssistantSpeech()).toBe(true)
      expect(JSON.parse(String(channel?.send.mock.calls[2]?.[0]))).toEqual({ type: 'response.cancel' })

      // The Realtime model must not autonomously claim a tool is running:
      // no harness-final request is active, so abort unsolicited responses.
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.created' }) })
      expect(JSON.parse(String(channel?.send.mock.calls[3]?.[0]))).toEqual({ type: 'response.cancel' })
      expect(audio?.muted).toBe(true)
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(7)

      // A stale renderer from another UI session may share turn/step numbers,
      // but it cannot append speech to this session's native Codex call.
      const beforeForeignSession = realtimeSpeak.mock.calls.length
      streamVoiceAssistantResponse(
        'session-b:assistant:turn-1:step-1',
        'No debe salir por la sesión anterior.',
        activatedAt,
        false,
        false,
        true,
        'session-b',
      )
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(beforeForeignSession)

      // A short tail can finish its only stable sentence before the harness
      // emits the final message projection. The final projection must mark
      // that accepted cursor as spoken instead of recreating it at zero.
      const beforeStableTail = realtimeSpeak.mock.calls.length
      streamVoiceAssistantResponse(
        'assistant:harness:stable-tail',
        'Una sola frase estable.',
        activatedAt,
        false,
        false,
        true,
      )
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenLastCalledWith({
        key: 'session-harness', text: 'Una sola frase estable.',
      })
      const afterStableSentence = realtimeSpeak.mock.calls.length
      expect(afterStableSentence).toBe(beforeStableTail + 1)
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenCalledTimes(afterStableSentence)
      streamVoiceAssistantResponse(
        'assistant:harness:stable-tail',
        'Una sola frase estable.',
        activatedAt,
        true,
        false,
        true,
      )
      // A duplicate final projection has the same result: one accepted native
      // request, no replay after the stream cursor is finalized.
      streamVoiceAssistantResponse(
        'assistant:harness:stable-tail',
        'Una sola frase estable.',
        activatedAt,
        true,
        false,
        true,
      )
      expect(realtimeSpeak).toHaveBeenCalledTimes(afterStableSentence)

      // The separately rendered completed turn uses the same canonical key.
      speakVoiceAssistantResponse('assistant:harness:stable-tail', 'Una sola frase estable.', activatedAt)
      expect(realtimeSpeak).toHaveBeenCalledTimes(afterStableSentence)
      // View unmount/remount preserves completed admission; an explicit
      // rewrite revokes it even after the cursor has drained.
      cancelVoiceAssistantSentenceStream('assistant:harness:stable-tail', true)
      streamVoiceAssistantResponse('assistant:harness:stable-tail', 'Una sola frase estable.', activatedAt, true, true, true)
      expect(realtimeSpeak).toHaveBeenCalledTimes(afterStableSentence)
      cancelVoiceAssistantSentenceStream('assistant:harness:stable-tail')
      streamVoiceAssistantResponse('assistant:harness:stable-tail', 'Respuesta corregida.', activatedAt, true, true, true)
      await Promise.resolve()
      expect(realtimeSpeak).toHaveBeenLastCalledWith({ key: 'session-harness', text: 'Respuesta corregida.' })
      channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
      await Promise.resolve()

      // Native completion may arrive before the Host RPC result. Retain one
      // in-flight operation until explicit admission; rejection is never a
      // delivered final token, and a later render may retry once.
      for (const outcome of ['accepted', 'rejected', 'failed'] as const) {
        let resolveAdmission!: (receipt: NativeReceipt) => void
        let rejectAdmission!: (error: Error) => void
        delayedNativeSpeech = new Promise((resolve, reject) => {
          resolveAdmission = resolve
          rejectAdmission = reject
        })
        const messageKey = `assistant:harness:terminal-before-${outcome}`
        const beforeAdmission = realtimeSpeak.mock.calls.length
        streamVoiceAssistantResponse(messageKey, 'Una respuesta autorizada.', activatedAt, true, false, true)
        channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
        streamVoiceAssistantResponse(messageKey, 'Una respuesta autorizada.', activatedAt, true, false, true)
        expect(realtimeSpeak).toHaveBeenCalledTimes(beforeAdmission + 1)
        if (outcome === 'failed') rejectAdmission(new Error('fixture admission failed'))
        else resolveAdmission({ ok: true, value: { accepted: outcome === 'accepted', ...(outcome === 'rejected' ? { reason: 'disabled' } : {}) } })
        await vi.waitFor(() => expect(document.documentElement.dataset.phoenixVoiceSpeechStatus).toBe(outcome))
        streamVoiceAssistantResponse(messageKey, 'Una respuesta autorizada.', activatedAt, true, false, true)
        expect(realtimeSpeak).toHaveBeenCalledTimes(beforeAdmission + (outcome === 'accepted' ? 1 : 2))
        await Promise.resolve()
        channel?.onmessage?.({ data: JSON.stringify({ type: 'response.done' }) })
        await Promise.resolve()
      }
      const beforeForeignTail = realtimeSpeak.mock.calls.length
      speakVoiceAssistantResponse('session-b:assistant:turn-1:step-1', 'Otra sesión.', activatedAt, 'session-b')
      expect(realtimeSpeak).toHaveBeenCalledTimes(beforeForeignTail)

      // Telegram/browser disconnection must never leave voice stuck: grant a
      // short reconnection window, then release the mic and return to text.
      vi.useFakeTimers()
      if (peer !== undefined) {
        peer.connectionState = 'disconnected'
        peer.onconnectionstatechange?.()
      }
      expect(isCodexRealtimeVoiceActive()).toBe(true)
      await vi.advanceTimersByTimeAsync(30_001)
      expect(isCodexRealtimeVoiceActive()).toBe(false)
      expect(getVoiceAssistantSnapshot().active).toBe(false)
      expect(audio?.isConnected).toBe(false)
    } finally {
      vi.useRealTimers()
      await stopCodexRealtimeVoice()
      disposeRemote()
      disposeRoute()
      disposeTranscript()
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

  it('routes streaming speech to Host Kokoro even when it is not the neural provider flag', async () => {
    const status = vi.fn(async () => ({
      ok: true as const,
      value: { enabled: true, natural: false, provider: 'kokoro' },
    }))
    const speak = vi.fn(async (_request: {
      readonly key: string
      readonly sequence: number
      readonly text: string
      readonly language?: string
      readonly final?: boolean
    }) => ({
      ok: true as const,
      value: { accepted: true, provider: 'kokoro' },
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
        language: 'es-DO',
      })

      expect(interruptVoiceAssistantSpeech()).toBe(true)
      await Promise.resolve()
      expect(cancel).toHaveBeenCalledWith({ key: 'assistant:2:1' })
    } finally {
      setVoiceAssistantActive(false)
      dispose()
    }
  })

  it('does not send unfinished clauses to neural speech where filler words can be generated', async () => {
    const speak = vi.fn(async () => ({
      ok: true as const,
      value: { accepted: true, provider: 'kokoro' },
    }))
    const dispose = configureVoiceAssistantRemote({
      conversationStatus: async () => ({
        ok: true as const,
        value: { enabled: true, natural: true, provider: 'kokoro' },
      }),
      conversationSpeak: speak,
      conversationCancel: async () => ({
        ok: true as const,
        value: { cancelled: 0 },
      }),
    })
    try {
      await refreshVoiceAssistantRemote()
      setVoiceAssistantActive(true)
      const started = getVoiceAssistantSnapshot().activatedAt
      const growing = 'Esta conversación sigue generando una explicación larga sin haber terminado todavía la frase '.repeat(3)
      streamVoiceAssistantResponse('assistant:unfinished', growing, started)
      await Promise.resolve()
      expect(speak).not.toHaveBeenCalled()
      streamVoiceAssistantResponse('assistant:unfinished', growing.trim() + '.', started, true)
      await Promise.resolve()
      expect(speak).toHaveBeenCalled()
      expect(speak.mock.calls.length).toBeGreaterThan(0)
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
