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
  conversationalSpeechText, createSpeechOutput, hasSpeechOutput, nextStreamingSpeechSegment,
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
let voiceAssistantRemoteNatural = false
let voiceAssistantRemoteEpoch = 0
let remoteSpeech: RemoteSpeechState | undefined

/** Current provider/model route read from the Host only when voice starts. */
export interface VoiceModelRoute {
  readonly provider: string
  readonly model: string
}

type VoiceModelRouteResolver = (sessionKey: string) => Promise<VoiceModelRoute | undefined>

interface CodexRealtimeVoiceSession {
  readonly key: string
  readonly peer: RTCPeerConnection
  readonly microphone: MediaStream
  readonly events: RTCDataChannel
  readonly audio: HTMLAudioElement
}

let voiceModelRouteResolver: VoiceModelRouteResolver | undefined
let codexRealtimeVoiceSession: CodexRealtimeVoiceSession | undefined
let codexRealtimeVoiceGeneration = 0

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

function resetRemoteSpeech(cancel = false): void {
  const current = remoteSpeech
  remoteSpeech = undefined
  if (cancel && current !== undefined && voiceAssistantRemote !== undefined) {
    void voiceAssistantRemote.conversationCancel({ key: current.key }).catch(() => {})
  }
}

function browserSpeech(messageKey: string, text: string, final: boolean): void {
  if (!hasSpeechOutput()) return
  if (voiceAssistantSpeech === undefined || voiceAssistantSpeechKey !== messageKey) {
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeechKey = messageKey
    voiceAssistantSpeech = createSpeechOutput((state) => {
      if (!voiceAssistantSnapshot.active || voiceAssistantSpeechKey !== messageKey) return
      if (state === 'speaking') publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
      else publishVoiceIdle()
    })
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
  if (!voiceAssistantRemoteNatural || remote === undefined) return false
  const transcript = conversationalSpeechText(text)
  if (transcript === '') return true

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
      final: isFinalSegment,
    }).then((result) => {
      if (remoteSpeech !== state || state.generation !== generation) return
      if (!result.ok || !result.value.accepted) {
        // Host lost the neural route after the capability probe. Disable it
        // until the next explicit refresh and preserve audible output locally.
        voiceAssistantRemoteNatural = false
        resetRemoteSpeech(true)
        browserSpeech(messageKey, text, final)
        return
      }
      remoteSpeechFinished(state, generation)
    }, () => {
      if (remoteSpeech !== state || state.generation !== generation) return
      voiceAssistantRemoteNatural = false
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
 * openai-codex. A Codex route never silently degrades to browser/local speech:
 * failures stay failures so the UI cannot make a fallback voice sound like
 * native Codex Realtime.
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

    codexRealtimeVoiceSession = { key: sessionKey, peer, microphone, events, audio }
    setVoiceAssistantActive(true)
    setVoiceAssistantListening(true)

    peer.onconnectionstatechange = () => {
      if (codexRealtimeVoiceSession?.peer !== peer) return
      if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed'
        || peer?.connectionState === 'disconnected') {
        void stopCodexRealtimeVoice()
        setVoiceAssistantActive(false)
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

function updateCodexRealtimePhase(payload: string): void {
  if (!voiceAssistantSnapshot.active || codexRealtimeVoiceSession === undefined) return
  let type = ''
  try {
    const value = JSON.parse(payload) as { type?: unknown }
    if (typeof value.type === 'string') type = value.type
  } catch {
    return
  }
  if (type.includes('speech_started')) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'listening' })
    return
  }
  if (type === 'response.created' || type.includes('output_audio')) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    return
  }
  if (type === 'response.done' || type.includes('speech_stopped')) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'listening' })
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
    voiceAssistantRemoteNatural = false
    voiceAssistantRemoteEpoch += 1
  }
}

/**
 * Re-probe the Host voice route after initial mount or connection reset.
 * @returns Whether the Host currently exposes the natural neural route.
 */
export async function refreshVoiceAssistantRemote(): Promise<boolean> {
  const remote = voiceAssistantRemote
  if (remote === undefined) {
    voiceAssistantRemoteNatural = false
    return false
  }
  const epoch = voiceAssistantRemoteEpoch
  try {
    const result = await remote.conversationStatus()
    if (epoch !== voiceAssistantRemoteEpoch || voiceAssistantRemote !== remote) return false
    voiceAssistantRemoteNatural = result.ok && result.value.enabled && result.value.natural
    return voiceAssistantRemoteNatural
  } catch {
    if (epoch === voiceAssistantRemoteEpoch && voiceAssistantRemote === remote) {
      voiceAssistantRemoteNatural = false
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
  const hadRealtimeSpeech = realtime !== undefined && voiceAssistantSnapshot.phase === 'speaking'
  if (hadRealtimeSpeech && realtime.events.readyState === 'open') {
    try { realtime.events.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* peer cleanup owns closure */ }
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
): void {
  if (!voiceAssistantSnapshot.active
    || text.trim() === '' || messageTime < voiceAssistantSnapshot.activatedAt - 1_000) return
  if (spokenAssistantMessages.has(messageKey)) return
  voiceAssistantSpokenText = text

  const realtime = codexRealtimeVoiceSession
  if (realtime !== undefined) {
    // While native realtime is active, the text Agent remains authoritative.
    // Streamed partials stay in chat; the finalized harness answer is handed
    // back to the realtime channel only for spoken rendering.
    if (!final) return
    if (realtime.events.readyState === 'open') {
      try {
        realtime.events.send(JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `Speak the following PHOENIX assistant response faithfully. Do not add claims, actions, or extra content.\n\n${conversationalSpeechText(text)}`,
          },
        }))
        spokenAssistantMessages.add(messageKey)
        publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
        return
      } catch {
        // Fall through to the normal Host/browser speech path if the live
        // channel races with closure after the peer-state check.
      }
    }
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
  streamVoiceAssistantResponse(messageKey, text, messageTime, true)
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
