import { describe, expect, it } from 'vitest'
import {
  auditScene3DQuality, classifyScene3DDomain, requestedScene3DLevel,
} from '../src/scene3d-quality.ts'
import { choosePhoenix3DPipeline } from '../src/scene3d-routing.ts'
import { createPhoenix3DTool } from '../src/scene3d-tool.ts'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'

function execution(): ToolRunContext {
  const callId = CallId('scene-quality')
  return { callId, rootCallId:callId, name:'phoenix_3d', arguments:{},
    token:Symbol('quality') as never, signal:new AbortController().signal,
    deferContext:()=>{}, concludeTurn:()=>{} }
}

describe('general-purpose 3D production admission', () => {
  it('classifies categories without specializing the tool to pelicans', () => {
    expect(classifyScene3DDomain('Un personaje anime con ropa')).toBe('character')
    expect(classifyScene3DDomain('Robot humanoide articulado')).toBe('robot')
    expect(classifyScene3DDomain('Bicicleta con ruedas reales')).toBe('vehicle')
    expect(classifyScene3DDomain('Casa de dos plantas')).toBe('architecture')
    expect(classifyScene3DDomain('Paisaje de bosque y montañas')).toBe('environment')
    expect(classifyScene3DDomain('Un reloj de pared')).toBe('object')
  })
  it('routes real production and exact reconstruction away from native preview', () => {
    expect(requestedScene3DLevel('Modelo 3D simple para girar')).toBe('preview')
    expect(requestedScene3DLevel('Personaje anime 3D profesional con rigging')).toBe('studio')
    expect(requestedScene3DLevel('Crea cualquier cosa perfecta en 3D')).toBe('studio')
    expect(requestedScene3DLevel('Casa con exactitud 1:1 y planos')).toBe('fidelity')
    expect(choosePhoenix3DPipeline('Personaje animado fotorrealista')).toBe('blender-studio')
    expect(choosePhoenix3DPipeline('Reconstrucción exacta de vehículo')).toBe('reference-reconstruction')
    expect(choosePhoenix3DPipeline('Showroom interactivo simple 3D')).toBe('preview')
  })
  it('requires necessary semantic parts and warns about missing organic detail', () => {
    const scene={nodes:[
      {type:'box',name:'Cuerpo',objectId:'character'},
      {type:'box',name:'Piso',objectId:'stage'},
    ]}
    const audit=auditScene3DQuality(scene,'Personaje anime', ['character','stage','hair'])
    expect(audit.domain).toBe('character')
    expect(audit.structuralChecksPassed).toBe(false)
    expect(audit.blockers.join(' ')).toContain('hair')
    expect(audit.warnings.join(' ')).toContain('malla orgánica')
    expect(audit.deliveredLevel).toBe('preview')
  })
  it('does not certify studio production from a primitive mesh even with many faces', () => {
    const scene={environment:'studio',nodes:[
      {type:'mesh',name:'Character',objectId:'character',vertices:new Array(900).fill(0)},
    ]}
    const audit=auditScene3DQuality(scene,'Personaje profesional', ['character'])
    expect(audit.requestedLevel).toBe('studio')
    expect(audit.structuralChecksPassed).toBe(false)
    expect(audit.blockers[0]).toContain('Blender')
  })
  it('rejects professional and exact output claims inside the native 3D tool', async () => {
    const tool=createPhoenix3DTool()
    const scene={nodes:[{type:'box',name:'Objeto',position:[0,0,0],size:[1,1,1],color:'#eeeeee'}]}
    await expect(tool.execute({title:'Personaje profesional',scene},execution()))
      .rejects.toThrow(/Blender Lab MCP/u)
    await expect(tool.execute({title:'Objeto',qualityMode:'fidelity',scene},execution()))
      .rejects.toThrow(/Fidelidad exacta/u)
    const preview=await tool.execute({title:'Objeto de prueba',scene},execution()) as {
      qualityReport:{deliveredLevel:string;structuralChecksPassed:boolean}
    }
    expect(preview.qualityReport.deliveredLevel).toBe('preview')
    expect(preview.qualityReport.structuralChecksPassed).toBe(true)
  })
})
