/** Local process adapters for the PHOENIX voice capability.
 *
 * The package does not download model weights. PHOENIX Natural may keep one
 * configured neural engine resident and warm; Kokoro, STT, and the platform
 * speech engine remain progressively lighter fallbacks.
 * @module @phoenix-ai/dsh-voice-local
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { createNaturalTextToSpeechProvider } from './natural.ts'
import type {
  VoiceSpeechToTextProvider,
  VoiceSynthesisRequest,
  VoiceTextToSpeechProvider,
  VoiceTranscriptionRequest,
  VoiceTranscript,
} from '@phoenix-ai/dsh-voice'

/** Command process input and output. */
export interface VoiceCommandRequest {
  /** Executable name or absolute path. */
  readonly command: string
  /** Arguments passed without a shell. */
  readonly args: readonly string[]
  /** UTF-8 text or binary audio written to stdin. */
  readonly stdin: string | Uint8Array
  /** Cancels the child process. */
  readonly signal?: AbortSignal
  /** Optional wall-clock limit. */
  readonly timeoutMs?: number
}

/** Result from one local command. */
export interface VoiceCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Injectable process boundary used by providers and their tests. */
export type VoiceCommandRunner = (request: VoiceCommandRequest) => Promise<VoiceCommandResult>

/** Options for an optional Kokoro local TTS command. */
export interface KokoroProviderOptions {
  /** Command that owns the locally installed Kokoro pipeline. */
  readonly command?: string
  /** Arguments passed to the command. */
  readonly args?: readonly string[]
  /** Injectable process runner. */
  readonly run?: VoiceCommandRunner
}

/** Options for the platform's installed speech synthesizer. */
export interface SystemTtsProviderOptions {
  /** Override platform selection in tests or a host wrapper. */
  readonly platform?: NodeJS.Platform
  /** Override the platform command. */
  readonly command?: string
  /** Override command arguments. */
  readonly args?: readonly string[]
  /** Injectable process runner. */
  readonly run?: VoiceCommandRunner
}

/** Options for a configured local STT command such as whisper.cpp. */
export interface LocalSttProviderOptions {
  /** Executable that accepts audio on stdin and prints a transcript. */
  readonly command?: string
  /** Arguments passed to the STT executable. */
  readonly args?: readonly string[]
  /** Injectable process runner. */
  readonly run?: VoiceCommandRunner
}

/** Create a provider backed by a locally configured Kokoro command.
 * @param options - command, arguments, and injectable runner.
 * @returns a provider that speaks through Kokoro when configured.
 */
export function createKokoroTextToSpeechProvider(options: KokoroProviderOptions): VoiceTextToSpeechProvider {
  const command = options.command?.trim() ?? ''
  const run = options.run ?? runVoiceCommand
  return {
    id: 'kokoro',
    priority: 100,
    available: () => command !== '',
    async speak(request: VoiceSynthesisRequest): Promise<void> {
      assertSuccessful(await run({
        command,
        args: options.args ?? [],
        stdin: request.text,
        ...request.signal === undefined ? {} : { signal: request.signal },
      }))
    },
  }
}

/** Create a provider using only a local platform speech command.
 * @param options - platform command and injectable runner overrides.
 * @returns a provider that uses the installed platform speech command.
 */
export function createSystemTextToSpeechProvider(options: SystemTtsProviderOptions = {}): VoiceTextToSpeechProvider {
  const platform = options.platform ?? process.platform
  const command = options.command ?? defaultSystemCommand(platform)
  const args = options.args ?? defaultSystemArgs(platform)
  const run = options.run ?? runVoiceCommand
  return {
    id: 'system',
    priority: 10,
    available: () => command !== '',
    async speak(request: VoiceSynthesisRequest): Promise<void> {
      assertSuccessful(await run({
        command,
        args,
        // Windows System.Speech must select an installed voice matching the
        // requested language instead of silently using the English default.
        stdin: platform === 'win32' && options.args === undefined
          ? JSON.stringify({ text: request.text, language: request.language, gender: request.gender })
          : request.text,
        ...request.signal === undefined ? {} : { signal: request.signal },
      }))
    },
  }
}

/** Create a provider backed by a configured local STT executable.
 * @param options - executable, arguments, and injectable runner.
 * @returns a provider that transcribes audio through the local executable.
 */
export function createLocalSpeechToTextProvider(options: LocalSttProviderOptions): VoiceSpeechToTextProvider {
  const command = options.command?.trim() ?? ''
  const run = options.run ?? runVoiceCommand
  return {
    id: 'local-stt',
    priority: 100,
    available: () => command !== '',
    async transcribe(request: VoiceTranscriptionRequest): Promise<VoiceTranscript> {
      const result = assertSuccessful(await run({
        command,
        args: options.args ?? [],
        stdin: request.audio,
        ...request.signal === undefined ? {} : { signal: request.signal },
      }))
      const text = result.stdout.trim()
      if (text === '') throw new Error('voice-local: speech-to-text provider returned an empty transcript')
      return { text, ...request.language === undefined ? {} : { language: request.language } }
    },
  }
}

/** Local voice plugin configuration. */
export interface Config {
  /** Use the packaged CosyVoice daemon with the platform Python executable. */
  readonly naturalBundledCosyVoice?: boolean
  /** Persistent neural speech daemon; absence leaves PHOENIX Natural unavailable. */
  readonly naturalCommand?: string
  /** Arguments for the persistent neural daemon. */
  readonly naturalArgs?: string[]
  /** Warm the configured neural engine asynchronously during host startup. */
  readonly naturalPrewarm?: boolean
  /** Maximum resident-engine startup time. */
  readonly naturalStartupTimeoutMs?: number
  /** Maximum time for one natural speech request. */
  readonly naturalRequestTimeoutMs?: number
  /** Maximum characters per semantic neural synthesis chunk. */
  readonly naturalMaxChunkChars?: number
  /** Warm Kokoro in the background when an installed local model is detected. */
  readonly kokoroPrewarm?: boolean
  /** Optional local Kokoro command; absence auto-detects a completed PHOENIX install. */
  readonly kokoroCommand?: string
  /** Arguments for the Kokoro command. */
  readonly kokoroArgs?: string[]
  /** Optional local STT command; absence leaves host STT unavailable. */
  readonly sttCommand?: string
  /** Arguments for the STT command. */
  readonly sttArgs?: string[]
  /** Whether to register the platform fallback after neural TTS and Kokoro. */
  readonly systemTts?: boolean
}

/** Schemastery schema for the local voice provider plugin. */
export const Config: z<Config> = z.object({
  naturalBundledCosyVoice: z.boolean().default(false),
  naturalCommand: z.string(),
  naturalArgs: z.array(z.string()).default([]),
  naturalPrewarm: z.boolean().default(true),
  naturalStartupTimeoutMs: z.number().default(45_000),
  naturalRequestTimeoutMs: z.number().default(120_000),
  naturalMaxChunkChars: z.number().default(180),
  kokoroPrewarm: z.boolean().default(false),
  kokoroCommand: z.string(),
  kokoroArgs: z.array(z.string()).default([]),
  sttCommand: z.string(),
  sttArgs: z.array(z.string()).default([]),
  systemTts: z.boolean().default(true),
})

/** Resolve the completed per-user Windows Kokoro installation.
 * @param localAppData - Windows per-user application data directory.
 * @param platform - Platform used to select the executable layout.
 * @returns Persistent daemon process, or undefined until installation is complete.
 */
export function detectInstalledKokoro(
  localAppData: string | undefined = process.env.LOCALAPPDATA,
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: readonly string[] } | undefined {
  if (platform !== 'win32' || !localAppData?.trim()) return undefined
  const home = join(localAppData, 'Phoenix', 'voice', 'kokoro')
  const command = join(home, '.venv', 'Scripts', 'python.exe')
  const daemon = join(home, 'kokoro-daemon.py')
  const required = [
    join(home, '.ready'), command, daemon,
    join(home, 'kokoro-v1.0.onnx'), join(home, 'voices-v1.0.bin'),
  ]
  if (!required.every(file => existsSync(file))) return undefined
  return { command, args: [daemon] }
}

/** Register configured local TTS and STT adapters into `ctx.voice`. */
export function apply(ctx: Context, config: Config): void {
  const voice = ctx.voice
  const explicitNaturalCommand = config.naturalCommand?.trim()
  const bundledNatural = config.naturalBundledCosyVoice === true
  const naturalCommand = explicitNaturalCommand !== undefined && explicitNaturalCommand !== ''
    ? explicitNaturalCommand
    : bundledNatural
      ? process.platform === 'win32' ? 'python.exe' : 'python3'
      : undefined
  const naturalArgs = explicitNaturalCommand !== undefined && explicitNaturalCommand !== ''
    ? config.naturalArgs ?? []
    : bundledNatural
      ? [fileURLToPath(new URL('../runtime/cosyvoice3-daemon.py', import.meta.url))]
      : []
  if (naturalCommand !== undefined && naturalCommand !== '') {
    const natural = createNaturalTextToSpeechProvider({
      command: naturalCommand,
      args: naturalArgs,
      startupTimeoutMs: config.naturalStartupTimeoutMs ?? 45_000,
      requestTimeoutMs: config.naturalRequestTimeoutMs ?? 120_000,
      maxChunkChars: config.naturalMaxChunkChars ?? 180,
    })
    voice.registerTextToSpeechProvider(natural)
    ctx.effect(() => () => { natural.close() }, 'natural voice daemon teardown')
    if (config.naturalPrewarm !== false) {
      void natural.warmup().catch((error: unknown) => {
        ctx.logger('voice-local').warn(`natural voice prewarm failed; fallbacks remain available: ${String(error)}`)
      })
    }
  }
  const kokoroCommand = config.kokoroCommand?.trim()
  if (kokoroCommand !== undefined && kokoroCommand !== '') {
    voice.registerTextToSpeechProvider(createKokoroTextToSpeechProvider({ command: kokoroCommand, args: config.kokoroArgs ?? [] }))
  } else {
    let kokoro: ReturnType<typeof createNaturalTextToSpeechProvider> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    const attach = (): void => {
      if (kokoro !== undefined) return
      const installed = detectInstalledKokoro()
      if (installed === undefined) return
      kokoro = createNaturalTextToSpeechProvider({
        id: 'kokoro',
        priority: 100,
        command: installed.command,
        args: installed.args,
      })
      voice.registerTextToSpeechProvider(kokoro)
      if (poll !== undefined) clearInterval(poll)
      poll = undefined
      if (config.kokoroPrewarm === true) {
        void kokoro.warmup().catch((error: unknown) => {
          ctx.logger('voice-local').warn(`Kokoro warmup failed; system voice remains available: ${String(error)}`)
        })
      }
    }
    attach()
    if (process.platform === 'win32' && kokoro === undefined) {
      poll = setInterval(attach, 15_000)
      poll.unref()
    }
    ctx.effect(() => () => {
      if (poll !== undefined) clearInterval(poll)
      kokoro?.close()
    }, 'kokoro voice installation and daemon teardown')
  }
  if (config.systemTts !== false) voice.registerTextToSpeechProvider(createSystemTextToSpeechProvider())
  const sttCommand = config.sttCommand?.trim()
  if (sttCommand !== undefined && sttCommand !== '') {
    voice.registerSpeechToTextProvider(createLocalSpeechToTextProvider({ command: sttCommand, args: config.sttArgs ?? [] }))
  }
}

export {
  createNaturalTextToSpeechProvider,
  naturalVoiceStyle,
  semanticSpeechChunks,
} from './natural.ts'
export type {
  NaturalTextToSpeechProvider,
  NaturalVoiceProviderOptions,
  NaturalVoiceStyle,
} from './natural.ts'

/** Package name used by the Cordis loader. */
export const name = 'voice-local'
/** This provider needs the provider-neutral voice service. */
export const inject = ['voice']

/** Run one command with pipes, no shell interpolation, and abort support.
 * @param request - executable, arguments, input, and lifecycle controls.
 * @returns the captured process output and exit code.
 */
export function runVoiceCommand(request: VoiceCommandRequest): Promise<VoiceCommandResult> {
  if (request.command.trim() === '') return Promise.reject(new Error('voice-local: command must not be empty'))
  return new Promise<VoiceCommandResult>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(request.command, [...request.args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: child.exitCode ?? 1 })
    }
    const abort = (): void => {
      child.kill()
      finish(new Error('voice-local: command aborted'))
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.once('error', (error) => { finish(error) })
    child.once('close', () => { finish() })
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted === true) {
      abort()
      return
    }
    if (request.timeoutMs !== undefined) {
      if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
        finish(new Error('voice-local: timeoutMs must be a positive integer'))
        return
      }
      timer = setTimeout(() => {
        child.kill()
        finish(new Error(`voice-local: command exceeded ${request.timeoutMs}ms`))
      }, request.timeoutMs)
    }
    child.stdin.on('error', (error) => { finish(error) })
    child.stdin.end(typeof request.stdin === 'string' ? request.stdin : Buffer.from(request.stdin))
  })
}

function defaultSystemCommand(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'powershell.exe'
  if (platform === 'darwin') return 'say'
  return 'espeak-ng'
}

function defaultSystemArgs(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') {
    return [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json; Add-Type -AssemblyName System.Speech; ' +
      '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
      '$culture = [string]$request.language; $language = $culture.Split("-")[0].ToLowerInvariant(); ' +
      '$voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $language }); ' +
      'if ($voices.Count -eq 0) { [Console]::Error.WriteLine("No native voice for " + $culture); exit 3 }; ' +
      '$requestedGender = if ($request.gender -eq "masculine") { "Male" } else { "Female" }; ' +
      '$gendered = @($voices | Where-Object { $_.VoiceInfo.Gender.ToString() -eq $requestedGender }); ' +
      '$eligible = if ($gendered.Count -gt 0) { $gendered } else { $voices }; ' +
      '$sameCulture = @($eligible | Where-Object { $_.VoiceInfo.Culture.Name -eq $culture }); ' +
      '$choice = if ($sameCulture.Count -gt 0) { $sameCulture[0] } else { $eligible[0] }; ' +
      '$speaker.SelectVoice($choice.VoiceInfo.Name); $speaker.Speak([string]$request.text)',
    ]
  }
  if (platform === 'darwin') return ['-f', '-']
  return ['--stdin']
}

function assertSuccessful(result: VoiceCommandResult): VoiceCommandResult {
  if (result.exitCode !== 0) throw new Error(`voice-local: command exited with ${result.exitCode}: ${result.stderr.trim()}`)
  return result
}
