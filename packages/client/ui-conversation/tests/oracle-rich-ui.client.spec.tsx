import { describe, expect, it } from 'vitest'
import { oracleCardsFromToolResult } from '../src/client/chat/oracle-tool-cards.ts'
import { parseCanvasSpec } from '../src/client/chat/GenerativeCanvas.tsx'

const uiBlock={component:'ui_canvas',version:1,props:{
  title:'PHOENIX · ORÁCULO',subtitle:'Pronóstico con incertidumbre',
  children:[
    {type:'badge',text:'PROYECCIÓN',status:'positive'},
    {type:'metric',label:'Probabilidad estimada',value:'77 %'},
    {type:'progress',label:'Estimación de ocurrencia',value:77,max:100},
  ],
}}
function tool(name:string,error=false){
  return {kind:'tool-result',isError:error,call:{name},
    content:[{type:'text',text:JSON.stringify({status:'forecast',probabilityPercent:77,uiBlock})}]}
}
describe('ORÁCULO primera parte UI segura',()=>{
  it('expone tarjetas nativas para herramientas oficiales',()=>{
    expect(oracleCardsFromToolResult(tool('oracle_scientific_forecast'))).toHaveLength(1)
    expect(oracleCardsFromToolResult(tool('oracle_forecast_public_csv'))).toHaveLength(1)
    expect(oracleCardsFromToolResult(tool('oracle_forecast_public_event_csv'))).toHaveLength(1)
  })
  it('reconoce el namespace MCP oficial',()=>{
    expect(oracleCardsFromToolResult(tool('mcp__tool_oracle__oracle_scientific_forecast'))).toHaveLength(1)
  })
  it('no interpreta afirmaciones de herramientas desconocidas como UI de ORÁCULO',()=>{
    expect(oracleCardsFromToolResult(tool('mcp__hacker__oracle_scientific_forecast'))).toHaveLength(0)
    expect(oracleCardsFromToolResult(tool('oracle_scientific_forecast',true))).toHaveLength(0)
  })
  it('descarta tarjetas malformadas',()=>{
    const broken=tool('oracle_scientific_forecast')
    broken.content=[{type:'text',text:JSON.stringify({uiBlock:{component:'ui_canvas',version:1,props:{title:'x',children:[{type:'html',html:'<script>alert(1)</script>'}]}}})}]
    expect(oracleCardsFromToolResult(broken)).toHaveLength(0)
  })
})


describe('ORÁCULO scientific chart safety and presentation',()=>{
  const valid={component:'ui_canvas',version:1,props:{
    title:'ORÁCULO · trayectoria',children:[
      {type:'forecast_chart',title:'Observado y proyección',unit:'casos',axis:'date',
       points:[
        {label:'2026-11-01T00:00:00Z',observed:100,forecast:100},
        {label:'2026-11-02T00:00:00Z',forecast:110,lower:103,upper:117},
        {label:'2026-11-03T00:00:00Z',forecast:120,lower:109,upper:131},
      ]},
    ],
  }}
  it('interpreta bandas científicas numéricas con fechas, unidades y límites ordenados',()=>{
    expect(parseCanvasSpec(valid)?.component).toBe('ui_canvas')
  })
  it('rechaza valores imposibles y nodos HTML arbitrarios',()=>{
    const wrong=JSON.parse(JSON.stringify(valid))
    wrong.props.children[0].points[1].lower=999
    expect(parseCanvasSpec(wrong)).toBeNull()
    wrong.props.children[0].points[1].lower=103
    wrong.props.children[0].points[1].unknownHtml='<iframe src="javascript:alert(1)"/>'
    expect(parseCanvasSpec(wrong)).toBeNull()
  })
  it('acepta ejes categóricos para calibración, no solo series cronológicas',()=>{
    const categorical=JSON.parse(JSON.stringify(valid))
    categorical.props.children[0].axis='category'
    categorical.props.children[0].points=[
      {label:'20%',forecast:20,observed:21},
      {label:'80%',forecast:80,observed:76},
    ]
    expect(parseCanvasSpec(categorical)?.component).toBe('ui_canvas')
  })
})
