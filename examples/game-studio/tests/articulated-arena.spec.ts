import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'examples/game-studio/animation-engine.js'), 'utf8')
const html = readFileSync(resolve(process.cwd(), 'examples/game-studio/articulated-arena.html'), 'utf8')
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
const inlineEngine = source.replace("if (typeof module !== 'undefined' && module.exports) module.exports = PhoenixArticulation;", '')

describe('Articulated Arena offline playable animation integration', () => {
  it('ships a self-contained playable artifact with its real skeletal engine inlined', () => {
    expect(scripts).toHaveLength(2)
    expect(scripts[0]?.[1]).toMatch(/application\/json/u)
    const manifest = JSON.parse(scripts[0]?.[2] ?? 'null') as {
      gameType: string; player: { states: string[] }; enemies: unknown[]; bosses: unknown[]
      level: { platforms: unknown[] }; sources: unknown[]
    }
    expect(manifest.gameType).toBe('platformer')
    expect(manifest.player.states).toEqual(expect.arrayContaining(['idle', 'run', 'jump', 'fall', 'shoot']))
    expect(manifest.enemies).toHaveLength(2)
    expect(manifest.bosses).toHaveLength(1)
    expect(manifest.level.platforms.length).toBeGreaterThan(0)
    expect(manifest.sources.length).toBeGreaterThan(0)
    expect(scripts[1]?.[2]).toContain(inlineEngine)
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/iu)
    expect(html).not.toMatch(/\bfetch\s*\(/u)
  })

  it('runs keyboard gameplay and animates three kinds of rigs without runtime errors', () => {
    const callbacks: Array<(ms: number) => void> = []
    const keyboard: Record<string, (e: { code: string; preventDefault: () => void }) => void> = {}
    const buttons: Record<string, () => void> = {}
    let fills = 0; let rotations = 0
    const noop = (): void => {}
    const ctx = {
      createLinearGradient: () => ({ addColorStop: noop }),
      save: noop, restore: noop, translate: noop, scale: noop,
      rotate: () => { rotations++ }, drawImage: noop, clearRect: noop,
      beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
      fillRect: () => { fills++ }, fill: noop, stroke: noop, strokeRect: noop,
      arc: noop, fillText: noop,
    }
    const canvas = { getContext: () => ctx, focus: noop }
    const status = { textContent: '' }
    const button = (name: string) => ({
      textContent: '', setAttribute: noop,
      addEventListener: (event: string, fn: () => void) => { buttons[name + ':' + event] = fn },
    })
    const doc = {
      getElementById: (id: string) => id === 'game' ? canvas : id === 'status' ? status : button(id),
      addEventListener: (event: string, handler: (e: { code: string; preventDefault: () => void }) => void) => { keyboard[event] = handler },
      querySelectorAll: () => [],
    }
    runInNewContext(scripts[1]?.[2] ?? '', {
      document: doc, window: { addEventListener: noop },
      requestAnimationFrame: (fn: (ms: number) => void) => { callbacks.push(fn) },
    }, { timeout: 3500 })
    const start = buttons['start:click']
    if (!start) throw new Error('Missing start button')
    start()
    const keydown = keyboard.keydown
    if (!keydown) throw new Error('Missing keydown control')
    for (const code of ['ArrowRight', 'Space', 'KeyJ']) keydown({ code, preventDefault: noop })
    for (let i = 0; i < 180; i++) {
      const step = callbacks[i]
      if (!step) throw new Error('Animation loop stopped at frame ' + i)
      step(i * 16.667)
    }
    expect(callbacks.length).toBe(181)
    expect(fills).toBeGreaterThan(5000)
    expect(rotations).toBeGreaterThan(200)
    expect(status.textContent).toContain('Escudo')
    expect(Object.keys(keyboard)).toEqual(expect.arrayContaining(['keydown', 'keyup']))
    expect(buttons['reset:click']).toBeTypeOf('function')
  })
})
