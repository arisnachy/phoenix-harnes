/** Render only first-party ORÁCULO receipts through native PHOENIX GenerativeCanvas. */
import { parseGenerativeUiBlock, type GenerativeUiBlock } from './GenerativeUi.tsx'
function object(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==='object'&&!Array.isArray(x)
}
function firstParty(name:unknown):boolean{
  if(typeof name!=='string')return false
  const canonical=name.startsWith('mcp__tool_oracle__')?name.slice(18)
    :name.startsWith('mcp__tool-oracle__')?name.slice(18)
    :name.startsWith('mcp__')?'':name
  return ['oracle_research_forecast','oracle_forecast_public_csv','oracle_scientific_forecast','oracle_audit_prediction','oracle_forecast_scorecard'].includes(canonical)
}
export function oracleCardsFromToolResult(root:unknown):GenerativeUiBlock[]{
  const stack:[unknown,number][]=[[root,0]],cards:GenerativeUiBlock[]=[]
  let processed=0
  while(stack.length && ++processed<=96 && cards.length<3){
    const next=stack.pop()
    if(!next)break
    const [entry,depth]=next
    if(!object(entry))continue
    if(depth<8 && Array.isArray(entry.subCalls))
      for(const child of entry.subCalls.slice(0,20).reverse())stack.push([child,depth+1])
    if(entry.kind!=='tool-result'||entry.isError===true||!object(entry.call)||!firstParty(entry.call.name)
      ||!Array.isArray(entry.content))continue
    const raw=entry.content.flatMap(v=>object(v)&&v.type==='text'&&typeof v.text==='string'?[v.text]:[]).join('')
    if(raw.length<2||raw.length>250000)continue
    try {
      const parsed=JSON.parse(raw) as unknown
      if(!object(parsed)||!object(parsed.uiBlock)||parsed.uiBlock.component!=='ui_canvas')continue
      const card=parseGenerativeUiBlock(parsed.uiBlock)
      if(card!==null)cards.push(card)
    }catch{ /* The JSON renderer never interprets prose as executable UI. */ }
  }
  return cards
}
