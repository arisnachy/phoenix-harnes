// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene3DView, parseScene3D, sceneCharacterFacingYaw } from '../src/client/chat/Scene3DView.tsx'
import { poseScene3D } from '../src/client/chat/scene3d-animation.ts'
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
  it('exposes native GLB/glTF workflows, camera/lighting and editable materials',()=>{
    const ctx={setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),
      lineTo:vi.fn(),stroke:vi.fn(),closePath:vi.fn(),fill:vi.fn()} as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
    render(<Scene3DView spec={scene}/>)
    expect(screen.getByRole('button',{name:'Exportar GLB'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Exportar glTF'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Importar 3D'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Isométrica'}))
    fireEvent.change(screen.getByLabelText('Iluminación del modelo 3D'),{target:{value:'sunset'}})
    fireEvent.click(screen.getByRole('button',{name:'Editar'}))
    expect(screen.getByLabelText('Seleccionar pieza 3D')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'glass'}))
    fireEvent.click(screen.getByRole('button',{name:'Duplicar'}))
    expect(document.querySelector('[data-scene-node-count="3"]')).toBeTruthy()
    expect(ctx.fill).toHaveBeenCalled()
  })
  it('interpolates arbitrary object keyframes, preserving background and other scene pieces',()=>{
    const animated=parseScene3D({
      version:1,units:'meters',name:'Pelícano en bicicleta',background:'#f9f3eb',
      nodes:[{type:'torus',name:'Rueda',objectId:'bike',position:[1,1,0],size:[1,.1,1],color:'#222222'},
        {type:'sphere',name:'Pelícano',objectId:'bird',position:[0,2,0],size:[1,1,1],color:'#ffffff'}],
      animations:[{name:'Pedalear',duration:2,loop:true,tracks:[{node:'Rueda',property:'rotation',
        keys:[{time:0,value:[90,0,0]},{time:2,value:[90,0,360]}]}]}],
    })
    expect(animated).toBeDefined()
    const mid=poseScene3D(animated!,animated!.animations![0]!,1)
    expect(mid.nodes[0]?.rotation).toEqual([90,0,180])
    expect(mid.nodes[1]?.position).toEqual([0,2,0])
    expect(mid.nodes[0]?.objectId).toBe('bike')
    expect(poseScene3D(animated!,animated!.animations![0]!,2).nodes[0]?.rotation).toEqual([90,0,0])
    expect(parseScene3D({...animated,animations:[{
      name:'Mal',duration:2,loop:true,tracks:[{node:'No existe',
        property:'rotation',keys:[{time:0,value:[0,0,0]},{time:2,value:[1,1,1]}]}],
    }]})).toBeUndefined()
  })
  it('aims character front view toward face landmarks instead of an arbitrary world axis',()=>{
    const character=parseScene3D({
      version:1,units:'meters',name:'Personaje de prueba',background:'#eeeeee',camera:'front',
      nodes:[
        {type:'sphere',name:'Cabeza',position:[0,2,0],size:[1,1,1],color:'#c2a183'},
        {type:'sphere',name:'Ojo izquierdo',position:[.48,2.08,-.15],size:[.12,.1,.1],color:'#111111'},
        {type:'sphere',name:'Ojo derecho',position:[.48,2.08,.15],size:[.12,.1,.1],color:'#111111'},
        {type:'box',name:'Torso',position:[0,.8,0],size:[1,1,1],color:'#d02525'},
      ],
    })
    expect(character).toBeDefined()
    expect(sceneCharacterFacingYaw(character!)).toBeCloseTo(Math.PI/2,4)
    expect(sceneCharacterFacingYaw(parseScene3D(scene)!)).toBeUndefined()
    const ctx={setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),
      lineTo:vi.fn(),stroke:vi.fn(),closePath:vi.fn(),fill:vi.fn()} as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
    render(<Scene3DView spec={character}/>)
    fireEvent.click(screen.getByRole('button',{name:'Frente'}))
    fireEvent.click(screen.getByRole('button',{name:'Restablecer'}))
    expect(ctx.fill).toHaveBeenCalled()
  })
  it('shows an actionable validation error rather than pretending invalid geometry is a scene',()=>{
    render(<Scene3DView spec={{version:1,units:'meters',nodes:[]}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/geometría válida/u)
  })
})
