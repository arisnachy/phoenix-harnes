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
