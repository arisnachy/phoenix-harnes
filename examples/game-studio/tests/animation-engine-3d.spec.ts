import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'examples/game-studio/animation-engine-3d.js'), 'utf8')
interface Rig {
  bones: Array<{ id: string; parent: string | null }>
  index: Record<string, { id: string }>
}
type Pose = { root: { position: number[]; rotation: number[] }; rotations: Record<string, number[]> }
interface Engine3D {
  createRig: (input: unknown) => Rig
  restPose: (rig: Rig) => Pose
  fk: (rig: Rig, pose: Pose) => Record<string, { position: number[]; tip: number[]; rotation: number[] }>
  ik: (rig: Rig, pose: Pose, id: string, target: number[], opts?: { tolerance?: number; maxBones?: number; iterations?: number }) => {
    reached: boolean; distance: number
  }
  socket: (rig: Rig, world: object, id: string) => { position: number[]; rotation: number[] }
  clip: (input: unknown) => unknown
  sample: (rig: Rig, clip: unknown, s: number) => Pose
  blend: (rig: Rig, from: Pose, to: Pose, t: number, mask?: Set<string>) => Pose
  createAnimator: (rig: Rig, clips: unknown[], initial: string, listener?: (evt: { name: string }) => void) => {
    play: (id: string, opts?: { fade?: number }) => void
    layer: (name: string, clip: string, opts?: { mask?: string[]; weight?: number }) => void
    update: (dt: number) => void; pose: () => Pose
  }
  retarget: (src: Rig, dest: Rig, pose: Pose, mapping?: Record<string, string>, scale?: number) => Pose
  applyToThree: (rig: Rig, pose: Pose, lookup: object, root?: object) => void
  quaternion: { slerp: (a: number[], b: number[], t: number) => number[];
    axisAngle: (axis: number[], angle: number) => number[]; rotate: (p: number[], q: number[]) => number[] }
}
const E = runInNewContext(source + '\nPhoenixArticulation3D;', {}) as Engine3D
const rig = E.createRig({ bones: [
  { id: 'finger', parent: 'forearm', length: .25 },
  { id: 'forearm', parent: 'arm', length: 1.2 },
  { id: 'arm', length: 1.8, axis: [0, 1, 0] },
], sockets: [{ id: 'gun', bone: 'finger', position: [0, .25, 0] }] })
const q = (angle: number): number[] => E.quaternion.axisAngle([0, 0, 1], angle)

describe('Phoenix Articulation 3D quaternion core', () => {
  it('sorts complex skeleton hierarchies and rejects cyclic topology', () => {
    expect(rig.bones.map(b => b.id)).toEqual(['arm', 'forearm', 'finger'])
    const p = E.restPose(rig)
    expect(E.fk(rig, p).finger.tip[1]).toBeCloseTo(3.25)
    expect(() => E.createRig({ bones: [
      { id: 'a', parent: 'b', length: 1 }, { id: 'b', parent: 'a', length: 1 },
    ] })).toThrow('cyclic')
  })

  it('solves 3D CCD reaching in the XY plane without degeneracy', () => {
    const p = E.restPose(rig)
    const result = E.ik(rig, p, 'finger', [1.3, 2.4, .5],
      { maxBones: 3, iterations: 75, tolerance: .03 })
    expect(result.reached).toBe(true)
    expect(result.distance).toBeLessThan(.03)
  })

  it('rotates a socket with the bone without detaching a weapon', () => {
    const pose = E.restPose(rig)
    const before = E.socket(rig, E.fk(rig, pose), 'gun')
    pose.rotations.arm = q(Math.PI / 2)
    const after = E.socket(rig, E.fk(rig, pose), 'gun')
    expect(after.position[0]).toBeLessThan(before.position[0])
    expect(after.position[1]).toBeLessThan(before.position[1])
  })

  it('slerps normalized orientations across clips and masked blends', () => {
    const clip = E.clip({ id: 'raise', duration: 1, tracks: {
      arm: [{ time: 0, rotation: q(0) }, { time: 1, rotation: q(Math.PI / 2) }],
    } })
    const middle = E.sample(rig, clip, .5)
    const length = Math.hypot(...middle.rotations.arm)
    expect(length).toBeCloseTo(1, 6)
    expect(middle.rotations.arm[2]).toBeCloseTo(Math.sin(Math.PI / 8))
    const rest = E.restPose(rig)
    const masked = E.blend(rig, rest, middle, 1, new Set(['arm']))
    expect(masked.rotations.arm[2]).toBeCloseTo(middle.rotations.arm[2])
    expect(masked.rotations.forearm).toEqual([0, 0, 0, 1])
  })

  it('retargets skeleton bones by map and scales root movement', () => {
    const dest = E.createRig({ bones: [
      { id: 'shoulder', length: 5 }, { id: 'elbow', parent: 'shoulder', length: 3 },
    ] })
    const sourcePose = E.restPose(rig)
    sourcePose.root.position = [2, 0, 0]
    sourcePose.rotations.arm = q(.6)
    const output = E.retarget(rig, dest, sourcePose,
      { shoulder: 'arm', elbow: 'forearm' }, 2)
    expect(output.root.position[0]).toBe(4)
    expect(output.rotations.shoulder[2]).toBeCloseTo(q(.6)[2] ?? 0)
  })

  it('integrates with compatible Three.js-like bone objects without requiring an import', () => {
    const node = { quaternion: { set: vi.fn() } }
    const root = { position: { set: vi.fn() }, quaternion: { set: vi.fn() } }
    E.applyToThree(rig, E.restPose(rig), { arm: node }, root)
    expect(node.quaternion.set).toHaveBeenCalledWith(0, 0, 0, 1)
    expect(root.position.set).toHaveBeenCalledWith(0, 0, 0)
  })

  it('animates transitions and overlays with deterministic clip state', () => {
    const rest = { id: 'rest', duration: 1, tracks: { arm: [{ time: 0, rotation: q(0) }] } }
    const turn = { id: 'turn', duration: 1, tracks: {
      arm: [{ time: 0, rotation: q(0) }, { time: .5, rotation: q(.7) }],
    }, events: [{ time: .2, name: 'footstep' }] }
    const listener = vi.fn()
    const actor = E.createAnimator(rig, [rest, turn], 'rest', listener)
    actor.play('turn', { fade: .2 })
    actor.update(.3)
    expect(actor.pose().rotations.arm[2]).toBeGreaterThan(0)
    actor.layer('upper', 'turn', { mask: ['arm'], weight: .4 })
    actor.update(.2)
    expect(listener).toHaveBeenCalled()
    expect(() => actor.update(-.1)).toThrow('invalid delta')
  })
})
