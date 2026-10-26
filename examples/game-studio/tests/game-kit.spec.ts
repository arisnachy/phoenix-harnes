import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const kitPath = resolve(process.cwd(), 'examples/game-studio/game-kit.js')
const kitSource = readFileSync(kitPath, 'utf8')
type Point = { x: number; y: number }
interface GameKit {
  direction8: (face: number, up: boolean, down: boolean) => Point
  drawSpriteState: (ctx: object, image: object, atlas: object, state: string, seconds: number,
    x: number, y: number, width: number, height: number, face?: number) => boolean
  advanceBoss: (boss: Record<string, number | string | boolean>, player: { x: number; y: number; w: number; h: number },
    dt: number, fire: (projectile: { kind: string; vx: number; vy: number }) => void) => void
  activateAbility: (actor: { nextPowerAt?: number; powerAnimationUntil?: number }, seconds: number, cooldown?: number) => boolean
  twoBone: (root: Point, target: Point, upper: number, lower: number, bend?: number) => {
    joint: Point; end: Point; reached: boolean
  }
  humanPose: (args?: { walk?: number; running?: boolean; airborne?: boolean; falling?: boolean; aim?: number }) => {
    legs: Array<{ joint: Point; end: Point }>; arms: Array<{ joint: Point; end: Point }>; hand: Point; muzzle: Point
  }
  drawHumanoid: (ctx: object, x: number, y: number, opts?: object) => object
  animationFrame: (seconds: number, fps: number, frames: number) => number
  parallaxX: (x: number, camera: number, factor: number) => number
  enemyDecision: (args: { distanceToTarget: number; cooldown: number; health: number; role: string; visible?: boolean }) => string
}
const kit = runInNewContext(kitSource + '\nPhoenixGameKit;', {}) as GameKit

describe('original dependency-free Phoenix Game Studio motion kit', () => {
  it('renders the requested real atlas frame, with facing and strict missing-animation rejection', () => {
    const drawImage = vi.fn()
    const ctx = { save: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage, restore: vi.fn() }
    const image = { complete: true, naturalWidth: 32, naturalHeight: 32 }
    const atlas = { frameWidth: 16, frameHeight: 16, fps: 10,
      animations: { idle: [0, 1], attack: [2, 3] } }
    expect(kit.drawSpriteState(ctx, image, atlas, 'attack', .12, 10, 20, 32, 32, -1)).toBe(true)
    expect(drawImage).toHaveBeenCalledWith(image, 16, 16, 16, 16, 0, 0, 32, 32)
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1)
    expect(kit.drawSpriteState(ctx, image, atlas, 'death', .12, 0, 0, 32, 32)).toBe(false)
    expect(kit.drawSpriteState(ctx, { ...image, complete: false }, atlas, 'idle', 0, 0, 0, 32, 32)).toBe(false)
  })

  it('actually launches warned boss attacks, changes phase and alternates avoidable powers', () => {
    const boss: Record<string, number | string | boolean> = {
      x: 3410, y: 318, w: 110, h: 122, hp: 30, maxHp: 30, alive: true,
      action: 'idle', recovery: 0, windup: 0, attackIndex: 0, animTime: 0,
    }
    const hero = { x: 3260, y: 340, w: 30, h: 54 }
    const attacks: Array<{ kind: string; vx: number; vy: number }> = []
    kit.advanceBoss(boss, hero, .05, attack => attacks.push(attack))
    expect(boss.action).toBe('windup')
    expect(attacks).toHaveLength(0)
    for (let i = 0; i < 75; i++) kit.advanceBoss(boss, hero, .05, attack => attacks.push(attack))
    expect(attacks.some(attack => attack.kind === 'bolt')).toBe(true)
    boss.hp = 12
    for (let i = 0; i < 150; i++) kit.advanceBoss(boss, hero, .05, attack => attacks.push(attack))
    expect(boss.phase).toBe('barrage')
    expect(attacks.some(attack => attack.kind === 'fan')).toBe(true)
    expect(attacks.some(attack => attack.kind === 'ground-wave')).toBe(true)
    expect(attacks.every(attack => Number.isFinite(attack.vx) && Number.isFinite(attack.vy))).toBe(true)
  })

  it('does not allow infinite magic spam and exposes the timed power animation', () => {
    const actor: { nextPowerAt?: number; powerAnimationUntil?: number } = {}
    expect(kit.activateAbility(actor, 0)).toBe(true)
    expect(actor.powerAnimationUntil).toBeCloseTo(.42)
    expect(kit.activateAbility(actor, 1)).toBe(false)
    expect(kit.activateAbility(actor, 4.5)).toBe(true)
  })

  it('maintains 2-bone reach and bend direction without NaNs for extreme or zero targets', () => {
    const near = kit.twoBone({ x: 0, y: 0 }, { x: 0, y: 0 }, 20, 18)
    const far = kit.twoBone({ x: 0, y: 0 }, { x: 400, y: 0 }, 20, 18)
    expect(Number.isFinite(near.joint.x)).toBe(true)
    expect(Number.isFinite(near.joint.y)).toBe(true)
    expect(far.reached).toBe(false)
    expect(Math.hypot(far.end.x, far.end.y)).toBeLessThan(38)
    expect(() => kit.twoBone({ x: 0, y: 0 }, { x: 3, y: 4 }, 0, 10)).toThrow('Bone lengths must be positive')
    const left = kit.twoBone({ x: 0, y: 0 }, { x: 20, y: 0 }, 15, 15, -1)
    const right = kit.twoBone({ x: 0, y: 0 }, { x: 20, y: 0 }, 15, 15, 1)
    expect(left.joint.y * right.joint.y).toBeLessThan(0)
  })

  it('changes both knees, arms and muzzle positions with motion and aim', () => {
    const rest = kit.humanPose()
    const running = kit.humanPose({ walk: 1, running: true })
    const airborne = kit.humanPose({ airborne: true, falling: true, aim: -Math.PI / 4 })
    expect(rest.legs[0]?.end.x).not.toBe(running.legs[0]?.end.x)
    expect(rest.legs[1]?.end.y).not.toBe(running.legs[1]?.end.y)
    expect(rest.arms[0]?.joint.y).not.toBe(airborne.arms[0]?.joint.y)
    expect(airborne.muzzle.y).toBeLessThan(rest.muzzle.y)
    expect(kit.direction8(-1, true, false).x).toBeLessThan(0)
    expect(kit.direction8(-1, true, false).y).toBeLessThan(0)
  })

  it('draws actual articulated segments and follows a bounded AI decision cycle', () => {
    let segments = 0
    let muzzle = 0
    const ctx = {
      stroke: () => { segments++ }, fillRect: () => { muzzle++ },
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      closePath: () => {}, fill: () => {}, save: () => {}, restore: () => {},
      translate: () => {}, scale: () => {}, rotate: () => {},
    }
    kit.drawHumanoid(ctx, 10, 40, { running: true, walk: 1, aim: -.7, flash: true })
    expect(segments).toBe(4)
    expect(muzzle).toBeGreaterThan(5)
    expect(kit.enemyDecision({ distanceToTarget: 150, cooldown: 0, health: 2, role: 'scout' })).toBe('telegraph')
    expect(kit.enemyDecision({ distanceToTarget: 200, cooldown: 2, health: 2, role: 'scout' })).toBe('chase')
    expect(kit.enemyDecision({ distanceToTarget: 200, cooldown: 2, health: 2, role: 'turret' })).toBe('cover')
    expect(kit.enemyDecision({ distanceToTarget: 200, cooldown: 0, health: 0, role: 'scout' })).toBe('dead')
    expect(kit.enemyDecision({ distanceToTarget: 200, cooldown: 0, health: 2, role: 'scout', visible: false })).toBe('patrol')
    expect(kit.parallaxX(100, 30, .5)).toBe(85)
    expect(kit.animationFrame(.4, 10, 6)).toBe(4)
  })
})
