/**
 * Package a real self-contained game and an authored manifest before publishing
 * an application/vnd.phoenix.game+html chat artifact.
 * The manifest is metadata, NEVER an inference of gameplay correctness.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditGameHtml, readGameManifest } from '../../packages/client/ui-conversation/src/client/chat/game-studio-quality.ts'

const marker = /<script\b[^>]*\bid\s*=\s*["']phoenix-game-manifest["'][^>]*>/iu

/**
 * Prepare a standalone HTML game with the matching manifest.
 * @param source - Real complete game HTML (not a code block, path, URL or screenshot).
 * @param manifest - Authored metadata that corresponds to actually implemented behaviors.
 * @returns A self-contained HTML document passing Game Studio structural preflight.
 */
export function prepareGameHtml(source: string, manifest: unknown): string {
  if (!/<html\b/iu.test(source) || !/<\/body\s*>/iu.test(source)) {
    throw new Error('Provide the complete game HTML with a closing </body>; do not pass a path or screenshot')
  }
  const existing = marker.test(source)
  if (existing) {
    const parsed = readGameManifest(source)
    if (parsed === undefined) {
      throw new Error('Existing phoenix-game-manifest is malformed or uses the wrong script type')
    }
    if (JSON.stringify(parsed) !== JSON.stringify(manifest)) {
      throw new Error('Existing phoenix-game-manifest differs from manifest.json; update the authored source, do not duplicate metadata')
    }
  }
  const json = JSON.stringify(manifest, null, 2)
  if (json === undefined) throw new Error('manifest.json must contain a JSON value')
  const safeJson = json.replace(/</gu, '\\u003c')
  const embedded = existing ? source : source.replace(/<\/body\s*>/iu,
    '<script id="phoenix-game-manifest" type="application/json">\n' + safeJson + '\n</script>\n</body>')
  const audit = auditGameHtml(embedded)
  if (!audit.valid) {
    throw new Error('Game Studio structural preflight failed: ' + audit.issues.join(', ')
      + '. Correct the real game/manifest before publishing.')
  }
  return embedded
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length !== 3) {
    throw new Error('Usage: pnpm exec tsx examples/game-studio/prepare-game.ts input.html manifest.json output.html')
  }
  const [input, metadata, output] = args
  if (input === undefined || metadata === undefined || output === undefined) throw new Error('Missing paths')
  const [html, raw] = await Promise.all([readFile(input, 'utf8'), readFile(metadata, 'utf8')])
  const result = prepareGameHtml(html, JSON.parse(raw) as unknown)
  await writeFile(output, result, 'utf8')
  process.stdout.write('Game Studio: structural preflight passed; artifact ready at ' + output
    + '. Gameplay, graphics and audio are NOT certified.\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(String(error) + '\n')
    process.exitCode = 1
  })
}
