import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'examples/game-studio/animation-engine.js'), 'utf8')
  + '\n' + readFileSync(resolve(process.cwd(), 'examples/game-studio/rigged-art.js'), 'utf8')
type Renderer = { update: (dt: number) => unknown; play: (state: string) => void;
  draw: (ctx: object, x: number, y: number, face?: number, options?: object) => unknown;
  socket: (name: string, origin?: { x: number; y: number }, face?: number) => { x: number; y: number };
  state: string; animationMode: string }
interface Runtime {
  PhoenixArticulation: object
  PhoenixRiggedArt: {
    actor: (params: object) => Renderer
    frameSource: (w: number, h: number, cw: number, ch: number, frame: number) => object
    validateAtlas: (img: object, art: object) => object
  }
}
const runtime = runInNewContext(source + '\n({ PhoenixArticulation, PhoenixRiggedArt });', {}) as Runtime
const image = { width: 64, height: 64, naturalWidth: 64, naturalHeight: 64 }
const rig = { bones: [
  { id: 'arm', length: 20, angle: 0 },
  { id: 'hand', parent: 'arm', length: 12, angle: 0 },
], sockets: [{ id: 'weapon', bone: 'hand', x: 12 }] }
const clips = [
  { id: 'idle', duration: 1, tracks: { arm: [{ time: 0, angle: 0 }] } },
  { id: 'run', duration: 1, tracks: { arm: [
    { time: 0, angle: 0 }, { time: .5, angle: .7 }, { time: 1, angle: 0 },
  ] } },
]
function canvas() {
  const calls: number[][] = []
  const noop = (): void => {}
  const ctx = {
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    drawImage: (_image: unknown, ...args: number[]) => { calls.push(args) },
  }
  return { ctx, calls }
}

describe('Phoenix Game Studio authored sprites to articulated actors', () => {
  it('draws the approved original flipbook atlas with actual changing sprite cells', () => {
    const art = {
      imageId: 'hero-art', frameWidth: 16, frameHeight: 16, fps: 8,
      animations: { idle: [0, 1], run: [2, 3, 4, 5] },
    }
    const actor = runtime.PhoenixRiggedArt.actor({
      engine: runtime.PhoenixArticulation, image, art, rig, clips, initial: 'idle',
    })
    const { ctx, calls } = canvas()
    actor.draw(ctx, 20, 20)
    expect(calls[0]?.slice(0, 4)).toEqual([0, 0, 16, 16])
    actor.play('run'); actor.update(.17)
    actor.draw(ctx, 40, 20)
    expect(calls[1]?.slice(0, 4)).toEqual([48, 0, 16, 16])
    expect(actor.state).toBe('run')
    expect(actor.animationMode).toBe('flipbook')
  })

  it('draws independent authored PNG cutouts following FK bones and attached weapon sockets', () => {
    const part = (one: number, two: number) => ({
      width: 20, height: 16, pivotX: 0, pivotY: 8, fps: 8,
      states: { idle: [one], run: [one, two] },
    })
    const art = {
      imageId: 'hero-art', frameWidth: 16, frameHeight: 16,
      animationMode: 'skeletal',
      parts: { arm: part(1, 2), hand: part(3, 4) },
    }
    const actor = runtime.PhoenixRiggedArt.actor({
      engine: runtime.PhoenixArticulation, image, art, rig, clips, initial: 'idle',
    })
    const { ctx, calls } = canvas()
    actor.draw(ctx, 100, 240, 1)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.slice(0, 4)).toEqual([16, 0, 16, 16])
    expect(calls[1]?.slice(0, 4)).toEqual([48, 0, 16, 16])
    const muzzle = actor.socket('weapon', { x: 100, y: 240 })
    expect(muzzle.x).toBeCloseTo(132, 5)
    actor.play('run'); actor.update(.2)
    actor.draw(ctx, 100, 240, -1, { ik: { tip: 'hand', target: { x: 18, y: 26 } } })
    expect(calls).toHaveLength(4)
    expect(calls[2]?.slice(0, 4)).toEqual([32, 0, 16, 16])
  })

  it('never silently paints placeholder rectangles when original images or bone parts are missing', () => {
    const ar = { imageId: 'hero-art', frameWidth: 16, frameHeight: 16,
      animationMode: 'skeletal', parts: { arm: { states: { idle: [0] } } } }
    expect(() => runtime.PhoenixRiggedArt.actor({
      engine: runtime.PhoenixArticulation, image, art: ar, rig, clips,
    })).toThrow('missing visible sprite art for bone hand')
    expect(() => runtime.PhoenixRiggedArt.validateAtlas({ width: 63, height: 64 },
      { frameWidth: 16, frameHeight: 16 })).toThrow('atlas grid')
    expect(() => runtime.PhoenixRiggedArt.frameSource(64, 64, 16, 16, 16))
      .toThrow('atlas frame')
  })
})
