/**
 * PHOENIX Genesis Healthcare Reference Pack — original institutional matrix v4.
 * Catalogs describe POSSIBLE services, indicators, protocols and reports, not
 * facts about any hospital or legal obligations already verified.
 * This extension does not modify the domain-independent Genesis core.
 */
import { readFileSync } from 'node:fs'
import { genesisSectorFamily } from './phoenix-genesis-sector-packs.mjs'

const pack=JSON.parse(readFileSync(new URL('./phoenix-genesis-healthcare-catalog.json',import.meta.url),'utf8'))
const labels={
  areas:'Áreas y funciones',indicators:'Indicadores',reports:'Informes',
  committees:'Comités',dataEntities:'Entidades de datos',risks:'Riesgos',
  procedures:'POE',references:'Referencias',integrationPatterns:'Integraciones',
  reportTransmissionTemplates:'Plantillas de envío',workflows:'Flujos',
  budgetTemplates:'Plantillas presupuestarias',responsibilityMatrix:'Matriz RACI'
}
if(pack.schemaVersion!=='1.0'||pack.status!=='templates-only')throw Error('Healthcare catalog schema invalid')
for(const [key,count] of Object.entries({areas:60,indicators:135,reports:34,committees:20})){
  if(pack.catalogs[key]?.rows?.length!==count)
    throw Error('Incomplete reference catalog: '+key)
}
const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
export function genesisCatalogSummary(industry){
  const family=genesisSectorFamily(industry)
  if(family!=='healthcare')return {
    family,available:false,templateOnly:true,catalogs:[],
    note:'Sin catálogo especializado para este sector; Genesis Core sigue siendo universal.'
  }
  return {family,available:true,templateOnly:true,source:pack.source,
    catalogs:Object.entries(pack.catalogs).map(([key,value])=>({
      id:key,label:labels[key]??key,count:value.rows.length
    })),
    warning:'Todos son modelos de referencia: confirmar pertinencia, normas y datos por institución.'
  }
}
export function searchGenesisCatalog({industry,category,query='',offset=0,limit=40}){
  const summary=genesisCatalogSummary(industry)
  if(!summary.available)return {...summary,category:null,rows:[],fields:[],total:0}
  if(!Object.hasOwn(pack.catalogs,category))throw Error('Catálogo desconocido')
  if(typeof query!=='string'||query.length>180)throw Error('Consulta inválida')
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw Error('Offset inválido')
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Límite fuera de rango')
  const sheet=pack.catalogs[category]
  const needle=normalize(query.trim())
  const filtered=needle?sheet.rows.filter(row=>
    row.some(value=>normalize(value).includes(needle))):sheet.rows
  return {
    family:summary.family,available:true,templateOnly:true,
    category,label:labels[category]??category,fields:[...sheet.fields],
    rows:filtered.slice(offset,offset+limit).map(row=>[...row]),
    total:filtered.length,offset,limit,
    source:pack.source.title,
    warning:'Pendiente de verificación y aceptación local. No constituye un registro institucional ni un informe oficial.'
  }
}
