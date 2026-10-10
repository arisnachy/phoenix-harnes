import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const command = resolve(process.cwd(), 'examples/game-studio/embed-game-assets.mjs')
const onePixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9H9UsAAAAASUVORK5CYII='

describe('Game Studio offline PNG importer', () => {
  it('puts real local image bytes before game code and never references remote URLs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-assets-'))
    try {
      const input = join(dir, 'game.html'), png = join(dir, 'actor.png'), assets = join(dir, 'images.json'), output = join(dir, 'out.html')
      writeFileSync(input, '<html><body><canvas id="game"></canvas><script>const actor=document.getElementById("hero-art");</script></body></html>')
      writeFileSync(png, Buffer.from(onePixel, 'base64'))
      writeFileSync(assets, JSON.stringify({ images: [{ id: 'hero-art', path: 'actor.png' }] }))
      const result = spawnSync(process.execPath, [command, input, assets, output], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      const html = readFileSync(output, 'utf8')
      expect(html).toContain('<img hidden decoding="sync" id="hero-art" src="data:image/png;base64,')
      expect(html.indexOf('id="hero-art"')).toBeLessThan(html.indexOf('const actor='))
      expect(html).not.toContain('https://')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects duplicate IDs and missing image bytes before game publication', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-assets-bad-'))
    try {
      const input = join(dir, 'game.html'), assets = join(dir, 'images.json'), output = join(dir, 'out.html')
      writeFileSync(input, '<html><body><img id="hero-art"><script>void 1</script></body></html>')
      writeFileSync(assets, JSON.stringify({ images: [{ id: 'hero-art', path: 'not-there.png' }] }))
      const result = spawnSync(process.execPath, [command, input, assets, output], { encoding: 'utf8' })
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
