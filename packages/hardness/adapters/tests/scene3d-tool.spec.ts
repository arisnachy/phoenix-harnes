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
