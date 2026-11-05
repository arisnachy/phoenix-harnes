import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,readFileSync,rmSync,existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createGenesisSyntheticDemo } from './phoenix-genesis-demo.mjs'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { buildGenesisReadinessBrief } from './phoenix-genesis-readiness-brief.mjs'

const token='u'.repeat(64)
test('demo hospital ejecutable: datos sintéticos, 2 sedes, POA y diagnóstico',()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-demo-test-'))
  const folder=join(root,'hospital_ficticio')
  try{
    const output=createGenesisSyntheticDemo(folder)
    assert.equal(output.demo,true)
    assert.equal(output.organizationId,'hospital_genesis_demo')
    assert.equal(output.sites,2)
    assert.equal(output.units,7)
    assert.equal(output.staffSlots,120)
    assert.equal(output.reviewedAreas,3)
    assert.equal(output.verifiedAreas,2)
    assert.equal(output.liveConnections,false)
    assert.match(output.sourceSha256,/^[a-f0-9]{64}$/)
    assert.ok(existsSync(output.dbPath))
    assert.ok(existsSync(join(folder,'LEEME-DEMO.txt')))
    const report=JSON.parse(readFileSync(output.reportJson,'utf8'))
    const poa=JSON.parse(readFileSync(join(folder,'poa-borrador.json'),'utf8'))
    assert.equal(report.type,'GENESIS-READINESS-DRAFT')
    assert.equal(report.inventory.units,7)
    assert.equal(report.inventory.staffSlots,120)
    assert.equal(report.inventory.sites,2)
    assert.equal(report.census.reviewed,3)
    assert.equal(report.census.verified,2)
    assert.equal(report.budgetByCurrencyAndPeriod['USD:one-time'],1500)
    assert.equal(report.budgetByCurrencyAndPeriod['USD:monthly'],250)
    assert.equal(report.budgetByCurrencyAndPeriod['DOP:monthly'],12500)
    assert.ok(JSON.stringify(poa).includes('ocupacion_hospitalaria_demo'))
    assert.ok(readFileSync(output.reportHtml,'utf8').includes('BORRADOR INTERNO'))
    assert.ok(readFileSync(join(folder,'fuente_sintetica.txt'),'utf8').includes('SIN DATOS REALES'))
    const db=new GenesisWorkbench(output.dbPath)
    try{
      const d=db.dashboard(output.organizationId)
      assert.equal(d.units.reduce((sum,x)=>sum+x.staffCount,0),120)
      assert.equal(d.systems[0].state,'pending-authorization')
      assert.equal(d.providers[0].status,'pending-credential-and-capability-test')
      assert.deepEqual(buildGenesisReadinessBrief(db,output.organizationId).sourceSha256,
        output.sourceSha256)
    }finally{db.close()}
    assert.throws(()=>createGenesisSyntheticDemo(folder),/ya existe/)
  }finally{rmSync(root,{force:true,recursive:true})}
})
test('API/HTML: informe disponible en consola solo con token y aislado por institución',async()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-readiness-http-'))
  const folder=join(root,'demo')
  const demo=createGenesisSyntheticDemo(folder)
  const app=createGenesisConsole({dbPath:demo.dbPath,adminToken:token})
  const {url}=await app.start()
  try{
    const home=await fetch(url)
    assert.equal(home.status,200)
    assert.match(await home.text(),/Diagnóstico ejecutivo/)
    const client=await fetch(url+'/readiness.js')
    assert.equal(client.status,200)
    assert.match(await client.text(),/readiness-html/)
    assert.equal((await fetch(url+'/v1/readiness?organizationId=hospital_genesis_demo')).status,401)
    const path='/v1/readiness?organizationId=hospital_genesis_demo'
    const result=await fetch(url+path,{headers:{authorization:'Bearer '+token}})
    assert.equal(result.status,200)
    assert.match(result.headers.get('cache-control'),/no-store/)
    const report=await result.json()
    assert.equal(report.inventory.units,7)
    assert.equal(report.census.verified,2)
    const html=await fetch(url+'/v1/readiness/html?organizationId=hospital_genesis_demo',
      {headers:{authorization:'Bearer '+token}})
    assert.equal(html.status,200)
    assert.match(html.headers.get('content-type'),/text\/html/)
    assert.match(await html.text(),/BORRADOR INTERNO/)
    assert.equal((await fetch(url+'/v1/readiness?organizationId=otra_org',
      {headers:{authorization:'Bearer '+token}})).status,404)
  }finally{await app.close();rmSync(root,{recursive:true,force:true})}
})
test('demostración no sobrescribe carpetas ni altera la base institucional del usuario',()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-demo-guard-'))
  try{
    const target=join(root,'hospital')
    assert.throws(()=>createGenesisSyntheticDemo(root),/ya existe/)
    assert.throws(()=>createGenesisSyntheticDemo('relative-demo'),/absoluta/)
    assert.equal(existsSync(target),false)
    createGenesisSyntheticDemo(target)
    assert.ok(existsSync(join(target,'genesis.sqlite')))
    assert.throws(()=>createGenesisSyntheticDemo(target),/ya existe/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
