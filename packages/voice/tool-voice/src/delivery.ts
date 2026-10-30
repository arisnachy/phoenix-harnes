/** Model-independent, auditable speech delivery through the installed Host providers. */
import { randomUUID } from 'node:crypto'
import { displayOutputToVoiceText, type VoiceRuntime } from '@phoenix-ai/dsh-voice'

/** Small service boundary; adapters can exercise real runtime methods or test doubles. */
export type SpeechHost = Pick<VoiceRuntime, 'status' | 'conversationRealtimeSpeak' | 'conversationSpeak'>

/** Receipt for speech admitted or completed by a provider; not proof speakers were audible. */
export interface AgentSpeechReceipt {
  readonly accepted: boolean
  readonly provider?: string
  readonly language: string
  readonly reason?: string
  readonly codexReason?: string
  /** Audio hardware/speaker audibility cannot be established remotely. */
  readonly audioHardwareVerified: false
}

/**
 * Speak with an already authorized Codex Live session, else the local host.
 * No microphone permission, user media capture, or spontaneous WebRTC activation.
 * @param host - Current PHOENIX voice capability.
 * @param text - User-approved phrase to synthesize.
 * @param language - BCP-47 voice language, derived from PHOENIX config.
 * @param sessionKey - Active calling agent's session identity, if available.
 * @returns Actual delivery receipt, distinguishing rejection from success.
 */
export async function deliverAgentSpeech(
  host: SpeechHost,
  text: string,
  language: string,
  sessionKey?: string,
): Promise<AgentSpeechReceipt> {
  const locale = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/iu.test(language)
    ? language : 'es-DO'
  const base = { language: locale, audioHardwareVerified: false as const }
  if (!host.status().enabled) return { ...base, accepted: false, reason: 'voice-disabled' }
  const speakable = displayOutputToVoiceText(text, 300)
  if (speakable.length === 0) return { ...base, accepted: false, reason: 'empty-text' }

  // A live Codex connection is a browser-authorized communication channel.
  // Merely having Codex installed or authenticated is not sufficient.
  let codexReason: string | undefined
  if (sessionKey !== undefined && sessionKey.trim() !== '') {
    try {
      const native = await host.conversationRealtimeSpeak({ key: sessionKey, text: speakable })
      if (native.accepted) return { ...base, accepted: true, provider: 'codex-live' }
      codexReason = native.reason
    } catch (error) {
      codexReason = String(error).slice(0, 160)
    }
  }

  // Separate key prevents repeated voice tests from being suppressed by the
  // incremental conversation sequence dedupe. Prefix explicitly permits local
  // platform TTS for a model-invoked, opt-in alert when neural TTS is missing.
  try {
    const fallback = await host.conversationSpeak({
      key: `phoenix:proactive-attention:agent:${randomUUID()}`,
      sequence: 0,
      language: locale,
      text: speakable,
      final: true,
    })
    return {
      ...base,
      accepted: fallback.accepted,
      ...fallback.provider === undefined ? {} : { provider: fallback.provider },
      ...fallback.accepted ? {} : { reason: fallback.reason ?? 'native-unavailable' },
      ...codexReason === undefined ? {} : { codexReason },
    }
  } catch (error) {
    return {
      ...base, accepted: false, reason: String(error).slice(0, 160),
      ...codexReason === undefined ? {} : { codexReason },
    }
  }
}
