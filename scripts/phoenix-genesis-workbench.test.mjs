import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'

const fixture=JSON.parse(readFileSync(new URL('./phoenix-genesis-fabric-example.json',import.meta.url),'utf8'))
const mk=()=>mkdtempSync(join(tmpdir(),'genesis-workbench-'))
const ADMIN='a'.repeat(64)
function withStore(fn){
  const dir=mk(),path=join(dir,'genesis.sqlite')
  try{
    const store=new GenesisWorkbench(path)
    try{return fn(store,dir,path)}
    finally{store.close()}
  }finally{rmSync(dir,{recursive:true,force:true})}
}
test('Genesis conoce una institución y pregunta lo que falta sin inventar datos',()=>{
  withStore(store=>{
    const plan=store.createOrganization(fixture)
    assert.equal(plan.organization.organizationId,'hospital_ejemplo')
    assert.equal(store.organizations().length,1)
    const dashboard=store.dashboard('hospital_ejemplo')
    assert.equal(dashboard.readiness.discoveryCoveragePct,0)
    assert.ok(dashboard.missingQuestions.length>15)
    assert.equal(dashboard.readiness.operationalConnections,0)
    assert.equal(dashboard.readiness.externalReportsSubmitted,0)
    assert.equal(dashboard.planSummary.logicalInstances,9)
    assert.throws(()=>store.createOrganization(fixture),/ya registrada/)
  })
})
test('preguntas, unidades y jerarquía verificadas; rechazo de información personal',()=>{
  withStore((store,dir)=>{
    store.createOrganization(fixture)
    const org='hospital_ejemplo'
    const note=join(dir,'org-chart.txt')
    writeFileSync(note,'Organigrama ficticio de un hospital para pruebas.')
    const pending=store.registry.registerEvidence({organizationId:org,
      filePath:note,kind:'org_chart'})
    assert.throws(()=>store.answer({organizationId:org,
      category:'staffing',key:'org_chart',value:'vigente',status:'verified',
      evidenceRefs:[pending.evidenceId]}),/no validada/)
    assert.throws(()=>store.answer({organizationId:org,
      category:'staffing',key:'org_chart',value:'vigente',status:'verified'}),/necesita evidencia/)
    const verified=store.registry.registerEvidence({organizationId:org,
      filePath:note,kind:'org_chart',validated:true})
    const a=store.answer({organizationId:org,category:'staffing',
      key:'org_chart',value:'disponible',status:'verified',
      evidenceRefs:[verified.evidenceId]})
    assert.equal(a.status,'verified')
    assert.equal(store.dashboard(org).readiness.discoveryCoveragePct,Math.round(100/21))
    assert.throws(()=>store.answer({organizationId:org,category:'other',
      key:'employee_salary',value:900}),/no admitidos/)
    store.unit({organizationId:org,unitId:'direction',siteId:'campus',
      name:'Dirección',role:'admin',staffCount:3,workstations:3})
    store.unit({organizationId:org,unitId:'pharmacy',siteId:'campus',
      name:'Farmacia',parentId:'direction',role:'pharmacy',staffCount:4,workstations:2})
    assert.throws(()=>store.unit({organizationId:org,unitId:'direction',siteId:'campus',
      name:'Dirección',parentId:'pharmacy'}),/Ciclo/)
    assert.throws(()=>store.unit({organizationId:org,unitId:'wrong',siteId:'unknown',
      name:'Inválido'}),/Sede inexistente/)
    const proposal=store.deployment(org)
    assert.equal(proposal.expectedStaffSlots,7)
    assert.equal(proposal.inventoriedUnitWorkstations,5)
    assert.equal(proposal.installation,'not-executed')
  })
})
test('inversión, OPEX, sistemas tradicionales y reportes no se declaran conectados',()=>{
  withStore(store=>{
    const org='hospital_ejemplo';store.createOrganization(fixture)
    const sys=store.system({organizationId:org,systemId:'his',
      name:'Software hospitalario heredado',method:'fhir'})
    assert.equal(sys.connected,false)
    assert.equal(sys.state,'pending-authorization')
    store.cost({organizationId:org,itemId:'server',label:'Servidor nuevo',
      category:'hardware',quantity:2,unitPrice:700,currency:'USD',
      recurrence:'one-time'})
    store.cost({organizationId:org,itemId:'support',label:'Soporte mensual',
      category:'services',quantity:1,unitPrice:900,currency:'DOP',
      recurrence:'monthly'})
    const output=store.dashboard(org)
    assert.equal(output.budgetByCurrencyAndPeriod['USD:one-time'],1400)
    assert.equal(output.budgetByCurrencyAndPeriod['DOP:monthly'],900)
    assert.equal(output.systems.length,1)
    assert.equal(output.systems[0].state,'pending-authorization')
    assert.throws(()=>store.cost({organizationId:org,itemId:'bad',
      label:'Precio inexistente',category:'hardware',quantity:1,unitPrice:Infinity}),
      /fuera de rango/)
    const obligation=store.obligation({organizationId:org,
      obligationId:'quarterly_report',recipient:'Autoridad de ejemplo',
      title:'Reporte de producción',periodicity:'quarterly'})
    assert.equal(obligation.status,'unverified-regulatory-requirement')
  })
})
test('POA conserva indicadores con fuente, metas y ausencias sin inventar',()=>{
  withStore((store,dir,path)=>{
    const org='hospital_ejemplo';store.createOrganization(fixture)
    const note=join(dir,'verified.csv')
    writeFileSync(note,'indicator,observed\nbeds_available,12\n')
    const source=store.registry.registerEvidence({organizationId:org,
      filePath:note,kind:'statistics',validated:true})
    store.unit({organizationId:org,unitId:'planning',siteId:'campus',
      name:'Planificación',role:'admin'})
    store.goal({organizationId:org,goalId:'bed_target',
      title:'Camas disponibles',metricId:'beds_available',period:'2026-11',
      target:20,ownerUnit:'planning'})
    store.goal({organizationId:org,goalId:'staff_target',
      title:'Cobertura de turnos',metricId:'staff_coverage',period:'2026-11',target:95})
    const measurement=store.registry.recordIndicator({organizationId:org,
      metricId:'beds_available',period:'2026-11',numerator:12,
      evidenceRefs:[source.evidenceId]})
    assert.equal(measurement.value,12)
    const poa=store.poa({organizationId:org,period:'2026-11'})
    assert.equal(poa.type,'POA-DRAFT')
    assert.equal(poa.entries[0].actual,12)
    assert.equal(poa.entries[0].target,20)
    assert.equal(poa.entries[1].actual,null)
    assert.equal(poa.entries[1].approval,'pending-human-approval')
    assert.equal(store.dashboard(org).audit.length>2,true)
    store.close()
    const persisted=new GenesisWorkbench(path)
    try{
      assert.equal(persisted.poa({organizationId:org,period:'2026-11'}).entries[0].actual,12)
      assert.equal(persisted.dashboard(org).units.length,1)
    }finally{persisted.close()}
  })
})
test('servidor Genesis es local, autenticado y sirve web/API de extremo a extremo',async()=>{
  const dir=mk(),dbPath=join(dir,'web.sqlite')
  assert.throws(()=>createGenesisConsole({dbPath,adminToken:ADMIN,host:'0.0.0.0'}),
    /solo funciona en loopback/)
  const app=createGenesisConsole({dbPath,adminToken:ADMIN})
  const {url}=await app.start()
  const call=async(path,token=ADMIN,method='GET',data,origin)=>{
    const res=await fetch(url+path,{method,headers:{
      authorization:'Bearer '+token,
      ...(data===undefined?{}:{'content-type':'application/json'}),
      ...(origin?{origin}:{})
    },...(data===undefined?{}:{body:JSON.stringify(data)})})
    return {status:res.status,data:await res.json()}
  }
  try{
    const ui=await fetch(url)
    assert.equal(ui.status,200)
    assert.match(await ui.text(),/PHOENIX Genesis/)
    assert.match(ui.headers.get('content-security-policy'),/script-src 'self'/)
    const script=await fetch(url+'/app.js')
    assert.equal(script.status,200)
    assert.match(await script.text(),/form-create/)
    const forbidden=await fetch(url+'/v1/organizations')
    assert.equal(forbidden.status,401)
    const wrong=await call('/v1/organizations','f'.repeat(64))
    assert.equal(wrong.status,401)
    const created=await call('/v1/organizations',ADMIN,'POST',fixture,url)
    assert.equal(created.status,201)
    const org='hospital_ejemplo'
    const answer=await call('/v1/answers',ADMIN,'POST',{
      organizationId:org,category:'facility',key:'blueprints',
      value:'pendientes de revisión',status:'declared',evidenceRefs:[]},url)
    assert.equal(answer.status,201)
    const blocked=await call('/v1/answers',ADMIN,'POST',{
      organizationId:org,category:'facility',key:'space_inventory',
      value:'inventariado',status:'declared',evidenceRefs:[]},'http://evil.example')
    assert.equal(blocked.status,403)
    const overview=await call('/v1/dashboard?organizationId='+org)
    assert.equal(overview.status,200)
    assert.equal(overview.data.readiness.discoveryCoveragePct,Math.round(100/21))
    const deployment=await call('/v1/deployment?organizationId='+org)
    assert.equal(deployment.status,200)
    assert.equal(deployment.data.installation,'not-executed')
    const poa=await call('/v1/poa?organizationId='+org+'&period=2026-11')
    assert.equal(poa.status,200)
    assert.equal(poa.data.type,'POA-DRAFT')
  }finally{
    await app.close()
    rmSync(dir,{recursive:true,force:true})
  }
})
