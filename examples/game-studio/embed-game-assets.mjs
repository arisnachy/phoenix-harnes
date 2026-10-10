/**
 * Inline exact local PNG atlas/background bytes in a sandboxed game HTML.
 * This is a transport helper. It cannot turn a concept portrait into run frames.
 *
 * node examples/game-studio/embed-game-assets.mjs game.html images.json output.html
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function embedGameAssets(html, manifest, baseDirectory) {
  if (!/<\/body\s*>/iu.test(html)) throw new Error('Game HTML must contain </body>')
  if (!Array.isArray(manifest.images) || manifest.images.length === 0) throw new Error('images.json requires nonempty images list')
  let tags = ''
  const seen = new Set()
  for (const image of manifest.images) {
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
    const bytes = await readFile(resolve(baseDirectory, path))
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(pngHeader)
      || !bytes.includes(Buffer.from('IDAT')) || !bytes.includes(Buffer.from('IEND'))) {
      throw new Error('Invalid or truncated PNG: ' + path)
    }
    tags += '<img hidden decoding="sync" id="' + id
      + '" src="data:image/png;base64,' + bytes.toString('base64') + '">\n'
  }
  return html.replace(/<\/body\s*>/iu, tags + '</body>')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 3) throw new Error('Usage: node examples/game-studio/embed-game-assets.mjs input.html images.json output.html')
  const [input, manifestPath, output] = args
  const [html, raw] = await Promise.all([readFile(input, 'utf8'), readFile(manifestPath, 'utf8')])
  const prepared = await embedGameAssets(html, JSON.parse(raw), dirname(resolve(manifestPath)))
  await writeFile(output, prepared, 'utf8')
  process.stdout.write('Images embedded; now validate art manifest and test gameplay in a browser.\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
}
