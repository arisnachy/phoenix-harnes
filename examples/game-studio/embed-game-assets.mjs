/**
 * Inline local PNG sprites and WAV/OGG/MP3 audio clips, voices and music in offline game HTML.
 * This is a transport helper. It cannot turn a concept portrait into run frames.
 *
 * node examples/game-studio/embed-game-assets.mjs game.html images.json output.html
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function assertRuntimeAssetBinding(html, id, kind) {
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(match => !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))
    .map(match => match[2] ?? '').join('\n')
  const literal = script.includes('"' + id + '"') || script.includes("'" + id + "'")
  const dynamic = kind === 'image'
    ? /getElementById\s*\(\s*(?:spec|layer|asset)\.imageId\s*\)/u.test(script)
    : /getElementById\s*\(\s*["']phoenix-audio-["']\s*\+/u.test(script)
  const consumer = kind === 'image'
    ? /(?:\.drawImage|\.drawSpriteState|\.drawActorsByDepth)\s*\(/u.test(script)
    : /(?:\.play|playSoundSample|playSound)\s*\(/u.test(script)
  if ((!literal && !dynamic) || !consumer) {
    throw new Error('Unused ' + kind + ' asset "' + id
      + '": bind it to a drawing/playback path before embedding')
  }
}

export async function embedGameAssets(html, manifest, baseDirectory) {
  if (!/<body\b[^>]*>/iu.test(html) || !/<\/body\s*>/iu.test(html)) throw new Error('Game HTML must contain <body> and </body>')
  const images = Array.isArray(manifest.images) ? manifest.images : []
  const audio = Array.isArray(manifest.audio) ? manifest.audio : []
  if (images.length + audio.length === 0) throw new Error('Asset manifest requires nonempty images or audio list')
  let tags = ''
  const seen = new Set()
  for (const image of images) {
    const id = image?.id
    const path = image?.path
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id)
      || typeof path !== 'string' || path.trim() === '') {
      throw new Error('Image entries require safe id and nonempty local file path')
    }
    if (seen.has(id)) throw new Error('Duplicate sprite image id: ' + id)
    seen.add(id)
    if (new RegExp('<img\\b[^>]*\\bid\\s*=\\s*["\\x27]' + id + '["\\x27]', 'iu').test(html)) {
      throw new Error('HTML already declares the image id: ' + id)
    }
    if (/^https?:\/\//iu.test(path) || path.includes('\0')) throw new Error('Only actual local PNG files are allowed')
    assertRuntimeAssetBinding(html, id, 'image')
    const bytes = await readFile(resolve(baseDirectory, path))
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(pngHeader)
      || !bytes.includes(Buffer.from('IDAT')) || !bytes.includes(Buffer.from('IEND'))) {
      throw new Error('Invalid or truncated PNG: ' + path)
    }
    tags += '<img hidden decoding="sync" id="' + id
      + '" src="data:image/png;base64,' + bytes.toString('base64') + '">\n'
  }
  // Audio is embedded as data URIs, never loaded from a CDN. Licensed voice
  // samples and detailed Foley are genuinely imported, not claimed or synthesized.
  for (const clip of audio) {
    const id = clip?.id, path = clip?.path
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id)
      || typeof path !== 'string' || !path.trim() || /^https?:\/\//iu.test(path) || path.includes('\0')) {
      throw new Error('Audio entries require safe id and local WAV/OGG/MP3 path')
    }
    if (seen.has(id) || new RegExp('<audio\\b[^>]*\\bid\\s*=\\s*["\\x27]' + id + '["\\x27]', 'iu').test(html)) {
      throw new Error('Duplicate audio asset id: ' + id)
    }
    seen.add(id)
    assertRuntimeAssetBinding(html, id, 'audio')
    const bytes = await readFile(resolve(baseDirectory, path))
    if (bytes.length < 12 || bytes.length > 12 * 1024 * 1024) throw new Error('Audio size invalid (max 12 MiB): ' + path)
    const wav = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
    const ogg = bytes.toString('ascii', 0, 4) === 'OggS'
    const mp3 = bytes.toString('ascii', 0, 3) === 'ID3'
      || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    const mime = wav ? 'audio/wav' : ogg ? 'audio/ogg' : mp3 ? 'audio/mpeg' : undefined
    if (mime === undefined) throw new Error('Unsupported or invalid WAV/OGG/MP3 data: ' + path)
    tags += '<audio hidden preload="auto" id="' + id
      + '" src="data:' + mime + ';base64,' + bytes.toString('base64') + '"></audio>\n'
  }
  // Put images and audio before executable scripts so document.getElementById can bind them.
  return html.replace(/<body\b[^>]*>/iu, opening => opening + '\n' + tags)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 3) throw new Error('Usage: node examples/game-studio/embed-game-assets.mjs input.html images.json output.html')
  const [input, manifestPath, output] = args
  const [html, raw] = await Promise.all([readFile(input, 'utf8'), readFile(manifestPath, 'utf8')])
  const prepared = await embedGameAssets(html, JSON.parse(raw), dirname(resolve(manifestPath)))
  await writeFile(output, prepared, 'utf8')
  process.stdout.write('Referenced image/audio bytes embedded; validate the art manifest and real gameplay.\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
}
