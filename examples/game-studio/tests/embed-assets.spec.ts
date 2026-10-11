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
  it('bundles a local original WAV sound and retains its cue id before gameplay scripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-audio-'))
    try {
      const input = join(dir, 'game.html'), wav = join(dir, 'shot.wav')
      const assets = join(dir, 'assets.json'), output = join(dir, 'out.html')
      const data = Buffer.alloc(48)
      data.write('RIFF', 0, 'ascii')
      data.writeUInt32LE(40, 4)
      data.write('WAVE', 8, 'ascii')
      data.write('fmt ', 12, 'ascii')
      data.writeUInt32LE(16, 16)
      data.writeUInt16LE(1, 20)
      data.writeUInt16LE(1, 22)
      data.writeUInt32LE(8000, 24)
      data.writeUInt32LE(16000, 28)
      data.writeUInt16LE(2, 32)
      data.writeUInt16LE(16, 34)
      data.write('data', 36, 'ascii')
      data.writeUInt32LE(4, 40)
      writeFileSync(wav, data)
      writeFileSync(input, '<html><body><script>document.getElementById("phoenix-audio-shoot").play()</script></body></html>')
      writeFileSync(assets, JSON.stringify({ audio: [{ id: 'phoenix-audio-shoot', path: 'shot.wav' }] }))
      const result = spawnSync(process.execPath, [command, input, assets, output], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      const html = readFileSync(output, 'utf8')
      expect(html).toContain('<audio hidden preload="auto" id="phoenix-audio-shoot" src="data:audio/wav;base64,')
      expect(html.indexOf('id="phoenix-audio-shoot"')).toBeLessThan(html.indexOf('document.getElementById'))
      expect(html).not.toContain('https://')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects fake and remote sounds, rather than silently claiming real sound effects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-audio-bad-'))
    try {
      const input = join(dir, 'game.html'), wav = join(dir, 'fake.wav')
      const assets = join(dir, 'assets.json'), output = join(dir, 'out.html')
      writeFileSync(input, '<html><body></body></html>')
      writeFileSync(wav, 'not a real audio sample')
      writeFileSync(assets, JSON.stringify({ audio: [{ id: 'phoenix-audio-shoot', path: 'fake.wav' }] }))
      expect(spawnSync(process.execPath, [command, input, assets, output]).status).toBe(1)
      writeFileSync(assets, JSON.stringify({ audio: [{ id: 'phoenix-audio-shoot', path: 'https://site/audio.mp3' }] }))
      expect(spawnSync(process.execPath, [command, input, assets, output]).status).toBe(1)
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
      expect(result.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
