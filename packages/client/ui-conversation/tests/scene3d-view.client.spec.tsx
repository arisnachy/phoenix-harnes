// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene3DView, parseScene3D } from '../src/client/chat/Scene3DView.tsx'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'
import { HardnessArtifactBody } from '../src/client/chat/HardnessArtifactBody.tsx'
import { UniversalArtifactSurface } from '../src/client/chat/UniversalArtifactSurface.tsx'

const scene={
  version:1,units:'meters',name:'Casa tropical',background:'#f9f3eb',
  nodes:[
    {type:'box',name:'Terraza',position:[0,0,0],size:[10,.5,7],color:'#ebd0ad'},
    {type:'cylinder',name:'Palmera',position:[-3,2,-2],size:[.4,4,.4],color:'#96704a'},
  ],
}
describe('Phoenix real interactive 3D artifacts',()=>{
  afterEach(()=>{cleanup();vi.restoreAllMocks()})
  it('accepts safe reusable 3D geometry and never treats it as a PNG',()=>{
    expect(parseScene3D(scene)?.nodes).toHaveLength(2)
    expect(parseScene3D({...scene,nodes:[{...scene.nodes[0],size:[0,1,1]}]})).toBeUndefined()
    expect(parseScene3D({...scene,nodes:[{...scene.nodes[0],color:'javascript:alert(1)'}]})).toBeUndefined()
    expect(normalizeHardnessArtifact({
      id:'villa',title:'Villa',mime:'application/vnd.phoenix.scene3d+json',data:scene,
    })).toMatchObject({kind:'visual',executable:false})
  })
  it('renders rotatable geometry and real orbit controls inside Phoenix, no iframe or image',()=>{
    const ctx={
      setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),
      stroke:vi.fn(),closePath:vi.fn(),fill:vi.fn(),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
    render(<HardnessArtifactBody
      mime="application/vnd.phoenix.scene3d+json" data={scene}
      title="Villa tropical" expanded={false} />)
    const viewer=document.querySelector('[data-phoenix-scene3d="interactive"]')
    expect(viewer).not.toBeNull()
    expect(viewer?.getAttribute('data-scene-node-count')).toBe('2')
    expect(screen.getByLabelText(/Modelo tridimensional manipulable/)).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Acercar modelo 3D'}))
    fireEvent.click(screen.getByRole('button',{name:'Alejar modelo 3D'}))
    fireEvent.click(screen.getByRole('button',{name:'Girar'}))
    expect(screen.getByRole('button',{name:'Pausar'}).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button',{name:'Pausar'}))
    fireEvent.click(screen.getByRole('button',{name:'Restablecer'}))
    expect(ctx.fillRect).toHaveBeenCalled()
  })
  it('opens 3D in a true expanded dialog and keeps orbit controls operational',()=>{
    const ctx={setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),
      lineTo:vi.fn(),stroke:vi.fn(),closePath:vi.fn(),fill:vi.fn()} as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
    const artifact=normalizeHardnessArtifact({
      id:'villa-3d',title:'Villa en 3D',mime:'application/vnd.phoenix.scene3d+json',data:scene,
    })
    render(<UniversalArtifactSurface artifact={artifact} onStop={vi.fn()} />)
    expect(screen.getByRole('button',{name:'Expand'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Expand'}))
    const dialog=screen.getByRole('dialog',{name:'Vista ampliada: Villa en 3D'})
    expect(dialog.querySelector('[data-phoenix-scene3d="interactive"]')).toBeTruthy()
    expect(dialog.querySelector('canvas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Acercar modelo 3D'}))
    fireEvent.click(screen.getByRole('button',{name:'Collapse'}))
    expect(screen.getByRole('button',{name:'Expand'})).toBeTruthy()
  })
  it('shows an actionable validation error rather than pretending invalid geometry is a scene',()=>{
    render(<Scene3DView spec={{version:1,units:'meters',nodes:[]}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/geometría válida/u)
  })
})
