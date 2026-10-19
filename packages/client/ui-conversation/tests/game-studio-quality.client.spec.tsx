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

  it('renders game artifact inline in a script-isolated iframe with quiet structural preflight', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'jungle', title: 'Jungle Echo', mime: 'application/vnd.phoenix.game+html',
      data: gameHtml(),
    })
    expect(artifact.kind).toBe('html')
    expect(artifact.executable).toBe(true)
    render(<UniversalArtifactSurface artifact={artifact} onStop={() => {}} />)
    const root = document.querySelector('[data-phoenix-game-studio="true"]')
    expect(root?.getAttribute('data-game-preflight')).toBe('pass')
    expect(screen.getByRole('heading', { name: 'Jungle Echo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agregar a biblioteca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir biblioteca' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir en otra ventana' })).toBeTruthy()
    expect(screen.queryByText(/structural preflight|Not a gameplay test|Issues:|Review:/iu)).toBeNull()
    const frame = screen.getByTitle('Jungle Echo')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    expect(frame.getAttribute('srcdoc')).toContain('phoenix-game-manifest')
  })
})


describe('Phoenix classic game contracts in chat', () => {
  for (const gameType of ['tetris', 'snake', 'pong', 'pac-man', 'ajedrez', 'chess', 'solitario', 'sudoku', '2048']) {
    it('recognizes ' + gameType + ' without imposing boss or parallax schemas', () => {
      const value = {
        schemaVersion: 1, title: 'Classic ' + gameType,
        genre: gameType, gameType,
        controls: { interact: 'Keyboard/Touch' },
        level: { board: { rows: 20, columns: 10 } },
        audio: { cues: ['select'], music: 'optional' },
      }
      const audit = auditGameManifest(value)
      expect(audit.valid).toBe(true)
      expect(audit.issues).toEqual([])
      expect(audit.issues).not.toContain('missing-boss')
      expect(audit.issues).not.toContain('level-requires-scene-layers')
    })
  }
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
  it('flags every absent production art family rather than accepting a hero-only run-and-gun', () => {
    const incomplete = auditGameManifest({ ...manifest, art: {
      mode: 'production', designReference: 'hero-approved.png', hero: { imageId: 'hero' },
    } })
    for (const family of ['enemies', 'bosses', 'backgrounds', 'weapons', 'projectiles', 'powers', 'props', 'effects']) {
      expect(incomplete.issues).toContain('missing-production-art:' + family)
    }
    const prototype = auditGameManifest({ ...manifest, art: { mode: 'prototype' } })
    expect(prototype.valid).toBe(true)
    expect(prototype.warnings).toContain('character-art-prototype-not-final')
  })

  it('distinguishes missing JSON from actual game boot failure and warns on provisional art', () => {
    const html = gameHtml()
    const absent = html.replace(/<script id="phoenix-game-manifest"[^>]*>[^]*?<\/script>/u, '')
    expect(auditGameHtml(absent).issues).toContain('game-manifest-missing')
    const broken = html.replace(JSON.stringify(manifest), '{oops')
    expect(auditGameHtml(broken).issues).toContain('game-manifest-invalid-json-or-type')
    const duplicate = html + '<script id="phoenix-game-manifest" type="application/json">'
      + JSON.stringify(manifest) + '</script>'
    expect(auditGameHtml(duplicate).issues).toContain('game-manifest-duplicated')
    const prototype = { ...manifest, art: { mode: 'prototype' } }
    expect(auditGameManifest(prototype).warnings).toContain('character-art-prototype-not-final')
  })

  it('reserves playable iframe height and injects a visible startup error diagnostic', () => {
    const artifact = normalizeHardnessArtifact({
      id: 'broken', title: 'Game diagnostics', mime: 'application/vnd.phoenix.game+html',
      data: gameHtml(),
    })
    render(<UniversalArtifactSurface artifact={artifact} onStop={() => {}} />)
    const frame = screen.getByTitle('Game diagnostics')
    expect(frame.getAttribute('srcdoc')).toContain('data-phoenix-game-error')
    expect(frame.getAttribute('style')).toContain('height: 460px')
  })

})

describe('Beat-em-up games require their own action-game profile', () => {
  const brawler = {
    schemaVersion: 1, title: 'Original street brawler', genre: 'beat-em-up', gameType: 'beat-em-up',
    player: { states: ['idle', 'run', 'jump', 'punch', 'kick', 'grab', 'hurt', 'death'],
      animations: { idle: 4, run: 8, jump: 2, punch: 3, kick: 3, grab: 2, hurt: 2, death: 3 } },
    enemies: ['scout', 'fighter', 'bruiser'].map(id => ({ id, states: ['move', 'attack', 'hurt', 'death'] })),
    bosses: [{ id: 'chief', phases: ['opening', 'enraged'],
      attacks: [{ id: 'sweep', telegraphSeconds: .4 }, { id: 'charge', telegraphSeconds: .7 }] }],
    combat: { depthAxis: true, knockback: true, hitboxes: { yTolerance: 22 },
      combos: [{ id: 'jab-jab-kick' }, { id: 'heavy-chain' }], grapples: [{ id: 'throw' }] },
    level: { scrollLength: 2400, belt: { minY: 260, maxY: 390 },
      zones: [{ id: 'alley' }, { id: 'warehouse' }],
      layers: [{ id: 'sky', scrollFactor: .1 }, { id: 'city', scrollFactor: .4 },
        { id: 'props', scrollFactor: .8 }] },
    controls: { move: 'WASD', punch: 'J', kick: 'K', jump: 'Space', grab: 'L' },
    audio: { cues: ['punch', 'kick', 'hit', 'grab', 'boss', 'pickup'], music: 'original theme' },
    sources: [{ path: 'scene.html', license: 'original' }],
    art: { mode: 'prototype' },
  }

  it('accepts a complete brawler prototype without pretending it has finished art', () => {
    const verdict = auditGameManifest(brawler)
    expect(verdict.valid).toBe(true)
    expect(verdict.warnings).toContain('character-art-prototype-not-final')
  })

  it('rejects a Double Dragon-like mock with two generic static fighters and empty audio', () => {
    const broken = auditGameManifest({
      ...brawler, genre: 'Double Dragon-inspired beat-em-up',
      player: { states: ['idle'], animations: { idle: 1 } },
      enemies: [{ id: 'clone', states: ['move', 'attack', 'hurt', 'death'] }],
      bosses: [{ id: 'still-boss', phases: ['phase1'] }],
      level: { layers: [{ id: 'flat', scrollFactor: 0 }] },
      controls: { move: 'WASD', action: 'J' },
      audio: { cues: [] },
      combat: undefined,
    })
    expect(broken.valid).toBe(false)
    for (const issue of ['player-state:punch', 'player-state:grab',
      'beat-em-up-requires-three-enemy-archetypes',
      'beat-em-up-boss-requires-two-telegraphed-attacks',
      'beat-em-up-requires-depth-hitboxes-combos-grapples-knockback',
      'beat-em-up-requires-belt-scroll-and-distinct-stage-zones',
      'control:punch', 'control:grab', 'audio-cue:grab']) expect(broken.issues).toContain(issue)
  })

  it('refuses to badge production art and audio from a hero-only brawler', () => {
    const verdict = auditGameManifest({ ...brawler,
      art: { mode: 'production', designReference: 'hero.png', hero: { imageId: 'hero-img' } },
    })
    expect(verdict.issues).toContain('missing-production-art:enemies')
    expect(verdict.issues).toContain('missing-production-art:bosses')
    expect(verdict.issues).toContain('beat-em-up-production-requires-recorded-audio')
  })
})
