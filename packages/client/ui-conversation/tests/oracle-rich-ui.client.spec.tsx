import { describe, expect, it } from 'vitest'
import { oracleCardsFromToolResult } from '../src/client/chat/oracle-tool-cards.ts'

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
