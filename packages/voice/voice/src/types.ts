/** Client-safe Remote vocabulary for conversational PHOENIX voice. */

/** Current Host speech route visible to the local Client. */
export interface VoiceConversationStatus {
  readonly enabled: boolean
  readonly natural: boolean
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

/** Capability probe for the Codex-backed realtime Kira Live transport. */
export interface VoiceRealtimeStatus {
  readonly enabled: boolean
  readonly available: boolean
  readonly provider?: string
  readonly voices?: readonly string[]
  readonly defaultVoice?: string
  readonly reason?: 'disabled' | 'no-provider' | 'unavailable'
}

/** Browser WebRTC offer used to negotiate one Kira Live receive-only audio session. */
export interface VoiceRealtimeOpenRequest {
  readonly key: string
  readonly sdp: string
  readonly voice?: string
}

/** Negotiated WebRTC answer returned by the selected realtime provider. */
export interface VoiceRealtimeOpenReceipt {
  readonly accepted: boolean
  readonly provider?: string
  readonly voice?: string
  readonly sdp?: string
  readonly reason?: 'disabled' | 'no-provider' | 'invalid' | 'unavailable' | 'negotiation-failed'
}

/** Speakable assistant text handed to an already-open realtime Kira Live session. */
export interface VoiceRealtimeSpeakRequest {
  readonly key: string
  readonly text: string
}

/** Admission result for one realtime speech append. */
export interface VoiceRealtimeSpeakReceipt {
  readonly accepted: boolean
  readonly provider?: string
  readonly reason?: 'disabled' | 'no-provider' | 'not-open' | 'empty' | 'unavailable'
}

/** Close one realtime Kira Live browser session. */
export interface VoiceRealtimeCloseRequest {
  readonly key: string
}

/** Whether a realtime Kira Live session was present and closed. */
export interface VoiceRealtimeCloseReceipt {
  readonly closed: boolean
}

