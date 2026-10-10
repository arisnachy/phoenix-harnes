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


describe('Phoenix Game Studio cross-genre contracts', () => {
  const scene = { layers: [{ id: 'board', scrollFactor: 0 }] }
  const assets = [{ path: 'game.html', license: 'original' }]

  it('allows a logic puzzle without fake shooter controls, bosses or player animations', () => {
    const audit = auditGameManifest({
      schemaVersion: 1, title: 'Logic Garden', genre: 'puzzle', gameType: 'puzzle',
      level: { ...scene, puzzles: [{ id: 'first', goal: 'align tiles' }] },
      controls: { interact: 'Click/Enter' }, audio: { cues: ['solve'], music: 'adaptive ambient' }, sources: assets,
    })
    expect(audit.valid).toBe(true)
    expect(audit.issues).toEqual([])
    expect(audit.issues).not.toContain('missing-boss')
  })

  it('checks a driving game track, steering and engine rather than run-and-gun requirements', () => {
    const base = {
      schemaVersion: 1, title: 'Circuit Vela', genre: 'racing', gameType: 'racing',
      level: { ...scene, track: { waypoints: [0, 1, 2] } },
      player: { states: ['idle', 'drive', 'turn', 'crash'], animations: { idle: 1, drive: 8, turn: 4, crash: 4 } },
      controls: { steer: 'Arrows', accelerate: 'W', brake: 'S' },
      audio: { cues: ['engine', 'collision'], music: 'procedural' }, sources: assets,
    }
    expect(auditGameManifest(base).valid).toBe(true)
    expect(auditGameManifest({ ...base, level: scene }).issues).toContain('missing-race-track')
    expect(auditGameManifest({ ...base, controls: { accelerate: 'W' } }).issues).toContain('control:steer')
  })

  it('supports platforming without requiring guns, and identifies missing platform geometry', () => {
    const value = {
      schemaVersion: 1, title: 'Moon Hopper', genre: 'platformer', gameType: 'platformer',
      player: { states: ['idle', 'run', 'jump', 'fall'], animations: { idle: 2, run: 6, jump: 2, fall: 2 } },
      level: { layers: [{ id: 'sky', scrollFactor: 0 }, { id: 'trees', scrollFactor: .4 }], platforms: [{ x: 0, y: 400, width: 800 }] },
      controls: { move: 'A/D', jump: 'Space' }, audio: { cues: ['jump'], music: 'original' }, sources: assets,
    }
    expect(auditGameManifest(value).valid).toBe(true)
    expect(auditGameManifest({ ...value, level: { ...value.level, platforms: [] } }).issues).toContain('missing-playable-platforms')
  })

  it('fails safely on an absent genre or unknown explicit profile', () => {
    const base = { schemaVersion: 1, title: 'Unknown', level: scene, controls: { interact: 'Click' },
      mechanics: ['choose action'], audio: { cues: [] }, sources: assets }
    expect(auditGameManifest(base).issues).toContain('missing-genre')
    expect(auditGameManifest({ ...base, genre: 'avant-garde', gameType: 'unsupported-type' }).issues)
      .toContain('unsupported-game-type')
  })
})


describe('Phoenix Game Studio premium production gate', () => {
  const premium = {
    ...manifest,
    productionTier: 'polished',
    references: [...manifest.references, { title: 'Level pacing study', url: 'https://example.org/level-study' }],
    production: {
      artDirection: { style: 'original hand-painted arcade', camera: 'side-scrolling 2D', palette: ['#123456', '#abcdef', '#fffacd'] },
      story: { premise: 'Restore the forest', goal: 'Reach the reactor', ending: 'The forest is free' },
      screens: ['title', 'intro', 'pause', 'game-over', 'victory'].map(id => ({
        id, runtimeRef: 'screen_' + id.replace(/-/gu, '_'),
      })),
      assets: [
        { id: 'hero', role: 'player', entityId: 'player', origin: 'original', runtimeRef: 'drawHero', states: manifest.player.states },
        { id: 'scoutArt', role: 'enemy', entityId: 'scout', origin: 'original', runtimeRef: 'drawScout', states: manifest.enemies[0]!.states },
        { id: 'walkerArt', role: 'boss', entityId: 'walker', origin: 'original', runtimeRef: 'drawWalker', states: ['patrol', 'barrage'] },
        ...(['weapon', 'background', 'ui', 'vfx', 'music', 'sfx'] as const).map(role => ({
          id: role, role, origin: 'original', runtimeRef: 'render_' + role,
        })),
      ],
      audioBindings: [...manifest.audio.cues, 'music'].map(cue => ({ cue, runtimeRef: 'play_' + cue })),
    },
  }
  const refs = [
    ...premium.production.screens.map(s => s.runtimeRef),
    ...premium.production.assets.map(a => a.runtimeRef),
    ...premium.production.audioBindings.map(a => a.runtimeRef),
  ]
  const html = (runtime: string) => '<canvas></canvas><script id="phoenix-game-manifest" type="application/json">'
    + JSON.stringify(premium) + '</script><script>' + runtime + '</script>'

  it('requires a full production inventory for polished games', () => {
    expect(auditGameManifest(premium).valid).toBe(true)
    expect(auditGameManifest({ ...premium, production: { ...premium.production, screens: [] } }).issues)
      .toContain('missing-production-screen:title')
    expect(auditGameManifest({ ...premium, production: { ...premium.production, assets: [
      ...premium.production.assets.filter(asset => asset.role !== 'enemy'),
    ] } }).issues).toContain('unbound-enemy-art:scout')
    expect(auditGameManifest({ ...premium, references: [] }).issues)
      .toContain('premium-needs-two-researched-references')
  })

  it('does not mistake asset names inside the manifest for runtime implementation', () => {
    expect(auditGameHtml(html('const game = 1;')).issues).toContain('missing-runtime-asset-binding:drawHero')
    const stubs = refs.map(name => 'function ' + name + '() {}').join('\n')
    const audit = auditGameHtml(html(stubs))
    expect(audit.valid).toBe(true)
    expect(audit.warnings).toContain('premium-needs-observed-visual-audio-gameplay-qa')
  })

  it('preserves existing prototype contracts with an explicit quality limitation', () => {
    const audit = auditGameManifest(manifest)
    expect(audit.valid).toBe(true)
    expect(audit.warnings).toContain('premium-asset-integration-not-audited')
  })
})
