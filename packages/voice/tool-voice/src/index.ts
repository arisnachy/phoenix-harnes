/** Discoverable speech controls for Kira: tools, not guessed tool names. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-voice'
import { deliverAgentSpeech } from './delivery.ts'

export const name = 'tool-voice'
export const inject = ['tools', 'voice', 'systemPrompt']

/** Register explicit, safe, deterministic speech tools discoverable by tool_search. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:voice',
    order: 119,
    text: 'If the user explicitly asks you to speak, test audio, or say a phrase out loud, call phoenix_voice_speak with short natural text in the configured language. '
      + 'Use phoenix_voice_status for diagnostics. Host TTS needs no microphone or active Codex call; an existing authorized Codex Live call has priority. '
      + 'Never claim that the speaker was audible or that microphone audio was heard based solely on a successful synthesis receipt. '
      + 'Do not search the web for local speech, simulate tool invocations, or tell the user there is no speech tool before checking these tools.',
  })
  ctx.tools.register(defineTool({
    name: 'phoenix_voice_status',
    description: 'Comprueba la voz de Kira y sus motores reales: habilitación, proveedor local, cola, voz Codex Live disponible y motivo de desconexión. No activa micrófono ni reproduce audio. Usa antes de una prueba cuando sea necesario diagnosticar.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute() {
      const local = ctx.voice.status()
      const realtime = await ctx.voice.conversationRealtimeStatus()
      return JSON.stringify({
        enabled: local.enabled,
        defaultLanguage: process.env.PHOENIX_VOICE_LANGUAGE?.trim() || 'es-DO',
        provider: local.ttsProvider ?? null,
        queued: local.queued,
        speaking: local.speaking,
        codexLive: {
          enabled: realtime.enabled,
          available: realtime.available,
          authenticated: realtime.authenticated,
          reason: realtime.reason ?? null,
        },
        note: 'Codex Live disponible no equivale a sesión WebRTC ya autorizada. La salida de voz local puede funcionar sin abrir el micrófono.',
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Diagnosticar voz de Kira', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_voice_speak',
    description: 'REPRODUCIR AUDIO AHORA. Kira debe llamar esta herramienta cuando el usuario le diga habla, di algo, lee en voz alta, quiero escucharte, prueba tu voz o ¿me escuchas bien?; usa Codex Live si hay sesión autorizada y activa; si no, sintetiza audio real usando voz local de PHOENIX en el idioma seleccionado. Responde con el proveedor y resultado verificables. No requiere micrófono. No usar para narrar cada paso ni simular reproducción.',
    parameters: {
      text: {
        type: 'string', required: true,
        description: 'Frase corta, natural y pronunciable en el idioma configurado, máximo 300 caracteres. No incluir identificadores ni secretos.',
      },
      language: {
        type: 'string',
        description: 'Idioma BCP-47 de la interfaz, por ejemplo es-DO. Omitir para usar PHOENIX_VOICE_LANGUAGE (es-DO).',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const language = args.language?.trim() || process.env.PHOENIX_VOICE_LANGUAGE?.trim() || 'es-DO'
      const receipt = await deliverAgentSpeech(ctx.voice, args.text, language, exec.agent?.id)
      return JSON.stringify({
        ...receipt,
        instruction: receipt.accepted
          ? 'El proveedor aceptó la salida de audio. Pregunta al usuario si realmente oyó la voz; no afirmes audibilidad sin su confirmación.'
          : 'No hubo reproducción aceptada. Informa el motivo literal y usa phoenix_voice_status para diagnosticar. No simules voz.',
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Kira habla en voz alta', kind: 'other' as const }),
  }))
}
