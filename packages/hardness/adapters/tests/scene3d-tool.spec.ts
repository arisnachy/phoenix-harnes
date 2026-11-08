import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createPhoenix3DTool, PHOENIX_SCENE3D_MIME } from '../src/scene3d-tool.ts'

function execution(onConclude: () => void = () => {}): ToolRunContext {
  const callId = CallId('scene-1')
  return { callId, rootCallId:callId, name:'phoenix_3d', arguments:{},
    token:Symbol('scene') as never, signal:new AbortController().signal,
    deferContext:()=>{}, concludeTurn:onConclude }
}
describe('phoenix_3d actual geometry tool',()=>{
  it('creates a real 3D villa concept without invoking image generation',async()=>{
    const tool=createPhoenix3DTool()
    const done=vi.fn()
    const args={title:'Villa tropical giratoria',demo:true}
    const value=await tool.execute(args,execution(done)) as {
      artifactId:string;title:string;scene:{version:number;units:string;nodes:unknown[]}
    }
    expect(value.artifactId).toBe('phoenix-3d:scene-1')
    expect(value.scene.version).toBe(1)
    expect(value.scene.units).toBe('meters')
    expect(value.scene.nodes.length).toBeGreaterThan(30)
    expect(value.scene.nodes).not.toContain('image/png')
    expect(done).toHaveBeenCalledOnce()
    expect(tool.output.presentationMeta?.(args,value as never)).toMatchObject({
      artifact:{id:value.artifactId,mime:PHOENIX_SCENE3D_MIME,executable:false,
        data:{nodes:expect.any(Array),version:1}},
    })
  })
  it('accepts original portable geometry and rejects malformed or malicious scene entries',async()=>{
    const tool=createPhoenix3DTool()
    const scene={name:'Casa',nodes:[{type:'box',position:[0,2,0],size:[5,4,6],
      rotation:[0,30,0],color:'#dbc4a0'}]}
    const result=await tool.execute({title:'Casa',scene},execution()) as {
      scene:{nodes:Array<{type:string;position:number[]}>}
    }
    expect(result.scene.nodes).toHaveLength(1)
    expect(result.scene.nodes[0]?.position).toEqual([0,2,0])
    for(const invalid of [
      {nodes:[]},
      {nodes:[{type:'html',position:[0,0,0],size:[1,1,1],color:'#ffffff'}]},
      {nodes:[{type:'box',position:[NaN,0,0],size:[1,1,1],color:'#ffffff'}]},
      {nodes:[{type:'box',position:[0,0,0],size:[1,1,1],color:'url(https://example.com)'}]},
    ]){
      await expect(tool.execute({title:'Invalido',scene:invalid},execution())).rejects.toThrow()
    }
  })
  it('rejects primitive anatomical scenes and redirects to image generation',async()=>{
    const tool=createPhoenix3DTool()
    const part={type:'sphere',name:'Parte',position:[0,0,0],size:[1,1,1],color:'#bb2244'}
    for(const args of [
      {title:'Gemelo digital anatómico del corazón',scene:{nodes:[part]}},
      {title:'Riñones 3D',scene:{nodes:[part]}},
      {title:'Proyecto visual',subject:'human brain anatomical visualization',scene:{nodes:[part]}},
      {title:'Objeto genérico',scene:{name:'Órganos humanos',nodes:[part]}},
      {title:'Objeto genérico',scene:{nodes:[{...part,name:'Corazón 3D'}]}},
    ]){
      await expect(tool.execute(args,execution())).rejects.toThrow(/image_generation/u)
    }
    expect(tool.description).toContain('backend=auto')
  })
  it('generates an anatomical pelican instead of silently rendering a box', async () => {
    const tool = createPhoenix3DTool()
    const result = await tool.execute({ title: 'Pelícano en 3D', preset: 'pelican' }, execution()) as {
      scene: { nodes: Array<{ type: string; name: string; vertices?: number[] }> }
    }
    const nodes = result.scene.nodes
    expect(nodes.length).toBeGreaterThanOrEqual(20)
    expect(nodes.some(node => node.type === 'box')).toBe(false)
    expect(nodes.some(node => node.type === 'mesh' && (node.vertices?.length ?? 0) > 100)).toBe(true)
    const names = nodes.map(node => node.name.toLowerCase()).join(' ')
    for (const feature of ['pico', 'bolsa', 'cuello', 'cabeza', 'ala', 'ojo', 'pie']) {
      expect(names).toContain(feature)
    }
    for (const node of nodes.filter(node => node.type === 'mesh')) {
      expect((node.vertices?.length ?? 0) % 9).toBe(0)
      expect(node.vertices?.every(Number.isFinite)).toBe(true)
    }
  })
  it('repairs the reported pelican-as-box failure without accepting generic organic cubes', async () => {
    const tool = createPhoenix3DTool()
    const cube = { nodes: [{ type: 'box', position: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] }
    const result = await tool.execute({ title: 'Pelicano 3D', scene: cube }, execution()) as {
      scene: { nodes: Array<{ type: string; name: string }> }
    }
    expect(result.scene.nodes.length).toBeGreaterThan(20)
    expect(result.scene.nodes.some(node => node.name.includes('Pico largo'))).toBe(true)
    await expect(tool.execute({ title: 'Animal 3D', subject: 'animal', scene: cube }, execution()))
      .rejects.toThrow(/Modelo orgánico insuficiente/u)
  })
  it('passes real triangle meshes from generator to the existing 3D viewer contract', async () => {
    const tool = createPhoenix3DTool()
    const triangle = { nodes: [{ type: 'mesh', name: 'Ala',
      position: [0, 1, 0], size: [1, 1, 1], color: '#ffffff',
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] }
    const result = await tool.execute({ title: 'Ala en malla', scene: triangle }, execution()) as {
      scene: { nodes: Array<{ type: string; vertices?: number[] }> }
    }
    expect(result.scene.nodes[0]?.type).toBe('mesh')
    expect(result.scene.nodes[0]?.vertices).toEqual(triangle.nodes[0]?.vertices)
    for (const vertices of [[0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, NaN, 1, 0], [0, 1, 0]]) {
      await expect(tool.execute({
        title: 'Malla inválida', scene: { nodes: [{ ...triangle.nodes[0], vertices }] },
      }, execution())).rejects.toThrow()
    }
  })
  it('preserves every object when an animal interacts with a bicycle and environment',async()=>{
    const tool=createPhoenix3DTool()
    const nodes=[
      {type:'sphere',name:'Pelícano cuerpo',objectId:'pelican',position:[0,2,0],size:[1,1,1],color:'#eeeeee'},
      {type:'torus',name:'Bicicleta rueda delantera',objectId:'bicycle',position:[1,.5,0],size:[1,.1,1],rotation:[90,0,0],color:'#111111'},
      {type:'torus',name:'Bicicleta rueda trasera',objectId:'bicycle',position:[-1,.5,0],size:[1,.1,1],rotation:[90,0,0],color:'#111111'},
      {type:'box',name:'Sendero',objectId:'park',position:[0,-.2,0],size:[7,.2,4],color:'#999999'},
    ]
    const result=await tool.execute({title:'Pelícano en bicicleta en un parque',
      scene:{nodes},requiredObjects:['pelican','bicycle','park']},execution()) as {
        scene:{nodes:Array<{type:string;objectId?:string}>}
      }
    expect(result.scene.nodes).toHaveLength(nodes.length)
    expect(result.scene.nodes.filter(node=>node.type==='torus')).toHaveLength(2)
    expect(result.scene.nodes.some(node=>node.objectId==='park')).toBe(true)
    await expect(tool.execute({title:'Bicicleta con entorno',
      scene:{nodes},requiredObjects:['pelican','bicycle','forest']},execution()))
      .rejects.toThrow(/Faltan objetos esenciales/)
  })
  it('never replaces a missing bicycle with the standalone pelican preset', async () => {
    const tool = createPhoenix3DTool()
    const title = 'Pelícano en bicicleta en un parque'
    await expect(tool.execute({ title, preset: 'pelican' }, execution()))
      .rejects.toThrow(/nodes/u)
    await expect(tool.execute({ title, scene: { nodes: [{
      type: 'box', name: 'Bicicleta', position: [0,0,0], size: [1,1,1], color: '#ffffff',
    }] } }, execution())).rejects.toThrow(/Escena compuesta insuficiente/u)
  })
  it('validates general-purpose animation tracks with named parts and bounded keyframes',async()=>{
    const tool=createPhoenix3DTool()
    const scene={nodes:[{type:'torus',name:'Rueda delantera',position:[0,1,0],size:[1,.1,1],
      color:'#111111'}],animations:[{name:'Pedaleo',duration:2,loop:true,tracks:[{
      node:'Rueda delantera',property:'rotation',keys:[
        {time:0,value:[90,0,0]},{time:1,value:[90,0,180]},{time:2,value:[90,0,360]},
      ],
    }]}]}
    const result=await tool.execute({title:'Bicicleta animada',scene},execution()) as {
      scene:{animations:Array<{tracks:unknown[]}>}
    }
    expect(result.scene.animations).toHaveLength(1)
    expect(result.scene.animations[0]?.tracks).toHaveLength(1)
    await expect(tool.execute({title:'Animación inválida',scene:{
      ...scene,animations:[{...scene.animations[0],tracks:[
        {...scene.animations[0]!.tracks[0],node:'Objeto inexistente'},
      ]}],
    }},execution())).rejects.toThrow(/nombre único/)
  })
  it('keeps subsequent app-building work only on explicit request',async()=>{
    const done=vi.fn()
    await createPhoenix3DTool().execute({
      title:'Modelo que se usará en una app',demo:true,continueAfterDisplay:true,
    },execution(done))
    expect(done).not.toHaveBeenCalled()
  })
  it('advertises 3D geometry instead of raster images or misleading exact CAD',()=>{
    const tool=createPhoenix3DTool()
    expect(tool.name).toBe('phoenix_3d')
    expect(tool.description).toContain('not image_generation')
    expect(tool.description).toContain('NOT claim exact photo-to-CAD')
    expect(tool.description).toContain('Phoenix apps')
  })
})
