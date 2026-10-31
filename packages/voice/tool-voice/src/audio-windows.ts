/** Windows audio source: authenticated desktop named pipe -> transient WAV -> local Whisper.
 * No ambient audio is collected without the foreground Windows Yes/No consent.
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

interface NativeAudioSample {
  status: 'captured'
  source: 'windows-output-loopback'
  file: string
  bytes: number
  seconds: number
  sessionId: string
  device: string
}

export function parseAudioDescriptor(raw: string): string {
  const object: unknown = JSON.parse(raw)
  if (object === null || typeof object !== 'object' || Array.isArray(object)) {
    throw new Error('AUDIO_PIPE_DESCRIPTOR_INVALID')
  }
  const value = object as { schema?: unknown; pipeName?: unknown }
  if (value.schema !== 1 || typeof value.pipeName !== 'string'
    || !/^PhoenixDesktop\.Browser\.[A-Za-z0-9._-]{1,96}$/u.test(value.pipeName)) {
    throw new Error('AUDIO_PIPE_DESCRIPTOR_INVALID')
  }
  return value.pipeName
}

function pipeQuery(pipeName: string, command: unknown): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const socket = createConnection('\\\\.\\pipe\\' + pipeName)
    let received = '', done = false
    socket.setEncoding('utf8')
    const finish = (error?: Error, result?: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolveResult(result ?? '')
    }
    // Includes time for the foreground consent dialog. It is not a silent retry.
    const timer = setTimeout(() => finish(new Error('AUDIO_CONSENT_OR_CAPTURE_TIMEOUT')), 120_000)
    socket.once('connect', () => socket.write(JSON.stringify(command) + '\n'))
    socket.on('data', (chunk: string) => {
      received += chunk
      if (received.length > 32_768) {
        finish(new Error('AUDIO_PIPE_RESPONSE_TOO_LARGE'))
        return
      }
      const end = received.indexOf('\n')
      if (end >= 0) finish(undefined, received.slice(0, end).trim())
    })
    socket.once('error', (error: Error) => finish(error))
    socket.once('close', () => {
      if (!done) finish(new Error('AUDIO_PIPE_CLOSED'))
    })
  })
}

async function callNative(type: 'phoenix.audio.status' | 'phoenix.audio.capture', sessionId: string, seconds = 8): Promise<string> {
  if (process.platform !== 'win32') throw new Error('AUDIO_WINDOWS_DESKTOP_REQUIRED')
  const appData = process.env.LOCALAPPDATA?.trim()
  const descriptor = process.env.PHOENIX_DESKTOP_CONTROL_DESCRIPTOR?.trim()
    || (appData ? join(appData, 'Phoenix', 'desktop-control.json') : '')
  if (!descriptor) throw new Error('AUDIO_WINDOWS_DESKTOP_REQUIRED')
  const pipe = parseAudioDescriptor(await readFile(descriptor, 'utf8'))
  const raw = await pipeQuery(pipe, { type, sessionId, seconds })
  const response: unknown = JSON.parse(raw)
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('AUDIO_PIPE_RESPONSE_INVALID')
  }
  const data = response as { ok?: unknown; details?: unknown; error?: unknown }
  if (data.ok !== true) {
    throw new Error(typeof data.error === 'string' ? data.error.slice(0, 220) : 'AUDIO_NATIVE_REJECTED')
  }
  if (typeof data.details !== 'string') throw new Error('AUDIO_NATIVE_DETAILS_MISSING')
  return data.details
}

export function parseAudioCapture(raw: string, sessionId: string, seconds: number): NativeAudioSample {
  const data: unknown = JSON.parse(raw)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('AUDIO_CAPTURE_RECEIPT_INVALID')
  }
  const item = data as Partial<NativeAudioSample>
  if (item.status !== 'captured' || item.source !== 'windows-output-loopback'
    || typeof item.file !== 'string' || !isAbsolute(item.file)
    || !/^audio-[a-f0-9]{32}\.wav$/iu.test(basename(item.file))
    || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes)
    || item.bytes < 512 || item.bytes > 24_000_000
    || item.seconds !== seconds || item.sessionId !== sessionId
    || typeof item.device !== 'string' || item.device.length > 256) {
    throw new Error('AUDIO_CAPTURE_RECEIPT_INVALID')
  }
  return item as NativeAudioSample
}

async function verifiedWav(file: string): Promise<void> {
  const root = await realpath(join(tmpdir(), 'phoenix-audio-captures'))
  const actual = await realpath(file)
  if (dirname(actual).toLowerCase() !== root.toLowerCase()) {
    throw new Error('AUDIO_CAPTURE_PATH_UNTRUSTED')
  }
  const details = await stat(actual)
  if (!details.isFile() || details.size < 556 || details.size > 24_000_000) {
    throw new Error('AUDIO_CAPTURE_SIZE_INVALID')
  }
  const wav = await readFile(actual)
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('AUDIO_CAPTURE_WAV_INVALID')
  }
}

/** Run the same local faster-whisper runtime already used in Chrome video inspection. */
async function transcribeLocal(file: string): Promise<{ language?: string; cues: { start: number; end: number; text: string }[] }> {
  const script = [
    'import json, sys',
    'from faster_whisper import WhisperModel',
    'model=WhisperModel(sys.argv[2], device="cpu", compute_type="int8")',
    'segments,info=model.transcribe(sys.argv[1],beam_size=1,vad_filter=True,condition_on_previous_text=False)',
    'cues=[{"start":round(s.start,2),"end":round(s.end,2),"text":s.text.strip()} for s in segments if s.text.strip()]',
    'print(json.dumps({"language":info.language,"cues":cues},ensure_ascii=False))',
  ].join('\n')
  const configuredModel = process.env.PHOENIX_VIDEO_WHISPER_MODEL
  const model = ['tiny','base','small'].includes(configuredModel ?? '') ? configuredModel! : 'base'
  const python = process.env.PHOENIX_VIDEO_PYTHON?.trim()
  const command = python || 'uv'
  const args = python ? ['-c',script,file,model]
    : ['run','--no-project','--with','faster-whisper','python','-c',script,file,model]
  const output = await new Promise<string>((ok, fail) => {
    let stdout = '', settled = false
    const child = spawn(command,args,{
      windowsHide: true, shell: false, stdio:['ignore','pipe','pipe'],
      env: { ...process.env, PYTHONIOENCODING:'utf-8' },
    })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) fail(error)
      else ok(stdout)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('AUDIO_LOCAL_TRANSCRIPTION_TIMEOUT'))
    }, 180_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data',(chunk:string)=>{
      stdout += chunk
      if (stdout.length > 60_000) {
        child.kill()
        finish(new Error('AUDIO_TRANSCRIPT_TOO_LARGE'))
      }
    })
    child.once('error', () => finish(new Error('AUDIO_LOCAL_TRANSCRIBER_UNAVAILABLE: install uv')))
    child.once('close', (code) => finish(code === 0 ? undefined
      : new Error('AUDIO_LOCAL_TRANSCRIPTION_FAILED: check uv and Whisper model')))
  })
  const data: unknown = JSON.parse(output)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('AUDIO_TRANSCRIPT_INVALID')
  const parsed = data as Record<string,unknown>
  if (!Array.isArray(parsed.cues)) throw new Error('AUDIO_TRANSCRIPT_INVALID')
  const cues = parsed.cues.slice(0,100).filter((cue):cue is {start:number;end:number;text:string} => {
    if (cue === null || typeof cue !== 'object') return false
    const v = cue as Record<string,unknown>
    return typeof v.start === 'number' && Number.isFinite(v.start)
      && typeof v.end === 'number' && Number.isFinite(v.end)
      && typeof v.text === 'string' && v.text.length <= 2000
  })
  return { ...typeof parsed.language === 'string'
    ? { language: parsed.language.slice(0,12) } : {}, cues }
}

/** No raw audio enters the model's context or is stored in conversation history. */
export async function windowsAudioStatus(sessionId: string): Promise<unknown> {
  return JSON.parse(await callNative('phoenix.audio.status', sessionId))
}

export async function listenWindowsAudio(sessionId: string, seconds: number): Promise<unknown> {
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 12) {
    throw new Error('AUDIO_CAPTURE_SECONDS_OUT_OF_RANGE')
  }
  const receipt = parseAudioCapture(
    await callNative('phoenix.audio.capture', sessionId, seconds),sessionId,seconds)
  // Cleanup even when media is corrupt, the model is unavailable, or transcription fails.
  try {
    await verifiedWav(receipt.file)
    const transcript = await transcribeLocal(receipt.file)
    return {
      source: receipt.source, device: receipt.device, seconds: receipt.seconds,
      captureVerified: true, speechRecognized: transcript.cues.length > 0,
      ...transcript,
      note: transcript.cues.length
        ? 'Solo este tramo de audio fue escuchado. El audio fue eliminado despues de transcribir.'
        : 'Audio capturado, pero no se reconocio voz. No inferir musica, sonidos ni frases no reconocidas.',
    }
  }
  finally {
    await rm(receipt.file,{force:true})
  }
}
