/** Validated public YouTube video locations and bounded subtitle parsing. */
export interface YoutubeCaptionTrack {
  readonly baseUrl: string
  readonly languageCode: string
  readonly kind?: string
  readonly name?: string
}

/**
 * Normalize a supplied public YouTube video URL without opening arbitrary sites.
 * @param input - Video URL supplied by Kira or the user.
 * @returns Canonical HTTPS YouTube watch URL.
 */
export function youtubeWatchUrl(input: string): string {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Solo se admiten enlaces HTTPS de videos públicos de YouTube.')
  }
  const host = url.hostname.toLowerCase()
  const compact = host === 'youtu.be' || host === 'www.youtu.be'
  const official = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
  if (!compact && !official) throw new Error('El video debe pertenecer a YouTube.')
  const path = url.pathname.split('/').filter(Boolean)
  const candidate = compact ? path[0] : url.pathname === '/watch'
    ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(path[0] ?? '') ? path[1] : undefined
  if (!candidate || !/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
    throw new Error('No se encontró un ID de video de YouTube válido.')
  }
  return 'https://www.youtube.com/watch?v=' + candidate
}

/**
 * Allow captions to be fetched only from YouTube's own timed-text endpoint.
 * @param input - Timed-text URL reported by the public video player.
 * @returns Safe HTTPS timed-text URL.
 */
export function youtubeCaptionUrl(input: string): string {
  const url = new URL(input)
  if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
    || url.pathname !== '/api/timedtext' || url.username || url.password) {
    throw new Error('La pista de subtítulos usa un servidor no permitido.')
  }
  url.hash = ''
  return url.href
}

/**
 * Prefer Spanish transcripts, followed by English and then other languages.
 * @param tracks - Available public caption track metadata.
 * @returns Chosen supported track, if any.
 */
export function chooseYoutubeCaptions(tracks: readonly YoutubeCaptionTrack[]): YoutubeCaptionTrack | undefined {
  const safe = tracks.filter((track) => {
    try { youtubeCaptionUrl(track.baseUrl); return true } catch { return false }
  })
  const priority = (track: YoutubeCaptionTrack): number => {
    const lang = track.languageCode.toLowerCase()
    const language = lang === 'es' || lang.startsWith('es-') ? 0
      : lang === 'en' || lang.startsWith('en-') ? 2 : 4
    return language + (track.kind === 'asr' ? 1 : 0)
  }
  return [...safe].sort((a, b) => priority(a) - priority(b))[0]
}

/** Decode only subtitle entities and strip inline styling, not the page HTML. */
function captionText(value: string): string {
  return value.replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_raw, digits: string) => {
      const code = digits.toLowerCase().startsWith('x') ? Number.parseInt(digits.slice(1), 16) : Number(digits)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_raw, name: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase() as 'amp'] ?? '')
    .replace(/\s+/gu, ' ').trim()
}

function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return (hours > 0 ? String(hours) + ':' + String(minutes).padStart(2, '0') : String(minutes))
    + ':' + String(secs).padStart(2, '0')
}

interface Cue { readonly startSeconds: number; readonly text: string }

/**
 * Parse captions that YouTube supplied in JSON3 or XML without guessing speech.
 * @param source - Actual caption document returned by YouTube.
 * @param maxChars - Upper bound for transcript text returned to the model.
 * @returns Timestamped transcript and evidence of truncation.
 */
export function youtubeTranscript(source: string, maxChars = 60_000): { text: string; cues: number; truncated: boolean } {
  const cues: Cue[] = []
  let json: unknown
  try { json = JSON.parse(source) } catch { json = undefined }
  if (json && typeof json === 'object' && 'events' in json && Array.isArray(json.events)) {
    const events = json.events as Array<{ tStartMs?: unknown; segs?: unknown }>
    for (const event of events) {
      if (typeof event.tStartMs !== 'number' || !Array.isArray(event.segs)) continue
      const segments = event.segs as Array<{ utf8?: unknown }>
      const text = captionText(segments.map(segment => typeof segment.utf8 === 'string' ? segment.utf8 : '').join(''))
      if (text) cues.push({ startSeconds: event.tStartMs / 1000, text })
    }
  } else {
    for (const match of source.matchAll(/<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/giu)) {
      const attributes = match[1] ?? ''
      const start = /\bstart=["']([0-9.]+)["']/iu.exec(attributes)
      const millis = /\bt=["']([0-9]+)["']/iu.exec(attributes)
      const seconds = start ? Number(start[1]) : millis ? Number(millis[1]) / 1000 : NaN
      const text = captionText(match[2] ?? '')
      if (Number.isFinite(seconds) && text) cues.push({ startSeconds: seconds, text })
    }
  }
  const all = cues.map(cue => '[' + timeLabel(cue.startSeconds) + '] ' + cue.text).join('\n')
  const limit = Math.max(1, Math.min(80_000, Math.floor(maxChars)))
  return { text: all.slice(0, limit), cues: cues.length, truncated: all.length > limit }
}
