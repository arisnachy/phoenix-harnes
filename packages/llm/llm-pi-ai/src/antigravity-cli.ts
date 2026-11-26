/** Account-backed Gemini model route through the official Antigravity CLI. No token extraction. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { CallId, LlmAdapter, LlmError } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@phoenix-ai/dsh-llm'
import { antigravityExecutable, antigravityInstalled, ensureAntigravityInstalled, installAntigravity } from './antigravity-install.ts'
import { relayGoogleCliLogin } from './antigravity-login.ts'
import { createAntigravityQuotaReader } from './antigravity-quota.ts'

export const GOOGLE_ACCOUNT_PROVIDER = 'google-account'
export const ANTIGRAVITY_MODEL_PROVIDER = 'google-antigravity'

/** The old and current selector IDs both execute the native CLI, never an API key. */
export function isGoogleAccountRoute(provider: string | undefined): boolean {
  return provider === GOOGLE_ACCOUNT_PROVIDER || provider === ANTIGRAVITY_MODEL_PROVIDER
}
export const GOOGLE_ACCOUNT_KEY = credentialKey('llm-pi-ai', GOOGLE_ACCOUNT_PROVIDER)

const phoenixToolResponseSchema = JSON.stringify({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['final', 'tools'] },
    text: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, arguments: { type: 'string' } },
        required: ['name', 'arguments'],
      },
    },
  },
  required: ['kind'],
})

// Native CLI actions would run outside Phoenix's tool dispatcher and cannot
// publish a Phoenix artifact or produce a result the agent loop can verify.
const phoenixModelSettings = JSON.stringify({
  permissions: { deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)'] },
})

function decodePhoenixResponse(response: string): unknown {
  const text = response.trim()
  const fenced = /^\x60{3}json[ \t]*\r?\n([\s\S]+)\r?\n\x60{3}$/iu.exec(text)
  try { return JSON.parse(fenced?.[1] ?? text) } catch { /* Try the CLI's appended final line below. */ }
  const lastLine = text.lastIndexOf('\n')
  if (lastLine === -1) return undefined
  // The CLI can concatenate a normal reply and the schema-constrained reply.
  // Recover only text from a trailing frame. Tool calls require a whole envelope.
  try {
    const final = JSON.parse(text.slice(lastLine + 1).trim()) as { kind?: unknown; text?: unknown } | null
    return final?.kind === 'final' && typeof final.text === 'string' ? final : undefined
  } catch { return undefined }
}


/** Refuse API-key billing on the account-only route. */
export function assertGoogleAccountMode(): void {
  if (process.env.AGY_ADC_AUTH?.toLowerCase() === 'true') {
    throw new LlmError('Antigravity está en modo ADC; desactiva AGY_ADC_AUTH para usar la cuenta Google individual.', 'GOOGLE_ACCOUNT_API_MODE')
  }
  const settingsFile = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')
  let config: unknown
  try {
    config = JSON.parse(readFileSync(settingsFile, 'utf8'))
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
    throw new LlmError('No se pudo verificar que Antigravity esté en modo cuenta Google.', 'GOOGLE_AUTH_MODE_UNKNOWN')
  }
  assertGoogleAccountSettings(config)
}

/** Account mode must not silently use a configured API billing provider. */
export function assertGoogleAccountSettings(config: unknown): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new LlmError('Configuración de Antigravity inválida; revisa settings.json.', 'GOOGLE_AUTH_MODE_UNKNOWN')
  }
  if ('modelProvider' in config && config.modelProvider != null && config.modelProvider !== '') {
    throw new LlmError(
      'Antigravity tiene modelProvider explícito; elimina esa propiedad para usar la sesión individual de Google, sin facturación por API.',
      'GOOGLE_ACCOUNT_API_MODE',
    )
  }
}

/** Keep unrelated API credentials out of the account-only child process. */
export function googleAccountEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH', 'GOOGLE_APPLICATION_CREDENTIALS'].includes(key.toUpperCase())))
}


/** Classify provider diagnostics without exposing arbitrary CLI output or credentials. */
export function isGoogleCliAuthFailure(value: string): boolean {
  return /api[ _-]?key|unauthenticated|authentication|sign[ -]?in|log[ -]?in|oauth|\b(?:401|403)\b/iu.test(value)
}

export function googleCliQuotaFailure(diagnostic: string): LlmError | undefined {
  if (/\bquota\s+(?:reached|exhausted|exceeded)\b|\bQUOTA_EXHAUSTED\b/iu.test(diagnostic)) {
    return new LlmError('Google Antigravity alcanzó la cuota del modelo. Espera a que se renueve la cuota para volver a intentarlo.', 'GOOGLE_CLI_QUOTA')
  }
  if (/\bRESOURCE_EXHAUSTED\b|\b429\b/iu.test(diagnostic)) {
    return new LlmError('Google Antigravity limitó temporalmente la solicitud (HTTP 429).', 'RATE_LIMIT')
  }
  return undefined
}

/** Send sensitive prompts through stdin, never process command arguments. */
export function runGoogleCli(args: readonly string[], input = '', signal?: AbortSignal): Promise<string> {
  assertGoogleAccountMode()
  return new Promise((resolve, reject) => {
    const child = spawn(antigravityExecutable(), [...args], {
      shell: false, windowsHide: true, cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
      env: googleAccountEnvironment(process.env),
      ...(signal === undefined ? {} : { signal }),
    })
    let output = ''
    let errorText = ''
    let done = false
    const streaming = args.includes('--input-format') && args.includes('stream-json') && input !== ''
    let terminalSeen = false
    let pendingLine = ''
    const deadline = setTimeout(() => {
      finish(new LlmError('Antigravity agotó el tiempo de respuesta.', 'TIMEOUT'))
      child.kill()
    }, 180_000)
    deadline.unref()
    const finish = (error?: Error): void => {
      if (done) return
      done = true
      clearTimeout(deadline)
      if (error === undefined) resolve(output)
      else reject(error)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      output += data
      if (streaming && !terminalSeen) {
        pendingLine += data
        const lines = pendingLine.split('\n')
        pendingLine = lines.pop() ?? ''
        for (const line of lines) {
          try {
            if (JSON.parse(line).event === 'result') {
              terminalSeen = true
              child.stdin.end()
              break
            }
          } catch { /* diagnostics are not terminal events */ }
        }
      }
      if (output.length > 8 * 1024 * 1024) {
        child.kill()
        finish(new LlmError('Google CLI output too large', 'GOOGLE_CLI_OUTPUT'))
      }
    })
    child.stderr.on('data', (data: string) => { errorText = (errorText + data).slice(-16000) })
    child.on('error', () => finish(new LlmError(
      'Instala Antigravity CLI y ejecuta agy para iniciar sesión con Google.',
      'GOOGLE_CLI_MISSING',
    )))
    child.on('close', (code) => {
      if (signal?.aborted) finish(new LlmError('Google CLI cancelled', 'ABORTED'))
      else if (code !== 0) {
        const authFailure = isGoogleCliAuthFailure(errorText + output)
        finish(googleCliQuotaFailure(errorText) ?? new LlmError(
          authFailure ? 'Antigravity CLI rechazó la autenticación. Ejecuta agy con la misma cuenta de Windows y comprueba que no exista modelProvider en settings.json.' : `Antigravity CLI terminó con código ${code ?? 'desconocido'}.`,
          authFailure ? 'AUTH_REQUIRED' : 'GOOGLE_CLI_FAILED',
        ))
      }
      else if (streaming && !terminalSeen) finish(new LlmError('Antigravity cerró sin confirmar el turno completo.', 'GOOGLE_CLI_PROTOCOL'))
      else finish()
      clearTimeout(deadline)
    })
    child.stdin.on('error', () => {
      if (!terminalSeen && !done) {
        finish(new LlmError('No se pudo entregar el mensaje completo a Antigravity.', 'TRANSPORT'))
        child.kill()
      }
    })
    // NDJSON is a live session: do not send EOF until the terminal result.
    // Explicit UTF-8 also preserves accents and non-ASCII text on Windows.
    if (streaming) child.stdin.write(Buffer.from(input, 'utf8'))
    else child.stdin.end(input)
  })
}

/** Only advertise real Gemini slugs from the account-scoped CLI listing. */
export function parseGoogleModels(value: string): string[] {
  return [...new Set((value.match(/\bgemini-[a-z0-9][a-z0-9._-]*\b/giu) ?? []).map(id => id.toLowerCase()))]
}

export interface GoogleCliResult {
  status: string
  response?: string
  error?: string
  usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number }
}

export function parseGoogleResult(value: string): GoogleCliResult {
  let result: GoogleCliResult | undefined
  for (const line of value.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (parsed !== null && typeof parsed === 'object') {
      const event = parsed as { event?: string; result?: GoogleCliResult }
      if (event.event === 'result') result = event.result
    }
  }
  if (result?.status !== 'SUCCESS') {
    const quotaFailure = googleCliQuotaFailure(result?.error ?? '')
    if (quotaFailure) throw quotaFailure
    if (isGoogleCliAuthFailure(result?.error ?? '')) {
      throw new LlmError('Antigravity CLI rechazó la sesión de Google. Vuelve a conectar la cuenta desde Modelos; no se usará una API key.', 'AUTH_REQUIRED')
    }
    throw new LlmError('Antigravity CLI no completó la solicitud: ' + (result?.status ?? 'sin respuesta'), 'GOOGLE_CLI_PROTOCOL')
  }
  return result
}

/** Encode the documented stream-json user event, not a bare content string. */
export function encodeGoogleUserEvent(text: string): string {
  if (text.trim() === '') throw new LlmError('Antigravity no recibió contenido de texto.', 'GOOGLE_CLI_EMPTY_INPUT')
  return JSON.stringify({ event: 'user', message: { content: [{ type: 'text', text }] } }) + '\n'
}

function isInternalContext(message: GenerateOptions['messages'][number]): boolean {
  const sourceKind: string | undefined = message.source?.kind
  return sourceKind === 'skill-catalog'
    || (message.source?.kind === 'plugin' && message.source.plugin === '@phoenix-ai/dsh-system-prompt')
}

/** Preserve the ordered transcript and put the actual latest turn at the end. */
export function buildPrompt(request: Pick<GenerateOptions, 'system' | 'messages' | 'tools' | 'model'>): string {
  const turns: string[] = []
  const latest = request.messages.findLast(message => !isInternalContext(message))
  if (latest === undefined || latest.role !== 'user' || !latest.content.some(block => block.type === 'tool-result' || (block.type === 'text' && block.text.trim()))) {
    throw new LlmError('Antigravity no recibió un turno actual de usuario o herramienta.', 'GOOGLE_CLI_EMPTY_INPUT')
  }
  const latestText = latest.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')
  turns.push('TURNO ACTUAL DE PHOENIX (responde a este contenido):\n' + latestText)
  if (request.system) turns.push('SYSTEM:\n' + request.system)
  turns.push('Modelo seleccionado en PHOENIX: ' + request.model + '. Responde al último turno de la conversación, utilizando el historial como contexto.')
  if (request.tools?.length) {
    turns.push('Solo el host de PHOENIX puede ejecutar estas herramientas y entregar resultados en este chat. '
      + 'Usa kind=tools para solicitar acciones al host. No uses herramientas nativas de Antigravity para esas acciones '
      + 'ni afirmes haberlas completado sin un resultado de PHOENIX. Herramientas disponibles: ' + JSON.stringify(request.tools))
    turns.push('Devuelve un JSON. Para respuesta: {"kind":"final","text":"respuesta"}. '
      + 'Para solicitar herramientas: {"kind":"tools","calls":[{"name":"nombre","arguments":"objeto JSON serializado"}]}. '
      + 'Para una respuesta puramente conversacional o después de verificar el resultado del host, usa kind=final.')
    if (request.tools.some(tool => tool.name === 'phoenix_canvas')) {
      turns.push('Para crear y mostrar una página web o mini-app en este chat, solicita phoenix_canvas con el título y el HTML autocontenido. '
        + 'Un nombre de archivo o una descripción no presenta una vista previa.')
    }
  }
  const conversation: string[] = []
  const internalContext: string[] = []
  for (const message of request.messages) {
    for (const block of message.content) {
      if (block.type === 'image' || block.type === 'file') {
        throw new LlmError('El acceso Google CLI solo admite texto en PHOENIX.', 'GOOGLE_CLI_TEXT_ONLY')
      }
    }
    const text = message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')
    if (!text.trim()) continue
    if (isInternalContext(message)) internalContext.push(text)
    else conversation.push(message.role.toUpperCase() + ':\n' + text)
  }
  if (conversation.length === 0) throw new LlmError('Antigravity no recibió mensajes de conversación.', 'GOOGLE_CLI_EMPTY_INPUT')
  if (internalContext.length > 0) turns.push('CONTEXTO INTERNO DE PHOENIX:\n' + internalContext.join('\n\n'))
  turns.push('CONVERSACIÓN (orden cronológico):\n' + conversation.join('\n\n'))
  return turns.join('\n\n')

}

export class GoogleAccountCliAdapter extends LlmAdapter {
  constructor(private readonly route: string = ANTIGRAVITY_MODEL_PROVIDER, private readonly execute = runGoogleCli) { super() }

  override providerInfo(): { id: string; name: string } {
    return { id: this.route, name: 'Google Antigravity CLI (cuenta Google)' }
  }
  override async listModels(): Promise<readonly LlmModelInfo[]> {
    try {
      const slugs = parseGoogleModels(await this.execute(['models']))
      return slugs.map(id => ({ provider: this.route, id, name: 'Gemini · ' + id, inputModalities: ['text'] as const }))
    } catch { return [] }
  }
  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    if (request.provider !== this.route || !/^gemini-[a-z0-9._-]+$/iu.test(request.model)) {
      throw new LlmError('Modelo Gemini no reconocido', 'INVALID_MODEL')
    }
    const flags = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', request.model, '--sandbox', '--disable-slash-commands', '--settings', phoenixModelSettings]
    if (request.reasoningEffort === 'low' || request.reasoningEffort === 'medium' || request.reasoningEffort === 'high') {
      flags.push('--effort', request.reasoningEffort)
    }
    if (request.tools?.length) flags.push('--json-schema', phoenixToolResponseSchema)
    const input = encodeGoogleUserEvent(buildPrompt(request))
    const tools = request.tools ?? []
    let result = parseGoogleResult(await this.execute(flags, input, request.signal))
    let response = result.response ?? ''
    if (!response.trim()) throw new LlmError('Antigravity terminó sin devolver contenido.', 'GOOGLE_CLI_EMPTY_OUTPUT')
    let calls: Array<{ name: string; arguments: string }> | undefined
    if (tools.length > 0) {
      let decoded = decodePhoenixResponse(response)
      if (decoded === undefined) {
        request.signal?.throwIfAborted()
        const repair = 'Devuelve exactamente un objeto JSON del esquema de PHOENIX, sin texto fuera del objeto. '
          + 'Una pregunta informativa se responde con kind=final y text. Si se requiere una acción, solicita la herramienta con kind=tools.'
        result = parseGoogleResult(await this.execute(flags,
          encodeGoogleUserEvent(repair + '\n\n' + buildPrompt(request)), request.signal))
        response = result.response ?? ''
        decoded = decodePhoenixResponse(response)
      }
      if (decoded && typeof decoded === 'object') {
        const object = decoded as { kind?: unknown; text?: unknown; calls?: unknown }
        if (object.kind === 'final' && typeof object.text === 'string' && object.text.trim()) response = object.text
        else if (object.kind !== 'tools' || !Array.isArray(object.calls) || object.calls.length === 0) {
          throw new LlmError('Antigravity no devolvió una respuesta válida para las herramientas de PHOENIX.', 'GOOGLE_CLI_PROTOCOL')
        }
        if (object.kind === 'tools' && Array.isArray(object.calls) && object.calls.length > 0) {
          const valid = new Set(tools.map(tool => tool.name))
          calls = object.calls.map((raw: unknown) => {
            if (!raw || typeof raw !== 'object') throw new LlmError('Tool call invalid', 'INVALID_TOOL_CALL')
            const call = raw as { name?: unknown; arguments?: unknown }
            if (typeof call.name !== 'string' || !valid.has(call.name) || typeof call.arguments !== 'string') {
              throw new LlmError('Unknown tool', 'INVALID_TOOL_CALL')
            }
            let argumentsObject: unknown
            try { argumentsObject = JSON.parse(call.arguments) } catch {
              throw new LlmError('Invalid tool JSON', 'INVALID_TOOL_CALL')
            }
            if (!argumentsObject || typeof argumentsObject !== 'object' || Array.isArray(argumentsObject)) {
              throw new LlmError('Invalid tool argument object', 'INVALID_TOOL_CALL')
            }
            return { name: call.name, arguments: call.arguments }
          })
        }
      } else throw new LlmError('Antigravity no devolvió una respuesta estructurada para PHOENIX.', 'GOOGLE_CLI_PROTOCOL')
    }
    if (calls !== undefined) {
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index]!
        const id = CallId(randomUUID())
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: call.arguments } }
      }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: response }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
    }
    if (result.usage) {
      const cached = Math.max(0, result.usage.cache_read_tokens ?? 0)
      yield { type: 'usage', usage: {
        inputTokens: Math.max(0, (result.usage.input_tokens ?? 0) - cached),
        outputTokens: Math.max(0, result.usage.output_tokens ?? 0),
        cacheReadTokens: cached,
        reasoningTokens: Math.max(0, result.usage.thinking_tokens ?? 0),
      } }
    }
    yield { type: 'finish', reason: { kind: calls === undefined ? 'stop' : 'tool-calls' } }
  }
}

/** Add Google account models and store only a verified account-session marker. */
export function registerGoogleAccountCli(ctx: Context): void {
  ctx.llm.registerAdapter([ANTIGRAVITY_MODEL_PROVIDER], new GoogleAccountCliAdapter(ANTIGRAVITY_MODEL_PROVIDER))
  // Preserve conversations saved using the temporary native route identifier.
  ctx.llm.registerAdapter([GOOGLE_ACCOUNT_PROVIDER], new GoogleAccountCliAdapter(GOOGLE_ACCOUNT_PROVIDER))
  const readQuota = createAntigravityQuotaReader(runGoogleCli)
  ctx.inject(['authorization', 'credentials'], (authorized) => {
    authorized.authorization.registerFlow({
      key: GOOGLE_ACCOUNT_KEY,
      label: 'Google Antigravity CLI (cuenta Google)',
      methods: [{ id: 'cli', label: 'Instalar y conectar cuenta Google' }],
      async inspect(signal) {
        const stored = await authorized.credentials.readRecord(GOOGLE_ACCOUNT_KEY)
        if (stored === undefined) return undefined
        const groups = await readQuota(signal).catch(() => undefined)
        return {
          kind: 'account', provider: 'Google Antigravity CLI', accountType: 'google-native-cli',
          ...groups === undefined ? {} : { quotaGroups: groups },
        }
      },
      async run(session) {
        assertGoogleAccountMode()
        session.notify({ message: 'Comprobando instalación de Antigravity CLI…' })
        await ensureAntigravityInstalled({
          installed: () => antigravityInstalled(session.signal),
          consent: async () => {
            const answer = await session.prompt({
              kind: 'select', message: 'Antigravity CLI no está instalada. ¿Autorizar la instalación oficial de Google para tu usuario?',
              options: [{ id: 'agy-install', label: 'Instalar Antigravity CLI' }, { id: 'agy-cancel', label: 'Cancelar' }], signal: session.signal,
            })
            return answer === 'agy-install'
          },
          install: async () => {
            session.notify({ message: 'Instalando Antigravity CLI desde Google…' })
            await installAntigravity(session.signal)
          },
        })
        session.notify({ message: 'Abriendo autenticación oficial de Google…' })
        const login = spawn(antigravityExecutable(), ['acp', '--login'], {
          shell: false, windowsHide: true, cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
          env: googleAccountEnvironment(process.env),
        })
        await relayGoogleCliLogin(login, {
          signal: session.signal,
          notify: notice => session.notify(notice),
          prompt: prompt => session.prompt(prompt),
        })
        session.notify({ message: 'Comprobando automáticamente los modelos y la respuesta de tu cuenta…' })
        const first = parseGoogleModels(await runGoogleCli(['models'], '', session.signal))[0]
        if (first === undefined) throw new LlmError('No se encontraron modelos de cuenta', 'NO_MODELS')
        const challenge = 'PHOENIX-' + randomUUID()
        const test = encodeGoogleUserEvent('Responde exclusivamente con este texto exacto, sin formato: ' + challenge)
        const verified = parseGoogleResult(await runGoogleCli([
          '--input-format', 'stream-json', '--output-format', 'stream-json', '--model', first, '--sandbox', '--mode', 'default', '--disable-slash-commands',
        ], test, session.signal))
        if (verified.response?.trim() !== challenge) throw new LlmError('Antigravity respondió, pero no confirmó la recepción exacta del mensaje de prueba.', 'AUTH_UNVERIFIED')
        await authorized.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, async () => ({
          kind: 'grant', payload: { kind: 'native-cli-session-marker', verifiedAt: new Date().toISOString() },
        }))
        session.notify({ message: 'Cuenta verificada con una llamada real. OAuth sigue en el almacén seguro del sistema.' })
      },
    })
  })
}
