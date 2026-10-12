import { describe, expect, it } from 'vitest'
import { parseCapturedVideoAudio, videoAudioCaptureExpression } from '../src/video-audio.ts'

const webm = Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]), Buffer.alloc(200)])

describe('Phoenix local video listening: bounded evidence', () => {
  it('constructs a fixed Chromium capture program with strict timestamps', () => {
    const script=videoAudioCaptureExpression(62,8)
    expect(script).toContain('video.captureStream()')
    expect(script).toContain('new MediaRecorder')
    expect(script).toContain('durationSeconds:8')
    expect(script).toContain('video.pause()')
    expect(script).toContain('video.muted=originalMuted')
    expect(() => videoAudioCaptureExpression(-1,8)).toThrow('VIDEO_AUDIO_RANGE_INVALID')
    expect(() => videoAudioCaptureExpression(1,30)).toThrow('VIDEO_AUDIO_RANGE_INVALID')
    expect(() => videoAudioCaptureExpression(Number.POSITIVE_INFINITY,8)).toThrow()
  })

  it('admits only bounded verified WebM clips, no arbitrary or misleading audio results', () => {
    const input=JSON.stringify({ok:true,base64:webm.toString('base64'),startSeconds:62,durationSeconds:8})
    expect(parseCapturedVideoAudio(input)).toMatchObject({
      ok:true,startSeconds:62,durationSeconds:8,
    })
    expect(parseCapturedVideoAudio(input).base64).toBe(webm.toString('base64'))
    expect(parseCapturedVideoAudio(JSON.stringify({ok:true,base64:Buffer.alloc(200).toString('base64'),
      startSeconds:62,durationSeconds:8}))).toEqual({ok:false,reason:'AUDIO_WEBM_INVALID'})
    expect(parseCapturedVideoAudio(JSON.stringify({ok:true,base64:webm.toString('base64'),
      startSeconds:62,durationSeconds:50}))).toEqual({ok:false,reason:'AUDIO_CAPTURE_RESPONSE_INVALID'})
    expect(parseCapturedVideoAudio('{')).toEqual({ok:false,reason:'AUDIO_CAPTURE_RESPONSE_INVALID'})
  })

  it('preserves specific browser limitations rather than inventing speech', () => {
    expect(parseCapturedVideoAudio(JSON.stringify({ok:false,reason:'NO_ACCESSIBLE_AUDIO_TRACK'})))
      .toEqual({ok:false,reason:'NO_ACCESSIBLE_AUDIO_TRACK'})
    expect(parseCapturedVideoAudio(JSON.stringify({ok:false,reason:'BROWSER_PLAYBACK_REQUIRES_GESTURE'})))
      .toEqual({ok:false,reason:'BROWSER_PLAYBACK_REQUIRES_GESTURE'})
  })
})
