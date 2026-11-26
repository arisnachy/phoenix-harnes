/** Discoverable speech controls for Kira: tools, not guessed tool names. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-voice'
import { deliverAgentSpeech } from './delivery.ts'
import { windowsAudioStatus, listenWindowsAudio, windowsSensesStatus, transcribeApprovedAudioFile } from './audio-windows.ts'


/** Preserve the agent session ID for native viewer ownership checks.
 * @param value - The actual conversation identity.
 * @returns Verified user conversation id.
 */
export function senseSessionId(value: string | undefined): string {
  if (typeof value !== 'string' || value.length > 128
    || !/^[A-Za-z0-9_:-]+$/u.test(value)) {
    throw new Error('SENSES_SESSION_NOT_AVAILABLE')
  }
  return value
}

export const name = 'tool-voice'
export const inject = ['tools', 'voice', 'systemPrompt']

/** Register explicit, safe, deterministic speech tools discoverable by tool_search. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:voice',
    order: 119,
    text: 'If the user explicitly asks you to speak, test audio, or say a phrase out loud, call phoenix_voice_speak with short natural text in the configured language. '
      + 'Use phoenix_voice_status for diagnostics. Use phoenix_codex_live_control to open, speak through, inspect or close Codex Live independently of the text model. The agent may autonomously open speaker-only voice when the user requests speech or has enabled proactive spoken notifications; never activate the microphone implicitly. If login is required, use authorize to request the official connector dialog; only the user may complete it. A queued control is not a playback receipt. Use status to check the result before claiming success; use phoenix_voice_speak with engine=local only after a definitive native failure or if local voice is requested. '
      + 'Never claim that the speaker was audible or that microphone audio was heard based solely on a successful synthesis receipt. '
      + 'When asked to hear Windows audio or the microphone, use phoenix_audio_status and phoenix_audio_listen (source output or microphone), not phoenix_voice_speak. The Windows host must be open and the user approves every 3-12 second clip in a native dialog. Never activate a microphone implicitly or listen continuously. '
      + 'When asked to analyze YouTube or browser video, first attempt video_media_inspect and youtube_video_listen if registered, then inspect the embedded browser using its authenticated channel to verify the page and media state. If speech is unavailable but the user is playing the video in Windows, independently check phoenix_audio_status and offer phoenix_audio_listen with source output and visible consent. A short captured clip never proves knowledge of the whole video. Ask to share a tab only when the native or authorized alternatives really cannot obtain the needed evidence. Never invent frames, speech, or transcription. '
      + 'For an explicitly user-approved audio or video file in PHOENIX_AUDIO_ALLOWED_DIRS, call phoenix_audio_file_listen; never browse the disk to find audio or bypass a blocked directory. '
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
    name: 'phoenix_codex_live_control',
    description: 'Controla Codex Live en la conversación actual: open inicia solo altavoz sin micrófono; speak abre y habla; close libera la conexión; authorize solicita el diálogo oficial si falta iniciar sesión; status consulta el recibo real del último control. Respeta el perfil femenino, masculino o neutro configurado. No concede OAuth ni confirma audibilidad. Solo usa voz por petición del usuario o alertas proactivas autorizadas.',
    parameters: {
      action: { type: 'string', required: true, enum: ['open', 'close', 'speak', 'authorize', 'status'] },
      text: { type: 'string', description: 'Solo para speak: frase breve, máximo 300 caracteres.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const key = senseSessionId(exec.agent?.id)
      if (args.action === 'status') return JSON.stringify(ctx.voice.agentRealtimeControlStatus(key, 'voice'))
      const action = args.action
      if (action !== 'open' && action !== 'close' && action !== 'speak' && action !== 'authorize') {
        return JSON.stringify({ state: 'failed', reason: 'invalid-action' })
      }
      return JSON.stringify(ctx.voice.agentRealtimeControl(key, action, args.text))
    },
    presentCall: () => ({ card: 'generic', title: 'Controlar Codex Live', kind: 'other' as const }),
  }))
  ctx.systemPrompt.section({name: 'phoenix:live-ui-control', order: 118,
    text: 'Use phoenix_ui_control inspect to see actual current shell geometry and a fresh revision. You may compact or expand the sidebar or highlight a real sidebar, composer or details control on your own initiative when it helps the user; use the exact revision and current conversation. These changes are local, reversible and do not modify user data, clinical content, permissions or code. A queued request is not success: use status and verify the receipt before explaining what actually changed. Do not repeatedly override a user manual choice.'})
  ctx.tools.register(defineTool({
    name: 'phoenix_ui_control',
    description: 'Live PHOENIX presentation control. inspect reads actual current sidebar, center, details and revision. compact/expand changes sidebar using its existing controls. highlight-sidebar/highlight-composer/highlight-details points to an existing visible area; clear-highlight removes it. For every change, pass the exact revision from a fresh inspect. status reads the last UI receipt. No microphone, file, account, clinical data, arbitrary selectors or executable code.',
    parameters: {
      action: { type: 'string', required: true, enum: ['inspect', 'compact', 'expand', 'highlight-sidebar', 'highlight-composer', 'highlight-details', 'clear-highlight', 'status'] },
      revision: { type: 'string', description: 'Exact revision from inspect. Required except inspect/status.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent?.session.header.origin === 'subagent') throw Error('UI_CONTROL_OWNER_REQUIRED')
      const key = senseSessionId(exec.agent?.id)
      if (args.action === 'status') return JSON.stringify(ctx.voice.agentRealtimeControlStatus(key, 'ui'))
      const action = args.action
      if (action !== 'inspect' && action !== 'compact' && action !== 'expand' && action !== 'highlight-sidebar'
        && action !== 'highlight-composer' && action !== 'highlight-details' && action !== 'clear-highlight') {
        return JSON.stringify({ state: 'failed', reason: 'invalid-action' })
      }
      const result = ctx.voice.agentRealtimeControl(key, `ui-${action}`, args.revision)
      if (result.state !== 'queued') return JSON.stringify(result)
      // Bounded foreground wait for the actual client readback, never claim success from admission.
      for (let i = 0; i < 12 && !exec.signal?.aborted; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 200))
        const receipt = ctx.voice.agentRealtimeControlStatus(key, 'ui')
        if (receipt.id !== result.id || receipt.state === 'completed' || receipt.state === 'failed') return JSON.stringify(receipt)
      }
      return JSON.stringify(ctx.voice.agentRealtimeControlStatus(key, 'ui'))
    },
    presentCall: () => ({ card: 'generic', title: 'PHOENIX · Control visual autónomo', kind: 'other' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_voice_speak',
    description: 'REPRODUCIR AUDIO AHORA. Kira debe llamar esta herramienta cuando el usuario le diga habla, di algo, lee en voz alta, quiero escucharte, prueba tu voz o ¿me escuchas bien?; usa Codex Live si hay sesión autorizada y activa; si no, sintetiza audio real usando voz local de PHOENIX en el idioma seleccionado. Responde con el proveedor y resultado verificables. No requiere micrófono. No usar para narrar cada paso ni simular reproducción.',
    parameters: {
      engine: { type: 'string', enum: ['auto', 'local'], description: 'auto prioriza Codex Live; local usa voz local configurada sin intentar abrir Codex.' },
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
      const key = exec.agent?.id
      if (args.engine !== 'local' && typeof key === 'string' && /^[A-Za-z0-9_:-]{1,128}$/u.test(key)) {
        const native = ctx.voice.agentRealtimeControl(key, 'speak', args.text)
        if (native.state === 'queued' || native.reason === 'control-busy') return JSON.stringify({
          ...native, accepted: false, instruction: 'Control solicitado o en curso. Consulta phoenix_codex_live_control status; no afirmes reproducción ni repitas por Kokoro mientras esté pendiente.',
        })
      }
      const receipt = await deliverAgentSpeech(ctx.voice, args.text, language, args.engine === 'local' ? undefined : key)
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
      try {
        const sessionId = senseSessionId(exec.agent?.id)
        const status = await windowsAudioStatus(sessionId)
        return JSON.stringify(status)
      } catch (error) {
        return JSON.stringify({
          available: false,
          reason: String(error).slice(0, 220),
          note: 'El oído de Windows requiere Phoenix.exe y una sesión válida. Para pestañas autorizadas, usa las herramientas de vídeo.',
        })
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Diagnosticar oído de PHOENIX', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_audio_listen',
    description: 'ESCUCHAR AUDIO REAL del dispositivo de salida predeterminado de Windows durante 3 a 12 segundos. Windows solicita permiso visible al principio; el usuario puede autorizar una fuente durante 15 minutos solo para esta conversación, sin repetir la selección. Transcribe con faster-whisper local y elimina el WAV temporal. No utiliza microfono ni escucha continua. Si el usuario pide analizar la voz o sonido que sale de sus aplicaciones, usar aqui; no inventar lo no capturado.',
    parameters: {
      seconds: { type: 'integer', description: 'Segundos enteros de captura, 3 a 12; por defecto 8. No sirve para escucha continua.' },
      source: { type: 'string', enum: ['output', 'microphone'],
        description: 'output escucha altavoces/aplicaciones; microphone capta sonido de microfono por autorizacion. Defecto output.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = senseSessionId(exec.agent?.id)
      const seconds = args.seconds === undefined ? 8 : args.seconds
      const source = args.source ?? 'output'
      try { return JSON.stringify(await listenWindowsAudio(sessionId, seconds, source)) }
      catch (error) { return JSON.stringify({
        captureVerified: false, heardSeconds: 0, reason: String(error).slice(0, 240),
        instruction: 'No afirmar que se escucho el audio. Informar el bloqueo concreto y pedir solo el permiso o la fuente necesaria.',
      }) }
    },
    presentCall: () => ({ card: 'generic',title: 'Escuchar audio de Windows (con permiso)', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_audio_file_listen',
    description: 'Transcribe un archivo local de audio aportado/autorizado por el usuario dentro de PHOENIX_AUDIO_ALLOWED_DIRS (rutas separadas por punto y coma). Solo lectura; faster-whisper local. Soporta WAV, MP3, M4A, OGG, FLAC, WebM, MP4; tamaño máximo 32 MiB. No escanea rutas ni accede a carpetas no autorizadas.',
    parameters: {
      path: { type: 'string', required: true, description: 'Ruta absoluta exacta de un archivo autorizado; no una carpeta ni URL.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      try { return JSON.stringify(await transcribeApprovedAudioFile(args.path)) }
      catch (error) { return JSON.stringify({ captureVerified: false, reason: String(error).slice(0, 240),
        instruction: 'Archivo no transcrito; obtener autorizacion concreta para la carpeta o un archivo compatible, no inventar contenido.' }) }
    },
    presentCall: () => ({ card: 'generic', title: 'Transcribir archivo de audio autorizado', kind: 'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name: 'phoenix_senses_status',
    description: 'Informa el estado real de los sentidos digitales de PHOENIX: voz y proveedor, dispositivos de audio de Windows, visores nativos Desktop Live/MiniBrowser e identidad de origen de observaciones. No activa microfono, grabacion o pantalla. No confundir visor visible con fotograma recibido.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const sessionId = senseSessionId(exec.agent?.id)
      const [audio, desktop] = await Promise.all([
        windowsAudioStatus(sessionId).catch((error: unknown) => ({ available: false, reason: String(error).slice(0, 180) })),
        windowsSensesStatus(sessionId).catch((error: unknown) => ({ available: false, reason: String(error).slice(0, 180) })),
      ])
      const voice = ctx.voice.status()
      const realtime = await ctx.voice.conversationRealtimeStatus().catch(() => undefined)
      return JSON.stringify({
        vision: { desktop, note: 'La existencia de un visor no confirma fotogramas. Usar computer o desktop.live-frame para mirar de verdad.' },
        hearing: { audio, browserTab: { verified: false, note: 'Revisar video_media_inspect / youtube_video_listen si estan registrados. Si el vídeo se reproduce realmente por la salida de Windows, usar phoenix_audio_listen con source output. El primer permiso puede autorizar esta conversación por 15 minutos, sin compartir pestañas; jamás afirmar escucha sin un recibo real. Audio capturado solo si existe recibo verificado.' } },
        speech: { enabled: voice.enabled, provider: voice.ttsProvider ?? null, speaking: voice.speaking,
          liveAvailable: realtime?.available ?? false, note: 'Proveedor aceptado no garantiza que el usuario escuche.' },
        physicalSensors: 'excluidos por decisión del usuario',
        evidence: 'Solo estados reportados por los servicios; no se ha abierto micrófono, escuchado ni capturado imagen al consultar.',
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Estado de los sentidos de Kira', kind: 'read' as const }),
  }))
}
