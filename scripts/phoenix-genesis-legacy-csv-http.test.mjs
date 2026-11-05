import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'

const TOKEN='c'.repeat(64)
async function call(url,path,method='GET',payload){
  const response=await fetch(url+path,{method,headers:{
    authorization:'Bearer '+TOKEN,
    ...(payload===undefined?{}:{'content-type':'application/json'})
  },...(payload===undefined?{}:{body:JSON.stringify(payload)})})
  return {status:response.status,data:await response.json()}
}
test('console API: CSV desde software tradicional, evidencia, vista previa e importación controlada',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'phoenix-bridge-api-'))
  const filePath=join(folder,'unidades.csv')
  writeFileSync(filePath,'id,sede,area,personal,pc\npharmacy,principal,Farmacia,4,2\n')
  const app=createGenesisConsole({dbPath:join(folder,'genesis.sqlite'),adminToken:TOKEN})
  const {url}=await app.start()
  try{
    const org=await call(url,'/v1/organizations','POST',{
      organizationId:'hospital_demo',name:'Hospital ejemplo',industry:'healthcare',
      adoptionMode:'hybrid',network:{mode:'lan'},
      sites:[{siteId:'principal',name:'Principal',workstations:10,
        reusableWorkstations:8,roles:[],software:[]}]
    })
    assert.equal(org.status,201)
    const ev=await call(url,'/v1/evidence','POST',{
      organizationId:'hospital_demo',filePath,kind:'legacy_export',
      classification:'internal',validated:true
    })
    assert.equal(ev.status,201)
    const evidenceId=ev.data.result.evidenceId
    const config={
      organizationId:'hospital_demo',batchId:'hospital_export_1',
      filePath,evidenceId,kind:'units',
      mapping:{unitId:'id',siteId:'sede',name:'area',
        staffCount:'personal',workstations:'pc'}
    }
    const preview=await call(url,'/v1/legacy-csv/preview','POST',config)
    assert.equal(preview.status,200)
    assert.equal(preview.data.result.count,1)
    assert.equal(preview.data.result.state,'preview-only')
    assert.equal((await call(url,'/v1/dashboard?organizationId=hospital_demo')).data.units.length,0)
    const denied=await call(url,'/v1/legacy-csv/import','POST',config)
    assert.equal(denied.status,400)
    const result=await call(url,'/v1/legacy-csv/import','POST',{...config,approved:true})
    assert.equal(result.status,201)
    assert.equal(result.data.result.state,'imported-pending-human-review')
    const dashboard=await call(url,'/v1/dashboard?organizationId=hospital_demo')
    assert.equal(dashboard.data.units[0].name,'Farmacia')
    assert.equal(dashboard.data.units[0].staffCount,4)
    assert.equal(dashboard.data.units[0].workstations,2)
    const repeated=await call(url,'/v1/legacy-csv/import','POST',{...config,approved:true})
    assert.equal(repeated.data.result.replayed,true)
    const bad=await call(url,'/v1/legacy-csv/import','POST',{
      ...config,batchId:'hospital_export_2',
      mapping:{...config.mapping,name:'nonexistent'}
    })
    assert.equal(bad.status,400)
  }finally{await app.close();rmSync(folder,{recursive:true,force:true})}
})
