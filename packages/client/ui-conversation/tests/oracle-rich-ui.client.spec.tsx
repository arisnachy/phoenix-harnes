// @vitest-environment jsdom
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
    for(const name of ['oracle_publish_research','oracle_weather_daily_forecast','oracle_fuse_series','oracle_calibration_report','oracle_forecast_history','oracle_forecast_due','oracle_revision_prediction']){
      expect(oracleCardsFromToolResult(tool(name))).toHaveLength(1)
    }
  })
  it('oculta explícitamente tarjetas prematuras de planificación, investigación con cero resultados y progreso',()=>{
    const premature=tool('oracle_research_forecast')
    expect(oracleCardsFromToolResult(premature)).toHaveLength(0)
    expect(oracleCardsFromToolResult(tool('oracle_plan_research'))).toHaveLength(0)
    const emptyDiscovery=tool('oracle_research_forecast')
    emptyDiscovery.content=[{type:'text',text:JSON.stringify({kind:'oracle_research',status:'insufficient',sources:[],uiBlock})}]
    expect(oracleCardsFromToolResult(emptyDiscovery)).toHaveLength(0)
  })
  it('la tarjeta final sí puede renderizarse después de una evidencia publicada',()=>{
    const published=tool('oracle_publish_research')
    expect(oracleCardsFromToolResult(published)).toHaveLength(1)
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


describe('ORÁCULO panel SVG real de predicción',()=>{
  it('representa observados, incertidumbre y futuras proyecciones sin HTML generado',async()=>{
    const { createElement }=await import('react')
    const { render, fireEvent }=await import('@testing-library/react')
    const { ForecastFanChart }=await import('../src/client/chat/ForecastFanChart.tsx')
    const { container, getByRole }=render(createElement(ForecastFanChart,{
      title:'Serie histórica y futuro',unit:'casos',
      points:[
        {label:'2026-11-03T00:00:00Z',observed:100},
        {label:'2026-11-04T00:00:00Z',observed:110,forecast:110},
        {label:'2026-11-05T00:00:00Z',forecast:116,lower:108,upper:124},
        {label:'2026-11-06T00:00:00Z',forecast:119,lower:106,upper:132},
      ],
    }))
    expect(container.querySelector('svg[role="img"]')).not.toBeNull()
    expect(container.querySelector('polygon')).not.toBeNull()
    expect(container.textContent).toContain('Observado')
    expect(container.textContent).toContain('Proyección')
    expect(container.textContent).toContain('casos')
    fireEvent.click(getByRole('button',{name:'Ver tabla'}))
    expect(getByRole('table')).toBeTruthy()
    expect(container.textContent).toContain('119')
  })
})
