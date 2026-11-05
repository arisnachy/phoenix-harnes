/**
 * PHOENIX Genesis — institutional readiness brief, reproducible from the
 * stored census, inventory, costs and evidence. Internal report only.
 */
import { createHash } from 'node:crypto'
import { listGenesisAreaCensus } from './phoenix-genesis-area-census.mjs'

const escapeHtml=value=>String(value??'').replace(/[&<>"']/gu,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch])
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const rank={high:0,medium:1,low:2}

export function buildGenesisReadinessBrief(workbench,organizationId){
  const d=workbench.dashboard(organizationId)
  const census=listGenesisAreaCensus(workbench,organizationId)
  const source={org:d.organization,units:d.units,systems:d.systems,costs:d.costs,
    evidence:d.evidence,facts:d.facts,missing:d.missingQuestions,areas:census.areas}
  const byDomain={},priorities=[]
  if(census.available){
    for(const area of census.areas){
      const domain=area.domain||'Sin clasificar'
      const stats=byDomain[domain]??={total:0,reviewed:0,verified:0,existing:0,outsourced:0}
      stats.total++
      if(area.reviewState!=='unreviewed')stats.reviewed++
      if(area.reviewState==='verified')stats.verified++
      if(area.state==='existing')stats.existing++
      if(area.state==='outsourced')stats.outsourced++
      let action=null,priority='medium'
      if(area.state==='existing'&&area.reviewState!=='verified'){
        action='Solicitar evidencia de la unidad declarada existente';priority='high'
      }else if(area.state==='outsourced'&&area.reviewState!=='verified'){
        action='Verificar contrato, proveedor y alcance de tercerización';priority='high'
      }else if(area.reviewState==='unreviewed'){
        action='Entrevistar jefatura y confirmar aplicabilidad del área'
      }else if(area.state==='unknown'){
        action='Investigar existencia y responsable del servicio'
      }
      if(action)priorities.push({priority,kind:'area',code:area.areaId,
        domain,title:area.name,action,requiredData:area.dataNeeded,
        suggestedReports:area.expectedReports,verified:false})
    }
  }
  for(const q of d.missingQuestions)priorities.push({
    priority:'medium',kind:'discovery',code:q.category+'.'+q.key,
    domain:q.category,title:q.question,
    action:'Solicitar documentos y respuestas a la institución',verified:false
  })
  for(const system of d.systems.filter(x=>x.state==='pending-authorization'))
    priorities.push({priority:'low',kind:'integration',code:system.systemId,
      domain:'technology',title:system.name,
      action:'Verificar licencia, propietario y método de interoperabilidad',
      verified:false})
  priorities.sort((a,b)=>rank[a.priority]-rank[b.priority]||
    a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title,'es'))
  return {
    type:'GENESIS-READINESS-DRAFT',version:'1.0',
    generatedAt:new Date().toISOString(),
    sourceSha256:sha(source),
    organization:{organizationId:d.organization.organizationId,
      name:d.organization.name,industry:d.organization.industry,
      adoptionMode:d.organization.adoptionMode},
    discovery:{coveragePct:d.readiness.discoveryCoveragePct,
      missingQuestions:d.missingQuestions.length,
      verifiedFacts:d.readiness.verifiedFacts},
    inventory:{sites:d.sites.length,units:d.units.length,
      staffSlots:d.units.reduce((sum,x)=>sum+x.staffCount,0),
      workstations:d.units.reduce((sum,x)=>sum+x.workstations,0),
      systems:d.systems.length,evidence:d.evidence.length,
      validatedEvidence:d.evidence.filter(x=>x.state==='validated').length,
      connectedInstancesNotVerified:true,regulatoryReportsSubmitted:0},
    budgetByCurrencyAndPeriod:d.budgetByCurrencyAndPeriod,
    census:{available:census.available,total:census.total,
      ...census.summary,byDomain},
    priorities,
    warnings:[
      'Diagnóstico interno no aprobado: NO es POA ni reporte oficial.',
      'Las 60 áreas son referencias, no servicios comprobados o habilitados.',
      'La evidencia validada es atestación del operador; requiere revisión profesional.',
      'Importes declarados, sin tarifas o conversiones monetarias inventadas.',
      'No se declara conectividad de nodos ni envío al gobierno sin prueba.'
    ]
  }
}

export function renderGenesisReadinessHtml(report){
  if(!report||report.type!=='GENESIS-READINESS-DRAFT')
    throw Error('Documento Genesis no válido')
  const e=escapeHtml
  const c=report.census
  const coverage=c.available?Math.round(c.reviewed/c.total*100):null
  const cards=[
    ['Entrevista',report.discovery.coveragePct+'%'],
    ['Áreas revisadas',c.available?c.reviewed+' / '+c.total:'No aplica'],
    ['Áreas verificadas',c.available?c.verified:'No aplica'],
    ['Documentos',report.inventory.evidence],
    ['Unidades registradas',report.inventory.units],
    ['Sistemas registrados',report.inventory.systems]
  ].map(([k,v])=>'<div class="metric"><strong>'+e(v)+'</strong><small>'+e(k)+'</small></div>').join('')
  const domains=Object.entries(c.byDomain||{}).map(([key,x])=>
    '<tr><td>'+e(key)+'</td><td>'+e(x.total)+'</td><td>'+e(x.reviewed)+
    '</td><td>'+e(x.verified)+'</td><td>'+e(x.existing)+'</td></tr>').join('')
  const priorities=report.priorities.slice(0,100).map((p,i)=>
    '<tr><td>'+e(i+1)+'</td><td>'+e(p.priority)+'</td><td>'+
    e(p.title)+'</td><td>'+e(p.action)+'</td></tr>').join('')
  const budget=Object.entries(report.budgetByCurrencyAndPeriod).map(([k,v])=>
    '<tr><td>'+e(k)+'</td><td>'+e(v)+'</td></tr>').join('')
  const warnings=report.warnings.map(w=>'<li>'+e(w)+'</li>').join('')
  const css=':root{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#28425b;background:#f6f9fc}'+
    '*{box-sizing:border-box}body{margin:0}main{max-width:1100px;margin:auto;padding:20px}'+
    'header,section{background:white;border:1px solid #e1e9f2;padding:20px;margin:0 0 18px;border-radius:12px}'+
    'h1{margin:0;font-size:23px}h2{font-size:17px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}'+
    '.metric{border:1px solid #e1e9f2;border-radius:9px;padding:12px}.metric strong{display:block;color:#126397;font-size:21px}'+
    '.metric small,.hint{color:#627d96}.bar{height:9px;border-radius:12px;background:#e9eff7;overflow:hidden}'+
    '.bar>span{height:100%;display:block;background:#278cc6}.scroll{overflow-x:auto}'+
    'table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:10px;border-bottom:1px solid #ebf0f5;text-align:left}'+
    '.warning{border-left:3px solid #b4c1cf;padding-left:12px}@media(max-width:600px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}'+
    '@media print{body{background:#fff}main{padding:0}section,header{break-inside:avoid}}'
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>PHOENIX Genesis · Diagnóstico institucional</title><style>'+css+'</style></head><body>',
    '<main><header><h1>✦ PHOENIX Genesis · Diagnóstico institucional</h1>',
    '<p>'+e(report.organization.name)+' · '+e(report.generatedAt)+'</p>',
    '<p class="hint">BORRADOR INTERNO · No es un reporte regulatorio</p></header>',
    '<section><h2>Visión de dirección</h2><div class="metrics">'+cards+'</div>',
    '<h3>Evaluación de áreas hospitalarias</h3>',
    '<div class="bar"><span style="width:'+e(coverage??0)+'%"></span></div>',
    '<p class="hint">'+e(coverage===null?'No aplica a esta industria':
      coverage+'% de las áreas revisadas; verificadas y declaradas no son equivalentes')+'</p></section>',
    '<section><h2>Áreas por dominio</h2><div class="scroll"><table>',
    '<thead><tr><th>Dominio</th><th>Referencias</th><th>Revisadas</th><th>Verificadas</th><th>Existentes</th></tr></thead>',
    '<tbody>'+(domains||'<tr><td colspan="5">Sin catálogo hospitalario</td></tr>')+'</tbody></table></div></section>',
    '<section><h2>Acciones pendientes ('+e(report.priorities.length)+')</h2><div class="scroll"><table>',
    '<thead><tr><th>#</th><th>Prioridad</th><th>Área</th><th>Acción necesaria</th></tr></thead>',
    '<tbody>'+(priorities||'<tr><td colspan="4">Sin acciones identificadas</td></tr>')+'</tbody></table></div>',
    '<p class="hint">Primeras 100 acciones; el JSON conserva todas.</p></section>',
    '<section><h2>Presupuesto declarado</h2><table><thead><tr><th>Moneda / período</th><th>Importe</th></tr></thead>',
    '<tbody>'+(budget||'<tr><td colspan="2">No hay importes registrados</td></tr>')+'</tbody></table></section>',
    '<section class="warning"><h2>Alcance y precauciones</h2><ul>'+warnings+'</ul>',
    '<p class="hint">Huella de fuente SHA-256: '+e(report.sourceSha256)+'</p></section>',
    '</main></body></html>'
  ].join('\n')
}
