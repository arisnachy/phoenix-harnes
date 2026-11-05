import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenesisInstitutionalRegistry } from './phoenix-genesis-institutional-registry.mjs'

test('Genesis conserva organización, documentos verificados, recursos e indicadores',()=>{
  const root=mkdtempSync(join(tmpdir(),'phoenix-genesis-evidence-'))
  const path=join(root,'genesis.sqlite')
  const spec=JSON.parse(readFileSync(new URL('./phoenix-genesis-fabric-example.json',import.meta.url),'utf8'))
  const paper=join(root,'inventario-ficticio.txt')
  writeFileSync(paper,'Ejemplo ficticio: Planta A, tres equipos en inventario.')
  let registry=new GenesisInstitutionalRegistry(path)
  try {
    const plan=registry.registerOrganization(spec)
    const org=plan.organization.organizationId
    assert.equal(plan.summary.logicalInstances,9)
    assert.throws(()=>registry.registerOrganization(spec),/ya registrada/)
    const pending=registry.registerEvidence({organizationId:org,filePath:paper,
      kind:'inventory',fileName:'Inventario de ejemplo',classification:'internal'})
    assert.equal(pending.state,'pending-validation')
    assert.throws(()=>registry.addResource({organizationId:org,
      resourceId:'equip_1',siteId:'campus',kind:'equipment',
      label:'Equipo ficticio',evidenceRefs:[pending.evidenceId]}),/no validada/)
    const evidence=registry.registerEvidence({organizationId:org,filePath:paper,
      kind:'inventory',fileName:'Inventario validado de demostración',
      validated:true})
    const asset=registry.addResource({organizationId:org,resourceId:'equipment_1',
      siteId:'campus',kind:'equipment',label:'Equipo de demostración',
      metadata:{quantity:3,department:'laboratorio'},evidenceRefs:[evidence.evidenceId]})
    assert.equal(asset.state,'registered')
    assert.throws(()=>registry.addResource({organizationId:org,
      resourceId:'secret_data',siteId:'campus',kind:'people',
      label:'No permitido',metadata:{salary:2000}}),/sensib/)
    const metric=registry.recordIndicator({organizationId:org,
      metricId:'devices_available',period:'2026-11',numerator:3,
      unit:'count',evidenceRefs:[evidence.evidenceId]})
    assert.equal(metric.value,3)
    assert.throws(()=>registry.recordIndicator({organizationId:org,
      metricId:'unverified',period:'2026-11',numerator:2}),/sin respaldo/)
    const poa=registry.draftPOA({organizationId:org,period:'2026-11',
      goals:[{goalId:'g1',metricId:'devices_available',title:'Equipamiento disponible',
        target:5},{goalId:'g2',metricId:'staff_coverage',
        title:'Cobertura de personal',target:95}]})
    assert.equal(poa.type,'POA-DRAFT')
    assert.equal(poa.entries[0].actual,3)
    assert.equal(poa.entries[1].actual,null)
    assert.equal(poa.entries[1].status,'missing-verified-measurement')
    assert.equal(poa.entries[0].approval,'pending-human-approval')
    assert.match(poa.disclaimer,/NO es entrega regulatoria/)
    registry.close()
    registry=new GenesisInstitutionalRegistry(path)
    const snap=registry.snapshot(org)
    assert.equal(snap.resources.length,1)
    assert.equal(snap.resources[0].metadata.quantity,3)
    assert.equal(snap.evidence.length,2)
    assert.equal(snap.evidence[1].digest.length,64)
    assert.equal(Object.hasOwn(snap.evidence[1],'file_contents'),false)
    assert.equal(registry.draftPOA({organizationId:org,period:'2026-11',
      goals:[{goalId:'g1',metricId:'devices_available',title:'Equipamiento',target:5}]})
      .entries[0].actual,3)
    assert.throws(()=>registry.snapshot('otra_org'),/inexistente/)
  }finally{
    try{registry.close()}catch{}
    rmSync(root,{recursive:true,force:true})
  }
})
