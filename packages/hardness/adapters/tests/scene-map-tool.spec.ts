import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  PHOENIX_SCENE_MAP_MIME,
  admitPhoenixSceneMap,
  createPhoenixSceneMapTool,
  demoIslandMap,
} from '../src/scene-map-tool.ts'

function context(concludeTurn:()=>void=()=>{}):ToolRunContext {
  const callId=CallId('map-isla-1')
  return {
    callId,rootCallId:callId,name:'phoenix_scene_map',arguments:{},
    token:Symbol('map-publish') as never,
    signal:new AbortController().signal,
    deferContext:()=>{},concludeTurn,
  }
}

describe('native fictional map publication via tool result',()=>{
  it('publishes a real renderable MIME artifact, not a prose claim',async()=>{
    const tool=createPhoenixSceneMapTool()
    const args={title:'Isla Bruma',demo:true}
    const conclude=vi.fn()
    const r=await tool.execute(args,context(conclude)) as {
      artifactId:string;title:string;map:{component:string;version:number;props:{places:unknown[];routes:unknown[]}}
      publication:string
    }
    expect(r.artifactId).toBe('phoenix-scene-map:map-isla-1')
    expect(r.map).toMatchObject({component:'scene_map',version:1})
    expect(r.map.props.places).toHaveLength(5)
    expect(r.map.props.routes).toHaveLength(4)
    expect(conclude).toHaveBeenCalledOnce()
    const artifact=tool.output.presentationMeta?.(args,r as never)
    expect(artifact).toMatchObject({artifact:{id:'phoenix-scene-map:map-isla-1',
      mime:PHOENIX_SCENE_MAP_MIME,executable:false,
      data:{component:'scene_map',version:1}}})
    expect(r.publication).toBe('artifact_emitted_not_client_render_verified')
  })
  it('validates custom islands and routes without fabricating extra locations',async()=>{
    const tool=createPhoenixSceneMapTool()
    const a={title:'Reino Costero',map:{theme:'treasure',places:[
      {id:'p',name:'Puerto',kind:'port',x:24,y:55,description:'Pueblo de pescadores'},
      {id:'b',name:'Bosque',kind:'forest',x:60,y:52,description:'Bosque encantado'},
    ],routes:[{from:'p',to:'b',label:'Camino local'}]}}
    const done=vi.fn()
    const r=await tool.execute({...a,continueAfterDisplay:true},context(done)) as {map:{props:{places:unknown[];routes:unknown[]}}}
    expect(r.map.props.places).toHaveLength(2)
    expect(r.map.props.routes).toHaveLength(1)
    expect(done).not.toHaveBeenCalled()
  })
  it('refuses unsafe, empty or unrenderable payloads before concludeTurn',async()=>{
    const tool=createPhoenixSceneMapTool()
    const done=vi.fn()
    for(const invalidMap of [
      {places:[]},
      {places:[{id:'a',name:'A',x:25,y:25,kind:'city',description:'Zona A'},
        {id:'b',name:'B',x:27,y:38,kind:'forest',description:'Zona B'}],script:'alert(1)'},
      {places:[{id:'a',name:'A',x:25,y:25,kind:'city',description:'Zona A'},
        {id:'a',name:'B',x:27,y:38,kind:'forest',description:'Zona B'}]},
      {places:[{id:'a',name:'A',x:25,y:25,kind:'city',description:'Zona A'},
        {id:'b',name:'B',x:27,y:38,kind:'forest',description:'Zona B'}],
        routes:[{from:'a',to:'external'}]},
    ]){
      await expect(tool.execute({title:'Mapa fallido',map:invalidMap},context(done))).rejects.toThrow()
    }
    expect(done).not.toHaveBeenCalled()
  })
  it('pure demo schema has no network URLs, API calls or real-world geography',()=>{
    const m=demoIslandMap('Isla Bruma')
    expect(m.props.places.every(p=>p.x>=5&&p.x<=95)).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/https?:\/\/|fetch\(|navigator|geocode|latitud|longitud/i)
    expect(admitPhoenixSceneMap(m.props,'Isla Bruma')).toEqual(m)
  })
})
