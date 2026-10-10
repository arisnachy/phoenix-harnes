/**
 * Package a real self-contained game and an authored manifest before publishing
 * an application/vnd.phoenix.game+html chat artifact.
 * The manifest is metadata, NEVER an inference of gameplay correctness.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateGameHtml } from '../../packages/hardness/adapters/src/game-tool.ts'

const marker = /<script\b[^>]*\bid\s*=\s*["']phoenix-game-manifest["'][^>]*>/iu

/** Extract the exact JSON manifest from the offline game HTML.
 * @param html - The embedded complete game document.
 * @returns Authored metadata or undefined when missing/invalid.
 */
export function readGameManifest(html: string): unknown {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
  const matching = scripts.filter(match => /\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(match[1] ?? ''))
  if (matching.length !== 1 || !/\btype\s*=\s*["']application\/json["']/iu.test(matching[0]?.[1] ?? '')) {
    return undefined
  }
  try { return JSON.parse(matching[0]?.[2] ?? '') as unknown } catch { return undefined }
}

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
  // Use the *same host-side validator* as the phoenix_game publisher. Client UI
  // modules belong to tsconfig.client.json and must not leak into host tests.
  validateGameHtml(embedded)
  if (manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const record = manifest as Record<string, unknown>
    const genre = String(record.gameType ?? record.genre ?? '').toLowerCase()
    if (/run.and.gun|shooter/u.test(genre)) {
      if (!record.player || typeof record.player !== 'object') throw new Error('missing-player')
      if (!Array.isArray(record.bosses) || record.bosses.length === 0) throw new Error('missing-boss')
    }
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
