import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { genesisCatalogSummary,searchGenesisCatalog } from './phoenix-genesis-healthcare-catalog.mjs'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'

const ADMIN='d'.repeat(64)
test('un hospital accede al catálogo completo: 60 áreas, 135 KPI, 34 informes, 20 comités',()=>{
  const summary=genesisCatalogSummary('healthcare')
  assert.equal(summary.family,'healthcare')
  assert.equal(summary.available,true)
  assert.equal(summary.templateOnly,true)
  const counts=Object.fromEntries(summary.catalogs.map(x=>[x.id,x.count]))
  assert.equal(counts.areas,60)
  assert.equal(counts.indicators,135)
  assert.equal(counts.reports,34)
  assert.equal(counts.committees,20)
  assert.equal(counts.procedures,12)
  assert.equal(counts.dataEntities,49)
  assert.equal(counts.workflows,15)
  assert.equal(counts.reportTransmissionTemplates,34)
  assert.equal(counts.integrationPatterns,10)
  const kpi=searchGenesisCatalog({industry:'hospital',category:'indicators',limit:10})
  assert.equal(kpi.total,135)
  assert.equal(kpi.rows[0][0],'KPI-001')
  assert.equal(kpi.rows[0][2],'Atenciones de consulta')
  assert.ok(kpi.rows[0][3].length>5)
  assert.ok(kpi.warning.includes('verificación'))
})
test('buscar por dominio, siglas y acentos sin alterar el catálogo original',()=>{
  const reports=searchGenesisCatalog({industry:'healthcare',category:'reports',query:'SNS'})
  assert.ok(reports.total>0)
  assert.ok(reports.rows.some(x=>x[0]==='R01'))
  const medication=searchGenesisCatalog({industry:'salud',category:'areas',query:'farmacia'})
  assert.ok(medication.rows.some(x=>x[1].toLowerCase().includes('farmacia')))
  const assess=searchGenesisCatalog({industry:'healthcare',category:'committees',
    query:'infecciones'})
  assert.ok(assess.total>0)
  const page=searchGenesisCatalog({industry:'healthcare',category:'indicators',
    limit:5,offset:10})
  assert.equal(page.rows.length,5)
  assert.equal(page.rows[0][0],'KPI-011')
  const repeat=searchGenesisCatalog({industry:'healthcare',category:'indicators',limit:1})
  assert.equal(repeat.rows[0][0],'KPI-001')
})
test('Genesis sigue siendo universal: otras industrias no heredan módulos clínicos',()=>{
  for(const industry of ['restaurant','universidad','manufacturing','retail']){
    const summary=genesisCatalogSummary(industry)
    assert.equal(summary.available,false)
    const rows=searchGenesisCatalog({industry,category:'indicators'})
    assert.equal(rows.total,0)
    assert.equal(rows.rows.length,0)
  }
  assert.throws(()=>searchGenesisCatalog({industry:'hospital',category:'unknown'}),/desconocido/)
  assert.throws(()=>searchGenesisCatalog({industry:'hospital',category:'reports',limit:1000}),/Límite/)
})
test('API de consola protege consultas y no altera inventario al leer referencias',async()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-health-catalog-'))
  const app=createGenesisConsole({dbPath:join(root,'genesis.sqlite'),adminToken:ADMIN})
  const {url}=await app.start()
  const req=async(path,secret=ADMIN,method='GET',data)=>{
    const res=await fetch(url+path,{
      method,headers:{authorization:'Bearer '+secret,
        ...(data===undefined?{}:{'content-type':'application/json'})},
      ...(data===undefined?{}:{body:JSON.stringify(data)})})
    return {status:res.status,body:await res.json()}
  }
  try{
    const blocked=await fetch(url+'/v1/catalog/summary?organizationId=hospital_demo')
    assert.equal(blocked.status,401)
    const created=await req('/v1/organizations',ADMIN,'POST',{
      organizationId:'hospital_demo',name:'Hospital ficticio',industry:'healthcare',
      adoptionMode:'hybrid',network:{mode:'isolated'},sites:[{
        siteId:'central',name:'Sede central',workstations:8,
        reusableWorkstations:6,roles:[],software:[]
      }]
    })
    assert.equal(created.status,201)
    const summary=await req('/v1/catalog/summary?organizationId=hospital_demo')
    assert.equal(summary.status,200)
    assert.equal(summary.body.catalogs.find(x=>x.id==='indicators').count,135)
    const page=await req('/v1/catalog?organizationId=hospital_demo&category=reports&query=riess')
    assert.equal(page.status,200)
    assert.ok(page.body.rows.length>=1)
    const unknown=await req('/v1/catalog?organizationId=other&category=reports')
    assert.equal(unknown.status,404)
    const dashboard=await req('/v1/dashboard?organizationId=hospital_demo')
    assert.equal(dashboard.body.units.length,0)
    assert.equal(dashboard.body.obligations.length,0)
  }finally{await app.close();rmSync(root,{recursive:true,force:true})}
})
