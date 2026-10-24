/** Bounded Chrome video audio capture and local Whisper transcription. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Bounded WebM sample captured by the Chromium playback surface. */
export interface CapturedVideoAudio {
  ok: boolean
  reason?: string
  base64?: string
  startSeconds?: number
  durationSeconds?: number
}
/** Timecoded transcript recognized locally; never an inferred YouTube caption. */
export interface AudioTranscript {
  language?: string
  cues: Array<{ start: number; end: number; text: string }>
}
const MAX_AUDIO_BYTES = 1_500_000
const TRANSCRIBE_SCRIPT = [
  'import json, sys',
  'from faster_whisper import WhisperModel',
  'model = WhisperModel(sys.argv[2], device="cpu", compute_type="int8")',
  'segments, info = model.transcribe(sys.argv[1], beam_size=1, vad_filter=True, condition_on_previous_text=False)',
  'cues = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()]',
  'print(json.dumps({"language": info.language, "cues": cues}, ensure_ascii=False))',
].join('\n')

/**
 * Generate a fixed, narrow Chrome MediaRecorder program; no model JS or
 * arbitrary network requests enter the page. Browser itself stays muted.
 * @param startSeconds - Video playback position to sample.
 * @param durationSeconds - Playback duration in seconds (3-9).
 * @returns Bounded CDP Runtime.evaluate expression.
 */
export function videoAudioCaptureExpression(startSeconds: number, durationSeconds: number): string {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86400
    || !Number.isInteger(durationSeconds) || durationSeconds < 3 || durationSeconds > 9) {
    throw new Error('VIDEO_AUDIO_RANGE_INVALID')
  }
  const script = [
    '(async () => {',
    'const video=document.querySelector("video");',
    'if(!video)return JSON.stringify({ok:false,reason:"VIDEO_ELEMENT_UNAVAILABLE"});',
    'if(typeof video.captureStream!=="function"||typeof MediaRecorder==="undefined")return JSON.stringify({ok:false,reason:"BROWSER_AUDIO_CAPTURE_UNSUPPORTED"});',
    'if(!Number.isFinite(video.duration)||video.duration<=0)return JSON.stringify({ok:false,reason:"VIDEO_DURATION_UNAVAILABLE"});',
    'let stream;const originalMuted=video.muted;',
    'try {',
    'video.pause();',
    'const at=Math.min('+String(startSeconds)+',Math.max(0,video.duration-'+String(durationSeconds)+'-0.25));',
    'await Promise.race([new Promise(resolve=>{video.addEventListener("seeked",resolve,{once:true});video.currentTime=at;}),new Promise(resolve=>setTimeout(resolve,1500))]);',
    'video.muted=true;',
    'try{await video.play();}catch{return JSON.stringify({ok:false,reason:"BROWSER_PLAYBACK_REQUIRES_GESTURE"});}',
    'stream=video.captureStream();const tracks=stream.getAudioTracks();',
    'if(tracks.length===0)return JSON.stringify({ok:false,reason:"NO_ACCESSIBLE_AUDIO_TRACK"});',
    'const mimeType=["audio/webm;codecs=opus","audio/webm","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));',
    'if(!mimeType)return JSON.stringify({ok:false,reason:"WEBM_RECORDER_UNAVAILABLE"});',
    'const chunks=[];const recorder=new MediaRecorder(new MediaStream(tracks),{mimeType});',
    'recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};',
    'const done=new Promise((resolve,reject)=>{recorder.onerror=()=>reject(Error("RECORDER_ERROR"));recorder.onstop=resolve;});',
    'recorder.start(500);video.muted=false;',
    'await new Promise(resolve=>setTimeout(resolve,'+String(durationSeconds*1000)+'));',
    'recorder.stop();await done;',
    'const blob=new Blob(chunks,{type:mimeType});',
    'if(blob.size<128)return JSON.stringify({ok:false,reason:"AUDIO_BYTES_EMPTY"});',
    'if(blob.size>'+String(MAX_AUDIO_BYTES)+')return JSON.stringify({ok:false,reason:"AUDIO_CAPTURE_TOO_LARGE"});',
    'const bytes=new Uint8Array(await blob.arrayBuffer());let data="";',
    'for(let i=0;i<bytes.length;i+=32768)data+=String.fromCharCode(...bytes.subarray(i,i+32768));',
    'return JSON.stringify({ok:true,base64:btoa(data),startSeconds:at,durationSeconds:'+String(durationSeconds)+'});',
    '}catch(e){return JSON.stringify({ok:false,reason:String(e&&e.name||"AUDIO_CAPTURE_FAILED").slice(0,80)});}',
    'finally{if(stream)stream.getTracks().forEach(track=>track.stop());video.pause();video.muted=originalMuted;}',
    '})()',
  ]
  return script.join('\n')
}

/**
 * Validate actual captured WebM and bound memory usage, rejecting fake results.
 * @param value - Chrome CDP evaluate return value.
 * @returns Decoded metadata and private WebM buffer in base64 or failure reason.
 */
export function parseCapturedVideoAudio(value: unknown): CapturedVideoAudio {
  let parsed: unknown
  try { parsed = JSON.parse(String(value)) } catch { return {ok:false,reason:'AUDIO_CAPTURE_RESPONSE_INVALID'} }
  if (!parsed || typeof parsed !== 'object') return {ok:false,reason:'AUDIO_CAPTURE_RESPONSE_INVALID'}
  const item = parsed as Record<string, unknown>
  if (item.ok !== true) return {ok:false,reason:typeof item.reason === 'string' ? item.reason.slice(0,96) : 'AUDIO_CAPTURE_FAILED'}
  if (typeof item.base64 !== 'string' || item.base64.length > 2_100_000
    || item.base64.length < 172 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.base64)
    || typeof item.startSeconds !== 'number' || !Number.isFinite(item.startSeconds)
    || typeof item.durationSeconds !== 'number' || item.durationSeconds < 3 || item.durationSeconds > 9) {
    return {ok:false,reason:'AUDIO_CAPTURE_RESPONSE_INVALID'}
  }
  const bytes = Buffer.from(item.base64,'base64')
  if (bytes.length < 128 || bytes.length > MAX_AUDIO_BYTES
    || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
    return {ok:false,reason:'AUDIO_WEBM_INVALID'}
  }
  return {ok:true,base64:item.base64,startSeconds:item.startSeconds,durationSeconds:item.durationSeconds}
}

/**
 * Install/reuse the cached faster-whisper Python package through uv, transcribe
 * locally and delete the original audio immediately, even on process failure.
 * @param capture - Validated audio WebM from Chrome, not exposed to the LLM.
 * @returns Timecoded transcript segments based on decoded speech.
 */
/** Shared file-based local Whisper transcription; the caller owns the file.
 * @param path - Caller-owned local WebM/WAV/media file to transcribe.
 * @returns Recognized timecoded speech segments and detected language.
 */
export async function transcribeLocalMediaFile(path: string): Promise<AudioTranscript> {
    const configuredModel=process.env.PHOENIX_VIDEO_WHISPER_MODEL
    const model=configuredModel !== undefined && ['tiny','base','small'].includes(configuredModel) ? configuredModel : 'base'
    const configuredPython=process.env.PHOENIX_VIDEO_PYTHON?.trim()
    const program=configuredPython || 'uv'
    const args=configuredPython
      ? ['-c',TRANSCRIBE_SCRIPT,path,model]
      : ['run','--no-project','--with','faster-whisper','python','-c',TRANSCRIBE_SCRIPT,path,model]
    const output=await new Promise<string>((resolve,reject)=>{
      let stdout='',settled=false
      const child=spawn(program,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,
        env:{...process.env,PYTHONIOENCODING:'utf-8'}})
      const finish=(error?:Error)=>{
        if(settled)return
        settled=true;clearTimeout(timer)
        if(error)reject(error);else resolve(stdout)
      }
      const timer=setTimeout(()=>{child.kill();finish(new Error('LOCAL_TRANSCRIPTION_TIMEOUT'))},180_000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data',(chunk:string)=>{
        stdout+=chunk
        if(stdout.length>60_000){child.kill();finish(new Error('LOCAL_TRANSCRIPT_TOO_LONG'))}
      })
      child.once('error',()=>finish(new Error('LOCAL_TRANSCRIBER_UNAVAILABLE: install uv')))
      child.once('close',code=>finish(code===0?undefined:new Error('LOCAL_TRANSCRIPTION_FAILED: check uv and model download')))
    })
    const parsed:unknown=JSON.parse(output)
    if(!parsed||typeof parsed!=='object')throw new Error('LOCAL_TRANSCRIPT_INVALID')
    const result=parsed as Record<string,unknown>
    if(!Array.isArray(result.cues))throw new Error('LOCAL_TRANSCRIPT_INVALID')
    const cues=result.cues.slice(0,150).filter((cue):cue is {start:number;end:number;text:string}=>{
      if(!cue||typeof cue!=='object')return false
      const item=cue as Record<string,unknown>
      return typeof item.start==='number'&&Number.isFinite(item.start)
        &&typeof item.end==='number'&&Number.isFinite(item.end)
        &&typeof item.text==='string'&&item.text.length<=2000
    })
    return {...(typeof result.language==='string' ? {language:result.language.slice(0,12)} : {}),cues}
}

/** Delete the private audio sample after transcribing it locally.
 * @param capture - Verified browser audio sample.
 * @returns Recognized timecoded speech segments.
 */
export async function transcribeCapturedVideoAudio(capture: CapturedVideoAudio): Promise<AudioTranscript> {
  if (!capture.ok || !capture.base64) throw new Error('AUDIO_CAPTURE_NOT_AVAILABLE')
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-video-audio-'))
  const path = join(directory,'clip.webm')
  try {
    await writeFile(path,Buffer.from(capture.base64,'base64'),{mode:0o600})
    return await transcribeLocalMediaFile(path)
  } finally {
    await rm(directory,{recursive:true,force:true})
  }
}
