/** Persistent, low-latency local neural speech adapter for PHOENIX.
 *
 * The adapter owns only the process protocol and speech planning. Model
 * installation remains deployment-owned so Phoenix never downloads large
 * weights during startup or silently introduces a paid dependency.
 * @module @phoenix-ai/dsh-voice-local/natural
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  VoiceSynthesisRequest,
  VoiceTextToSpeechProvider,
} from '@phoenix-ai/dsh-voice'

/** Cheap, deterministic delivery hints sent to a local neural voice engine. */
export interface NaturalVoiceStyle {
  readonly pace: 'calm' | 'conversational' | 'brisk'
  readonly energy: number
  readonly warmth: number
  readonly interrogative: boolean
}

/** Process factory seam used by the daemon and deterministic tests. */
export type NaturalVoiceSpawn = (
  command: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams

/** Persistent neural provider configuration. */
export interface NaturalVoiceProviderOptions {
  /** Executable that implements the PHOENIX NDJSON voice protocol. */
  readonly command?: string
  /** Arguments passed without a shell. */
  readonly args?: readonly string[]
  /** Maximum time for the resident engine to emit its ready frame. */
  readonly startupTimeoutMs?: number
  /** Maximum time for one speech request. */
  readonly requestTimeoutMs?: number
  /** Maximum characters placed into one semantic synthesis chunk. */
  readonly maxChunkChars?: number
  /** Injectable process factory. */
  readonly spawnProcess?: NaturalVoiceSpawn
}

interface PendingSpeech {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
  readonly removeAbort: () => void
}

interface StartupWaiter {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface NaturalVoiceFrame {
  readonly type?: unknown
  readonly id?: unknown
  readonly message?: unknown
}

/** TTS provider with explicit warmup and deterministic teardown. */
export interface NaturalTextToSpeechProvider extends VoiceTextToSpeechProvider {
  /** Start and warm the resident engine without blocking Phoenix startup. */
  warmup(): Promise<void>
  /** Stop the resident process and reject unfinished work. */
  close(): void
}

/**
 * Split prose at semantic boundaries while keeping chunks small enough for
 * streaming neural synthesis.
 */
export function semanticSpeechChunks(text: string, maxChars = 180): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized === '') return []
  const limit = positiveInteger(maxChars, 'maxChunkChars')
  if (normalized.length <= limit) return [normalized]

  const chunks: string[] = []
  let remaining = normalized
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1)
    const minimum = Math.min(48, Math.floor(limit * 0.45))
    const sentence = lastBoundary(window, /[.!?…](?:[”"'»)]|\s|$)/gu, minimum)
    const clause = lastBoundary(window, /[,;:](?:\s|$)/gu, minimum)
    const whitespace = window.lastIndexOf(' ', limit)
    const cut = sentence > 0
      ? sentence
      : clause > 0
        ? clause
        : whitespace >= minimum
          ? whitespace + 1
          : limit
    const chunk = remaining.slice(0, cut).trim()
    if (chunk !== '') chunks.push(chunk)
    remaining = remaining.slice(cut).trim()
  }
  if (remaining !== '') chunks.push(remaining)
  return chunks
}

/** Derive expressive hints locally without spending another model request. */
export function naturalVoiceStyle(text: string): NaturalVoiceStyle {
  const trimmed = text.trim()
  const interrogative = /[?¿]\s*$/u.test(trimmed)
  const urgent = /(?:!{1,}|\b(?:urgente|alerta|warning|important|importante)\b)/iu.test(trimmed)
  const explanatory = trimmed.length > 180 || /(?:\bporque\b|\bpor tanto\b|\btherefore\b|\bbecause\b)/iu.test(trimmed)
  return Object.freeze({
    pace: urgent ? 'brisk' : explanatory ? 'calm' : 'conversational',
    energy: urgent ? 0.68 : interrogative ? 0.56 : 0.50,
    warmth: urgent ? 0.62 : 0.78,
    interrogative,
  })
}

/** Create one persistent local neural TTS provider. */
export function createNaturalTextToSpeechProvider(
  options: NaturalVoiceProviderOptions,
): NaturalTextToSpeechProvider {
  const command = options.command?.trim() ?? ''
  const args = options.args ?? []
  const daemon = new NaturalVoiceDaemon({
    command,
    args,
    startupTimeoutMs: positiveInteger(options.startupTimeoutMs ?? 45_000, 'startupTimeoutMs'),
    requestTimeoutMs: positiveInteger(options.requestTimeoutMs ?? 120_000, 'requestTimeoutMs'),
    maxChunkChars: positiveInteger(options.maxChunkChars ?? 180, 'maxChunkChars'),
    spawnProcess: options.spawnProcess ?? defaultSpawn,
  })

  return {
    id: 'phoenix-natural',
    priority: 300,
    available: () => command !== '',
    warmup: () => daemon.warmup(),
    close: () => { daemon.close() },
    speak: request => daemon.speak(request),
  }
}

interface ResolvedNaturalVoiceOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly startupTimeoutMs: number
  readonly requestTimeoutMs: number
  readonly maxChunkChars: number
  readonly spawnProcess: NaturalVoiceSpawn
}

class NaturalVoiceDaemon {
  private child: ChildProcessWithoutNullStreams | undefined
  private ready = false
  private stdout = ''
  private startup: StartupWaiter | undefined
  private readonly pending = new Map<string, PendingSpeech>()
  private closing = false

  constructor(private readonly options: ResolvedNaturalVoiceOptions) {}

  async warmup(): Promise<void> {
    if (this.options.command === '') throw new Error('voice-local: natural voice command is not configured')
    await this.ensureStarted()
  }

  async speak(request: VoiceSynthesisRequest): Promise<void> {
    if (request.signal?.aborted === true) throw abortError()
    await this.ensureStarted()
    if (request.signal?.aborted === true) throw abortError()

    const chunks = semanticSpeechChunks(request.text, this.options.maxChunkChars)
    if (chunks.length === 0) return
    const id = randomUUID()
    const child = this.child
    if (child === undefined || !this.ready) throw new Error('voice-local: natural voice engine is not ready')

    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        pending.removeAbort()
        this.pending.delete(id)
        if (error === undefined) resolve()
        else reject(error)
      }
      const abort = (): void => {
        this.writeFrame({ type: 'cancel', id })
        finish(abortError())
      }
      const timer = setTimeout(() => {
        this.writeFrame({ type: 'cancel', id })
        finish(new Error(`voice-local: natural voice request exceeded ${this.options.requestTimeoutMs}ms`))
      }, this.options.requestTimeoutMs)
      this.pending.set(id, {
        resolve: () => { finish() },
        reject: error => { finish(error) },
        timer,
        removeAbort: () => { request.signal?.removeEventListener('abort', abort) },
      })
      request.signal?.addEventListener('abort', abort, { once: true })

      const frame = {
        type: 'speak',
        id,
        language: request.language,
        chunks,
        style: naturalVoiceStyle(request.text),
      }
      child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error !== null && error !== undefined) finish(error)
      })
    })
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    this.writeFrame({ type: 'shutdown' })
    this.child?.kill()
    this.fail(new Error('voice-local: natural voice engine closed'))
    this.closing = false
  }

  private async ensureStarted(): Promise<void> {
    if (this.ready && this.child !== undefined) return
    if (this.startup !== undefined) return this.startup.promise
    if (this.options.command === '') throw new Error('voice-local: natural voice command is not configured')

    let resolveStartup!: () => void
    let rejectStartup!: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve
      rejectStartup = reject
    })
    const timer = setTimeout(() => {
      const error = new Error(`voice-local: natural voice startup exceeded ${this.options.startupTimeoutMs}ms`)
      this.child?.kill()
      this.fail(error)
    }, this.options.startupTimeoutMs)
    this.startup = { promise, resolve: resolveStartup, reject: rejectStartup, timer }

    const child = this.options.spawnProcess(this.options.command, this.options.args)
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => { this.acceptStdout(chunk.toString('utf8')) })
    child.stderr.on('data', () => {
      // Diagnostics intentionally stay off stdout because stdout is the framed protocol.
    })
    child.once('error', (error) => { this.fail(error) })
    child.once('close', (code) => {
      if (this.closing) return
      this.fail(new Error(`voice-local: natural voice engine exited with ${String(code)}`))
    })
    return promise
  }

  private acceptStdout(chunk: string): void {
    this.stdout += chunk
    while (true) {
      const newline = this.stdout.indexOf('\n')
      if (newline < 0) return
      const raw = this.stdout.slice(0, newline).trim()
      this.stdout = this.stdout.slice(newline + 1)
      if (raw === '') continue
      let frame: NaturalVoiceFrame
      try {
        frame = JSON.parse(raw) as NaturalVoiceFrame
      } catch {
        this.fail(new Error('voice-local: natural voice emitted invalid JSON'))
        return
      }
      this.acceptFrame(frame)
    }
  }

  private acceptFrame(frame: NaturalVoiceFrame): void {
    if (frame.type === 'ready') {
      this.ready = true
      const startup = this.startup
      if (startup !== undefined) {
        clearTimeout(startup.timer)
        this.startup = undefined
        startup.resolve()
      }
      return
    }
    if (typeof frame.id !== 'string') return
    const pending = this.pending.get(frame.id)
    if (pending === undefined) return
    if (frame.type === 'done') {
      pending.resolve()
      return
    }
    if (frame.type === 'error') {
      pending.reject(new Error(typeof frame.message === 'string'
        ? `voice-local: natural voice: ${frame.message}`
        : 'voice-local: natural voice request failed'))
    }
  }

  private writeFrame(frame: Readonly<Record<string, unknown>>): void {
    const child = this.child
    if (child === undefined || child.stdin.destroyed) return
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  private fail(error: Error): void {
    this.ready = false
    this.stdout = ''
    const startup = this.startup
    if (startup !== undefined) {
      clearTimeout(startup.timer)
      this.startup = undefined
      startup.reject(error)
    }
    for (const pending of [...this.pending.values()]) pending.reject(error)
    this.pending.clear()
    this.child = undefined
  }
}

function lastBoundary(value: string, pattern: RegExp, minimum: number): number {
  let result = -1
  for (const match of value.matchAll(pattern)) {
    const end = (match.index ?? -1) + match[0].length
    if (end >= minimum) result = end
  }
  return result
}

function defaultSpawn(command: string, args: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(command, [...args], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`voice-local: ${field} must be a positive integer`)
  }
  return value
}

function abortError(): Error {
  const error = new Error('voice-local: natural voice request aborted')
  error.name = 'AbortError'
  return error
}
