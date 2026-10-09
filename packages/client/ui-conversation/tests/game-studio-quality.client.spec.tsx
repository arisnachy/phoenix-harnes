// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { auditGameHtml, auditGameManifest, readGameManifest } from '../src/client/chat/game-studio-quality.ts'
import { UniversalArtifactSurface } from '../src/client/chat/UniversalArtifactSurface.tsx'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'

const manifest = {
  schemaVersion: 1,
  title: 'Jungle Echo', genre: 'original run-and-gun',
  references: [{ title: 'Gameplay reference', url: 'https://example.org/reference' }],
  player: {
    states: ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'],
    animations: { idle: 4, run: 8, jump: 2, fall: 2, shoot: 3, hurt: 2, death: 6 },
  },
  enemies: [{ id: 'scout', states: ['move', 'attack', 'hurt', 'death'] }],
  bosses: [{ id: 'walker', phases: ['patrol', 'barrage'] }],
  level: {
    layers: [{ id: 'sky', scrollFactor: 0 }, { id: 'forest', scrollFactor: 0.3 }, { id: 'trees', scrollFactor: 0.6 }],
    platforms: [{ x: 0, y: 350, width: 1000 }],
  },
  controls: { move: 'ArrowLeft/ArrowRight', jump: 'Space', shoot: 'KeyJ' },
  audio: { cues: ['jump', 'shoot', 'hit', 'explosion', 'boss'], music: 'original dynamic soundtrack' },
  sources: [{ path: 'main.html', license: 'original' }],
}

function gameHtml(): string {
  return '<canvas width="800" height="450"></canvas>'
    + '<script id="phoenix-game-manifest" type="application/json">' + JSON.stringify(manifest) + '</script>'
    + '<script>const game = document.querySelector("canvas");</script>'
}

describe('Phoenix Game Studio 2D artifact quality', () => {
  afterEach(() => { cleanup() })

  it('passes a coherent character/enemy/boss/level/audio contract without pretending it was playtested', () => {
    const result = auditGameManifest(manifest)
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.summary).toContain('still required')
  })

  it('flags missing motion, boss phases, level parallax and audio instead of accepting pretty images', () => {
    const result = auditGameManifest({
      ...manifest,
      player: { states: ['idle'], animations: { idle: 1 } },
      bosses: [{ id: 'walker', phases: ['one'] }],
      level: { layers: [], platforms: [] },
      audio: { cues: [] },
    })
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('player-state:jump')
    expect(result.issues).toContain('boss-requires-two-phases')
    expect(result.issues).toContain('level-requires-parallax-layers')
    expect(result.issues).toContain('audio-cue:shoot')
  })

  it('rejects external executable dependencies blocked by Phoenix iframe CSP', () => {
    const html = gameHtml() + '<script src="https://cdn.example.org/game.js"></script>'
    expect(auditGameHtml(html).issues).toContain('external-script-or-stylesheet-blocked')
    expect(readGameManifest(html)).toMatchObject({ title: 'Jungle Echo' })
    expect(readGameManifest('<script id="phoenix-game-manifest" type="application/json">{bad</script>')).toBeUndefined()
  })

  it('renders game artifact inline in a script-isolated iframe with visible preflight limits', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'jungle', title: 'Jungle Echo', mime: 'application/vnd.phoenix.game+html',
      data: gameHtml(),
    })
    expect(artifact.kind).toBe('html')
    expect(artifact.executable).toBe(true)
    render(<UniversalArtifactSurface artifact={artifact} onStop={() => {}} />)
    const root = document.querySelector('[data-phoenix-game-studio="true"]')
    expect(root?.getAttribute('data-game-preflight')).toBe('pass')
    expect(screen.getByText(/Not a gameplay test/u)).toBeTruthy()
    const frame = screen.getByTitle('Jungle Echo')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    expect(frame.getAttribute('srcdoc')).toContain('phoenix-game-manifest')
  })
})
