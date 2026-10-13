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

/**
 * Browser speech recognition may use a browser-vendor service. Never switch
 * away from subscription-backed Codex Live without prior user approval.
 * Remember that approval locally so future upstream failures need no extra
 * click, and make revocation available in the composer.
 */
const ALTERNATIVE_VOICE_CONSENT_KEY = 'phoenix:voice:approved-browser-backup-v1'

/**
 * Check whether this browser profile explicitly authorized the local voice fallback.
 * @param storage - Optional storage double used by deterministic callers.
 * @returns Whether the persisted consent marker is present.
 */
export function hasApprovedVoiceFallback(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const source = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    return source?.getItem(ALTERNATIVE_VOICE_CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

/**
 * Persist or revoke explicit consent for browser recognition fallback.
 * @param approved - Whether browser recognition may be used after native failure.
 * @param storage - Optional storage double used by deterministic callers.
 */
export function setApprovedVoiceFallback(approved: boolean, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    if (approved) target?.setItem(ALTERNATIVE_VOICE_CONSENT_KEY, 'yes')
    else target?.removeItem(ALTERNATIVE_VOICE_CONSENT_KEY)
  } catch {
    // Restricted storage must never break the voice button.
  }
}

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
  /** Official Codex thread/realtime/appendSpeech, provided by updated Hosts. */
  conversationRealtimeSpeak?(
    request: { readonly key: string; readonly text: string },
  ): Promise<VoiceRemoteResult<{ readonly accepted: boolean; readonly reason?: string }>>
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
/** Prevent duplicate in-flight final calls without treating a rejection as spoken. */
const pendingNativeAssistantMessages = new Set<string>()
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
  /** A native response.cancel was sent; wait for its terminal event before reusing the channel. */
  nativeCancelRequested?: boolean
  /** Bound the wait when a peer never returns the cancelled response terminal event. */
  nativeCancelTimer?: number
  /** Recent distinct human transcripts for this WebRTC call, not per render. */
  readonly recentTranscripts: Map<string, number>
  /** Drop an unrecovered network disconnect instead of leaving voice stuck. */
  disconnectTimer?: number
  /** Silence ends only audio, never the owning Phoenix task. */
  inactivityTimer?: number
  /** Browser/tab termination releases live voice ownership. */
  readonly onPageHide: () => void
}

interface PendingCodexRealtimeUtterance {
  /** RPC admission and native completion belong to the same in-flight operation. */
  admission?: 'pending' | 'accepted'
  terminal?: boolean
  readonly sessionKey: string
  readonly key: string
  readonly instructions: string
  readonly echoText: string
  readonly assistantMessageKey?: string
  /** Strict conversational-tail stream identity; one segment is in flight at a time. */
  readonly streamMessageKey?: string
  /** Cursor range used to recover a segment if its native request is rejected. */
  readonly streamThroughBefore?: number
  readonly streamThroughAfter?: number
}

interface NativeSentenceStreamState {
  readonly sessionKey: string
  readonly messageKey: string
  transcript: string
  through: number
  sequence: number
  final: boolean
}

let voiceModelRouteResolver: VoiceModelRouteResolver | undefined
let codexRealtimeUserTranscriptHandler: CodexRealtimeUserTranscriptHandler | undefined
let codexRealtimeVoiceSession: CodexRealtimeVoiceSession | undefined
let codexRealtimeVoiceGeneration = 0
let codexRealtimeVoiceStarting = false
const CODEX_VOICE_DISCONNECT_GRACE_MS = 30_000
const CODEX_VOICE_INACTIVITY_MS = 5 * 60_000
const pendingCodexRealtimeUtterances: PendingCodexRealtimeUtterance[] = []
/** One bounded sentence cursor; never preloads an unbounded answer queue. */
let nativeSentenceStream: NativeSentenceStreamState | undefined
/** Final tails deduplicate across React rerenders without claiming unsent audio completed. */
const nativeSentenceFinalMessages = new Map<string, string>()

function nativeSentenceMessageToken(sessionKey: string, messageKey: string): string {
  return `${sessionKey}\u0000${messageKey}`
}

/** A completed message is scoped to the native call that authorized it. */
function spokenMessageToken(sessionKey: string, messageKey: string): string {
  return nativeSentenceMessageToken(sessionKey, messageKey)
}

/** A voice call owns bounded resources; it never owns the harness task. */
function clearCodexRealtimeTimers(session: CodexRealtimeVoiceSession): void {
  if (session.disconnectTimer !== undefined) window.clearTimeout(session.disconnectTimer)
  if (session.inactivityTimer !== undefined) window.clearTimeout(session.inactivityTimer)
  if (session.nativeCancelTimer !== undefined) window.clearTimeout(session.nativeCancelTimer)
  delete session.disconnectTimer
  delete session.inactivityTimer
  delete session.nativeCancelTimer
}

function refreshCodexRealtimeActivity(session: CodexRealtimeVoiceSession): void {
  if (codexRealtimeVoiceSession !== session) return
  if (session.inactivityTimer !== undefined) window.clearTimeout(session.inactivityTimer)
  session.inactivityTimer = window.setTimeout(() => {
    if (codexRealtimeVoiceSession === session) void stopCodexRealtimeVoice()
  }, CODEX_VOICE_INACTIVITY_MS)
}

function publishVoiceAssistant(next: VoiceAssistantSnapshot): void {
  voiceAssistantSnapshot = next
  if (typeof document !== 'undefined') document.documentElement.dataset.phoenixVoicePhase = next.phase
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
  const remote = voiceAssistantRemote
  if (remote?.conversationRealtimeSpeak !== undefined) {
    utterance.admission = 'pending'
    utterance.terminal = false
    session.activeUtterance = utterance
    voiceAssistantSpokenText = utterance.echoText
    // Reserve the finalized message synchronously so a React closure/tail
    // rerender cannot enqueue the same reply while the RPC is pending.
    if (utterance.assistantMessageKey !== undefined && utterance.streamMessageKey === undefined) {
      pendingNativeAssistantMessages.add(spokenMessageToken(session.key, utterance.assistantMessageKey))
    }
    document.documentElement.dataset.phoenixVoiceSpeechStatus = 'requested'
    delete document.documentElement.dataset.phoenixVoiceSpeechError
    // The UI authorizes only a harness-owned reply or sentence segment. The Host side sends it
    // through Codex's official thread/realtime/appendSpeech method, rather
    // than trying to fabricate output via an unsupported V3 datachannel
    // response.create payload containing ad hoc instructions.
    void remote.conversationRealtimeSpeak({
      key: session.key,
      text: utterance.echoText,
    }).then((receipt) => {
      if (codexRealtimeVoiceSession !== session || session.activeUtterance !== utterance) return
      if (receipt.ok && receipt.value.accepted) {
        utterance.admission = 'accepted'
        document.documentElement.dataset.phoenixVoiceSpeechStatus = 'accepted'
        if (utterance.assistantMessageKey !== undefined && utterance.streamMessageKey === undefined) {
          const token = spokenMessageToken(session.key, utterance.assistantMessageKey)
          pendingNativeAssistantMessages.delete(token)
          spokenAssistantMessages.add(token)
        }
        if (utterance.streamMessageKey !== undefined) {
          const stream = nativeSentenceStream
          if (stream !== undefined && stream.sessionKey === session.key
            && stream.messageKey === utterance.streamMessageKey
            && stream.final && stream.through >= stream.transcript.length) {
            nativeSentenceFinalMessages.set(spokenMessageToken(session.key, utterance.streamMessageKey), stream.transcript)
          }
        }
        if (session.nativeCancelRequested) {
          session.audio.muted = true
          finishNativeUtterance(session, utterance)
          return
        }
        allowAuthorizedCodexAudio(session)
        finishNativeUtterance(session, utterance)
        return
      }
      delete session.activeUtterance
      if (utterance.assistantMessageKey !== undefined && utterance.streamMessageKey === undefined) {
        pendingNativeAssistantMessages.delete(spokenMessageToken(session.key, utterance.assistantMessageKey))
      }
      clearNativeCancelWait(session)
      session.audio.muted = true
      restoreRejectedNativeSentence(utterance)
      resetNativeSentenceStream(session.key)
      document.documentElement.dataset.phoenixVoiceSpeechStatus = 'rejected'
      document.documentElement.dataset.phoenixVoiceSpeechError = receipt.ok
        ? (receipt.value.reason ?? 'append-speech-rejected')
        : (receipt.error.code ?? 'append-speech-failed')
      console.warn('[PHOENIX VOICE] Codex native speech request was not accepted.')
      publishVoiceIdle()
      flushCodexRealtimeUtterances(session)
    }, () => {
      if (codexRealtimeVoiceSession !== session || session.activeUtterance !== utterance) return
      delete session.activeUtterance
      if (utterance.assistantMessageKey !== undefined && utterance.streamMessageKey === undefined) {
        pendingNativeAssistantMessages.delete(spokenMessageToken(session.key, utterance.assistantMessageKey))
      }
      clearNativeCancelWait(session)
      session.audio.muted = true
      restoreRejectedNativeSentence(utterance)
      resetNativeSentenceStream(session.key)
      document.documentElement.dataset.phoenixVoiceSpeechStatus = 'failed'
      document.documentElement.dataset.phoenixVoiceSpeechError = 'append-speech-request-failed'
      console.warn('[PHOENIX VOICE] Codex native speech request failed.')
      publishVoiceIdle()
      flushCodexRealtimeUtterances(session)
    })
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    return true
  }
  // Rolling upgrades must not silently pretend to have the native speech RPC.
  // Old Hosts retain their existing behavior until their Remote contracts
  // are regenerated by the new build; keep the legacy path only for them.
  try {
    session.events.send(JSON.stringify({
      type: 'response.create',
      response: { instructions: utterance.instructions },
    }))
  } catch {
    return false
  }
  session.activeUtterance = utterance
  utterance.admission = 'accepted'
  utterance.terminal = false
  voiceAssistantSpokenText = utterance.echoText
  if (utterance.assistantMessageKey !== undefined && utterance.streamMessageKey === undefined) {
    spokenAssistantMessages.add(spokenMessageToken(session.key, utterance.assistantMessageKey))
  }
  publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
  return true
}

/** Keep browser output audible after asynchronous WebRTC authorization.
 * A muted autoplay may start before speech; after the harness authorizes a
 * response, retry play on the same attached track and report a blocked output.
 */
function playCodexRealtimeAudio(audio: HTMLAudioElement): void {
  try {
    const playback = audio.play()
    if (playback === undefined || typeof playback.catch !== 'function') return
    void playback.then(() => {
      audio.dataset.phoenixAudioPlayback = 'playing'
    }, () => {
      audio.dataset.phoenixAudioPlayback = 'blocked'
      console.warn('[PHOENIX VOICE] The browser blocked native Codex Live audio playback.')
    })
  } catch {
    audio.dataset.phoenixAudioPlayback = 'blocked'
    console.warn('[PHOENIX VOICE] The browser could not start native Codex Live audio playback.')
  }
}

function allowAuthorizedCodexAudio(session: CodexRealtimeVoiceSession): void {
  session.audio.muted = false
  session.audio.volume = 1
  if (session.audio.srcObject) playCodexRealtimeAudio(session.audio)
}

function restoreRejectedNativeSentence(utterance: PendingCodexRealtimeUtterance): void {
  const stream = nativeSentenceStream
  if (utterance.streamMessageKey === undefined || stream === undefined
    || stream.messageKey !== utterance.streamMessageKey) return
  stream.through = utterance.streamThroughBefore ?? stream.through
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

/**
 * Cancel only the native Codex response currently carrying speech. A native
 * response is transport-owned; conversationCancel belongs to the older Host
 * TTS route and would cancel the harness conversation itself.
 */
function cancelNativeCodexResponse(session: CodexRealtimeVoiceSession): void {
  if (session.activeUtterance !== undefined) {
    if (session.nativeCancelRequested) {
      session.audio.muted = true
      return
    }
    if (session.events.readyState === 'open') {
      try { session.events.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* peer cleanup owns closure */ }
      // Keep the active marker until response.done arrives. Releasing it here
      // lets a late terminal event from the cancelled response steal the next
      // sentence's active marker and advance the cursor out of order.
      session.nativeCancelRequested = true
      if (session.nativeCancelTimer === undefined) {
        session.nativeCancelTimer = window.setTimeout(() => {
          if (codexRealtimeVoiceSession !== session || !session.nativeCancelRequested) return
          // Without a response id, reusing this data channel after a missing
          // cancel acknowledgement could let a late old response.done consume
          // the next sentence. End the native call instead of guessing which
          // response owns the terminal event.
          document.documentElement.dataset.phoenixVoiceSpeechStatus = 'failed'
          document.documentElement.dataset.phoenixVoiceSpeechError = 'native-cancel-timeout'
          void stopCodexRealtimeVoice()
        }, 3_000)
      }
    } else {
      delete session.activeUtterance
      clearNativeCancelWait(session)
    }
  }
  session.audio.muted = true
}

function clearNativeCancelWait(session: CodexRealtimeVoiceSession): void {
  if (session.nativeCancelTimer !== undefined) window.clearTimeout(session.nativeCancelTimer)
  delete session.nativeCancelTimer
  delete session.nativeCancelRequested
}

function resetNativeSentenceStream(sessionKey?: string): void {
  if (sessionKey === undefined || nativeSentenceStream?.sessionKey === sessionKey) {
    nativeSentenceStream = undefined
  }
}

/** Release speech only after both RPC admission and native generation completion. */
function finishNativeUtterance(session: CodexRealtimeVoiceSession, utterance: PendingCodexRealtimeUtterance): void {
  if (session.activeUtterance !== utterance || utterance.admission !== 'accepted' || !utterance.terminal) return
  delete session.activeUtterance
  clearNativeCancelWait(session)
  if (!flushNativeSentenceStream(session)) {
    publishVoiceIdle()
    flushCodexRealtimeUtterances(session)
  }
}

/**
 * Send at most one next sentence. The cursor stays in memory until the native
 * response finishes, so long answers cannot overflow or silently drop a queue.
 */
function flushNativeSentenceStream(session: CodexRealtimeVoiceSession): boolean {
  const stream = nativeSentenceStream
  if (stream === undefined || stream.sessionKey !== session.key || session.activeUtterance !== undefined) {
    return false
  }
  const planned = nextStreamingSpeechSegment(stream.transcript, stream.through, stream.final)
  if (planned === undefined) {
    // A complete sentence may have been accepted while the durable tail was
    // still open. When the same transcript is later marked final, there is no
    // new segment to send; finalize the cursor here so the next React render
    // cannot recreate it and speak the already-accepted sentence again.
    if (stream.final && stream.through >= stream.transcript.length) {
      nativeSentenceFinalMessages.set(nativeSentenceMessageToken(session.key, stream.messageKey), stream.transcript)
      resetNativeSentenceStream(session.key)
      publishVoiceIdle()
    }
    return false
  }
  // Native Codex receives complete sentences while a fast turn is open. The
  // shared browser adapter may use bounded clauses for local TTS, but sending
  // a hard-cut prefix here would make a realtime voice guess the missing tail.
  if (!stream.final && !/[.!?…][”"'»)]?$/u.test(planned.text)) return false
  const sequence = stream.sequence++
  const utterance: PendingCodexRealtimeUtterance = {
    sessionKey: session.key,
    key: `assistant:${stream.messageKey}:sentence:${sequence}`,
    echoText: planned.text,
    instructions: `Read only this finalized PHOENIX harness response segment in the user's current language and with the same voice/persona. Do not independently assess task progress, say "still working", claim tool use, or add any words.\n\n${planned.text}`,
    streamMessageKey: stream.messageKey,
    streamThroughBefore: stream.through,
    streamThroughAfter: planned.end,
  }
  stream.through = planned.end
  const sent = sendCodexRealtimeUtterance(session, utterance)
  if (!sent) stream.through = utterance.streamThroughBefore ?? stream.through
  return sent
}

function streamNativeSentence(
  session: CodexRealtimeVoiceSession,
  messageKey: string,
  text: string,
  final: boolean,
): void {
  const transcript = conversationalSpeechText(text)
  if (transcript === '') {
    // A rewrite can temporarily project only metadata/formatting. Do not
    // leave the previous sentence audible while its replacement is empty.
    if (nativeSentenceStream?.sessionKey === session.key) {
      cancelNativeCodexResponse(session)
      resetNativeSentenceStream(session.key)
    }
    return
  }
  let stream = nativeSentenceStream
  if (stream === undefined || stream.sessionKey !== session.key || stream.messageKey !== messageKey) {
    if (stream !== undefined && stream.sessionKey === session.key) cancelNativeCodexResponse(session)
    stream = { sessionKey: session.key, messageKey, transcript: '', through: 0, sequence: 0, final: false }
    nativeSentenceStream = stream
  } else if (!transcript.startsWith(stream.transcript)) {
    // A retry/rewrite invalidates every unsent segment and the active native
    // response. The corrected transcript starts at cursor zero.
    cancelNativeCodexResponse(session)
    stream = { sessionKey: session.key, messageKey, transcript: '', through: 0, sequence: 0, final: false }
    nativeSentenceStream = stream
  }
  stream.transcript = transcript
  stream.final = final
  flushNativeSentenceStream(session)
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

/** Resolve Codex CLI startup errors across old/new generated Host Remote types.
 * The Host may send a new diagnostic before the client-side generated
 * declaration is rebuilt. Do not statically access status.detail.
 * @param status Host status using the minimum common Remote wire contract.
 * @returns Sanitized Host diagnostic when present, otherwise the status reason.
 */
export function codexRealtimeStatusFailureReason(
  status: Pick<VoiceConversationRealtimeStatus, 'reason'> & { readonly detail?: unknown },
): string {
  const detail = 'detail' in status && typeof status.detail === 'string'
    ? status.detail.trim() : ''
  return detail || status.reason || 'codex-realtime-unavailable'
}

/**
 * Identify the native voice failures that require the official login flow.
 * @param reason - Sanitized failure reason from the native voice endpoint.
 * @returns Whether the user must reconnect the Codex account.
 */
export function codexRealtimeRequiresLogin(reason: string): boolean {
  return reason === 'codex-login-required'
    // oxlint-disable-next-line @stylistic/max-len -- Keep the native login matcher auditable as one literal.
    || /(?:refresh[\s_-]*token[^\r\n]{0,120}expired|access token could not be refreshed|chatgpt login required|not authenticated|please log out and sign in again)/iu.test(reason)
}

/** Show the existing native Codex connection window; never navigate to guessed OAuth URLs. */
export function openCodexReconnection(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('phoenix:open-feature', {
    detail: { destination: 'connectors', label: 'Reconectar Codex' },
  }))
}

/** A successful update is the only condition that may restart the user's Live call. */
export type CodexLiveRepairState = 'checking' | 'updating' | 'waiting-upstream' | 'ready' | 'blocked' | 'disabled'

/**
 * Check whether native voice is waiting for the single-owner updater.
 * @param reason - Classified startup failure from the native voice probe.
 * @returns Whether the updater must finish before retrying voice.
 */
export function isCodexLiveRepairPending(reason: string): boolean {
  return reason === 'codex-live-repair-pending'
}

/**
 * Consume optional Host updater progress without relying on newly generated Remote types.
 * @param status - Untrusted status payload returned by a rolling Host build.
 * @returns A recognized repair state, or undefined for older payloads.
 */
export function codexLiveRepairFromStatus(status: unknown): CodexLiveRepairState | undefined {
  if (status === null || typeof status !== 'object' || !('repair' in status)) return undefined
  const repair = status.repair
  return repair === 'checking' || repair === 'updating' || repair === 'waiting-upstream'
    || repair === 'ready' || repair === 'blocked' || repair === 'disabled'
    ? repair : undefined
}

/**
 * Poll only the existing single-owner updater after an explicit microphone click.
 * Do not start fresh WebRTC negotiations while a binary is downloading and
 * never wait forever for a provider version that has not been released.
 * @param signal - Cancellation signal from the user's voice action.
 * @param options - Optional bounded polling and timeout values.
 * @returns The repair outcome observed by the client.
 */
export async function waitForCodexLiveRepair(
  signal: AbortSignal,
  options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<'ready' | 'waiting-upstream' | 'unavailable' | 'timeout' | 'cancelled'> {
  const timeoutMs = options.timeoutMs ?? 3 * 60_000
  const pollMs = options.pollMs ?? 5_000
  const expires = Date.now() + timeoutMs
  while (!signal.aborted && Date.now() < expires) {
    const remote = voiceAssistantRemote
    if (remote?.conversationRealtimeStatus === undefined) return 'unavailable'
    try {
      const result = await remote.conversationRealtimeStatus()
      if (signal.aborted) break
      if (result.ok) {
        const phase = codexLiveRepairFromStatus(result.value)
        if (phase === 'ready') return 'ready'
        // Nothing is being installed when the newest official CLI still lacks
        // Quicksilver support. Do not trap the microphone in a three-minute wait.
        if (phase === 'waiting-upstream') return 'waiting-upstream'
        if (phase === 'blocked' || phase === 'disabled') return 'unavailable'
        if (phase === undefined && (!result.value.enabled || result.value.reason === 'codex-login-required')) {
          return 'unavailable'
        }
      }
    } catch {
      // A Host handoff can briefly disconnect the remote. Retry after delay.
    }
    await new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return }
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() },
        Math.min(pollMs, Math.max(0, expires - Date.now())))
      function cancel(): void { clearTimeout(timer); resolve() }
      signal.addEventListener('abort', cancel, { once: true })
    })
  }
  return signal.aborted ? 'cancelled' : 'timeout'
}

/** Result of one attempt to enter native Codex voice independently of the task model. */
export type CodexRealtimeVoiceStartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'not-codex' } // retained for backwards-compatible callers
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * Prefer native Codex realtime even when PHOENIX Auto or another text provider
 * owns the agent. Startup failures remain classified so the caller can deliberately
 * enter the documented Kokoro -> platform fallback without mislabeling that
 * fallback as native Codex Realtime.
 * @param sessionKey Conversation whose selected model route determines the voice provider.
 * @returns Started, non-Codex route, or a classified startup failure.
 */
export async function tryStartCodexRealtimeVoice(
  sessionKey: string,
): Promise<CodexRealtimeVoiceStartResult> {
  // The user may close a call while the route/capability probe is in flight.
  // A late probe must not reacquire the microphone and resurrect voice mode.
  const startFence = codexRealtimeVoiceGeneration
  // Codex CLI Live is its own voice service, independent of task routing.
  // Do not await session.models here: a slow or failed catalog refresh used
  // to block microphone startup even though the ChatGPT voice account was
  // authenticated. The app-server chooses its native Realtime voice model.
  // Keep the legacy resolver registration for compatibility, but do not
  // require its result in this transport.

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
      const phase = codexLiveRepairFromStatus(capability.value)
      if (phase === 'waiting-upstream') {
        return { kind: 'failed', reason: 'Codex Live: la versión oficial instalada aún no es compatible con Quicksilver v2; no hay una actualización disponible.' }
      }
      if (phase === 'checking' || phase === 'updating') {
        return { kind: 'failed', reason: 'codex-live-repair-pending' }
      }
      return {
        kind: 'failed',
        // Incremental client builds may still hold the previous generated
        // @phoenix-ai/dsh-api-remotes/client status declaration without
        // "detail". Detect this optional wire extension structurally so both
        // old and new Remote contracts compile and report the right failure.
        reason: codexRealtimeStatusFailureReason(capability.value),
      }
    }
  } catch {
    return { kind: 'failed', reason: 'capability-probe-failed' }
  }

  if (startFence !== codexRealtimeVoiceGeneration) {
    return { kind: 'failed', reason: 'start-superseded' }
  }
  // Do not leak an earlier live call if the user explicitly starts a new one.
  if (codexRealtimeVoiceSession !== undefined) await stopCodexRealtimeVoice()
  const generation = ++codexRealtimeVoiceGeneration
  codexRealtimeVoiceStarting = true
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
      playCodexRealtimeAudio(audio)
    }
    events.onmessage = (event) => {
      if (codexRealtimeVoiceGeneration !== generation || typeof event.data !== 'string') return
      const liveSession = codexRealtimeVoiceSession
      if (liveSession !== undefined && liveSession.events === events) refreshCodexRealtimeActivity(liveSession)
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
        if (!flushNativeSentenceStream(liveSession)) flushCodexRealtimeUtterances(liveSession)
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
    })
    if (!result.ok) throw new Error(result.error.code)
    if (!result.value.accepted || result.value.answerSdp === undefined) {
      throw new Error(result.value.detail ?? result.value.reason ?? 'codex-realtime-rejected')
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: result.value.answerSdp })
    if (generation !== codexRealtimeVoiceGeneration) throw new Error('start-superseded')

    const liveSession: CodexRealtimeVoiceSession = {
      key: sessionKey, peer, microphone, events, audio, recentTranscripts: new Map(),
      onPageHide: () => { void stopCodexRealtimeVoice() },
    }
    codexRealtimeVoiceSession = liveSession
    window.addEventListener('pagehide', liveSession.onPageHide)
    refreshCodexRealtimeActivity(liveSession)
    // Closing/revoking the mic must end this voice call, not the harness task.
    for (const track of microphone.getTracks()) {
      if (typeof track.addEventListener === 'function') {
        track.addEventListener('ended', () => {
          if (codexRealtimeVoiceSession === liveSession) void stopCodexRealtimeVoice()
        }, { once: true })
      }
    }
    setVoiceAssistantActive(true)
    setVoiceAssistantListening(true)

    peer.onconnectionstatechange = () => {
      const liveSession = codexRealtimeVoiceSession
      if (liveSession === undefined || liveSession.peer !== peer) return
      if (peer?.connectionState === 'connected') {
        // A brief disconnect must not switch voices or interrupt the harness.
        if (liveSession.disconnectTimer !== undefined) {
          window.clearTimeout(liveSession.disconnectTimer)
          delete liveSession.disconnectTimer
        }
        refreshCodexRealtimeActivity(liveSession)
        if (!flushNativeSentenceStream(liveSession)) flushCodexRealtimeUtterances(liveSession)
        return
      }
      if (peer?.connectionState === 'disconnected') {
        // A dropped Telegram Mini App/browser call cannot leave the mic active forever.
        liveSession.disconnectTimer ??= window.setTimeout(() => {
          if (codexRealtimeVoiceSession === liveSession && liveSession.peer.connectionState === 'disconnected') {
            void stopCodexRealtimeVoice()
          }
        }, CODEX_VOICE_DISCONNECT_GRACE_MS)
        return
      }
      if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed') {
        // End voice completely; do not silently re-enable browser recognition.
        // The Phoenix harness and its pending tasks are deliberately unaffected.
        void stopCodexRealtimeVoice()
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
    if (codexRealtimeVoiceSession?.key !== sessionKey) {
      // Even a superseded negotiation may have created a remote thread.
      void remote.conversationRealtimeStop?.({ key: sessionKey }).catch(() => {})
    }
    return {
      kind: 'failed',
      reason: error instanceof Error && error.message !== '' ? error.message : 'realtime-start-failed',
    }
  } finally {
    if (generation === codexRealtimeVoiceGeneration) codexRealtimeVoiceStarting = false
  }
}

/** Stop the direct Codex call and release mic/audio/WebRTC resources immediately.
 * @returns Whether an active session was released; remote cleanup is best effort.
 */
export async function stopCodexRealtimeVoice(): Promise<boolean> {
  const session = codexRealtimeVoiceSession
  const starting = codexRealtimeVoiceStarting
  codexRealtimeVoiceGeneration += 1
  codexRealtimeVoiceStarting = false
  codexRealtimeVoiceSession = undefined
  if (session === undefined) return starting

  clearCodexRealtimeTimers(session)
  window.removeEventListener('pagehide', session.onPageHide)
  setVoiceAssistantListening(false)
  discardCodexRealtimeUtterances(session.key)
  resetNativeSentenceStream(session.key)
  nativeSentenceFinalMessages.clear()
  pendingNativeAssistantMessages.clear()
  session.events.close()
  session.peer.close()
  for (const track of session.microphone.getTracks()) track.stop()
  session.audio.pause()
  session.audio.srcObject = null
  session.audio.remove()
  // Make voice an explicitly terminated activity, not a sticky global mode.
  // Do this BEFORE awaiting the remote stop, which may be slow or unavailable.
  if (voiceAssistantSnapshot.active) setVoiceAssistantActive(false)

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
  let assistantTurnDone = false
  try {
    const value = JSON.parse(payload) as { type?: unknown; turn?: { role?: unknown } }
    if (typeof value.type === 'string') type = value.type
    assistantTurnDone = type === 'turn.done' && value.turn?.role === 'assistant'
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
    if (session.nativeCancelRequested) {
      session.audio.muted = true
      // The cancelled response can still emit a late created event. Keep the
      // channel quiet until its terminal event instead of treating it as the
      // next authorized sentence.
      if (session.events.readyState === 'open') {
        try { session.events.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* closing peer */ }
      }
      return
    }
    allowAuthorizedCodexAudio(session)
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
    return
  }
  if (type === 'response.done' || assistantTurnDone) {
    // V3 can finish a spoken response as turn.done (role assistant) instead
    // of the older response.done. A user turn.done must NEVER drain output.
    // Realtime signals the end of generation before WebRTC finishes playing
    // buffered audio. Muting here truncated Kira's voice, and short answers
    // could be completely silent. The next unsolicited response.created still
    // mutes immediately; interruption/stop also mute or dispose the stream.
    const utterance = session.activeUtterance
    if (utterance !== undefined) {
      utterance.terminal = true
      finishNativeUtterance(session, utterance)
    }
    return
  }
  if (type.includes('speech_started')) {
    publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'listening' })
    return
  }
  // Some native V3 transports emit audio frames before a response.created
  // event. Only an already-authorized harness utterance may unmute them.
  if ((type.includes('output_audio') || type.startsWith('response.audio.'))
    && session.activeUtterance !== undefined) {
    allowAuthorizedCodexAudio(session)
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
    // Always invalidate pending route/capability probes too: voice may be closed
    // before a live WebRTC session or its startup flag exists.
    void stopCodexRealtimeVoice()
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeech = undefined
    voiceAssistantSpeechKey = undefined
    resetRemoteSpeech(true)
    voiceAssistantMicListening = false
    voiceAssistantSpokenText = ''
    spokenAssistantMessages.clear()
    pendingNativeAssistantMessages.clear()
    nativeSentenceFinalMessages.clear()
    resetNativeSentenceStream()
    if (voiceAssistantSnapshot.active) publishVoiceAssistant(INACTIVE_VOICE_ASSISTANT)
    return
  }
  if (voiceAssistantSnapshot.active) return
  spokenAssistantMessages.clear()
  pendingNativeAssistantMessages.clear()
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
    cancelNativeCodexResponse(realtime)
  }
  if (realtime !== undefined) {
    realtime.audio.muted = true
    resetNativeSentenceStream(realtime.key)
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
 * Stop a pre-close native sentence stream when its step is rewritten or revoked.
 * @param messageKey - Stable assistant message identity whose cursor is invalid.
 * @param preserveCompleted - Preserve admitted final text when a view merely unmounts.
 */
export function cancelVoiceAssistantSentenceStream(messageKey: string, preserveCompleted = false): void {
  const session = codexRealtimeVoiceSession
  if (session === undefined) return
  if (!preserveCompleted) nativeSentenceFinalMessages.delete(nativeSentenceMessageToken(session.key, messageKey))
  if (nativeSentenceStream?.messageKey !== messageKey) return
  cancelNativeCodexResponse(session)
  resetNativeSentenceStream(session.key)
}

/**
 * Speak one newly completed assistant message while hands-free mode is active.
 * Old history is ignored by the activation-time fence and each rendered message
 * key is spoken once, even when the transcript projection re-renders.
 * @param messageKey - stable conversation identity of the assistant message.
 * @param text - finalized assistant prose.
 * @param messageTime - durable event time in Unix milliseconds.
 * @param final - Whether this is the final transcript update for the message.
 * @param fromCompletedHarnessTurn - Whether a completed harness Turn authorized this speech.
 * @param allowRealtimeStreaming - Whether durable conversational-tail evidence
 * authorizes sentence speech before the owning Turn closes.
 * @param expectedSessionKey - Optional UI session authority for the active native call.
 */
export function streamVoiceAssistantResponse(
  messageKey: string,
  text: string,
  messageTime: number,
  final = false,
  fromCompletedHarnessTurn = false,
  allowRealtimeStreaming = false,
  expectedSessionKey?: string,
): void {
  if (!voiceAssistantSnapshot.active
    || text.trim() === '' || messageTime < voiceAssistantSnapshot.activatedAt - 1_000) return
  const realtime = codexRealtimeVoiceSession
  // The voice call is owned by the session whose InputBar opened it. A stale
  // or hidden session renderer must never append its transcript to that call.
  if (realtime !== undefined && expectedSessionKey !== undefined
    && realtime.key !== expectedSessionKey) return
  // Step-local assistant messages can precede more tool work. Codex Live
  // must not voice them as if a real browser action had already settled.
  if (realtime !== undefined && !fromCompletedHarnessTurn && !allowRealtimeStreaming) {
    if (nativeSentenceStream?.sessionKey === realtime.key && nativeSentenceStream.messageKey === messageKey) {
      cancelNativeCodexResponse(realtime)
      resetNativeSentenceStream(realtime.key)
    }
    return
  }
  const nativeFinalToken = realtime === undefined
    ? undefined
    : nativeSentenceMessageToken(realtime.key, messageKey)
  if ((realtime === undefined && spokenAssistantMessages.has(messageKey))
    || (nativeFinalToken !== undefined && nativeSentenceFinalMessages.get(nativeFinalToken) === conversationalSpeechText(text))
    || (realtime !== undefined && spokenAssistantMessages.has(spokenMessageToken(realtime.key, messageKey)))
    || (realtime !== undefined && pendingNativeAssistantMessages.has(spokenMessageToken(realtime.key, messageKey)))) return
  voiceAssistantSpokenText = text
  if (realtime !== undefined) {
    // Native Codex is sticky for the whole hands-free session. A temporary
    // data-channel/WebRTC pause must never substitute another TTS voice after
    // Hardness returns control. Queue the finalized harness answer until the
    // same Codex channel is writable again.
    if (allowRealtimeStreaming || (fromCompletedHarnessTurn
      && nativeSentenceStream?.sessionKey === realtime.key && nativeSentenceStream.messageKey === messageKey)) {
      streamNativeSentence(realtime, messageKey, text, final)
      // The final marker is added only after the native appendSpeech receipt is
      // accepted and the cursor has reached the end of the final transcript.
      return
    }
    if (!final) return
    const spoken = conversationalSpeechText(text)
    if (spoken === '') return
    // A component may publish the same closed turn while the native
    // RPC is still in flight. The existing active utterance owns that answer.
    if (realtime.activeUtterance?.assistantMessageKey === messageKey) return
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
 * @param expectedSessionKey - Optional UI session identity authorizing the active native call.
 */
export function speakVoiceAssistantResponse(messageKey: string, text: string, messageTime: number, expectedSessionKey?: string): void {
  streamVoiceAssistantResponse(messageKey, text, messageTime, true, true, false, expectedSessionKey)
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
