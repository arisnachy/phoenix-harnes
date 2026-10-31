/** Discoverable speech controls for Kira: tools, not guessed tool names. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-voice'
import { deliverAgentSpeech } from './delivery.ts'
import { windowsAudioStatus, listenWindowsAudio, windowsSensesStatus } from './audio-windows.ts'

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
      + 'When asked to hear Windows audio or the microphone, use phoenix_audio_status and phoenix_audio_listen (source output or microphone), not phoenix_voice_speak. The Windows host must be open and the user approves every 3-12 second clip in a native dialog. Never activate a microphone implicitly or listen continuously. If unavailable, try already-authorized browser tab or video_media_inspect; never invent hearing. '
      + 'When asked what Kira can perceive or what viewer is open, call phoenix_senses_status; it distinguishes actual Windows viewer state, local audio hardware and voice providers. If the user asks to SEE the desktop use an actual computer screenshot, not the senses status alone; for shared browser tabs use existing MiniBrowser capture. '
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
  ctx.tools.register(defineTool({
    name: 'phoenix_audio_status',
    description: 'Consulta si PHOENIX Desktop en Windows puede escuchar la salida WASAPI del equipo. No inicia grabacion, no requiere microfono. Aclara si el dispositivo realmente esta disponible.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const sessionId = 'agent-' + (exec.agent?.id ?? 'kira').replace(/[^A-Za-z0-9_-]/gu,'').slice(0,80)
      try { return JSON.stringify(await windowsAudioStatus(sessionId)) }
      catch (error) { return JSON.stringify({ available:false, reason:String(error).slice(0,220),
        note:'El oido de Windows requiere Phoenix.exe. Para pestañas autorizadas usa las herramientas de video existentes.' }) }
    },
    presentCall: () => ({ card: 'generic', title: 'Diagnosticar oído de PHOENIX', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_audio_listen',
    description: 'ESCUCHAR AUDIO REAL del dispositivo de salida predeterminado de Windows durante 3 a 12 segundos. La ventana de PHOENIX solicita permiso visible cada vez. Transcribe con faster-whisper local; elimina WAV temporal. No utiliza microfono ni escucha continua. Si el usuario pide analizar la voz o sonido que sale de sus aplicaciones, usar aqui; no inventar lo no capturado.',
    parameters: {
      seconds: { type:'integer', description:'Segundos enteros de captura, 3 a 12; por defecto 8. No sirve para escucha continua.' },
      source: { type:'string', enum: ['output','microphone'],
        description:'output escucha altavoces/aplicaciones; microphone capta sonido de microfono por autorizacion. Defecto output.' },
    },
    output: { schema: { type:'string' }, render: (_args,value) => [{type:'text' as const,text:value}] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = 'agent-' + (exec.agent?.id ?? 'kira').replace(/[^A-Za-z0-9_-]/gu,'').slice(0,80)
      const seconds = args.seconds === undefined ? 8 : args.seconds
      const source = args.source ?? 'output'
      try { return JSON.stringify(await listenWindowsAudio(sessionId,seconds,source)) }
      catch (error) { return JSON.stringify({
        captureVerified:false, heardSeconds:0, reason:String(error).slice(0,240),
        instruction:'No afirmar que se escucho el audio. Informar el bloqueo concreto y pedir solo el permiso o la fuente necesaria.',
      }) }
    },
    presentCall: () => ({ card:'generic',title:'Escuchar audio de Windows (con permiso)',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_senses_status',
    description: 'Informa el estado real de los sentidos digitales de PHOENIX: voz y proveedor, dispositivos de audio de Windows, visores nativos Desktop Live/MiniBrowser e identidad de origen de observaciones. No activa microfono, grabacion o pantalla. No confundir visor visible con fotograma recibido.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const sessionId = 'agent-' + (exec.agent?.id ?? 'kira').replace(/[^A-Za-z0-9_-]/gu, '').slice(0,80)
      const [audio, desktop] = await Promise.all([
        windowsAudioStatus(sessionId).catch(error => ({ available: false, reason: String(error).slice(0,180) })),
        windowsSensesStatus(sessionId).catch(error => ({ available: false, reason: String(error).slice(0,180) })),
      ])
      const voice = ctx.voice.status()
      const realtime = await ctx.voice.conversationRealtimeStatus().catch(() => undefined)
      return JSON.stringify({
        vision: { desktop, note: 'La existencia de un visor no confirma fotogramas. Usar computer o desktop.live-frame para mirar de verdad.' },
        hearing: { audio, browserTab: 'Requiere pestaña compartida con audio por el usuario; usar video_media_inspect / youtube_video_listen.' },
        speech: { enabled: voice.enabled, provider: voice.ttsProvider ?? null, speaking: voice.speaking,
          liveAvailable: realtime?.available ?? false, note: 'Proveedor aceptado no garantiza que el usuario escuche.' },
        physicalSensors: 'excluidos por decisión del usuario',
        evidence: 'Solo estados reportados por los servicios; no se ha abierto micrófono, escuchado ni capturado imagen al consultar.'
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Estado de los sentidos de Kira', kind: 'read' as const }),
  }))

}
