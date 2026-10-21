import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  PHOENIX_GEO_MAP_MIME, admitPhoenixGeoMap, createPhoenixGeoMapTool,
} from '../src/geo-map-tool.ts'

function context(concludeTurn:()=>void=()=>{}):ToolRunContext {
  const callId=CallId('geo-tool-1')
  return {callId,rootCallId:callId,name:'phoenix_geo_map',arguments:{},
    token:Symbol('geo-map-test') as never,signal:new AbortController().signal,
    deferContext:()=>{},concludeTurn}
}
const valid=()=>({
  source:'Valores sintéticos de prueba para verificar el visor; sin inferencia epidemiológica',
  theme:'health',
  metric:'Conteo de prueba (personas sintéticas)',
  subtitle:'Ubicaciones de prueba: no son tasas provinciales',
  layers:[{id:'sitios',name:'Sitios individuales',kind:'points',features:[
    {id:'p1',label:'Ejemplo de punto',coordinates:[[-70.69,19.78]],
      value:27,detail:'Cifra totalmente ficticia utilizada exclusivamente en el test',color:'#b35336'},
  ]}],
})
describe('geographic map publication in native chat',()=>{
  it('publishes a validated geographic artifact and receipt, not just prose',async()=>{
    const tool=createPhoenixGeoMapTool(),done=vi.fn()
    const args={title:'Mapa sintético de prueba',map:valid()}
    const result=await tool.execute(args,context(done)) as {
      artifactId:string;title:string;publication:string
      map:{component:string;version:number;props:{center:{lng:number;lat:number};layers:unknown[]}}
    }
    expect(result.artifactId).toBe('phoenix-geo-map:geo-tool-1')
    expect(result.map.component).toBe('geo_map')
    expect(result.map.version).toBe(1)
    expect(result.map.props.center.lng).toBeCloseTo(-70.69)
    expect(result.map.props.layers).toHaveLength(1)
    expect(result.publication).toBe('artifact_emitted_not_client_render_verified')
    expect(done).not.toHaveBeenCalled()
    expect(tool.output.presentationMeta?.(args,result as never)).toMatchObject({
      artifact:{id:result.artifactId,mime:PHOENIX_GEO_MAP_MIME,
        executable:false,data:{component:'geo_map',version:1}},
    })
  })
  it('preserves other work if continueAfterDisplay is requested',async()=>{
    const done=vi.fn()
    await createPhoenixGeoMapTool().execute(
      {title:'Sitios verificados',map:valid(),continueAfterDisplay:true},context(done))
    expect(done).not.toHaveBeenCalled()
  })
  it('rejects unsupported scripts, missing coordinates, fake province aggregates, invalid health metadata',()=>{
    const title='Mapa de salud'
    const base=valid()
    const cases:unknown[]=[
      {...base,script:'alert(1)'},
      {...base,layers:[{id:'vacío',name:'Sin registros',kind:'points',features:[]}]},
      {...base,source:''},
      {...base,metric:undefined},
      {...base,conversationId:'otra-conversación'},
      {...base,layers:[{id:'sitios',name:'Sitios',kind:'points',
        features:[{id:'p',label:'P',coordinates:[[-70.69,89]],value:27}]}]},
      {...base,layers:[{id:'sitios',name:'Sitios',kind:'points',
        features:[{id:'p',label:'P',coordinates:[[-70.69,19.78]],value:27,regionValue:'territory'}]}]},
    ]
    for(const map of cases)expect(()=>admitPhoenixGeoMap(map,title)).toThrow()
  })
  it('does not convert location samples into additional provinces or polygons',()=>{
    const map=admitPhoenixGeoMap(valid(),'Mapa de prueba')
    expect(map.props.layers).toHaveLength(1)
    expect(map.props.layers[0]?.kind).toBe('points')
    expect(map.props.layers[0]?.features).toHaveLength(1)
    expect(JSON.stringify(map)).toContain('sin inferencia epidemiológica')
    expect(JSON.stringify(map)).not.toContain('provinceRank')
  })
})
