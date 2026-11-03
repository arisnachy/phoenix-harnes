import { describe, expect, it } from 'vitest'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import {
  auditCharacterGeometry, explicitlyLowPoly3D, isHumanoidCharacterRequest,
} from '../src/scene3d-character-quality.ts'
import { requestedScene3DLevel, classifyScene3DDomain } from '../src/scene3d-quality.ts'
import { createPhoenix3DTool } from '../src/scene3d-tool.ts'

function execution(): ToolRunContext {
  const callId=CallId('character-quality')
  return {callId,rootCallId:callId,name:'phoenix_3d',arguments:{},
    token:Symbol('character') as never,signal:new AbortController().signal,
    deferContext:()=>{},concludeTurn:()=>{}}
}
const brokenCharacter = {
  nodes:[
    {type:'sphere',name:'Cabeza',position:[0,2,0],size:[.8,.9,.8],color:'#bf9172'},
    {type:'sphere',name:'Ojo izquierdo',position:[1.2,2.15,.7],size:[.12,.2,.12],color:'#ffffff'},
    {type:'sphere',name:'Nariz',position:[1.8,1.8,.8],size:[.25,.25,.25],color:'#b7906a'},
    {type:'sphere',name:'Bigote',position:[1.2,1.7,.8],size:[.3,.2,.15],color:'#3b221a'},
    {type:'box',name:'Torso',position:[0,.8,0],size:[1.2,1.3,.6],color:'#d32332'},
    {type:'cylinder',name:'Brazo izquierdo',position:[-.8,.7,0],size:[.2,1,.2],color:'#c72333'},
    {type:'cylinder',name:'Pierna izquierda',position:[-.4,-.3,0],size:[.4,1,.4],color:'#224466'},
  ],
}
describe('character fidelity and broken-face regression',()=>{
  it('routes Mario and any explicitly described character to Studio by default',()=>{
    expect(isHumanoidCharacterRequest('Mario Bros')).toBe(true)
    expect(requestedScene3DLevel('Mario Bros 3D interactivo')).toBe('studio')
    expect(requestedScene3DLevel('Haz a Mario Bros en 3D')).toBe('studio')
    expect(requestedScene3DLevel('Personaje original con armadura')).toBe('studio')
    expect(requestedScene3DLevel('Avatar anime de fantasía')).toBe('studio')
    expect(classifyScene3DDomain('Mario Bros')).toBe('character')
    expect(requestedScene3DLevel('Boceto low-poly del personaje original')).toBe('preview')
    expect(explicitlyLowPoly3D('Modelo low-poly simple')).toBe(true)
    expect(requestedScene3DLevel('Modelo geométrico de una casa')).toBe('preview')
  })
  it('detects primitive-only humanoids and clearly separated eyes, nose and moustache',()=>{
    const audit = auditCharacterGeometry(brokenCharacter,'Modelo interactivo')
    expect(audit.isCharacter).toBe(true)
    expect(audit.isExplicitDraft).toBe(false)
    expect(audit.meshTriangles).toBe(0)
    expect(audit.errors.join(' ')).toMatch(/primitivas|malla suficientemente detallada/u)
    expect(audit.errors.join(' ')).toContain('Detalle facial separado')
  })
  it('rejects the reported floating Mario model instead of publishing 24 primitive pieces',async()=>{
    const tool=createPhoenix3DTool()
    await expect(tool.execute({
      title:'Mario Bros 3D',scene:brokenCharacter,
    },execution())).rejects.toThrow(/Studio/u)
    await expect(tool.execute({
      title:'Figura tridimensional',scene:brokenCharacter,
    },execution())).rejects.toThrow(/Personaje 3D sin malla/u)
  })
  it('allows an explicitly requested low-poly concept but never claims it is production quality',async()=>{
    const tool=createPhoenix3DTool()
    const result=await tool.execute({
      title:'Personaje low-poly de prueba',scene:brokenCharacter,
    },execution()) as {qualityReport:{
      deliveredLevel:string;character:{isExplicitDraft:boolean;meshTriangles:number}
    }}
    expect(result.qualityReport.deliveredLevel).toBe('preview')
    expect(result.qualityReport.character.isExplicitDraft).toBe(true)
    expect(result.qualityReport.character.meshTriangles).toBe(0)
  })
  it('checks character faces independent of labels and does not equate a dense mesh with fidelity',()=>{
    const triangles=Array.from({length:2700},(_,i)=>i%3)
    const scene={nodes:[
      {type:'mesh',name:'Cabeza',position:[0,2,0] as const,
        size:[1,1,1] as const,vertices:triangles},
      {type:'sphere',name:'Ojo',position:[2,2,0] as const,size:[.1,.1,.1] as const},
    ]}
    const audit=auditCharacterGeometry(scene,'Personaje 3D')
    expect(audit.meshTriangles).toBe(300)
    expect(audit.errors).toHaveLength(1)
    expect(audit.errors[0]).toContain('Detalle facial separado')
  })
})
