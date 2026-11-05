import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { listGenesisAreaCensus,assessGenesisArea } from './phoenix-genesis-area-census.mjs'

const spec=(org,industry='healthcare')=>({
  organizationId:org,name:'Organización ficticia '+org,industry,
  adoptionMode:'hybrid',network:{mode:'isolated'},
  sites:[{siteId:'principal',name:'Sede central',workstations:10,
    reusableWorkstations:7,roles:[],software:[]}]
})
function setup(){
  const folder=mkdtempSync(join(tmpdir(),'genesis-area-census-'))
  const store=new GenesisWorkbench(join(folder,'genesis.sqlite'))
  store.createOrganization(spec('hospital_demo'))
  return {folder,store,clean:()=>{store.close();rmSync(folder,{recursive:true,force:true})}}
}
test('censo completo: 60 áreas por verificar, sin inventar una sola existente',()=>{
  const x=setup()
  try{
    const found=listGenesisAreaCensus(x.store,'hospital_demo')
    assert.equal(found.available,true)
    assert.equal(found.total,60)
    assert.equal(found.summary.reviewed,0)
    assert.equal(found.summary.notEvaluated,60)
    assert.equal(found.summary.existing,0)
    assert.ok(found.areas.some(a=>a.name==='Consejo y dirección general'))
    assert.ok(found.areas.every(a=>a.state==='not-evaluated'))
    assert.ok(found.areas.every(a=>a.affectsRealInventory===false))
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
  }finally{x.clean()}
})
test('cada jefatura puede declarar o verificar un área sin crear instancias ni pacientes',()=>{
  const x=setup()
  try{
    const record=assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'existing',reviewerRole:'Dirección General',
      siteId:'principal'})
    assert.equal(record.status,'recorded-for-organizational-review')
    assert.equal(record.linkedPhoenixInstances,0)
    assert.equal(record.installed,false)
    let census=listGenesisAreaCensus(x.store,'hospital_demo')
    assert.equal(census.summary.reviewed,1)
    assert.equal(census.summary.notEvaluated,59)
    assert.equal(census.summary.existing,1)
    assert.equal(census.summary.verified,0)
    assert.equal(census.areas[0].reviewState,'declared')
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    const path=join(x.folder,'orgchart.txt')
    writeFileSync(path,'Documento ficticio para una prueba de gobierno institucional')
    const evidence=x.store.registry.registerEvidence({organizationId:'hospital_demo',
      filePath:path,kind:'org_chart',validated:true})
    const result=assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'existing',reviewerRole:'Dirección General',
      siteId:'principal',reviewState:'verified',evidenceRefs:[evidence.evidenceId],
      expectedRevision:record.revision})
    assert.equal(result.reviewState,'verified')
    census=listGenesisAreaCensus(x.store,'hospital_demo')
    assert.equal(census.summary.verified,1)
    assert.deepEqual(census.areas[0].evidenceRefs,[evidence.evidenceId])
    assert.equal(census.areas[0].revision,2)
    assert.throws(()=>assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'outsourced',reviewerRole:'Dirección General',
      expectedRevision:1}),/Conflicto de versión/)
    assert.equal(listGenesisAreaCensus(x.store,'hospital_demo').areas[0].state,'existing')
    assert.ok(x.store.dashboard('hospital_demo').audit.some(a=>a.action==='area-assessed'))
  }finally{x.clean()}
})
test('aislamiento entre organizaciones y rechazo de fuentes no validadas',()=>{
  const x=setup()
  try{
    x.store.createOrganization(spec('hospital_2'))
    const path=join(x.folder,'pending.txt')
    writeFileSync(path,'Matriz institucional ficticia')
    const evidence=x.store.registry.registerEvidence({organizationId:'hospital_demo',
      filePath:path,kind:'manual',validated:false})
    assert.throws(()=>assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'existing',reviewerRole:'Planificación',
      reviewState:'verified',evidenceRefs:[]}),/requiere evidencia/)
    assert.throws(()=>assessGenesisArea(x.store,{organizationId:'hospital_demo',
      areaId:'area_001',state:'existing',reviewerRole:'Planificación',
      reviewState:'verified',evidenceRefs:[evidence.evidenceId]}),/no validada/)
    assert.equal(listGenesisAreaCensus(x.store,'hospital_2').summary.reviewed,0)
    assert.throws(()=>assessGenesisArea(x.store,{organizationId:'hospital_2',
      areaId:'area_002',state:'existing',reviewerRole:'Planificación',
      reviewState:'verified',evidenceRefs:[evidence.evidenceId]}),/no validada/)
  }finally{x.clean()}
})
test('no se inventan obligaciones en organizaciones no sanitarias',()=>{
  const x=setup()
  try{
    x.store.createOrganization(spec('restaurante_demo','restaurant'))
    const census=listGenesisAreaCensus(x.store,'restaurante_demo')
    assert.equal(census.available,false)
    assert.equal(census.total,0)
    assert.throws(()=>assessGenesisArea(x.store,{
      organizationId:'restaurante_demo',areaId:'area_001',state:'existing',
      reviewerRole:'Gerencia'}),/no corresponde/i)
  }finally{x.clean()}
})
test('validación de áreas, estados y sedes; sin efectos parciales',()=>{
  const x=setup()
  try{
    const base={organizationId:'hospital_demo',areaId:'area_001',
      state:'existing',reviewerRole:'Planificación',siteId:'principal'}
    assert.throws(()=>assessGenesisArea(x.store,{...base,areaId:'area_999'}),
      /fuera del catálogo/)
    assert.throws(()=>assessGenesisArea(x.store,{...base,siteId:'otra_sede'}),
      /Sede inexistente/)
    assert.throws(()=>assessGenesisArea(x.store,{...base,state:'installed'}),
      /Estado de área inválido/)
    assert.throws(()=>assessGenesisArea(x.store,{...base,reviewerRole:'secret@domain.com'}),
      /sensible/)
    assert.equal(listGenesisAreaCensus(x.store,'hospital_demo').summary.reviewed,0)
  }finally{x.clean()}
})
