import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext, Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('examples/game-studio/street-brawler-demo.html'), 'utf8')
const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1] ?? '')
const manifest = JSON.parse(scripts[0] ?? 'null') as {
  title: string
  genre: string
  gameType: string
  art: { mode: string }
  enemies: unknown[]
  bosses: unknown[]
  controls: Record<string, string>
}

describe('one-level in-chat street brawler playable fallback', () => {
  it('ships a truthful offline beat-em-up contract, three rivals and a boss', () => {
    expect(scripts).toHaveLength(3)
    expect(manifest.gameType).toBe('beat-em-up')
    expect(manifest.art.mode).toBe('prototype')
    expect(manifest.enemies).toHaveLength(3)
    expect(manifest.bosses).toHaveLength(1)
    expect(manifest.controls).toHaveProperty('grab')
    expect(source).not.toMatch(/<script\b[^>]*\bsrc=/iu)
    expect(source).not.toMatch(/\bfetch\s*\(/u)
    new Script(scripts[1] ?? '')
    new Script(scripts[2] ?? '')
  })

  it('actually advances frames, moves the hero, accepts attacks and resets', () => {
    const callbacks: Array<(ms: number) => void> = []
    const keys = new Map<string, (event: { code: string; repeat: boolean; preventDefault: () => void }) => void>()
    const clicks: Record<string, () => void> = {}
    const state: { __phoenixDemoState?: {
      frames: number
      started: boolean
      heroX: number
      bossHp: number
      enemiesAlive: number
    } } = {}
    const paint = {
      fillRect: () => {}, beginPath: () => {}, arc: () => {}, ellipse: () => {},
      fill: () => {}, stroke: () => {}, fillText: () => {}, strokeRect: () => {},
      moveTo: () => {}, lineTo: () => {}, save: () => {}, restore: () => {},
      translate: () => {}, scale: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
    }
    const buttons = Object.fromEntries(['start', 'restart', 'sound'].map(id => [id, {
      addEventListener: (_name: string, handler: () => void) => { clicks[id] = handler },
      focus: () => {},
    }]))
    const canvas = { getContext: () => paint, focus: () => {} }
    const scope = createContext({
      document: {
        getElementById: (id: string) => id === 'game' ? canvas : buttons[id],
        addEventListener: (type: string, callback: typeof keys extends Map<string, infer F> ? F : never) => {
          keys.set(type, callback)
        },
      },
      window: {
        requestAnimationFrame: (callback: (ms: number) => void) => { callbacks.push(callback) },
        addEventListener: () => {},
        ...state,
      },
    })
    runInContext((scripts[1] ?? '') + '\n' + (scripts[2] ?? ''), scope, { timeout: 2000 })
    const windowState = (scope.window as typeof state)
    expect(windowState.__phoenixDemoState?.started).toBe(false)
    clicks.start?.()
    const right = keys.get('keydown')
    expect(right).toBeDefined()
    right?.({ code: 'ArrowRight', repeat: false, preventDefault: () => {} })
    right?.({ code: 'KeyJ', repeat: false, preventDefault: () => {} })
    right?.({ code: 'KeyK', repeat: false, preventDefault: () => {} })
    right?.({ code: 'KeyL', repeat: false, preventDefault: () => {} })
    right?.({ code: 'Space', repeat: false, preventDefault: () => {} })
    for (let i = 0; i < 80; i++) {
      const step = callbacks[i]
      if (!step) throw new Error('Game did not request the next animation frame')
      step(i * (1000 / 60))
    }
    expect(windowState.__phoenixDemoState?.frames).toBeGreaterThan(70)
    expect(windowState.__phoenixDemoState?.heroX).toBeGreaterThan(96)
    expect(windowState.__phoenixDemoState?.bossHp).toBe(150)
    clicks.restart?.()
    expect(windowState.__phoenixDemoState?.heroX).toBe(96)
    expect(windowState.__phoenixDemoState?.enemiesAlive).toBe(3)
  })
})
