import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const gamePath = resolve(process.cwd(), 'examples/game-studio/jungle-echo.html')
const html = readFileSync(gamePath, 'utf8')

describe('Jungle Echo offline starter', () => {
  it('ships a documented, original game contract and no network-loaded dependencies', () => {
    const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    expect(blocks).toHaveLength(2)
    const manifest = JSON.parse(blocks[0]?.[2] ?? 'null') as {
      title: string
      player: { states: string[] }
      enemies: unknown[]
      bosses: { phases: string[] }[]
      level: { layers: unknown[] }
      audio: { cues: string[] }
    }
    expect(manifest.title).toBe('Jungle Echo')
    expect(manifest.player.states).toEqual(expect.arrayContaining(['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death']))
    expect(manifest.enemies.length).toBeGreaterThanOrEqual(2)
    expect(manifest.bosses[0]?.phases).toHaveLength(2)
    expect(manifest.level.layers.length).toBeGreaterThanOrEqual(3)
    expect(manifest.audio.cues).toEqual(expect.arrayContaining(['jump', 'shoot', 'hit', 'explosion', 'boss']))
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/iu)
    expect(html).not.toMatch(/\bfetch\s*\(/u)
  })

  it('advances actual game frames and accepts move/jump/fire input without JavaScript errors', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    const runtime = scripts[1]?.[2]
    expect(typeof runtime).toBe('string')

    const listeners: Record<string, (event: { code: string; repeat: boolean; preventDefault: () => void }) => void> = {}
    const callbacks: Array<(ms: number) => void> = []
    let fills = 0
    const ctx = {
      fillRect: () => { fills++ },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
      fill: () => {}, stroke: () => {}, arc: () => {}, save: () => {},
      restore: () => {}, translate: () => {}, scale: () => {}, rotate: () => {}, fillText: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
    }
    const noop = (): void => {}
    const canvas = { getContext: () => ctx, addEventListener: noop, focus: noop }
    const status = { textContent: '' }
    const controls = {
      restart: { addEventListener: noop },
      mute: { addEventListener: noop, setAttribute: noop, textContent: '' },
    }
    const doc = {
      getElementById: (id: string) => id === 'game' ? canvas : id === 'status' ? status
        : controls[id as keyof typeof controls],
      addEventListener: (type: string, callback: (event: { code: string; repeat: boolean; preventDefault: () => void }) => void) => {
        listeners[type] = callback
      },
      querySelectorAll: () => [],
    }

    runInNewContext(runtime ?? '', {
      document: doc, window: { addEventListener: noop },
      requestAnimationFrame: (callback: (ms: number) => void) => { callbacks.push(callback) },
    }, { timeout: 2000 })

    const press = (code: string): void => {
      const handler = listeners.keydown
      if (!handler) throw new Error('No keyboard handler attached')
      handler({ code, repeat: false, preventDefault: noop })
    }
    press('ArrowRight')
    press('Space')
    press('KeyJ')
    for (let i = 0; i < 90; i++) {
      const step = callbacks[i]
      if (!step) throw new Error('Game failed to request animation frame')
      step(i * (1000 / 60))
    }
    expect(fills).toBeGreaterThan(500)
    expect(status.textContent).toContain('Misión')
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['keydown', 'keyup']))
  })
})
