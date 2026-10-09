import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const kitPath = resolve(process.cwd(), 'examples/game-studio/game-kit.js')
const kitSource = readFileSync(kitPath, 'utf8')
type Point = { x: number; y: number }
interface GameKit {
  direction8: (face: number, up: boolean, down: boolean) => Point
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
