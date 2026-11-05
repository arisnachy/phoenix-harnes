import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { importGenesisManifest } from './phoenix-genesis-importer.mjs'

const fixture=JSON.parse(readFileSync(new URL('./phoenix-genesis-fabric-example.json',import.meta.url),'utf8'))
function setup(){
  const root=mkdtempSync(join(tmpdir(),'genesis-import-'))
  const store=new GenesisWorkbench(join(root,'data.sqlite'))
  store.createOrganization(fixture)
  const path=join(root,'sample-source.txt')
  writeFileSync(path,'Fuentes ficticias agregadas sobre el hospital, sin datos personales.')
  const ev=store.registry.registerEvidence({organizationId:'hospital_ejemplo',
    filePath:path,kind:'inventory',validated:true})
  return {root,store,evidenceId:ev.evidenceId}
}
const build=(evidenceId)=>({
  schemaVersion:'1.0',manifestId:'setup_inventory_1',organizationId:'hospital_ejemplo',
  evidenceId,
  facts:[{category:'facility',key:'blueprints',value:'Confirmados por responsable',
    status:'verified'}],
  units:[
    {unitId:'pharmacy',siteId:'campus',parentId:'direction',
      name:'Farmacia',role:'pharmacy',staffCount:4,workstations:2},
    {unitId:'direction',siteId:'campus',name:'Dirección',role:'admin',
      staffCount:3,workstations:3}
  ],
  systems:[{systemId:'his',name:'HIS tradicional',method:'fhir',ownerUnit:'direction'}],
  costs:[{itemId:'server',label:'Servidor cotizado',category:'hardware',
    quantity:2,unitPrice:750,currency:'USD',recurrence:'one-time'}],
  goals:[{goalId:'availability',title:'Disponibilidad de equipos',
    metricId:'devices_available',period:'2026-11',target:5,ownerUnit:'direction'}],
  obligations:[{obligationId:'monthly',recipient:'Autoridad de ejemplo',
    title:'Producción agregada',periodicity:'monthly'}]
})
test('importación institucional completa, con evidencia, jerarquía y idempotencia',()=>{
  const {root,store,evidenceId}=setup()
  try{
    const m=build(evidenceId)
    const receipt=importGenesisManifest(store,m)
    assert.equal(receipt.status,'imported-for-human-review-not-deployed')
    assert.equal(receipt.counts.units,2)
    assert.equal(receipt.counts.facts,1)
    assert.equal(receipt.counts.costs,1)
    const dashboard=store.dashboard('hospital_ejemplo')
    assert.equal(dashboard.units.length,2)
    assert.equal(dashboard.facts[0].status,'verified')
    assert.equal(dashboard.budgetByCurrencyAndPeriod['USD:one-time'],1500)
    assert.equal(dashboard.systems[0].state,'pending-authorization')
    assert.equal(dashboard.obligations[0].state,'unverified-regulatory-requirement')
    const replay=importGenesisManifest(store,m)
    assert.equal(replay.replayed,true)
    assert.equal(store.dashboard('hospital_ejemplo').units.length,2)
    assert.throws(()=>importGenesisManifest(store,{...m,
      costs:[{...m.costs[0],unitPrice:800}]}),/Conflicto/)
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
test('si falla una unidad se revierte todo el manifiesto, incluso su auditoría',()=>{
  const {root,store,evidenceId}=setup()
  try{
    const before=store.dashboard('hospital_ejemplo')
    const bad=build(evidenceId)
    bad.manifestId='broken_import_2'
    bad.facts=[{category:'finance',key:'budget',value:'Fuente registrada'}]
    bad.units=[{unitId:'orphan',siteId:'campus',parentId:'nonexistent',
      name:'Unidad huérfana',staffCount:1,workstations:1}]
    assert.throws(()=>importGenesisManifest(store,bad),/Jerarquía cíclica o padre inexistente/)
    const after=store.dashboard('hospital_ejemplo')
    assert.equal(after.units.length,before.units.length)
    assert.equal(after.facts.length,before.facts.length)
    assert.equal(after.audit.length,before.audit.length)
    assert.throws(()=>importGenesisManifest(store,{...build(evidenceId),
      manifestId:'unexpected_field',facts:[{category:'facility',
        key:'blueprints',value:'sí',salary:99}]}),/campo no permitido/)
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
test('no importa archivos no verificados ni información de otra organización',()=>{
  const {root,store,evidenceId}=setup()
  try{
    const file=join(root,'unsigned.txt')
    writeFileSync(file,'Sin validación')
    const ev=store.registry.registerEvidence({organizationId:'hospital_ejemplo',
      filePath:file,kind:'inventory'})
    assert.throws(()=>importGenesisManifest(store,build(ev.evidenceId)),/no validada/)
    assert.throws(()=>importGenesisManifest(store,{...build(evidenceId),
      organizationId:'otro_hospital'}),/inexistente/)
    assert.throws(()=>importGenesisManifest(store,{...build(evidenceId),
      payload:{patient:'secreto'}}),/campo no permitido/)
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
test('agregar sedes mantiene activos y controla versiones de configuración',()=>{
  const {root,store}=setup()
  try{
    store.unit({organizationId:'hospital_ejemplo',
      unitId:'direction',siteId:'campus',name:'Dirección',role:'admin'})
    const current=store.dashboard('hospital_ejemplo')
    assert.equal(current.configurationRevision,1)
    const revision=store.addSite({organizationId:'hospital_ejemplo',
      siteId:'north',name:'Sede Norte',workstations:12,reusableWorkstations:9,
      expectedRevision:1})
    assert.equal(revision.revision,2)
    assert.equal(store.dashboard('hospital_ejemplo').sites.length,2)
    assert.equal(store.dashboard('hospital_ejemplo').units.length,1)
    assert.equal(store.deployment('hospital_ejemplo').planSummary.sites,2)
    assert.throws(()=>store.addSite({organizationId:'hospital_ejemplo',
      siteId:'other',name:'Otra',expectedRevision:1}),/Conflicto de versión/)
    const suggested=store.recommendations('hospital_ejemplo','north')
    assert.equal(suggested.status,'unverified-proposals-only')
    assert.ok(suggested.units.some(u=>u.unitId==='farmacia'&&u.role==='pharmacy'))
    assert.equal(store.dashboard('hospital_ejemplo').units.length,1)
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
test('una organización no sanitaria recibe propuestas correspondientes a su sector',()=>{
  const {root,store}=setup()
  try{
    const profile={...fixture,organizationId:'restaurante_demo',
      name:'Restaurante ficticio',industry:'restaurant'}
    store.createOrganization(profile)
    const suggestions=store.recommendations('restaurante_demo')
    assert.equal(suggestions.family,'restaurant')
    assert.ok(suggestions.units.some(u=>u.unitId==='salon'))
    assert.ok(!suggestions.units.some(u=>u.unitId==='uci'))
    assert.equal(suggestions.units.every(u=>u.requiresHumanAcceptance),true)
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
