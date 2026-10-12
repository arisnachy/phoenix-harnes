/** Local, user-authorized video evidence: never fetches or downloads YouTube media. */
import { spawn } from 'node:child_process'
import { readFile, realpath, stat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { transcribeLocalMediaFile } from './video-audio.ts'

const CAPTURE_ROOT = join(tmpdir(), 'phoenix-video-captures')
const MAX_BYTES = 64 * 1024 * 1024
const MAX_AGE_MS = 60 * 60_000
const MEDIA_SUFFIXES = new Set(['.webm', '.mp4', '.mov', '.m4v', '.mkv'])
export type FrameEvidence = { atSeconds: number; jpeg: string }
export type VideoMediaEvidence = {
  source: 'authorized-browser-capture' | 'approved-local-file'
  durationSeconds: number
  frames: FrameEvidence[]
  audio: { status: 'ok' | 'unavailable'; language?: string; transcript?: string; reason?: string; cueCount?: number }
}

/** Even distribution across a decoded clip, including very short recordings. */
export function videoFrameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1 || count > 8) return []
  const length = Math.min(duration, 7200)
  const total = Math.min(count, Math.max(1, Math.floor(length * 2)))
  return Array.from({length: total},
    (_, index) => Number(Math.max(0, (index + 0.5) * length / total).toFixed(2)))
}

/** Reject unapproved local paths and expired or forged capture descriptors. */
export async function videoMediaInput(path?: string): Promise<{ path: string; source: VideoMediaEvidence['source'] }> {
  if (path !== undefined) {
    if (!isAbsolute(path) || !MEDIA_SUFFIXES.has(extname(path).toLowerCase())) throw new Error('VIDEO_FILE_NOT_APPROVED')
    const roots = (process.env.PHOENIX_VIDEO_ALLOWED_DIRS ?? '').split(process.platform === 'win32' ? ';' : ':')
      .map(value => value.trim()).filter(Boolean)
    if (roots.length === 0) throw new Error('VIDEO_ALLOWED_DIRS_NOT_CONFIGURED')
    const actual = await realpath(path)
    let approved = false
    for (const root of roots) {
      try {
        const rootPath = await realpath(root)
        const relation = relative(rootPath, actual)
        if (relation !== '..' && !relation.startsWith('..' + sep) && !isAbsolute(relation) && relation !== '') {
          approved = true
          break
        }
      } catch { /* A missing approved root cannot grant access. */ }
    }
    if (!approved) throw new Error('VIDEO_FILE_NOT_APPROVED')
    const details = await stat(actual)
    if (!details.isFile() || details.size < 128 || details.size > MAX_BYTES) throw new Error('VIDEO_FILE_SIZE_INVALID')
    return {path: actual, source: 'approved-local-file'}
  }
  let marker: unknown
  try { marker = JSON.parse(await readFile(join(CAPTURE_ROOT, 'latest.json'), 'utf8')) } catch {
    throw new Error('VIDEO_CAPTURE_NOT_FOUND: start an authorized tab capture in MiniBrowser')
  }
  if (!marker || typeof marker !== 'object') throw new Error('VIDEO_CAPTURE_INVALID')
  const value = marker as Record<string, unknown>
  if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.id)
    || typeof value.createdAt !== 'number' || Date.now() - value.createdAt > MAX_AGE_MS
    || value.createdAt > Date.now() + 60_000) throw new Error('VIDEO_CAPTURE_EXPIRED_OR_INVALID')
  const expected = resolve(CAPTURE_ROOT, 'capture-' + value.id + '.webm')
  const actual = await realpath(expected)
  if (actual !== expected) throw new Error('VIDEO_CAPTURE_PATH_INVALID')
  const details = await stat(actual)
  if (!details.isFile() || details.size < 128 || details.size > MAX_BYTES) throw new Error('VIDEO_CAPTURE_BYTES_INVALID')
  return {path: actual, source: 'authorized-browser-capture'}
}

type CommandResult = { output: Buffer; stderr: string; code: number }
async function execute(command: string, args: string[], timeout = 30_000, maxOutput = 5_000_000): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    let output: Buffer[] = [], size = 0, stderr = '', finished = false
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false})
    const finish = (error?: Error, code = -1) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise({output: Buffer.concat(output), stderr, code})
    }
    const timer = setTimeout(() => { child.kill(); finish(new Error('VIDEO_DECODER_TIMEOUT')) }, timeout)
    child.stdout.on('data', (bytes: Buffer) => {
      size += bytes.length
      if (size > maxOutput) { child.kill(); finish(new Error('VIDEO_DECODER_OUTPUT_LIMIT')) }
      else output.push(bytes)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    child.once('error', () => finish(new Error('VIDEO_DECODER_UNAVAILABLE')))
    child.once('close', code => finish(undefined, code ?? -1))
  })
}
let cachedDecoder: Promise<string> | undefined
/** Cached, bounded decoder discovery: FFmpeg PATH/config or uv imageio-ffmpeg. */
export async function resolveVideoDecoder(): Promise<string> {
  cachedDecoder ??= (async () => {
    const configured = process.env.PHOENIX_VIDEO_FFMPEG?.trim() || 'ffmpeg'
    try {
      const result = await execute(configured, ['-version'], 7000, 5000)
      if (result.code === 0) return configured
    } catch { /* Try an isolated cached uv FFmpeg binary. */ }
    const provision = await execute('uv', ['run', '--no-project', '--with', 'imageio-ffmpeg', 'python', '-c',
      'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], 120_000, 10000)
    const path = provision.output.toString('utf8').trim()
    if (provision.code !== 0 || !isAbsolute(path)) throw new Error('VIDEO_FFMPEG_UNAVAILABLE: install ffmpeg or uv')
    const verify = await execute(path, ['-version'], 7000, 5000)
    if (verify.code !== 0) throw new Error('VIDEO_FFMPEG_UNAVAILABLE')
    return path
  })().catch(error => { cachedDecoder = undefined; throw error })
  return await cachedDecoder
}

/** Analyze only a verified, explicitly authorized capture or approved local file. */
export async function inspectVideoMedia(input: {path?: string; frames: number; audioSeconds: number}): Promise<VideoMediaEvidence> {
  const selected = await videoMediaInput(input.path)
  const decoder = await resolveVideoDecoder()
  const info = await execute(decoder, ['-hide_banner', '-i', selected.path], 15_000, 50000)
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(info.stderr)
  if (!match) throw new Error('VIDEO_DURATION_UNAVAILABLE: supplied media is not decodable')
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('VIDEO_DURATION_INVALID')
  const frames: FrameEvidence[] = []
  for (const time of videoFrameTimes(duration, input.frames)) {
    try {
      const result = await execute(decoder, ['-hide_banner', '-loglevel', 'error',
        '-ss', String(time), '-i', selected.path, '-frames:v', '1',
        '-vf', 'scale=960:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], 20_000)
      if (result.code === 0 && result.output.length > 128
        && result.output[0] === 0xff && result.output[1] === 0xd8) {
        frames.push({atSeconds: time, jpeg: result.output.toString('base64')})
      }
    } catch { /* Preserve any successfully decoded frames. */ }
  }
  let audio: VideoMediaEvidence['audio'] = {status:'unavailable', reason:'AUDIO_DISABLED'}
  if (input.audioSeconds >= 3) {
    const dir = await mkdtemp(join(tmpdir(), 'phoenix-video-analysis-'))
    const destination = join(dir, 'audio.wav')
    try {
      // Constrain transcription to real audio from the first requested seconds.
      const length = Math.min(90, Math.floor(input.audioSeconds), Math.ceil(duration))
      const wav = await execute(decoder, ['-y', '-hide_banner', '-loglevel', 'error',
        '-i', selected.path, '-vn', '-ac', '1', '-ar', '16000',
        '-t', String(length), destination], 90_000, 10000)
      if (wav.code !== 0) throw new Error('VIDEO_AUDIO_STREAM_UNAVAILABLE')
      const transcript = await transcribeLocalMediaFile(destination)
      const cues = transcript.cues.slice(0, 200)
      const text = cues.map(cue => '[' + cue.start.toFixed(2) + 's] ' + cue.text).join('\n').slice(0, 24000)
      audio = text
        ? {status:'ok', transcript:text, cueCount:cues.length,
          ...(transcript.language ? {language:transcript.language} : {})}
        : {status:'unavailable', reason:'VIDEO_AUDIO_SPEECH_NOT_DETECTED'}
    } catch (error) {
      audio = {status:'unavailable',reason: String(error).slice(0,160)}
    } finally {
      await rm(dir,{recursive:true,force:true})
    }
  }
  return {source:selected.source,durationSeconds:duration,frames,audio}
}
