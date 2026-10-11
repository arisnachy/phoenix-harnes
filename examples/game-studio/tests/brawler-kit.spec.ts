import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { planGameAssets } from '../plan-game-assets.mjs'

const code = readFileSync(resolve(process.cwd(), 'examples/game-studio/brawler-kit.js'), 'utf8')
type Actor = Record<string, any>
const kit = runInNewContext(code + '\nPhoenixBrawlerKit;', {}) as {
  fighter: (props: Record<string, unknown>) => Actor
  walk: (a: Actor, x: number, y: number, dt: number, belt: { minY: number; maxY: number }, world: number) => boolean
  queueAttack: (a: Actor, move: string) => boolean
  advance: (a: Actor, dt: number, emit?: (e: any) => void) => void
  resolveHits: (a: Actor, targets: Actor[], emit?: (e: any) => void) => number
  enemyAI: (a: Actor, target: Actor, dt: number, belt: object, w: number, emit?: (e: any) => void) => void
  bossAI: (a: Actor, target: Actor, dt: number, belt: object, w: number, emit?: (e: any) => void) => void
  cameraX: (target: Actor, camera: number, w: number, world: number, dt: number) => number
  drawActorsByDepth: (ctx: object, fighters: Actor[], atlas: (id: string) => any, camera: number, clock: number, kit: object) => void
  audioBus: (doc: object) => { unlock: () => void; cue: (name: string) => boolean; music: () => boolean; mute: (v: boolean) => void; stop: () => void }
}

describe('Phoenix street beat-em-up runtime (no placeholder art)', () => {
  const belt = { minY: 250, maxY: 420 }
  it('moves on real horizontal+depth axes and clamps street walkability', () => {
    const hero = kit.fighter({ id: 'hero', x: 40, y: 330, team: 'player' })
    expect(kit.walk(hero, 1, 1, .2, belt, 3200)).toBe(true)
    expect(hero.x).toBeGreaterThan(40)
    expect(hero.y).toBeGreaterThan(330)
    kit.walk(hero, 0, 1, 2, belt, 3200)
    expect(hero.y).toBe(420)
    expect(kit.cameraX(hero, 0, 640, 3200, .05)).toBeGreaterThanOrEqual(0)
  })

  it('resolves timed attacks only in front and on a matching depth lane, once per swing', () => {
    const hero = kit.fighter({ id: 'hero', x: 100, y: 340, team: 'player' })
    const enemy = kit.fighter({ id: 'enemy', x: 143, y: 349, hp: 50, team: 'enemy' })
    const behind = kit.fighter({ id: 'behind', x: 90, y: 340, hp: 50 })
    const anotherLane = kit.fighter({ id: 'far-y', x: 144, y: 415, hp: 50 })
    const events: any[] = []
    expect(kit.queueAttack(hero, 'punch')).toBe(true)
    expect(kit.resolveHits(hero, [enemy], e => events.push(e))).toBe(0)
    kit.advance(hero, .05)
    kit.advance(hero, .05)
    kit.advance(hero, .05)
    expect(kit.resolveHits(hero, [enemy, behind, anotherLane], e => events.push(e))).toBe(1)
    expect(enemy.hp).toBe(43)
    expect(enemy.stun).toBeGreaterThan(0)
    expect(hero.hitstop).toBeGreaterThan(0)
    expect(kit.resolveHits(hero, [enemy], e => events.push(e))).toBe(0)
    expect(events.filter(e => e.type === 'hit')).toHaveLength(1)
  })

  it('has animated boss windup intent, a real enrage transition and unique heavy attacks', () => {
    const player = kit.fighter({ id: 'hero', x: 125, y: 350, team: 'player' })
    const boss = kit.fighter({ id: 'boss', x: 180, y: 350, hp: 200, boss: true })
    const events: any[] = []
    kit.bossAI(boss, player, .05, belt, 3200, e => events.push(e))
    expect(events.some(e => e.type === 'boss-telegraph')).toBe(true)
    expect(boss.action.name).toBe('sweep')
    boss.action = null
    boss.cooldown = 0
    boss.hp = 60
    kit.bossAI(boss, player, .05, belt, 3200, e => events.push(e))
    expect(boss.phase).toBe('enraged')
    expect(events.some(e => e.type === 'boss-phase')).toBe(true)
    expect(['sweep', 'charge']).toContain(boss.action.name)
  })

  it('draws approved atlases by actor depth instead of substituting generic figures', () => {
    const near = kit.fighter({ id: 'near', y: 390 })
    const far = kit.fighter({ id: 'far', y: 280 })
    const draw = vi.fn()
    kit.drawActorsByDepth({}, [near, far], id => ({ image: id, atlas: {}, width: 64, height: 90 }), 20, 0,
      { drawSpriteState: draw })
    expect(draw).toHaveBeenCalledTimes(2)
    expect(draw.mock.calls[0]?.[1]).toBe('far')
    expect(draw.mock.calls[1]?.[1]).toBe('near')
    expect(() => kit.drawActorsByDepth({}, [near], () => undefined, 0, 0, {})).toThrow('renderer')
  })

  it('requires an unlock gesture before event-linked audio and supports mute/stop', () => {
    const play = vi.fn(() => Promise.resolve())
    const pause = vi.fn()
    const sample = { play, pause, muted: false, loop: false, currentTime: 2 }
    const bus = kit.audioBus({ getElementById: () => sample, querySelectorAll: () => [sample] })
    expect(bus.cue('punch')).toBe(false)
    bus.unlock()
    expect(bus.cue('punch')).toBe(true)
    expect(sample.currentTime).toBe(0)
    expect(bus.music()).toBe(true)
    expect(sample.loop).toBe(true)
    bus.mute(true)
    expect(bus.cue('punch')).toBe(false)
    bus.stop()
    expect(pause).toHaveBeenCalled()
  })

  it('plans a full brawler cast/world instead of shooter presets', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/game-studio/street-brawler.manifest.json'), 'utf8'))
    const plan = planGameAssets(manifest)
    const families = new Set(plan.tasks.map((t: { family: string }) => t.family))
    for (const family of ['hero', 'enemies', 'bosses', 'boss-attacks', 'combat-combos', 'grapples',
      'backgrounds', 'weapons', 'props', 'effects', 'audio']) expect(families.has(family)).toBe(true)
    expect(families.has('projectiles')).toBe(false)
    expect(plan.missingDesignDecisions).toEqual([])
    expect(plan.tasks.every((t: { status: string }) => t.status === 'pending')).toBe(true)
  })
})
