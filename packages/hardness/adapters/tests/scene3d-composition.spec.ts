import { describe, expect, it } from 'vitest'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import {
  auditScene3DComposition, parseScene3DCompositionContract,
} from '../src/scene3d-composition.ts'
import { createPhoenix3DTool } from '../src/scene3d-tool.ts'

function execution(): ToolRunContext {
  const callId = CallId('scene-universal')
  return { callId, rootCallId:callId, name:'phoenix_3d', arguments:{},
    token:Symbol('scene') as never, signal:new AbortController().signal,
    deferContext:()=>{}, concludeTurn:()=>{} }
}
const nodes = [
  { type:'sphere',objectId:'creature',name:'Cuerpo de criatura imaginaria',
    position:[0,2,0],size:[1,2,1],color:'#fafafa' },
  { type:'box',objectId:'vehicle',name:'Cabina',position:[0,.75,0],
    size:[2,.5,1],color:'#b4c3c8' },
  { type:'torus',objectId:'vehicle',name:'Rueda',position:[1,.5,0],
    size:[1,1,.2],color:'#222222' },
  { type:'box',objectId:'world',name:'Suelo',position:[0,-.2,0],
    size:[12,.4,10],color:'#557755' },
] as const
const requirements={
  objects:[{id:'creature',minParts:1},{id:'vehicle',minParts:2,animated:true},{id:'world',minParts:1}],
  relations:[{from:'creature',to:'vehicle',relation:'on',tolerance:.2},
    {from:'vehicle',to:'world',relation:'near',tolerance:1}],
}
const animations = [{ name:'Movimiento',duration:2,loop:true,
  tracks:[{ node:'Rueda',property:'rotation',
    keys:[{time:0,value:[0,0,0]},{time:2,value:[0,0,360]}] }] }]

describe('universal scene graph regardless of category',()=>{
  it('checks arbitrary imagined creature, machinery and landscape together',async()=>{
    const tool=createPhoenix3DTool()
    const result=await tool.execute({
      title:'Criatura fantástica sobre una máquina en un entorno 3D',
      scene:{nodes,animations,environment:'daylight'},
      compositionContract:requirements,
    },execution()) as {qualityReport:{composition:{passed:boolean;checks:number}}}
    expect(result.qualityReport.composition).toMatchObject({passed:true,checks:5})
  })
  it('rejects an incomplete, floating or static scene rather than presenting it as perfect',async()=>{
    const tool=createPhoenix3DTool()
    await expect(tool.execute({
      title:'Mundo de fantasía 3D',scene:{nodes:nodes.slice(0,3),animations},
      compositionContract:requirements,
    },execution())).rejects.toThrow(/Falta el objeto obligatorio world/u)
    await expect(tool.execute({
      title:'Criatura en máquina 3D',scene:{nodes:[
        {...nodes[0],position:[0,8,0]},...nodes.slice(1),
      ],animations},compositionContract:requirements,
    },execution())).rejects.toThrow(/Relación espacial incumplida/u)
    await expect(tool.execute({
      title:'Vehículo 3D animado',scene:{nodes},
      compositionContract:requirements,
    },execution())).rejects.toThrow(/animación verificable/u)
    await expect(tool.execute({
      title:'Vehículo incompleto 3D',scene:{nodes:nodes.filter(node=>node.name!=='Rueda')},
      compositionContract:requirements,
    },execution())).rejects.toThrow(/necesita 2 piezas/u)
  })
  it('validates and bounds object graphs and rejects invented relation identifiers',()=>{
    for(const invalid of [
      {objects:[]},
      {objects:[{id:'thing'},{id:'thing'}]},
      {objects:[{id:'thing',minParts:0}]},
      {objects:[{id:'thing',animated:'yes'}]},
      {objects:[{id:'thing'}],relations:[{from:'thing',to:'absent',relation:'on'}]},
      {objects:[{id:'thing'},{id:'other'}],relations:[
        {from:'thing',to:'other',relation:'flavored-like'}]},
      {objects:[{id:'thing'},{id:'other'}],relations:[
        {from:'thing',to:'other',relation:'near',tolerance:Infinity}]},
    ])expect(()=>parseScene3DCompositionContract(invalid)).toThrow()
  })
  it('checks exact minimum mesh detail and semantic part count independently of subject',()=>{
    const contract=parseScene3DCompositionContract({objects:[
      {id:'imagined-entity',minParts:2,minTriangles:2},
    ]})
    const audit=auditScene3DComposition({nodes:[
      {type:'mesh',name:'surface',objectId:'imagined-entity',
        position:[0,0,0],size:[1,1,1],
        vertices:[0,0,0,1,0,0,0,1,0]},
      {type:'box',objectId:'imagined-entity',position:[0,0,0],size:[1,1,1]},
    ]},contract)
    expect(audit.passed).toBe(false)
    expect(audit.errors[0]).toContain('2 triángulos')
  })
})
