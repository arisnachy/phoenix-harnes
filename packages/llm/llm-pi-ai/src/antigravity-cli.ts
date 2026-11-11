/** Account-backed Gemini model route through the official Antigravity CLI. No token extraction. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { CallId, LlmAdapter, LlmError } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@phoenix-ai/dsh-llm'

export const GOOGLE_ACCOUNT_PROVIDER = 'google-account'
export const GOOGLE_ACCOUNT_KEY = credentialKey('llm-pi-ai', GOOGLE_ACCOUNT_PROVIDER)

function executable(): string {
  const local = process.env.LOCALAPPDATA
  const installed = local === undefined ? undefined : join(local, 'agy', 'bin', 'agy.exe')
  return installed !== undefined && existsSync(installed) ? installed : 'agy'
}

/** Send sensitive prompts through stdin, never process command arguments. */
export function runGoogleCli(args: readonly string[], input = '', signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(), [...args], {
      shell: false, windowsHide: true, cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
      ...(signal === undefined ? {} : { signal }),
    })
    let output = ''
    let errorText = ''
    let done = false
    const deadline = setTimeout(() => { child.kill() }, 180_000)
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
      if (output.length > 8 * 1024 * 1024) {
        child.kill()
        finish(new LlmError('Google CLI output too large', 'GOOGLE_CLI_OUTPUT'))
      }
    })
    child.stderr.on('data', (data: string) => { errorText = (errorText + data).slice(-2000) })
    child.on('error', () => finish(new LlmError(
      'Instala Antigravity CLI y ejecuta agy para iniciar sesión con Google.',
      'GOOGLE_CLI_MISSING',
    )))
    child.on('close', (code) => {
      if (signal?.aborted) finish(new LlmError('Google CLI cancelled', 'ABORTED'))
      else if (code !== 0) finish(new LlmError(
        'Google CLI: ' + (errorText.trim() || String(code)) + '. Ejecuta agy para renovar tu cuenta.',
        'GOOGLE_CLI_FAILED',
      ))
      else finish()
      clearTimeout(deadline)
    })
    child.stdin.on('error', () => { /* Process close reports the failure. */ })
    child.stdin.end(input)
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
  if (result?.status !== 'SUCCESS') throw new LlmError(
    'Antigravity CLI no completó la solicitud: ' + (result?.error ?? result?.status ?? 'sin respuesta'),
    'GOOGLE_CLI_PROTOCOL',
  )
  return result
}

function buildPrompt(request: GenerateOptions): string {
  const turns: string[] = []
  if (request.system) turns.push('SYSTEM:\n' + request.system)
  for (const message of request.messages) {
    for (const block of message.content) {
      if (block.type === 'image' || block.type === 'file') {
        throw new LlmError('El acceso Google CLI solo admite texto en PHOENIX.', 'GOOGLE_CLI_TEXT_ONLY')
      }
    }
    turns.push(message.role.toUpperCase() + ':\n' + JSON.stringify(message.content))
  }
  if (request.tools?.length) {
    turns.push('Herramientas de PHOENIX (no las ejecutes tú): ' + JSON.stringify(request.tools))
    turns.push('Devuelve un JSON. Para respuesta: {"kind":"final","text":"respuesta"}. '
      + 'Para solicitar herramientas: {"kind":"tools","calls":[{"name":"nombre","arguments":"objeto JSON serializado"}]}. '
      + 'Solo PHOENIX ejecutará herramientas y devolverá sus resultados.')
  }
  return turns.join('\n\n')
}

export class GoogleAccountCliAdapter extends LlmAdapter {
  override providerInfo(): { id: string; name: string } {
    return { id: GOOGLE_ACCOUNT_PROVIDER, name: 'Google · Gemini (cuenta)' }
  }
  override async listModels(): Promise<readonly LlmModelInfo[]> {
    try {
      const slugs = parseGoogleModels(await runGoogleCli(['models']))
      return slugs.map(id => ({ provider: GOOGLE_ACCOUNT_PROVIDER, id, name: 'Gemini · ' + id, inputModalities: ['text'] }))
    } catch { return [] }
  }
  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    if (request.provider !== GOOGLE_ACCOUNT_PROVIDER || !/^gemini-[a-z0-9._-]+$/iu.test(request.model)) {
      throw new LlmError('Modelo Gemini no reconocido', 'INVALID_MODEL')
    }
    const flags = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', request.model, '--sandbox']
    if (request.reasoningEffort === 'low' || request.reasoningEffort === 'medium' || request.reasoningEffort === 'high') {
      flags.push('--effort', request.reasoningEffort)
    }
    const input = JSON.stringify({ event: 'user', message: { content: buildPrompt(request) } }) + '\n'
    const result = parseGoogleResult(await runGoogleCli(flags, input, request.signal))
    let response = result.response ?? ''
    let calls: Array<{ name: string; arguments: string }> | undefined
    if (request.tools?.length) {
      let decoded: unknown
      try { decoded = JSON.parse(response) } catch { decoded = undefined }
      if (decoded && typeof decoded === 'object') {
        const object = decoded as { kind?: unknown; text?: unknown; calls?: unknown }
        if (object.kind === 'final' && typeof object.text === 'string') response = object.text
        if (object.kind === 'tools' && Array.isArray(object.calls) && object.calls.length > 0) {
          const valid = new Set(request.tools.map(tool => tool.name))
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
      }
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
  ctx.llm.registerAdapter([GOOGLE_ACCOUNT_PROVIDER], new GoogleAccountCliAdapter())
  ctx.inject(['authorization', 'credentials'], (authorized) => {
    authorized.authorization.registerFlow({
      key: GOOGLE_ACCOUNT_KEY,
      label: 'Google Gemini · Cuenta Antigravity',
      methods: [{ id: 'cli', label: 'Verificar acceso con Google' }],
      async inspect() {
        const stored = await authorized.credentials.readRecord(GOOGLE_ACCOUNT_KEY)
        return stored === undefined ? undefined : {
          kind: 'account', provider: 'Google Antigravity CLI', accountType: 'google-native-cli',
        }
      },
      async run(session) {
        session.notify({
          message: 'Ejecuta agy en PowerShell, inicia sesión en Google desde el navegador y regresa aquí. Nunca pegues tokens ni contraseñas.',
          url: 'https://antigravity.google/docs/install/',
        })
        const answer = await session.prompt({
          kind: 'text', message: 'Escribe VERIFICAR tras completar el inicio de sesión local.',
          placeholder: 'VERIFICAR', signal: session.signal,
        })
        if (answer.trim().toUpperCase() !== 'VERIFICAR') throw new LlmError('Autenticación no confirmada', 'AUTH_REQUIRED')
        const first = parseGoogleModels(await runGoogleCli(['models'], '', session.signal))[0]
        if (first === undefined) throw new LlmError('No se encontraron modelos de cuenta', 'NO_MODELS')
        const test = JSON.stringify({ event: 'user', message: { content: 'Responde solo OK.' } }) + '\n'
        const verified = parseGoogleResult(await runGoogleCli([
          '--input-format', 'stream-json', '--output-format', 'stream-json', '--model', first, '--sandbox',
        ], test, session.signal))
        if (!verified.response?.trim()) throw new LlmError('No respondió el modelo', 'AUTH_UNVERIFIED')
        await authorized.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, async () => ({
          kind: 'grant', payload: { kind: 'native-cli-session-marker', verifiedAt: new Date().toISOString() },
        }))
        session.notify({ message: 'Cuenta verificada con una llamada real. OAuth sigue en el almacén seguro del sistema.' })
      },
    })
  })
}
