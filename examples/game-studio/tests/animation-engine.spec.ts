import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const engineSource = readFileSync(resolve(process.cwd(), 'examples/game-studio/animation-engine.js'), 'utf8')
type Vec = { x: number; y: number }
type Rig = {
  bones: readonly { id: string; parent: string | null; length: number }[]
  index: Record<string, unknown>
}
type Pose = { root: { x: number; y: number; rotation: number }; angles: Record<string, number> }
type World = Record<string, { start: Vec; end: Vec; angle: number }>
type Animated = {
  play: (name: string, opts?: { fade?: number; speed?: number; reset?: boolean }) => void
  layer: (name: string, clip: string, opts?: { mask?: string[]; weight?: number; mode?: string }) => void
  removeLayer: (name: string) => void
  update: (dt: number) => Array<{ name: string; cycle: number }>
  pose: () => Pose
  world: () => World
  time: () => number
  state: () => string
  seek: (s: number) => void
}
interface Engine {
  createRig: (input: unknown) => Rig
  restPose: (rig: Rig) => Pose
  forwardKinematics: (rig: Rig, pose: Pose) => World
  solveIK: (rig: Rig, pose: Pose, boneId: string, target: Vec, options?: { maxBones?: number; iterations?: number; tolerance?: number }) => { distance: number; reached: boolean; world: World }
  socketTransform: (rig: Rig, world: World, id: string) => Vec & { angle: number }
  createClip: (spec: unknown) => unknown
  sampleClip: (rig: Rig, clip: unknown, time: number) => Pose
  createAnimator: (rig: Rig, clips: unknown[], initial: string, onEvent?: (evt: { name: string }) => void) => Animated
  createSpring: (options?: { value?: number; stiffness?: number; damping?: number }) => { update: (target: number, dt: number) => number; reset: (v?: number) => void }
  drawSprites: (ctx: object, rig: Rig, pose: Pose, skins: object, attachments?: object, options?: object) => World
  drawDebug: (ctx: object, rig: Rig, pose: Pose) => World
  spriteFrame: (frames: unknown[], fps: number, seconds: number, loop?: boolean) => unknown
}
const engine = runInNewContext(engineSource + '\nPhoenixArticulation;', {}) as Engine
const rig = engine.createRig({
  bones: [
    { id: 'hand', parent: 'forearm', length: 5, minAngle: -0.8, maxAngle: 0.8, depth: 2 },
    { id: 'forearm', parent: 'arm', length: 15, minAngle: -2, maxAngle: 2, depth: 1 },
    { id: 'arm', length: 20, angle: 0.1, minAngle: -Math.PI, maxAngle: Math.PI },
  ],
  sockets: [{ id: 'muzzle', bone: 'hand', x: 5, y: 0, angle: 0.1 }],
})
const wave = {
  id: 'wave', duration: 1,
  tracks: {
    arm: [{ time: 0, angle: 0 }, { time: 0.5, angle: 1.2, ease: 'smooth' }, { time: 1, angle: 0 }],
    forearm: [{ time: 0, angle: 0 }, { time: 0.5, angle: -0.4 }, { time: 1, angle: 0 }],
  },
  events: [{ time: 0.3, name: 'swing' }],
}
const rest = { id: 'rest', duration: 1, tracks: { arm: [{ time: 0, angle: 0 }] } }
const aim = { id: 'aim', duration: 1, tracks: { forearm: [{ time: 0, angle: 0.8 }] } }

describe('Phoenix Articulation Engine - deterministic 2D core', () => {
  it('sorts parent-first, honors transforms and guarantees fresh pose objects', () => {
    expect(rig.bones.map(b => b.id)).toEqual(['arm', 'forearm', 'hand'])
    const p = engine.restPose(rig)
    const origin = engine.forwardKinematics(rig, p)
    expect(origin.arm!.start).toEqual({ x: 0, y: 0 })
    expect(Math.hypot(origin.hand!.end.x, origin.hand!.end.y)).toBeCloseTo(40, 5)
    p.root.x = 10
    expect(engine.forwardKinematics(rig, p).arm!.start.x).toBe(10)
    expect(engine.restPose(rig).root.x).toBe(0)
  })

  it('rejects cycles, invalid lengths, duplicate ids and unknown socket bones', () => {
    expect(() => engine.createRig({ bones: [{ id: 'a', parent: 'b', length: 1 },
      { id: 'b', parent: 'a', length: 1 }] })).toThrow('cyclic')
    expect(() => engine.createRig({ bones: [{ id: 'a', length: -1 }] })).toThrow('invalid bone length')
    expect(() => engine.createRig({ bones: [{ id: 'a', length: 1 }, { id: 'a', length: 2 }] })).toThrow('duplicate')
    expect(() => engine.createRig({ bones: [{ id: 'a', length: 1 }],
      sockets: [{ id: 'bad', bone: 'missing' }] })).toThrow('socket')
  })

  it('moves 3 articulated joints toward a reachable IK target', () => {
    const pose = engine.restPose(rig)
    const result = engine.solveIK(rig, pose, 'hand', { x: 16, y: 31 },
      { iterations: 64, maxBones: 3, tolerance: .8 })
    expect(result.reached).toBe(true)
    expect(result.distance).toBeLessThan(0.8)
    expect(pose.angles.hand).toBeGreaterThanOrEqual(-0.8)
    expect(pose.angles.hand).toBeLessThanOrEqual(0.8)
  })

  it('never violates joint limits or creates NaN for unreachable targets', () => {
    const pose = engine.restPose(rig)
    const result = engine.solveIK(rig, pose, 'hand', { x: 5000, y: 5000 })
    expect(result.reached).toBe(false)
    for (const name of ['arm', 'forearm', 'hand']) {
      expect(Number.isFinite(pose.angles[name])).toBe(true)
      expect(Number.isFinite(result.world[name]!.end.x)).toBe(true)
    }
    expect(pose.angles.hand).toBeLessThanOrEqual(0.8)
  })

  it('interpolates keyframes, loops without corrupting clips, and validates malformed frames', () => {
    const clip = engine.createClip(wave)
    expect(engine.sampleClip(rig, clip, 0.25).angles.arm!).toBeGreaterThan(0.4)
    expect(engine.sampleClip(rig, clip, 1.25).angles.arm!).toBeCloseTo(
      engine.sampleClip(rig, clip, 0.25).angles.arm!, 5)
    expect(() => engine.createClip({ id: 'bad', duration: 1,
      tracks: { arm: [{ time: 2, angle: 0 }] } })).toThrow('keyframe')
    expect(() => engine.sampleClip(rig, engine.createClip({
      id: 'wrong', duration: 1, tracks: { phantom: [{ time: 0, angle: 1 }] },
    }), .3)).toThrow('unknown bone')
  })

  it('crossfades without snapping and blends an arm-only overlay', () => {
    const actor = engine.createAnimator(rig, [rest, wave, aim], 'rest')
    actor.play('wave', { fade: .4 })
    expect(actor.pose().angles.arm).toBeCloseTo(0)
    actor.update(.2)
    expect(actor.pose().angles.arm).toBeGreaterThan(0)
    actor.layer('aim-upper', 'aim', { mask: ['forearm'], weight: .5 })
    expect(actor.pose().angles.forearm).toBeGreaterThan(0)
    actor.removeLayer('aim-upper')
    expect(actor.pose().angles.forearm).toBeLessThanOrEqual(0)
    actor.update(.25)
    expect(actor.state()).toBe('wave')
  })

  it('fires timeline events on entry, repeated cycles and masked layers', () => {
    const listener = vi.fn()
    const actor = engine.createAnimator(rig, [wave, aim], 'wave', listener)
    expect(actor.update(.4).map(evt => evt.name)).toEqual(['swing'])
    actor.update(.9)
    expect(listener).toHaveBeenCalledTimes(2)
    actor.layer('extra', 'wave', { mask: ['arm'], mode: 'additive', weight: .5 })
    actor.update(.5)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('anchors attached weapons to the rotating wrist in world coordinates', () => {
    const pose = engine.restPose(rig)
    const original = engine.socketTransform(rig, engine.forwardKinematics(rig, pose), 'muzzle')
    pose.angles.arm = Math.PI / 2
    const turned = engine.socketTransform(rig, engine.forwardKinematics(rig, pose), 'muzzle')
    expect(turned.x).not.toBeCloseTo(original.x)
    expect(turned.y).not.toBeCloseTo(original.y)
    expect(turned.angle).toBeGreaterThan(original.angle)
  })

  it('renders ordered sprite skins and attachments via world transforms', () => {
    let draws = 0, transforms = 0
    const noop = (): void => {}
    const ctx = { save: noop, restore: noop, translate: () => { transforms++ },
      rotate: noop, drawImage: () => { draws++ } }
    engine.drawSprites(ctx, rig, engine.restPose(rig), {
      arm: { image: { width: 24, height: 12 }, width: 20, height: 12 },
      hand: { draw: () => { draws++ } },
    }, { muzzle: { image: { width: 9, height: 6 } } })
    expect(draws).toBe(3)
    expect(transforms).toBe(3)
  })

  it('selects imported sprite-atlas cells by time and skeletal state', () => {
    const frames = [{ x: 0, y: 0, width: 16, height: 16 }, { x: 16, y: 0, width: 16, height: 16 }]
    expect(engine.spriteFrame(frames, 10, .01)).toEqual(frames[0])
    expect(engine.spriteFrame(frames, 10, .15)).toEqual(frames[1])
    expect(engine.spriteFrame(frames, 10, .21)).toEqual(frames[0])
    expect(engine.spriteFrame(frames, 10, .21, false)).toEqual(frames[1])
    let cropX = -1
    const noop = (): void => {}
    const ctx = { save: noop, restore: noop, translate: noop, rotate: noop,
      drawImage: (_image: unknown, x: number) => { cropX = x } }
    engine.drawSprites(ctx, rig, engine.restPose(rig), {
      arm: { image: { width: 32, height: 16 }, fps: 10,
        states: { attack: frames, idle: [frames[0]] }, height: 16 },
    }, {}, { state: 'attack', seconds: .15 })
    expect(cropX).toBe(16)
  })

  it('uses stable bounded spring substeps for recoil and secondary motion', () => {
    const spring = engine.createSpring({ value: 0, stiffness: 170, damping: 29 })
    for (let n = 0; n < 120; n++) spring.update(10, 1 / 60)
    expect(spring.update(10, 1 / 60)).toBeCloseTo(10, 1)
    spring.reset(0)
    expect(spring.update(0, 0)).toBe(0)
  })

  it('rejects invalid frame steps and states instead of silently corrupting animation', () => {
    const actor = engine.createAnimator(rig, [rest], 'rest')
    expect(() => actor.update(-1)).toThrow('invalid animation delta')
    expect(() => actor.update(2)).toThrow('invalid animation delta')
    expect(() => actor.play('missing')).toThrow('unknown state')
    expect(() => actor.layer('unknown', 'rest', { mask: ['ghost'] })).toThrow('unknown layer mask')
  })
})
