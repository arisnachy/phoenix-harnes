import { describe, expect, it } from 'vitest'
import { chooseYoutubeCaptions, youtubeCaptionUrl, youtubeTranscript, youtubeWatchUrl } from '../src/youtube-video.ts'

describe('YouTube video inspection: URL and subtitle safety', () => {
  it('accepts public videos, short links and shorts but never arbitrary media hosts', () => {
    expect(youtubeWatchUrl('https://youtu.be/dQw4w9WgXcQ?t=4'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(youtubeWatchUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(() => youtubeWatchUrl('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toThrow()
    expect(() => youtubeWatchUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toThrow()
    expect(() => youtubeWatchUrl('https://www.youtube.com/results?search_query=godot')).toThrow()
  })

  it('rejects untrusted transcript URLs and prefers available Spanish captions', () => {
    const baseUrl = 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=es'
    expect(youtubeCaptionUrl(baseUrl)).toBe(baseUrl)
    expect(() => youtubeCaptionUrl('https://youtube.com.evil.test/api/timedtext')).toThrow()
    expect(() => youtubeCaptionUrl('https://www.youtube.com/redirect?q=https://evil.test')).toThrow()
    expect(chooseYoutubeCaptions([
      { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' },
      { baseUrl, languageCode: 'es', kind: 'asr' },
      { baseUrl: 'https://bad.test/captions', languageCode: 'es' },
    ])?.languageCode).toBe('es')
  })

  it('returns only timecoded speech present in real JSON3 caption events', () => {
    const data = JSON.stringify({ events: [
      { tStartMs: 1000, segs: [{ utf8: 'Open ' }, { utf8: 'Godot' }] },
      { tStartMs: 60500, segs: [{ utf8: 'Create a scene &amp; node' }] },
      { tStartMs: 70000, segs: [] },
    ] })
    expect(youtubeTranscript(data)).toEqual({
      text: '[0:01] Open Godot\n[1:00] Create a scene & node',
      cues: 2,
      truncated: false,
    })
    expect(youtubeTranscript(data, 20).truncated).toBe(true)
  })

  it('parses XML caption cues with entities without claiming unavailable audio', () => {
    const xml = '<transcript><text start="2.5" dur="1.1">Hola &amp; adiós</text>'
      + '<p t="10000" d="1000"><s>SceneTree</s></p></transcript>'
    expect(youtubeTranscript(xml).text).toBe('[0:02] Hola & adiós\n[0:10] SceneTree')
    expect(youtubeTranscript('').cues).toBe(0)
  })
})
