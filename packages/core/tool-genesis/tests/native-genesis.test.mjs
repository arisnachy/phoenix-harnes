import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, existsSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runGenesis} from '../src/runtime.ts'

test('native Kira tools expose real local Genesis and a side-effect-free capability check',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'phoenix-genesis-chat-test-'))
  const save={home:process.env.PHOENIX_INSTITUTION_DATA_HOME,
    path:process.env.PHOENIX_GENESIS_DB,root:process.env.PHOENIX_GENESIS_RUNTIME_ROOT}
  process.env.PHOENIX_GENESIS_RUNTIME_ROOT=process.cwd()
  process.env.PHOENIX_INSTITUTION_DATA_HOME=join(dir,'institution')
  process.env.PHOENIX_GENESIS_DB=join(dir,'production.sqlite')
  try{
    const status=await runGenesis('status',{})
    assert.equal(status.source,'local-sqlite')
    assert.equal(status.persisted,false)
    assert.equal(status.result.available,true)
    assert.equal(status.result.databaseExists,false)
    assert.equal(existsSync(process.env.PHOENIX_GENESIS_DB),false)
    const initial=await runGenesis('organizations',{})
    assert.deepEqual(initial.result,{organizations:[],databaseExists:false})
    const demo=await runGenesis('demo-create',{scope:'demo'})
    assert.equal(demo.persisted,true)
    assert.equal(demo.result.organizationId,'hospital_genesis_demo')
    assert.equal(demo.result.staffSlots,120)
    assert.equal(demo.result.liveConnections,false)
    assert.equal(existsSync(process.env.PHOENIX_GENESIS_DB),false)
    const same=await runGenesis('demo-create',{scope:'demo'})
    assert.equal(same.persisted,false)
    assert.equal(same.result.status,'already-existing')
    const orgs=await runGenesis('organizations',{scope:'demo'})
    assert.ok(orgs.result.organizations.includes('hospital_genesis_demo'))
    const snap=await runGenesis('report',{
      scope:'demo',organizationId:'hospital_genesis_demo',kind:'snapshot'})
    assert.equal(snap.persisted,false)
    assert.equal(snap.result.units.length,7)
    assert.equal(snap.result.units.reduce((a,u)=>a+u.staffCount,0),120)
    assert.equal(snap.result.systems[0].state,'pending-authorization')
    const catalog=await runGenesis('catalog',{scope:'demo',
      organizationId:'hospital_genesis_demo',category:'indicators',query:''})
    assert.equal(catalog.result.total,135)
    const committee=await runGenesis('catalog',{scope:'demo',
      organizationId:'hospital_genesis_demo',category:'committees',query:''})
    assert.equal(committee.result.total,20)
    const area=await runGenesis('report',{scope:'demo',
      organizationId:'hospital_genesis_demo',kind:'census'})
    assert.equal(area.result.total,60)
    assert.equal(area.result.summary.reviewed,3)
    const readiness=await runGenesis('report',{scope:'demo',
      organizationId:'hospital_genesis_demo',kind:'readiness'})
    assert.equal(readiness.result.inventory.units,7)
    assert.equal(readiness.result.inventory.staffSlots,120)
    const poa=await runGenesis('report',{scope:'demo',
      organizationId:'hospital_genesis_demo',kind:'poa',period:'2026-11'})
    assert.match(JSON.stringify(poa),/ocupacion_hospitalaria_demo/)
    assert.equal(existsSync(process.env.PHOENIX_GENESIS_DB),false)
    await assert.rejects(runGenesis('unit-register',{
      scope:'demo',organizationId:'hospital_genesis_demo',authorized:false,
      unit:{organizationId:'hospital_genesis_demo',unitId:'new',siteId:'principal',name:'New'}}),
      /autorización/)
    await assert.rejects(runGenesis('report',{scope:'institution',
      organizationId:'hospital_genesis_demo',kind:'snapshot'}),/base institucional/)
    await assert.rejects(runGenesis('report',{scope:'demo',
      organizationId:'real_hospital',kind:'snapshot'}),/inexistente/)
  }finally{
    for(const [key,val] of [['PHOENIX_INSTITUTION_DATA_HOME',save.home],
      ['PHOENIX_GENESIS_DB',save.path],['PHOENIX_GENESIS_RUNTIME_ROOT',save.root]]){
      if(val===undefined)delete process.env[key]
      else process.env[key]=val
    }
    rmSync(dir,{recursive:true,force:true})
  }
})
test('native Genesis creates only an explicitly supplied institution and validates writes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'phoenix-genesis-chat-prod-'))
  const path=process.env.PHOENIX_GENESIS_DB
  const root=process.env.PHOENIX_GENESIS_RUNTIME_ROOT
  process.env.PHOENIX_GENESIS_DB=join(dir,'genesis.sqlite')
  process.env.PHOENIX_GENESIS_RUNTIME_ROOT=process.cwd()
  try{
    const created=await runGenesis('organization-create',{spec:{
      organizationId:'institucion_prueba',name:'Institución ficticia',
      industry:'healthcare',adoptionMode:'hybrid',network:{mode:'isolated'},
      sites:[{siteId:'sede_a',name:'Sede A',workstations:12,
        reusableWorkstations:8,roles:[],software:[]}]
    }})
    assert.equal(created.persisted,true)
    assert.ok(existsSync(process.env.PHOENIX_GENESIS_DB))
    const orgs=await runGenesis('organizations',{})
    assert.ok(orgs.result.organizations.includes('institucion_prueba'))
    await assert.rejects(runGenesis('unit-register',{
      organizationId:'institucion_prueba',authorized:false,
      unit:{organizationId:'institucion_prueba',unitId:'farmacia',siteId:'sede_a',name:'Farmacia'}
    }),/autorización/)
    const saved=await runGenesis('unit-register',{
      organizationId:'institucion_prueba',authorized:true,
      unit:{organizationId:'institucion_prueba',unitId:'farmacia',
        siteId:'sede_a',name:'Farmacia de ejemplo',role:'pharmacy',staffCount:4}
    })
    assert.equal(saved.persisted,true)
    assert.equal(saved.result.saved.unitId,'farmacia')
    const brief=await runGenesis('report',{
      organizationId:'institucion_prueba',kind:'readiness'})
    assert.equal(brief.result.inventory.units,1)
    assert.equal(brief.result.census.reviewed,0)
    const area=await runGenesis('area-assess',{
      organizationId:'institucion_prueba',authorized:true,
      assessment:{organizationId:'institucion_prueba',
        areaId:'area_001',state:'existing',
        reviewerRole:'Dirección de prueba',expectedRevision:0}
    })
    assert.equal(area.persisted,true)
    assert.equal(area.result.status,'recorded-for-organizational-review')
    assert.equal(area.result.installed,false)
  }finally{
    if(path===undefined)delete process.env.PHOENIX_GENESIS_DB
    else process.env.PHOENIX_GENESIS_DB=path
    if(root===undefined)delete process.env.PHOENIX_GENESIS_RUNTIME_ROOT
    else process.env.PHOENIX_GENESIS_RUNTIME_ROOT=root
    rmSync(dir,{recursive:true,force:true})
  }
})
