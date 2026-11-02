import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateGameHtml } from '../../../packages/hardness/adapters/src/game-tool.ts'
import { prepareGameHtml, readGameManifest } from '../prepare-game.ts'

const puzzle = readFileSync(resolve(process.cwd(), 'examples/game-studio/lumen-circuit.html'), 'utf8')
const shooter = readFileSync(resolve(process.cwd(), 'examples/game-studio/jungle-echo.html'), 'utf8')
const manifestScript = /<script\b[^>]*\bid\s*=\s*["']phoenix-game-manifest["'][^>]*>[\s\S]*?<\/script\s*>/iu

describe('Phoenix Game Studio publication handshake', () => {
  it('injects matching game metadata into an actual playable puzzle without changing game code', () => {
    const metadata = readGameManifest(puzzle)
    const without = puzzle.replace(manifestScript, '')
    expect(readGameManifest(without)).toBeUndefined()
    const prepared = prepareGameHtml(without, metadata)
    expect(readGameManifest(prepared)).toEqual(metadata)
    expect(readGameManifest(prepared)).toEqual(metadata)
    expect(prepared).toContain('LUMEN CIRCUIT')
    expect(prepared).toContain('canvas.addEventListener')
    expect(prepareGameHtml(prepared, metadata)).toBe(prepared)
  })

  it('accepts the shipped shooter only with its authentic genre-specific entities', () => {
    const metadata = readGameManifest(shooter)
    const without = shooter.replace(manifestScript, '')
    const prepared = prepareGameHtml(without, metadata)
    expect(validateGameHtml(prepared)).toMatchObject({ schemaVersion: 1, genre: 'run-and-gun' })
    expect(readGameManifest(prepared)).toMatchObject({ genre: 'run-and-gun' })
    expect(prepared).toContain('PhoenixGameKit')
  })

  it('rejects incomplete game contracts without silently inventing entities', () => {
    const metadata = readGameManifest(shooter) as Record<string, unknown>
    const html = shooter.replace(manifestScript, '')
    expect(() => prepareGameHtml(html, { ...metadata, player: undefined, bosses: [] })).toThrow('missing-player')
    expect(() => prepareGameHtml(html, { ...metadata, bosses: [] })).toThrow('missing-boss')
    expect(() => prepareGameHtml('some/file.html', metadata)).toThrow('complete game HTML')
  })

  it('reports malformed, wrong-typed, duplicate and conflicting manifests explicitly', () => {
    const metadata = readGameManifest(puzzle)
    const without = puzzle.replace(manifestScript, '')
    const malformed = without.replace('</body>', '<script id="phoenix-game-manifest" type="application/json">{bad</script></body>')
    expect(readGameManifest(malformed)).toBeUndefined()
    expect(() => prepareGameHtml(malformed, metadata)).toThrow('malformed')
    const wrongType = without.replace('</body>', '<script id="phoenix-game-manifest" type="text/plain">{}</script></body>')
    expect(readGameManifest(wrongType)).toBeUndefined()
    expect(() => prepareGameHtml(puzzle + (puzzle.match(manifestScript)?.[0] ?? ''), metadata)).toThrow()
    expect(() => prepareGameHtml(puzzle, { schemaVersion: 1 })).toThrow('differs')
  })

  it('escapes closing script fragments in authored metadata before insertion', () => {
    const metadata = readGameManifest(puzzle) as Record<string, unknown>
    const result = prepareGameHtml(puzzle.replace(manifestScript, ''),
      { ...metadata, title: '</script><script>window.pwned()</script>' })
    expect(result).not.toContain('</script><script>window.pwned()')
    expect(readGameManifest(result)).toMatchObject({ title: '</script><script>window.pwned()</script>' })
  })
})
