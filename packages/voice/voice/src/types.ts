/** Client-safe Remote vocabulary for conversational PHOENIX voice. */

/** Presentation chosen for the assistant's spoken identity. */
export type VoiceAssistantGender = 'masculine' | 'feminine' | 'neutral'

/** Current Host speech route visible to the local Client. */
export interface VoiceConversationStatus {
  readonly enabled: boolean
  readonly natural: boolean
  /** Assistant identity preference that browser/local fallback must honor too. */
  readonly assistantGender?: VoiceAssistantGender
  readonly provider?: string
}

/** One already-stable semantic speech segment from a growing assistant reply. */
export interface VoiceConversationSpeakRequest {
  readonly key: string
  readonly sequence: number
  readonly text: string
  readonly language?: string
  readonly final?: boolean
}

/** Immediate admission result; playback continues asynchronously on the Host. */
export interface VoiceConversationSpeakReceipt {
  readonly accepted: boolean
  readonly reason?: 'disabled' | 'natural-unavailable' | 'empty' | 'invalid' | 'duplicate'
  readonly provider?: string
}

/** Cancel all queued/active speech belonging to one assistant response. */
export interface VoiceConversationCancelRequest {
  readonly key: string
}

/** Number of in-flight segment controllers aborted for one response. */
export interface VoiceConversationCancelReceipt {
  readonly cancelled: number
}


/** Capability of the native Codex/ChatGPT realtime voice sidecar. */
export interface VoiceConversationRealtimeStatus {
  readonly enabled: boolean
  readonly available: boolean
  readonly authenticated: boolean
  readonly provider: 'openai-codex'
  readonly reason?: 'disabled' | 'codex-unavailable' | 'codex-login-required' | 'experimental-unavailable'
}

/** Browser WebRTC offer for one PHOENIX session using its current Codex route. */
export interface VoiceConversationRealtimeStartRequest {
  readonly key: string
  readonly offerSdp: string
  /** Current direct Codex model. Phoenix Auto omits its synthetic id. */
  readonly model?: string
}

/** WebRTC answer returned after Codex app-server negotiated the realtime call. */
export interface VoiceConversationRealtimeStartReceipt {
  readonly accepted: boolean
  readonly threadId?: string
  readonly answerSdp?: string
  /** Concrete Realtime voice chosen from the assistant presentation preference. */
  readonly voice?: string
  readonly reason?: 'disabled' | 'invalid' | 'codex-unavailable' | 'codex-login-required' | 'experimental-unavailable' | 'negotiation-failed'
  /** Bounded sanitized startup diagnostic when native Codex negotiation fails. */
  readonly detail?: string
}

/** Speak Phoenix-owned prose through an already-active native Realtime call. */
export interface VoiceConversationRealtimeSpeakRequest {
  readonly key: string
  readonly text: string
}

/** Result of appending Phoenix speech to the active Realtime thread. */
export interface VoiceConversationRealtimeSpeakReceipt {
  readonly accepted: boolean
  readonly reason?: 'disabled' | 'invalid' | 'not-active' | 'speak-failed'
}

/** Stop one native Codex realtime session addressed by its PHOENIX session key. */
export interface VoiceConversationRealtimeStopRequest {
  readonly key: string
}

/** Whether a native Codex realtime session was active and stopped. */
export interface VoiceConversationRealtimeStopReceipt {
  readonly stopped: boolean
}
