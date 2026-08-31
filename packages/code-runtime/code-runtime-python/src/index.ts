/**
 * CPython subprocess provider for the PHOENIX code-execution seam.
 *
 * Each run gets a fresh interpreter. The process is a containment mechanism,
 * not a security boundary: callers must still apply the product sandbox and
 * approval policy before exposing untrusted code to it.
 * @module @phoenix-ai/dsh-code-runtime-python
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { snapshotJsonValue } from '@phoenix-ai/dsh-session'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@phoenix-ai/dsh-code-runtime'
import type { CodeBindingNamespace, CodeJsonValue, CodeRunFailure, CodeRunRequest, CodeRunResult } from '@phoenix-ai/dsh-code-runtime'
import type { BootMessage, ChildToHost, ReplyMessage } from './protocol.ts'
import { checkDoneValue, encodeJsonPlain, hasNonLosslessNumber, hasUnsafeIntegerToken, logTruncationMarker, validateChildFrame } from './protocol.ts'

export type { BootMessage, ChildToHost, ReplyMessage }
export { checkDoneValue, encodeJsonPlain, hasNonLosslessNumber, hasUnsafeIntegerToken, logTruncationMarker, validateChildFrame }

declare module '@phoenix-ai/cordis' {
  interface Context {
    pythonCodeRuntime: PythonCodeRuntime
  }
}

/** Python runtime settings. All execution budgets are deployment-configurable. */
export interface Config {
  /** Executable used to launch CPython. */
  pythonCommand?: string
  /** CPU limit sent to the child on platforms that expose resource limits. */
  cpuSeconds?: number
  /** Address-space limit sent to the child on platforms that expose it. */
  addressSpaceBytes?: number
  /** Maximum bytes retained by the child log ledger. */
  maxLogBytes?: number
  /** Maximum serialized completion value size. */
  maxValueBytes?: number
  /** Maximum combined outer result size. */
  maxOutputBytes?: number
  /** Maximum bytes buffered for one inbound protocol frame. */
  maxFrameBytes?: number
  /** Wall-clock limit for one run. */
  maxWallMs?: number
}

type ResolvedConfig = Required<Config>

const PYTHON_PATH = fileURLToPath(new URL('../py/runtime.py', import.meta.url))
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const MIN_OUTPUT_BYTES = 4

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

class OutputLedger {
  private bytes = 2
  private entries = 0
  constructor(private readonly maxBytes: number) {}

  /** Admit one log entry into the bounded outer result. */
  admit(text: string, logs: string[]): boolean {
    const next = Buffer.byteLength(JSON.stringify(text), 'utf8') + (this.entries === 0 ? 0 : 1)
    if (this.bytes + next > this.maxBytes) return false
    this.bytes += next
    this.entries++
    logs.push(text)
    return true
  }

  /** Finalize a success or orthogonal failure without throwing. */
  finish(logs: string[], value?: CodeJsonValue, error?: CodeRunFailure): CodeRunResult {
    if (error !== undefined) {
      if (this.bytes + Buffer.byteLength(JSON.stringify(error.message), 'utf8') > this.maxBytes) {
        return { logs, error: { kind: 'output-limit', message: `outer output exceeded ${this.maxBytes} bytes` } }
      }
      return { logs, error }
    }
    const checked = value === undefined ? undefined : checkDoneValue(value, this.maxBytes - this.bytes)
    if (checked !== undefined && !checked.ok) {
      return { logs, error: { kind: 'output-limit', message: `outer output exceeded ${this.maxBytes} bytes` } }
    }
    return { logs, ...value === undefined ? {} : { value } }
  }
}

function validateBindings(request: CodeRunRequest): Map<string, CodeBindingNamespace> {
  const bindings = new Map<string, CodeBindingNamespace>()
  const errorClassNames = new Set<string>()
  for (const namespace of request.bindings) {
    if (!IDENTIFIER.test(namespace.global) || PORTABLE_RESERVED_WORDS.has(namespace.global)) {
      throw new Error(`dsh-code-runtime-python: binding global ${JSON.stringify(namespace.global)} is not a usable identifier`)
    }
    if (RESERVED_BINDING_GLOBALS.has(namespace.global) || bindings.has(namespace.global)) {
      throw new Error(`dsh-code-runtime-python: reserved or duplicate binding global ${JSON.stringify(namespace.global)}`)
    }
    bindings.set(namespace.global, namespace)
    const errorClass = namespace.errorClass
    if (errorClass === undefined) continue
    if (!IDENTIFIER.test(errorClass.name) || PORTABLE_RESERVED_WORDS.has(errorClass.name)
      || RESERVED_BINDING_GLOBALS.has(errorClass.name) || bindings.has(errorClass.name) || errorClassNames.has(errorClass.name)) {
      throw new Error(`dsh-code-runtime-python: binding error class ${JSON.stringify(errorClass.name)} is not usable`)
    }
    if (errorClass.memberNameProperty.length === 0
      || RESERVED_ERROR_MEMBERS.has(errorClass.memberNameProperty)
      || DUNDER_MEMBER.test(errorClass.memberNameProperty)) {
      throw new Error(`dsh-code-runtime-python: binding error member property ${JSON.stringify(errorClass.memberNameProperty)} is not usable`)
    }
    errorClassNames.add(errorClass.name)
  }
  return bindings
}

interface LiveRun {
  readonly child: ChildProcess
  readonly finished: Promise<void>
  settle: (failure: CodeRunFailure) => void
}

/** CPython provider registered as `ctx.pythonCodeRuntime`. */
export class PythonCodeRuntime extends CodeRuntime {
  static Config: z<Config> = z.object({
    pythonCommand: z.string().default(process.platform === 'win32' ? 'python' : 'python3'),
    cpuSeconds: z.number().default(60),
    addressSpaceBytes: z.number().default(536_870_912),
    maxLogBytes: z.number().default(8_388_608),
    maxValueBytes: z.number().default(16_777_216),
    maxOutputBytes: z.number().default(67_108_864),
    maxFrameBytes: z.number().default(67_108_864),
    maxWallMs: z.number().default(600_000),
  })

  readonly language: string = 'python'
  readonly isolation: string = 'process'
  private readonly config: ResolvedConfig
  private readonly live = new Set<LiveRun>()
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pythonCodeRuntime')
    this.config = config as ResolvedConfig
    if (this.config.pythonCommand.trim() === '') throw new Error('dsh-code-runtime-python: config.pythonCommand must not be empty')
    for (const [key, value] of Object.entries(this.config)) {
      if (typeof value === 'number' && !(Number.isFinite(value) && value > 0)) throw new Error(`dsh-code-runtime-python: config.${key} must be positive`)
    }
    for (const key of ['addressSpaceBytes', 'maxLogBytes', 'maxValueBytes', 'maxOutputBytes', 'maxFrameBytes'] as const) {
      if (!Number.isSafeInteger(this.config[key])) throw new Error(`dsh-code-runtime-python: config.${key} must be a safe integer`)
    }
    if (this.config.maxOutputBytes < MIN_OUTPUT_BYTES
      || this.config.maxFrameBytes < MIN_OUTPUT_BYTES
      || this.config.maxWallMs > 2_147_483_647) {
      throw new Error('dsh-code-runtime-python: output and wall-clock caps are outside the supported range')
    }
    ctx.effect(() => () => this.teardown(), 'python code-runtime teardown')
  }

  private async teardown(): Promise<void> {
    this.disposed = true
    const runs = [...this.live]
    for (const run of runs) run.settle({ kind: 'abort', message: 'runtime disposed' })
    await Promise.all(runs.map(run => run.finished))
  }

  /**
   * Execute one program in a fresh CPython process.
   * @param request - Program source, host bindings, and optional abort signal.
   * @returns The bounded logs, completion value, or structured runtime failure.
   */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) throw new Error('dsh-code-runtime-python: run() after disposal')
    const bindings = validateBindings(request)
    if (request.signal?.aborted) return { logs: [], error: { kind: 'abort', message: String(request.signal.reason) } }
    return await this.execute(request, bindings)
  }

  private execute(request: CodeRunRequest, bindings: Map<string, CodeBindingNamespace>): Promise<CodeRunResult> {
    // `-I` removes the bootstrap directory from sys.path on CPython, which
    // would also hide the package-owned protocol mirror. The child already
    // receives an empty environment; keeping the script directory available
    // is required for the checked-in bootstrap import.
    const child = spawn(this.config.pythonCommand, ['-B', PYTHON_PATH], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: {}, windowsHide: true,
    })
    const channel = child.stdio[3]
    if (!(channel instanceof Writable)) {
      child.kill()
      return Promise.resolve({ logs: [], error: { kind: 'worker-exit', message: 'python protocol channel unavailable' } })
    }

    return new Promise((resolve) => {
      const output = new OutputLedger(this.config.maxOutputBytes)
      const logs: string[] = []
      let settled = false
      let booted = false
      let runSent = false
      let inputBuffer = ''
      let onAbort = (): void => {}
      let finishResolve!: () => void
      let childClosed = false
      let resultToResolve: CodeRunResult | undefined
      const finished = new Promise<void>((done) => { finishResolve = done })
      const live: LiveRun = { child, finished, settle: (failure) => { finish(output.finish(logs, undefined, failure)) } }

      const resolveFinished = (): void => {
        if (resultToResolve === undefined) return
        finishResolve()
        resolve(resultToResolve)
      }

      const finish = (result: CodeRunResult): void => {
        if (settled) return
        settled = true
        clearTimeout(wallTimer)
        request.signal?.removeEventListener('abort', onAbort)
        this.live.delete(live)
        channel.end()
        child.kill()
        resultToResolve = result
        if (childClosed) resolveFinished()
      }
      live.settle = (failure) => { finish(output.finish(logs, undefined, failure)) }
      const fail = (failure: CodeRunFailure): void => { finish(output.finish(logs, undefined, failure)) }
      const write = (frame: unknown): void => {
        if (settled) return
        try { channel.write(`${encodeJsonPlain(frame)}\n`) } catch (error) { fail({ kind: 'worker-exit', message: messageOf(error) }) }
      }
      const onFrame = (raw: unknown): void => {
        const frame = validateChildFrame(raw)
        if (frame === undefined || settled) return
        if (frame.type === 'boot-ack') {
          if (booted) return
          booted = true
          write({ type: 'run', program: request.program })
          runSent = true
          return
        }
        if (frame.type === 'log') {
          if (!output.admit(frame.text, logs)) fail({ kind: 'output-limit', message: `outer output exceeded ${this.config.maxOutputBytes} bytes` })
          return
        }
        if (frame.type === 'call') {
          if (!runSent) return
          const namespace = bindings.get(frame.global)
          const fn = namespace !== undefined && Object.hasOwn(namespace.functions, frame.name) ? namespace.functions[frame.name] : undefined
          if (typeof fn !== 'function') { write({ type: 'reply', id: frame.id, ok: false, message: `unknown binding ${JSON.stringify(`${frame.global}.${frame.name}`)}` }); return }
          void (async () => {
            try {
              const value = snapshotJsonValue(await fn(frame.args))
              if (value === undefined) write({ type: 'reply', id: frame.id, ok: false, message: 'binding resolution must be lossless JSON' })
              else write({ type: 'reply', id: frame.id, ok: true, value })
            } catch (error) { write({ type: 'reply', id: frame.id, ok: false, message: messageOf(error) }) }
          })()
          return
        }
        if (frame.error !== undefined) { finish(output.finish(logs, undefined, frame.error)); return }
        if (!Object.hasOwn(frame, 'value')) { finish(output.finish(logs)); return }
        const checked = checkDoneValue(frame.value, this.config.maxValueBytes)
        finish(checked.ok
          ? output.finish(logs, frame.value as CodeJsonValue)
          : output.finish(logs, undefined, { kind: checked.reason === 'non-lossless' ? 'invalid-output' : 'output-limit', message: checked.reason === 'non-lossless' ? 'program completion must be lossless JSON' : `completion exceeded ${this.config.maxValueBytes} bytes` }))
      }
      const read = (chunk: Buffer): void => {
        inputBuffer += chunk.toString('utf8')
        if (Buffer.byteLength(inputBuffer, 'utf8') > this.config.maxFrameBytes) { fail({ kind: 'output-limit', message: `python protocol frame exceeded ${this.config.maxFrameBytes} bytes` }); return }
        let newline = inputBuffer.indexOf('\n')
        while (newline >= 0 && !settled) {
          const line = inputBuffer.slice(0, newline)
          inputBuffer = inputBuffer.slice(newline + 1)
          newline = inputBuffer.indexOf('\n')
          try { onFrame(JSON.parse(line) as unknown) } catch { /* validator drops malformed peer frames */ }
        }
      }
      const capture = (chunk: Buffer): void => { if (!settled && !output.admit(chunk.toString('utf8'), logs)) fail({ kind: 'output-limit', message: `outer output exceeded ${this.config.maxOutputBytes} bytes` }) }
      onAbort = (): void => { fail({ kind: 'abort', message: String(request.signal?.reason) }) }
      channel.on('data', read)
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      child.once('error', (error) => { fail({ kind: 'worker-exit', message: `python process error: ${error.message}` }) })
      child.once('close', () => { childClosed = true; resolveFinished() })
      child.once('exit', (code) => { if (!settled) fail({ kind: 'worker-exit', message: `python exited with code ${String(code)} before completing` }) })
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const wallTimer = setTimeout(
        () => { fail({ kind: 'timeout', message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)` }) },
        this.config.maxWallMs,
      )
      this.live.add(live)
      write({
        type: 'boot', cpuSeconds: this.config.cpuSeconds, addressSpaceBytes: this.config.addressSpaceBytes,
        maxLogBytes: this.config.maxLogBytes, maxValueBytes: this.config.maxValueBytes,
        namespaces: [...bindings].map(([global, namespace]) => ({
          global,
          names: Object.keys(namespace.functions),
          ...namespace.errorClass === undefined ? {} : { errorClass: namespace.errorClass },
        })),
      })
    })
  }
}

export default PythonCodeRuntime
