import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve(process.cwd(), 'examples/game-studio/lumen-circuit.html'), 'utf8')

describe('Lumen Circuit independent playable puzzle genre', () => {
  it('declares a genre-specific local game manifest without network resources', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    const data = JSON.parse(scripts[0]?.[2] ?? '{}') as {
      gameType?: string
      controls: { interact: string }
      level: { puzzles: unknown[] }
    }
    expect(data.gameType).toBe('puzzle')
    expect(data.controls.interact).toContain('pointer')
    expect(data.level.puzzles).toHaveLength(1)
    expect(html).not.toMatch(/<script\b[^>]*src\s*=/iu)
    expect(scripts).toHaveLength(2)
  })

  it('runs real frame callbacks and responds to keyboard and pointer rotations', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    const events: Record<string, (e: { code?: string; clientX?: number; clientY?: number; preventDefault?: () => void }) => void> = {}
    const frames: Array<(ms: number) => void> = []
    let fills = 0
    const noop = (): void => {}
    const ctx = {
      fillRect: () => { fills++ }, strokeRect: noop, beginPath: noop, moveTo: noop,
      lineTo: noop, stroke: noop, fill: noop, arc: noop, fillText: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
    }
    const canvas = {
      width: 760, height: 590, getContext: () => ctx, focus: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 760, height: 590 }),
      addEventListener: (name: string, fn: (e: { code?: string; clientX?: number; clientY?: number; preventDefault?: () => void }) => void) => { events[name] = fn },
    }
    const status = { textContent: '' }
    const buttons = { reset: { addEventListener: noop }, mute: { addEventListener: noop } }
    const doc = { getElementById: (id: string) => id === 'board' ? canvas : id === 'status' ? status
      : buttons[id as keyof typeof buttons] }
    runInNewContext(scripts[1]?.[2] ?? '', {
      document: doc, window: {}, requestAnimationFrame: (fn: (ms: number) => void) => { frames.push(fn) },
    }, { timeout: 2000 })
    for (let i = 0; i < 60; i++) {
      const fn = frames[i]
      if (!fn) throw Error('Expected next rendered frame')
      fn(i * (1000 / 60))
    }
    const key = events.keydown
    const pointer = events.pointerdown
    if (!key || !pointer) throw Error('Game controls were not registered')
    key({ code: 'ArrowRight', preventDefault: noop })
    key({ code: 'Enter', preventDefault: noop })
    pointer({ clientX: 200, clientY: 110 })
    expect(status.textContent).toContain('Movimientos: 2')
    expect(fills).toBeGreaterThan(2500)
    expect(frames.length).toBe(61)
  })
})
