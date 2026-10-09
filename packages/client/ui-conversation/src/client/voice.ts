/** Browser-native voice input adapter used by the conversation composer. */

import type {
  VoiceConversationCancelReceipt,
  VoiceConversationRealtimeStartReceipt,
  VoiceConversationRealtimeStartRequest,
  VoiceConversationRealtimeStatus,
  VoiceConversationRealtimeStopReceipt,
  VoiceConversationSpeakReceipt,
  VoiceConversationSpeakRequest,
  VoiceConversationStatus,
} from '@phoenix-ai/dsh-api-remotes/client'
import {
  conversationalSpeechText, createSpeechOutput, hasSpeechOutput, nextStreamingSpeechSegment, spokenLanguage,
  type SpeechOutput,
} from './speech-output.ts'

/** States exposed by the short-lived browser recognition session. */
export type VoiceInputState = 'idle' | 'listening' | 'unsupported' | 'permission-denied' | 'error'

/** Public phase of the browser-native, hands-free assistant mode. */
export type VoiceAssistantPhase = 'inactive' | 'paused' | 'listening' | 'speaking'

/** Snapshot shared by the composer and finalized assistant-message tails. */
export interface VoiceAssistantSnapshot {
  readonly active: boolean
  readonly phase: VoiceAssistantPhase
  /** Wall-clock activation point used to avoid reading old history on enable. */
  readonly activatedAt: number
}


/** Minimal generated Remote envelope used without importing Host code. */
type VoiceRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Host voice namespace mounted by @phoenix-ai/dsh-api-remotes. */
export interface VoiceAssistantRemote {
  conversationStatus(): Promise<VoiceRemoteResult<VoiceConversationStatus>>
  conversationSpeak(request: VoiceConversationSpeakRequest): Promise<VoiceRemoteResult<VoiceConversationSpeakReceipt>>
  conversationCancel(request: { readonly key: string }): Promise<VoiceRemoteResult<VoiceConversationCancelReceipt>>
  /** Newer Hosts expose native Codex realtime; optional keeps rolling upgrades compatible. */
  conversationRealtimeStatus?(): Promise<VoiceRemoteResult<VoiceConversationRealtimeStatus>>
  conversationRealtimeStart?(
    request: VoiceConversationRealtimeStartRequest,
  ): Promise<VoiceRemoteResult<VoiceConversationRealtimeStartReceipt>>
  conversationRealtimeStop?(request: { readonly key: string }): Promise<VoiceRemoteResult<VoiceConversationRealtimeStopReceipt>>
}

interface RemoteSpeechState {
  readonly key: string
  generation: number
  transcript: string
  through: number
  sequence: number
  pending: number
  final: boolean
}

const INACTIVE_VOICE_ASSISTANT: VoiceAssistantSnapshot = Object.freeze({
  active: false,
  phase: 'inactive',
  activatedAt: 0,
})
let voiceAssistantSnapshot: VoiceAssistantSnapshot = INACTIVE_VOICE_ASSISTANT
const voiceAssistantListeners = new Set<() => void>()
const spokenAssistantMessages = new Set<string>()
let voiceAssistantSpeech: SpeechOutput | undefined
let voiceAssistantSpeechKey: string | undefined
let voiceAssistantMicListening = false
let voiceAssistantSpokenText = ''
let voiceAssistantRemote: VoiceAssistantRemote | undefined
let voiceAssistantRemoteSpeech = false
let voiceAssistantRemoteEpoch = 0
let remoteSpeech: RemoteSpeechState | undefined

/** Current provider/model route read from the Host only when voice starts. */
export interface VoiceModelRoute {
  readonly provider: string
  readonly model: string
}

type VoiceModelRouteResolver = (sessionKey: string) => Promise<VoiceModelRoute | undefined>
type CodexRealtimeUserTranscriptHandler = (text: string) => void

interface CodexRealtimeVoiceSession {
  readonly key: string
  readonly peer: RTCPeerConnection
  readonly microphone: MediaStream
  readonly events: RTCDataChannel
  readonly audio: HTMLAudioElement
  /** Single authorized harness-owned speech request currently in flight. */
  activeUtterance?: PendingCodexRealtimeUtterance
  /** Recent distinct human transcripts for this WebRTC call, not per render. */
  readonly recentTranscripts: Map<string, number>
}

interface PendingCodexRealtimeUtterance {
  readonly sessionKey: string
  readonly key: string
  readonly instructions: string
  readonly echoText: string
  readonly assistantMessageKey?: string
}

let voiceModelRouteResolver: VoiceModelRouteResolver | undefined
let codexRealtimeUserTranscriptHandler: CodexRealtimeUserTranscriptHandler | undefined
let codexRealtimeVoiceSession: CodexRealtimeVoiceSession | undefined
let codexRealtimeVoiceGeneration = 0
const pendingCodexRealtimeUtterances: PendingCodexRealtimeUtterance[] = []

function publishVoiceAssistant(next: VoiceAssistantSnapshot): void {
  voiceAssistantSnapshot = next
  for (const listener of voiceAssistantListeners) listener()
}


function publishVoiceIdle(): void {
  if (!voiceAssistantSnapshot.active) return
  publishVoiceAssistant({
    ...voiceAssistantSnapshot,
    phase: voiceAssistantMicListening ? 'listening' : 'paused',
  })
}

function sendCodexRealtimeUtterance(
  session: CodexRealtimeVoiceSession,
  utterance: PendingCodexRealtimeUtterance,
): boolean {
  if (session.key !== utterance.sessionKey || session.events.readyState !== 'open'
    || session.activeUtterance !== undefined) return false
  try {
    session.events.send(JSON.stringify({
      type: 'response.create',
      response: { instructions: utterance.instructions },
    }))
  } catch {
    return false
  }
  session.activeUtterance = utterance
  voiceAssistantSpokenText = utterance.echoText
  if (utterance.assistantMessageKey !== undefined) {
    spokenAssistantMessages.add(utterance.assistantMessageKey)
  }
  publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
  return true
}

function queueCodexRealtimeUtterance(utterance: PendingCodexRealtimeUtterance): void {
  const existing = pendingCodexRealtimeUtterances.findIndex(candidate =>
    candidate.sessionKey === utterance.sessionKey && candidate.key === utterance.key)
  if (existing >= 0) pendingCodexRealtimeUtterances[existing] = utterance
  else pendingCodexRealtimeUtterances.push(utterance)
  if (pendingCodexRealtimeUtterances.length > 4) pendingCodexRealtimeUtterances.shift()
}

function flushCodexRealtimeUtterances(session: CodexRealtimeVoiceSession): void {
  for (let index = 0; index < pendingCodexRealtimeUtterances.length;) {
    const utterance = pendingCodexRealtimeUtterances[index]
    if (utterance === undefined || utterance.sessionKey !== session.key) {
      index += 1
      continue
    }
    if (!sendCodexRealtimeUtterance(session, utterance)) return
    pendingCodexRealtimeUtterances.splice(index, 1)
  }
}

function discardCodexRealtimeUtterances(sessionKey: string): void {
  for (let index = pendingCodexRealtimeUtterances.length - 1; index >= 0; index -= 1) {
    if (pendingCodexRealtimeUtterances[index]?.sessionKey === sessionKey) {
      pendingCodexRealtimeUtterances.splice(index, 1)
    }
  }
}

function resetRemoteSpeech(cancel = false): void {
  const current = remoteSpeech
  remoteSpeech = undefined
  if (cancel && current !== undefined && voiceAssistantRemote !== undefined) {
    void voiceAssistantRemote.conversationCancel({ key: current.key }).catch(() => {})
  }
}

function browserSpeech(messageKey: string, text: string, final: boolean): void {
  if (!hasSpeechOutput()) return
  const language = spokenLanguage(text, typeof document === 'undefined' ? undefined : document.documentElement.lang)
  if (voiceAssistantSpeech === undefined || voiceAssistantSpeechKey !== messageKey) {
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeechKey = messageKey
    voiceAssistantSpeech = createSpeechOutput((state) => {
      if (!voiceAssistantSnapshot.active || voiceAssistantSpeechKey !== messageKey) return
      if (state === 'speaking') publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
      else publishVoiceIdle()
    }, language)
  }
  voiceAssistantSpeech.update(text, final)
}

function remoteSpeechFinished(state: RemoteSpeechState, generation: number): void {
  if (remoteSpeech !== state || state.generation !== generation) return
  state.pending = Math.max(0, state.pending - 1)
  if (state.pending === 0) {
    if (state.final) remoteSpeech = undefined
    publishVoiceIdle()
  }
}

function streamRemoteSpeech(messageKey: string, text: string, final: boolean): boolean {
  const remote = voiceAssistantRemote
  if (!voiceAssistantRemoteSpeech || remote === undefined) return false
  const transcript = conversationalSpeechText(text)
  if (transcript === '') return true
  const language = spokenLanguage(transcript, typeof document === 'undefined' ? undefined : document.documentElement.lang)

  let state = remoteSpeech
  if (state === undefined || state.key !== messageKey || !transcript.startsWith(state.transcript)) {
    resetRemoteSpeech(state !== undefined)
    state = {
      key: messageKey,
      generation: (state?.generation ?? 0) + 1,
      transcript: '',
      through: 0,
      sequence: 0,
      pending: 0,
      final: false,
    }
    remoteSpeech = state
  }
  state.transcript = transcript
  state.final = final

  let queued = false
  while (true) {
    const planned = nextStreamingSpeechSegment(state.transcript, state.through, final)
    if (planned === undefined) break
    // A neural TTS engine can fill an unfinished clause with unwanted syllables.
    // Wait for punctuation instead of feeding arbitrary 180-character cuts
    // while the model is still streaming; flush the remainder at completion.
    if (!final && !/[.!?…;:]$/u.test(planned.text)) break
    state.through = planned.end
    const sequence = state.sequence++
    const generation = state.generation
    const isFinalSegment = final && state.through >= state.transcript.length
    state.pending += 1
    queued = true
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    void remote.conversationSpeak({
      key: messageKey,
      sequence,
      text: planned.text,
      language,
      final: isFinalSegment,
    }).then((result) => {
      if (remoteSpeech !== state || state.generation !== generation) return
      if (!result.ok || !result.value.accepted) {
        // Host lost its selected conversation TTS route after the capability
        // probe. Disable it until the next explicit refresh and preserve audible
        // output locally. The Host normally orders Kokoro before system TTS.
        voiceAssistantRemoteSpeech = false
        resetRemoteSpeech(true)
        browserSpeech(messageKey, text, final)
        return
      }
      remoteSpeechFinished(state, generation)
    }, () => {
      if (remoteSpeech !== state || state.generation !== generation) return
      voiceAssistantRemoteSpeech = false
      resetRemoteSpeech(true)
      browserSpeech(messageKey, text, final)
    })
  }

  if (final && !queued && state.pending === 0) {
    remoteSpeech = undefined
    publishVoiceIdle()
  }
  return true
}

/**
 * Attach a lightweight current-model resolver. The conversation package stays
 * independent of the model-selector UI and asks the Host's session.models
 * endpoint only when the user explicitly starts voice.
 * @param resolver - Host-backed provider/model resolver.
 * @returns Disposer for the resolver registration.
 */
export function configureVoiceModelRouteResolver(resolver: VoiceModelRouteResolver): () => void {
  voiceModelRouteResolver = resolver
  return () => {
    if (voiceModelRouteResolver === resolver) voiceModelRouteResolver = undefined
  }
}

/**
 * Bind the current conversation composer as the admission path for finalized
 * native Codex Live user speech. The WebRTC microphone remains the only audio
 * capture while Live is active; this callback receives text, not microphone data.
 * @param handler - Composer-owned finalized user-transcript admission callback.
 * @returns Disposer that removes this exact handler registration.
 */
export function configureCodexRealtimeUserTranscriptHandler(
  handler: CodexRealtimeUserTranscriptHandler,
): () => void {
  codexRealtimeUserTranscriptHandler = handler
  return () => {
    if (codexRealtimeUserTranscriptHandler === handler) codexRealtimeUserTranscriptHandler = undefined
  }
}

/** Minimal browser surface needed to capability-probe Codex Realtime WebRTC. */
export interface CodexRealtimeVoiceWindow {
  readonly RTCPeerConnection?: unknown
  readonly navigator?: {
    readonly mediaDevices?: {
      readonly getUserMedia?: unknown
    }
  }
}

/** Check browser primitives required for direct Codex Realtime WebRTC.
 * @param scope Browser globals to inspect; defaults to the current window when available.
 * @returns Whether WebRTC and microphone acquisition are available.
 */
export function hasCodexRealtimeVoiceSupport(
  scope: CodexRealtimeVoiceWindow | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  return scope !== undefined
    && typeof scope.RTCPeerConnection === 'function'
    && typeof scope.navigator?.mediaDevices?.getUserMedia === 'function'
}

/** Identify the currently active hands-free transport.
 * @returns Whether a direct Codex WebRTC session is active.
 */
export function isCodexRealtimeVoiceActive(): boolean {
  return codexRealtimeVoiceSession !== undefined
}

/** Result of one attempt to enter the native Codex realtime voice path. */
export type CodexRealtimeVoiceStartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'not-codex' }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * Prefer native Codex realtime when the selected PHOENIX provider is
 * openai-codex. Startup failures remain classified so the caller can deliberately
 * enter the documented Kokoro -> platform fallback without mislabeling that
 * fallback as native Codex Realtime.
 * @param sessionKey Conversation whose selected model route determines the voice provider.
 * @returns Started, non-Codex route, or a classified startup failure.
 */
export async function tryStartCodexRealtimeVoice(
  sessionKey: string,
): Promise<CodexRealtimeVoiceStartResult> {
  const resolveRoute = voiceModelRouteResolver
  if (resolveRoute === undefined) return { kind: 'failed', reason: 'route-unavailable' }

  let route: VoiceModelRoute | undefined
  try {
    route = await resolveRoute(sessionKey)
  } catch {
    return { kind: 'failed', reason: 'route-unavailable' }
  }
  if (route?.provider !== 'openai-codex') return { kind: 'not-codex' }

  const remote = voiceAssistantRemote
  if (remote === undefined || remote.conversationRealtimeStatus === undefined
    || remote.conversationRealtimeStart === undefined) {
    return { kind: 'failed', reason: 'host-realtime-unavailable' }
  }
  if (!hasCodexRealtimeVoiceSupport()) {
    return { kind: 'failed', reason: 'browser-webrtc-unavailable' }
  }

  try {
    const capability = await remote.conversationRealtimeStatus()
    if (!capability.ok) return { kind: 'failed', reason: capability.error.code }
    if (!capability.value.enabled || !capability.value.available || !capability.value.authenticated) {
      return {
        kind: 'failed',
        reason: capability.value.reason ?? 'codex-realtime-unavailable',
      }
    }
  } catch {
    return { kind: 'failed', reason: 'capability-probe-failed' }
  }

  const generation = ++codexRealtimeVoiceGeneration
  let microphone: MediaStream | undefined
  let peer: RTCPeerConnection | undefined
  let events: RTCDataChannel | undefined
  let audio: HTMLAudioElement | undefined
  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (generation !== codexRealtimeVoiceGeneration) {
      for (const track of microphone.getTracks()) track.stop()
      return { kind: 'failed', reason: 'start-superseded' }
    }

    peer = new RTCPeerConnection()
    events = peer.createDataChannel('oai-events', { ordered: true })
    audio = document.createElement('audio')
    audio.autoplay = true
    // Realtime's VAD can emit speech without a harness request. Do not play it.
    audio.muted = true
    audio.dataset.phoenixCodexVoice = 'true'
    audio.style.display = 'none'
    document.body.append(audio)

    for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone)
    peer.ontrack = (event) => {
      if (codexRealtimeVoiceGeneration !== generation || audio === undefined) return
      const stream = event.streams[0] ?? new MediaStream([event.track])
      audio.srcObject = stream
      void audio.play().catch(() => {})
    }
    events.onmessage = (event) => {
      if (codexRealtimeVoiceGeneration !== generation || typeof event.data !== 'string') return
      forwardCodexRealtimeUserTranscript(event.data)
      updateCodexRealtimePhase(event.data)
    }
    events.onopen = () => {
      if (codexRealtimeVoiceGeneration !== generation || events === undefined) return
      // The realtime model supplies low-latency audio and transcription only.
      // Phoenix's live Agent must own the actual turn so every spoken request
      // uses the same harness, tools, policies, persistence, and verification
      // as a typed message. Disable VAD-created autonomous model responses.
      try {
        events.send(JSON.stringify({
          type: 'session.update',
          session: {
            turn_detection: {
              type: 'server_vad',
              create_response: false,
              interrupt_response: true,
            },
          },
        }))
      } catch {
        // A concurrently closing channel is handled by the peer-state cleanup.
      }
      const liveSession = codexRealtimeVoiceSession
      if (liveSession !== undefined && liveSession.key === sessionKey && liveSession.events === events) {
        flushCodexRealtimeUtterances(liveSession)
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await waitForIceGathering(peer)
    const offerSdp = peer.localDescription?.sdp
    if (offerSdp === undefined || offerSdp.trim() === '') throw new Error('webrtc-offer-empty')

    const result = await remote.conversationRealtimeStart({
      key: sessionKey,
      offerSdp,
      model: route.model,
    })
    if (!result.ok) throw new Error(result.error.code)
    if (!result.value.accepted || result.value.answerSdp === undefined) {
      throw new Error(result.value.detail ?? result.value.reason ?? 'codex-realtime-rejected')
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: result.value.answerSdp })
    if (generation !== codexRealtimeVoiceGeneration) throw new Error('start-superseded')

    codexRealtimeVoiceSession = { key: sessionKey, peer, microphone, events, audio, recentTranscripts: new Map() }
    setVoiceAssistantActive(true)
    setVoiceAssistantListening(true)

    peer.onconnectionstatechange = () => {
      const liveSession = codexRealtimeVoiceSession
      if (liveSession === undefined || liveSession.peer !== peer) return
      if (peer?.connectionState === 'connected') {
        // WebRTC "disconnected" is explicitly transient. A long Hardness/tool
        // turn can pass through it and reconnect without renegotiating voice.
        flushCodexRealtimeUtterances(liveSession)
        return
      }
      if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed') {
        // Native Live lost ownership. Keep the explicit hands-free mode active:
        // InputBar observes the published idle state and attaches browser
        // recognition, while assistant output falls through Host TTS in the
        // strict Kokoro -> platform order. The PHOENIX task itself keeps running.
        discardCodexRealtimeUtterances(liveSession.key)
        void stopCodexRealtimeVoice().finally(() => {
          if (voiceAssistantSnapshot.active) publishVoiceIdle()
        })
      }
    }
    return { kind: 'started' }
  } catch (error) {
    if (peer !== undefined) peer.close()
    if (microphone !== undefined) {
      for (const track of microphone.getTracks()) track.stop()
    }
    if (audio !== undefined) {
      audio.pause()
      audio.srcObject = null
      audio.remove()
    }
    if (events !== undefined && events.readyState !== 'closed') events.close()
    if (generation === codexRealtimeVoiceGeneration) {
      void remote.conversationRealtimeStop?.({ key: sessionKey }).catch(() => {})
    }
    return {
      kind: 'failed',
      reason: error instanceof Error && error.message !== '' ? error.message : 'realtime-start-failed',
    }
  }
}

/** Stop the direct Codex call and release mic/audio/WebRTC resources immediately.
 * @returns Whether an active session was released; remote cleanup is best effort.
 */
export async function stopCodexRealtimeVoice(): Promise<boolean> {
  const session = codexRealtimeVoiceSession
  codexRealtimeVoiceGeneration += 1
  codexRealtimeVoiceSession = undefined
  if (session === undefined) return false

  setVoiceAssistantListening(false)
  discardCodexRealtimeUtterances(session.key)
  session.events.close()
  session.peer.close()
  for (const track of session.microphone.getTracks()) track.stop()
  session.audio.pause()
  session.audio.srcObject = null
  session.audio.remove()

  const remote = voiceAssistantRemote
  if (remote !== undefined) {
    await remote.conversationRealtimeStop?.({ key: session.key }).catch(() => undefined)
  }
  return true
}

function forwardCodexRealtimeUserTranscript(payload: string): void {
  const handler = codexRealtimeUserTranscriptHandler
  if (handler === undefined) return
  let value: unknown
  try {
    value = JSON.parse(payload) as unknown
  } catch {
    return
  }
  if (typeof value !== 'object' || value === null) return
  const event = value as Record<string, unknown>
  const type = typeof event.type === 'string' ? event.type : ''

  let transcript: string | undefined
  if (type === 'turn.done') {
    const turn = typeof event.turn === 'object' && event.turn !== null
      ? event.turn as Record<string, unknown>
      : undefined
    if (turn?.role === 'user' && typeof turn.transcript === 'string') {
      transcript = turn.transcript
    }
  } else if (type === 'conversation.input_transcript.turn_marked'
    || type === 'conversation.item.input_audio_transcription.completed') {
    if (typeof event.transcript === 'string') transcript = event.transcript
  }

  const text = transcript?.trim()
  if (text === undefined || text === '') return
  const session = codexRealtimeVoiceSession
  if (session === undefined) return
  // One VAD utterance can appear as both turn.done and transcription.completed.
  // Deduplicate across protocols and React remounts without suppressing an
  // intentionally repeated human command after a natural pause.
  const normalized = normalizeEchoText(text)
  if (normalized === '') return
  const now = Date.now()
  for (const [key, seenAt] of session.recentTranscripts) {
    if (now - seenAt > 7_000) session.recentTranscripts.delete(key)
  }
  if (session.recentTranscripts.has(normalized)) return
  if (isLikelyVoiceAssistantEcho(text)) return
  session.recentTranscripts.set(normalized, now)
  handler(text)
}

function updateCodexRealtimePhase(payload: string): void {
  const session = codexRealtimeVoiceSession
  if (!voiceAssistantSnapshot.active || session === undefined) return
  let type = ''
  try {
    const value = JSON.parse(payload) as { type?: unknown }
    if (typeof value.type === 'string') type = value.type
  } catch {
    return
  }
  if (type === 'response.created' && session.activeUtterance === undefined) {
    session.audio.muted = true
    // Some realtime transports can start autonomous VAD replies even with
    // create_response:false. Suppress unverified "sigo en ello" narration.
    if (session.events.readyState === 'open') {
      try { session.events.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* closing peer */ }
    }
    return
  }
  if (type === 'response.created' && session.activeUtterance !== undefined) {
    session.audio.muted = false
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    return
  }
  if (type === 'response.done') {
    session.audio.muted = true
    delete session.activeUtterance
    publishVoiceIdle()
    // Serialize speech until the preceding audio response really finished.
    flushCodexRealtimeUtterances(session)
    return
  }
  if (type.includes('speech_started')) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'listening' })
    return
  }
  if ((type === 'response.created' || type.includes('output_audio'))
    && session.activeUtterance !== undefined) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    return
  }
  if (type.includes('speech_stopped') && session.activeUtterance === undefined) {
    publishVoiceIdle()
  }
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      peer.removeEventListener('icegatheringstatechange', changed)
      resolve()
    }
    const changed = (): void => {
      if (peer.iceGatheringState === 'complete') done()
    }
    const timer = window.setTimeout(done, 5_000)
    peer.addEventListener('icegatheringstatechange', changed)
  })
}

/**
 * Attach the generated Host voice namespace. Capability probing is asynchronous
 * and never blocks rendering; browser speech remains the fallback until ready.
 * @param remote - Generated Host voice Remote namespace.
 * @returns Disposer that detaches the Remote and cancels in-flight Host speech.
 */
export function configureVoiceAssistantRemote(remote: VoiceAssistantRemote): () => void {
  voiceAssistantRemote = remote
  const epoch = ++voiceAssistantRemoteEpoch
  void refreshVoiceAssistantRemote()
  return () => {
    if (voiceAssistantRemote !== remote || epoch !== voiceAssistantRemoteEpoch) return
    resetRemoteSpeech(true)
    voiceAssistantRemote = undefined
    voiceAssistantRemoteSpeech = false
    voiceAssistantRemoteEpoch += 1
  }
}

/**
 * Re-probe the Host voice route after initial mount or connection reset.
 * @returns Whether the Host currently exposes any conversation speech route.
 */
export async function refreshVoiceAssistantRemote(): Promise<boolean> {
  const remote = voiceAssistantRemote
  if (remote === undefined) {
    voiceAssistantRemoteSpeech = false
    return false
  }
  const epoch = voiceAssistantRemoteEpoch
  try {
    const result = await remote.conversationStatus()
    if (epoch !== voiceAssistantRemoteEpoch || voiceAssistantRemote !== remote) return false
    voiceAssistantRemoteSpeech = result.ok && result.value.enabled && result.value.provider !== undefined
    return voiceAssistantRemoteSpeech
  } catch {
    if (epoch === voiceAssistantRemoteEpoch && voiceAssistantRemote === remote) {
      voiceAssistantRemoteSpeech = false
    }
    return false
  }
}

/**
 * Subscribe to hands-free assistant mode changes for a browser component.
 * @param listener - Callback invoked after the immutable mode snapshot changes.
 * @returns Disposer that removes the listener.
 */
export function subscribeVoiceAssistant(listener: () => void): () => void {
  voiceAssistantListeners.add(listener)
  return () => { voiceAssistantListeners.delete(listener) }
}

/**
 * Read the current hands-free assistant mode without exposing mutable state.
 * @returns The current immutable assistant-mode snapshot.
 */
export function getVoiceAssistantSnapshot(): VoiceAssistantSnapshot {
  return voiceAssistantSnapshot
}

/**
 * Enable or disable the explicit hands-free assistant mode.
 * @param active - Whether hands-free recognition and response speech remain enabled.
 */
export function setVoiceAssistantActive(active: boolean): void {
  if (!active) {
    if (codexRealtimeVoiceSession !== undefined) void stopCodexRealtimeVoice()
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeech = undefined
    voiceAssistantSpeechKey = undefined
    resetRemoteSpeech(true)
    voiceAssistantMicListening = false
    voiceAssistantSpokenText = ''
    spokenAssistantMessages.clear()
    if (voiceAssistantSnapshot.active) publishVoiceAssistant(INACTIVE_VOICE_ASSISTANT)
    return
  }
  if (voiceAssistantSnapshot.active) return
  spokenAssistantMessages.clear()
  publishVoiceAssistant({ active: true, phase: 'paused', activatedAt: Date.now() })
}

/**
 * Reflect whether the recognizer is currently listening.
 * @param listening - Whether the browser recognizer has an active segment.
 */
export function setVoiceAssistantListening(listening: boolean): void {
  voiceAssistantMicListening = listening
  if (!voiceAssistantSnapshot.active || voiceAssistantSnapshot.phase === 'speaking') return
  publishVoiceAssistant({
    ...voiceAssistantSnapshot,
    phase: listening ? 'listening' : 'paused',
  })
}

/**
 * Cancel current assistant speech after non-echo human speech is detected.
 * @returns Whether any browser or Host speech was active and cancelled.
 */
export function interruptVoiceAssistantSpeech(): boolean {
  if (!voiceAssistantSnapshot.active) return false
  const hadBrowserSpeech = voiceAssistantSpeech !== undefined
  const hadRemoteSpeech = remoteSpeech !== undefined
  const realtime = codexRealtimeVoiceSession
  const hadPendingRealtimeSpeech = realtime !== undefined
    && pendingCodexRealtimeUtterances.some(item => item.sessionKey === realtime.key)
  const hadRealtimeSpeech = realtime !== undefined
    && (voiceAssistantSnapshot.phase === 'speaking' || hadPendingRealtimeSpeech
      || realtime.activeUtterance !== undefined)
  if (hadRealtimeSpeech && realtime.events.readyState === 'open') {
    try { realtime.events.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* peer cleanup owns closure */ }
  }
  if (realtime !== undefined) {
    realtime.audio.muted = true
    delete realtime.activeUtterance
    if (hadPendingRealtimeSpeech) discardCodexRealtimeUtterances(realtime.key)
  }
  voiceAssistantSpeech?.dispose()
  voiceAssistantSpeech = undefined
  voiceAssistantSpeechKey = undefined
  resetRemoteSpeech(true)
  if (hadBrowserSpeech || hadRemoteSpeech || hadRealtimeSpeech) publishVoiceIdle()
  return hadBrowserSpeech || hadRemoteSpeech || hadRealtimeSpeech
}

/**
 * Suppress recognizer feedback when the microphone transcribes Phoenix's own
 * loudspeaker output. Short human interjections stay intentionally exempt.
 * @param text - Final recognizer transcript to compare with current assistant speech.
 * @returns Whether the transcript is likely loudspeaker echo.
 */
export function isLikelyVoiceAssistantEcho(text: string): boolean {
  const heard = normalizeEchoText(text)
  const spoken = normalizeEchoText(voiceAssistantSpokenText)
  if (heard.length < 8 || spoken === '') return false
  if (spoken.includes(heard)) return true
  const heardTokens = heard.split(' ').filter(token => token.length >= 3)
  if (heardTokens.length < 3) return false
  const spokenTokens = new Set(spoken.split(' ').filter(token => token.length >= 3))
  const overlap = heardTokens.filter(token => spokenTokens.has(token)).length
  return overlap / heardTokens.length >= 0.8
}

/**
 * Speak one newly completed assistant message while hands-free mode is active.
 * Old history is ignored by the activation-time fence and each rendered message
 * key is spoken once, even when the transcript projection re-renders.
 * @param messageKey - stable conversation identity of the assistant message.
 * @param text - finalized assistant prose.
 * @param messageTime - durable event time in Unix milliseconds.
 * @param final - Whether this is the final transcript update for the message.
 */
export function streamVoiceAssistantResponse(
  messageKey: string,
  text: string,
  messageTime: number,
  final = false,
  fromCompletedHarnessTurn = false,
): void {
  if (!voiceAssistantSnapshot.active
    || text.trim() === '' || messageTime < voiceAssistantSnapshot.activatedAt - 1_000) return
  if (spokenAssistantMessages.has(messageKey)) return
  const realtime = codexRealtimeVoiceSession
  // Step-local assistant messages can precede more tool work. Codex Live
  // must not voice them as if a real browser action had already settled.
  if (realtime !== undefined && !fromCompletedHarnessTurn) return
  voiceAssistantSpokenText = text
  if (realtime !== undefined) {
    // Native Codex is sticky for the whole hands-free session. A temporary
    // data-channel/WebRTC pause must never substitute another TTS voice after
    // Hardness returns control. Queue the finalized harness answer until the
    // same Codex channel is writable again.
    if (!final) return
    const spoken = conversationalSpeechText(text)
    if (spoken === '') return
    const utterance: PendingCodexRealtimeUtterance = {
      sessionKey: realtime.key,
      key: `assistant:${messageKey}`,
      assistantMessageKey: messageKey,
      echoText: spoken,
      instructions: `Read only this finalized PHOENIX harness response in the user's current language and with the same voice/persona. Do not independently assess task progress, say "still working", claim tool use, or add any words.\n\n${spoken}`,
    }
    if (!sendCodexRealtimeUtterance(realtime, utterance)) {
      queueCodexRealtimeUtterance(utterance)
    }
    return
  }

  if (streamRemoteSpeech(messageKey, text, final)) {
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeech = undefined
    voiceAssistantSpeechKey = undefined
  } else {
    browserSpeech(messageKey, text, final)
  }
  if (final) spokenAssistantMessages.add(messageKey)
}

/**
 * Speak one completed response; streaming callers should use the growing-text API above.
 * @param messageKey - Stable conversation identity of the assistant message.
 * @param text - Final assistant prose.
 * @param messageTime - Durable event time in Unix milliseconds.
 */
export function speakVoiceAssistantResponse(messageKey: string, text: string, messageTime: number): void {
  streamVoiceAssistantResponse(messageKey, text, messageTime, true, true)
}

/**
 * Use the already-active Codex realtime voice for an approval/proactive alert.
 * No browser/system TTS fallback is attempted here: when Codex owns the call,
 * the user hears one continuous selected voice and never internal ids.
 * @param title - Human-facing attention title.
 * @param detail - Optional human-facing context for the notification.
 * @returns Whether active Codex Realtime accepted or queued the notification.
 */
export function speakVoiceAssistantAttention(title: string, detail?: string): boolean {
  const realtime = codexRealtimeVoiceSession
  if (!voiceAssistantSnapshot.active || realtime === undefined) return false
  const context = naturalAttentionContext(title, detail)
  const utterance: PendingCodexRealtimeUtterance = {
    sessionKey: realtime.key,
    key: `attention:${context}`,
    echoText: context,
    instructions: [
      'Give the user one brief, natural spoken notification in the user\'s current language.',
      'PHOENIX needs the user\'s input or review before continuing.',
      'Use the same voice and persona already active in this call.',
      'Do not read UUIDs, task ids, hashes, timestamps, field names, or raw numbers used only as identifiers.',
      'Avoid mechanical status-label wording; ask for the required review or input like a person would.',
      'Use the following context only to explain naturally what the user should look at:',
      context,
    ].join(' '),
  }
  if (!sendCodexRealtimeUtterance(realtime, utterance)) {
    queueCodexRealtimeUtterance(utterance)
  }
  return true
}

function naturalAttentionContext(title: string, detail?: string): string {
  const combined = [title, detail].filter((value): value is string =>
    typeof value === 'string' && value.trim() !== '').join('. ')
  const cleaned = conversationalSpeechText(combined)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, ' ')
    .replace(/\b[0-9a-f]{16,}\b/giu, ' ')
    .replace(/\b\d{6,}\b/gu, ' ')
    .replace(/\bneeds? attention\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return cleaned === '' ? 'Please ask the user naturally for the input required to continue.' : cleaned.slice(0, 360)
}

function normalizeEchoText(text: string): string {
  return conversationalSpeechText(text)
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Minimal result event needed from SpeechRecognition across browser vendors. */
export interface VoiceRecognitionResultEvent {
  readonly resultIndex?: number
  readonly results: {
    readonly length: number
    readonly [index: number]: {
      readonly isFinal?: boolean
      readonly [index: number]: { readonly transcript?: string } | undefined
    } | undefined
  }
}

/** Browser event surface used by the adapter and test doubles. */
export interface VoiceRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { readonly error?: string }) => void) | null
  onresult: ((event: VoiceRecognitionResultEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Constructor exposed by Chromium and WebKit for native speech recognition. */
export interface VoiceRecognitionConstructor {
  new (): VoiceRecognitionLike
}

/** Window subset needed to resolve the native recognition constructor. */
export interface VoiceRecognitionWindow {
  readonly SpeechRecognition?: VoiceRecognitionConstructor
  readonly webkitSpeechRecognition?: VoiceRecognitionConstructor
}

/**
 * Find the browser's native speech-recognition implementation, if present.
 * @param scope - browser-like object to inspect.
 * @returns the available recognition constructor, or undefined when unsupported.
 */
export function voiceRecognitionConstructor(scope: VoiceRecognitionWindow | undefined =
  typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow): VoiceRecognitionConstructor | undefined {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition
}

/**
 * Test whether the current browser can provide native voice dictation.
 * @param scope - browser-like object to inspect.
 * @returns true when a native recognition constructor is available.
 */
export function hasVoiceRecognition(scope: VoiceRecognitionWindow | undefined =
  typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow): boolean {
  return voiceRecognitionConstructor(scope) !== undefined
}

/**
 * Create one explicit, non-persistent recognition session.
 * @param onTranscript - receives only final, trimmed transcript fragments.
 * @param onState - receives lifecycle and permission state changes.
 * @param language - BCP-47 language sent to the browser recognizer.
 * @param scope - browser window used to resolve the constructor.
 * @returns configured recognition session, or undefined when unsupported.
 */
export function createVoiceRecognition(
  onTranscript: (text: string) => void,
  onState: (state: VoiceInputState) => void,
  language = typeof navigator === 'undefined' ? 'en-US' : navigator.language,
  scope: VoiceRecognitionWindow | undefined = typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow,
): VoiceRecognitionLike | undefined {
  const Constructor = voiceRecognitionConstructor(scope)
  if (Constructor === undefined) return undefined
  const recognition = new Constructor()
  recognition.lang = language
  recognition.continuous = true
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.onstart = () => { onState('listening') }
  recognition.onend = () => { onState('idle') }
  recognition.onerror = (event) => {
    onState(event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'permission-denied'
      : 'error')
  }
  recognition.onresult = (event) => {
    const start = event.resultIndex ?? 0
    const fragments: string[] = []
    for (let index = start; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result?.isFinal === false) continue
      const transcript = result?.[0]?.transcript?.trim()
      if (transcript !== undefined && transcript !== '') fragments.push(transcript)
    }
    if (fragments.length > 0) onTranscript(fragments.join(' '))
  }
  return recognition
}
