import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { assessGenesisArea } from './phoenix-genesis-area-census.mjs'
import { buildGenesisReadinessBrief,renderGenesisReadinessHtml } from './phoenix-genesis-readiness-brief.mjs'
import { runGenesisReadinessCli } from './phoenix-genesis-readiness-cli.mjs'

const fixture=(org,industry)=>({organizationId:org,name:'Organización ficticia',
  industry,adoptionMode:'hybrid',network:{mode:'isolated'},
  sites:[{siteId:'principal',name:'Principal',workstations:12,
    reusableWorkstations:8,roles:[],software:[]}]
})
const setup=()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-brief-'))
  const dbPath=join(root,'genesis.sqlite')
  const store=new GenesisWorkbench(dbPath)
  store.createOrganization(fixture('hospital_demo','healthcare'))
  return {root,dbPath,store,close:()=>{store.close();rmSync(root,{recursive:true,force:true})}}
}
test('reporte hospitalario vacío: 60 áreas no inventadas y prioridades verificables',()=>{
  const x=setup()
  try{
    const report=buildGenesisReadinessBrief(x.store,'hospital_demo')
    assert.equal(report.type,'GENESIS-READINESS-DRAFT')
    assert.equal(report.census.total,60)
    assert.equal(report.census.reviewed,0)
    assert.equal(report.census.verified,0)
    assert.equal(report.census.existing,0)
    assert.equal(report.inventory.units,0)
    assert.equal(report.inventory.regulatoryReportsSubmitted,0)
    assert.equal(report.discovery.coveragePct,0)
    assert.ok(report.priorities.length>=60)
    assert.ok(report.priorities.every(x=>x.verified===false))
    assert.ok(report.warnings.some(x=>x.includes('NO es POA')))
    assert.match(report.sourceSha256,/^[0-9a-f]{64}$/)
    assert.ok(report.generatedAt.includes('T'))
  }finally{x.close()}
})
test('sin inventar: prioriza verificación y diferencia los costos declarados',()=>{
  const x=setup()
  try{
    const first=buildGenesisReadinessBrief(x.store,'hospital_demo')
    const assessment=assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'existing',reviewerRole:'Dirección',
      expectedRevision:0})
    assert.equal(assessment.revision,1)
    const next=buildGenesisReadinessBrief(x.store,'hospital_demo')
    assert.equal(next.census.reviewed,1)
    assert.equal(next.census.existing,1)
    assert.equal(next.census.verified,0)
    assert.notEqual(next.sourceSha256,first.sourceSha256)
    assert.equal(next.priorities[0].priority,'high')
    assert.ok(next.priorities.some(p=>p.code==='area_001'&&p.action.includes('evidencia')))
    x.store.cost({organizationId:'hospital_demo',itemId:'one_server',
      label:'Servidor ficticio',category:'hardware',quantity:2,unitPrice:800,
      currency:'USD',recurrence:'one-time'})
    x.store.cost({organizationId:'hospital_demo',itemId:'internet',
      label:'Internet mensual',category:'services',quantity:1,unitPrice:1000,
      currency:'DOP',recurrence:'monthly'})
    const budget=buildGenesisReadinessBrief(x.store,'hospital_demo')
    assert.equal(budget.budgetByCurrencyAndPeriod['USD:one-time'],1600)
    assert.equal(budget.budgetByCurrencyAndPeriod['DOP:monthly'],1000)
    assert.equal(budget.inventory.connectedInstancesNotVerified,true)
  }finally{x.close()}
})
test('HTML autónomo no interpreta texto institucional como HTML ejecutable',()=>{
  const x=setup()
  try{
    const report=buildGenesisReadinessBrief(x.store,'hospital_demo')
    report.organization.name='<script>alert("hello")</script>'
    report.priorities[0].title='<img src=x onerror=alert(1)>'
    const html=renderGenesisReadinessHtml(report)
    assert.match(html,/&lt;script&gt;alert/)
    assert.match(html,/&lt;img src=x onerror=alert/)
    assert.ok(!html.includes('<script>alert('))
    assert.ok(!html.includes('<img src=x onerror='))
    assert.match(html,/<!doctype html>/)
    assert.match(html,/SHA-256/)
    assert.match(html,/BORRADOR INTERNO/)
    assert.throws(()=>renderGenesisReadinessHtml({type:'OTHER'}),/no válido/)
  }finally{x.close()}
})
test('informe universal: un restaurante no recibe 60 áreas clínicas',()=>{
  const x=setup()
  try{
    x.store.createOrganization(fixture('restaurant_demo','restaurant'))
    const report=buildGenesisReadinessBrief(x.store,'restaurant_demo')
    assert.equal(report.census.available,false)
    assert.equal(report.census.total,0)
    assert.equal(report.census.byDomain&&Object.keys(report.census.byDomain).length,0)
    assert.equal(report.inventory.units,0)
    assert.ok(report.priorities.every(x=>x.kind!=='area'))
    assert.match(renderGenesisReadinessHtml(report),/No aplica a esta industria/)
  }finally{x.close()}
})
test('CLI exporta HTML y JSON con ruta explícita y nunca sobreescribe reportes',()=>{
  const x=setup()
  try{
    const summary=runGenesisReadinessCli(['summary','hospital_demo'],x.dbPath)
    assert.equal(summary.census.total,60)
    const htmlPath=join(x.root,'diagnostico.html')
    const jsonPath=join(x.root,'diagnostico.json')
    const html=runGenesisReadinessCli(['html','hospital_demo',htmlPath],x.dbPath)
    assert.equal(html.type,'GENESIS-READINESS-DRAFT')
    assert.match(readFileSync(htmlPath,'utf8'),/PHOENIX Genesis/)
    const json=runGenesisReadinessCli(['json','hospital_demo',jsonPath],x.dbPath)
    assert.equal(json.type,'GENESIS-READINESS-DRAFT')
    assert.equal(JSON.parse(readFileSync(jsonPath,'utf8')).census.total,60)
    assert.throws(()=>runGenesisReadinessCli(['html','hospital_demo',htmlPath],x.dbPath),
      /EEXIST/)
    assert.throws(()=>runGenesisReadinessCli(['html','hospital_demo',
      join(x.root,'informe.txt')],x.dbPath),/ruta absoluta/)
  }finally{x.close()}
})
