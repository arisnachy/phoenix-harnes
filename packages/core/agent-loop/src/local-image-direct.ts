/**
 * Deterministic local-image ingress. Recognize only self-contained requests
 * targeting the local FastSD engine; no LLM, history, prompts, tools or memory
 * are assembled before this branch. Ambiguous follow-ups stay with Kira.
 * @module dsh-agent-loop/local-image-direct
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { UserMessage } from '@phoenix-ai/dsh-session'

const WORKER = fileURLToPath(new URL('../../../../scripts/phoenix-fastsd-mcp.mjs', import.meta.url))
const MAX_USER_CHARS = 3000
const MAX_REPLY_CHARS = 8192
const WORKER_TIMEOUT_MS = 30 * 60_000
const IMAGE_MARKDOWN = /^!\[Imagen generada localmente\]\(\/local-images\/[a-f0-9]{32}\.jpg\)$/u
// oxlint-disable-next-line @stylistic/max-len -- Intent is a single verified, language-specific expression.
const COMMAND = /^(?:(?:hey\s+)?kira[\s,:-]*)?(?:(?:por\s+favor|puedes|podrias|could\s+you|please)[\s,:-]*)?(?:genera(?:me)?|crea(?:me)?|haz(?:me)?|dibuja(?:me)?|renderiza|generate|create|make|draw|render)\s+(?:una?\s+|an?\s+)?(?:imagen|foto(?:grafia)?|ilustracion|image|picture|photo|illustration)(?:\s+local)?(?:\s+(?:de|del|of))?\s*/iu
// oxlint-disable-next-line @stylistic/max-len -- Intent is a single verified, language-specific expression.
const ENGINE_SUFFIX = /\s+(?:usando|con|using|with)\s+(?:(?:el|the)\s+)?(?:(?:modelo|model)\s+)?(?:sd[\s-]*turbo(?:[\s-]*openvino)?|fastsd(?:[\s-]*cpu)?)\s*[.!?]*$/iu
// oxlint-disable-next-line @stylistic/max-len -- Intent is a single verified, language-specific expression.
const REFERENCE = /\b(?:anterior|anteriores|previous|above|adjunta|adjunto|attached|subida|subido|uploaded|esta\s+foto|esta\s+imagen|that\s+image|same\s+image|la\s+misma|como\s+antes|edit(?:ar|a)?|modifica|retoca)\b/iu

/**
 * Return precisely the requested image subject or decline the fastpath.
 * Only a self-contained text-only human message may bypass model context.
 * @param message - first pending message in an otherwise empty agent inbox.
 * @returns The concise user-specified image prompt, or undefined to use normal conversation.
 */
export function localImageDirectPrompt(message: UserMessage | undefined): string | undefined {
  if (process.env.PHOENIX_FASTSD_ENABLE === '0' || message?.source.kind !== 'user'
    || message.content.length !== 1 || message.content[0]?.type !== 'text') return undefined
  const original = message.content[0].text.trim()
  if (original.length < 10 || original.length > MAX_USER_CHARS) return undefined
  const normalized = original.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  if (!/\b(?:local|openvino|fastsd|sd[\s-]*turbo)\b/iu.test(normalized)) return undefined
  if (REFERENCE.test(normalized)) return undefined
  const command = COMMAND.exec(normalized)
  if (command === null || command.index !== 0) return undefined
  const subject = original.slice(command[0].length).replace(ENGINE_SUFFIX, '').trim()
  if (subject.length < 2 || subject.length > 2800) return undefined
  return subject
}

/**
 * Execute exactly one prompt through the isolated FastSD CLI worker. The
 * worker receives only this text over stdin (never a session snapshot).
 * A single worker runs at a time across sessions on this Host.
 */
let directImageQueue: Promise<void> = Promise.resolve()

/**
 * Serialize standalone image generations across concurrently active sessions:
 * no second Host worker can interrupt another worker's owned FastSD process.
 * @param prompt - Image description from the current human message only.
 * @param signal - Turn cancellation, including while waiting for the queue.
 * @returns The single generated image markdown reference.
 */
export function runLocalImageDirect(prompt: string, signal: AbortSignal): Promise<string> {
  const generation = directImageQueue.then(() => spawnDirectImageWorker(prompt, signal))
  directImageQueue = generation.then(() => undefined, () => undefined)
  return generation
}

async function spawnDirectImageWorker(prompt: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise<string>((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [WORKER, '--generate-once'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    let output = ''
    let errorOutput = ''
    let settled = false
    const finish = (error: Error | undefined, result?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error !== undefined) rejectResult(error)
      else if (result !== undefined) resolveResult(result)
      else rejectResult(new Error('FastSD no devolvió una imagen.'))
    }
    const abort = (): void => {
      child.kill()
      finish(new Error('Generación de imagen local cancelada.'))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('FastSD excedió el tiempo máximo de generación local.'))
    }, WORKER_TIMEOUT_MS)
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString('utf8')
      if (output.length > MAX_REPLY_CHARS) {
        child.kill()
        finish(new Error('FastSD devolvió una respuesta excesiva.'))
      }
    })
    child.stderr.on('data', (bytes: Buffer) => {
      errorOutput = (errorOutput + bytes.toString('utf8')).slice(-1000)
    })
    child.once('error', (error: Error) => { finish(error) })
    child.once('close', (code: number | null) => {
      if (settled) return
      let message: { ok?: boolean; markdown?: unknown; error?: unknown }
      try {
        message = JSON.parse(output) as { ok?: boolean; markdown?: unknown; error?: unknown }
      } catch {
        finish(new Error('FastSD terminó sin respuesta verificable (código ' + String(code) + ').'))
        return
      }
      if (code !== 0 || message.ok !== true) {
        const reason = typeof message.error === 'string' ? message.error.slice(0, 300) : errorOutput.slice(0, 240)
        finish(new Error('FastSD no pudo generar la imagen: ' + (reason || 'el servicio no está disponible')))
        return
      }
      if (typeof message.markdown !== 'string' || !IMAGE_MARKDOWN.test(message.markdown)) {
        finish(new Error('FastSD devolvió una referencia de imagen inválida.'))
        return
      }
      finish(undefined, message.markdown)
    })
    if (signal.aborted) {
      abort()
      return
    }
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ prompt }))
  })
}
