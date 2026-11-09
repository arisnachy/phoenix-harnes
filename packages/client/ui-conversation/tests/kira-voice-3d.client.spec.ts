import {describe,expect,it} from 'vitest'
import {
  createKiraHeadGeometry,kira3dPose,kiraFaceDepth,kiraFacePoint,kiraBlinkAmount,
} from '../src/client/skeleton/kira-voice-3d-geometry.ts'
import {KIRA_VOICE_PORTRAIT} from '../src/client/skeleton/kira-voice-portrait.ts'

describe('Kira anime 3D head',()=>{
  it('renders a real indexed depth mesh rather than a 2D plane',()=>{
    const head=createKiraHeadGeometry()
    expect(head.vertices.length).toBeGreaterThan(8000)
    expect(head.indices.length).toBeGreaterThan(9000)
    expect(head.vertices.length%5).toBe(0)
    expect(head.indices.length%3).toBe(0)
    const depths:number[]=[]
    for(let i=2;i<head.vertices.length;i+=5)depths.push(head.vertices[i]!)
    expect(Math.max(...depths)-Math.min(...depths)).toBeGreaterThan(.25)
    expect(kiraFaceDepth(.61,.55)).toBeGreaterThan(kiraFaceDepth(.05,.05))
  })
  it('keeps facial points on the same surface as 3D lip and eye meshes',()=>{
    const [x,y,z]=kiraFacePoint(.616,.693,.05)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeLessThan(0)
    expect(z).toBeGreaterThan(.2)
  })
  it('bounds head yaw, pitch, motion and pauses for accessibility',()=>{
    const poses=[0,200,1100,4900,12000].map(t=>kira3dPose(t,.8,'speaking'))
    expect(poses.some(p=>Math.abs(p.yaw)>.04)).toBe(true)
    for(const p of poses){
      expect(Math.abs(p.yaw)).toBeLessThan(.16)
      expect(Math.abs(p.pitch)).toBeLessThan(.09)
      expect(p.scale).toBeLessThan(1.06)
    }
    expect(kira3dPose(2500,1,'speaking',true))
      .toEqual({yaw:0,pitch:0,roll:0,scale:1})
  })
  it('blinks naturally without freezing eyelids shut',()=>{
    expect(kiraBlinkAmount(0)).toBe(0)
    expect(kiraBlinkAmount(2600)).toBeGreaterThan(.9)
    expect(kiraBlinkAmount(4200)).toBe(0)
    expect(kiraBlinkAmount(Infinity)).toBe(0)
  })
  it('keeps the original approved Kira anime identity as the texture',()=>{
    expect(KIRA_VOICE_PORTRAIT).toMatch(/^data:image\/webp;base64,UklGR/u)
  })
})
