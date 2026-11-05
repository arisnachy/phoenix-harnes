import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'

const ADMIN='c'.repeat(64)
const spec=(org,industry='healthcare')=>({
  organizationId:org,name:'Organización ficticia',industry,adoptionMode:'hybrid',
  network:{mode:'isolated'},sites:[{siteId:'central',name:'Campus central',
    workstations:10,reusableWorkstations:5,roles:[],software:[]}]
})
const request=async(url,path,method='GET',data,token=ADMIN)=>{
  const response=await fetch(url+path,{method,
    headers:{authorization:'Bearer '+token,
      ...(data===undefined?{}:{'content-type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})})
  return {status:response.status,response:await response.json()}
}
test('HTTP/UI: censo por institución, autorización, documentación y versiones',async()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-census-http-'))
  const dbPath=join(root,'genesis.sqlite')
  const note=join(root,'acta.txt')
  writeFileSync(note,'Acta ficticia: el comité verificó el organigrama de la sede.')
  const app=createGenesisConsole({dbPath,adminToken:ADMIN})
  const {url}=await app.start()
  try{
    const page=await fetch(url)
    assert.equal(page.status,200)
    assert.match(await page.text(),/Censo hospitalario/)
    const js=await fetch(url+'/census.js')
    assert.equal(js.status,200)
    assert.match(await js.text(),/form-census/)
    assert.match(js.headers.get('content-type'),/text\/javascript/)
    assert.equal((await fetch(url+'/v1/census?organizationId=hospital_demo')).status,401)
    assert.equal((await request(url,'/v1/organizations','POST',spec('hospital_demo'))).status,201)
    assert.equal((await request(url,'/v1/organizations','POST',spec('restaurante_demo','restaurant'))).status,201)
    const first=await request(url,'/v1/census?organizationId=hospital_demo')
    assert.equal(first.status,200)
    assert.equal(first.response.total,60)
    assert.equal(first.response.summary.reviewed,0)
    assert.equal(first.response.areas[0].revision,0)
    const other=await request(url,'/v1/census?organizationId=restaurante_demo')
    assert.equal(other.response.available,false)
    assert.equal(other.response.total,0)
    const unauthorized=await request(url,'/v1/census/assess','POST',
      {organizationId:'hospital_demo',areaId:'area_001',state:'existing',
        reviewerRole:'Dirección',expectedRevision:0},'e'.repeat(64))
    assert.equal(unauthorized.status,401)
    const assessment={organizationId:'hospital_demo',areaId:'area_001',
      state:'existing',reviewState:'declared',reviewerRole:'Dirección General',
      siteId:'central',evidenceRefs:[],expectedRevision:0}
    const made=await request(url,'/v1/census/assess','POST',assessment)
    assert.equal(made.status,201)
    assert.equal(made.response.result.revision,1)
    assert.equal(made.response.result.installed,false)
    const evidence=await request(url,'/v1/evidence','POST',{
      organizationId:'hospital_demo',filePath:note,kind:'org_chart',validated:true
    })
    assert.equal(evidence.status,201)
    const update=await request(url,'/v1/census/assess','POST',{
      ...assessment,reviewState:'verified',
      evidenceRefs:[evidence.response.result.evidenceId],expectedRevision:1
    })
    assert.equal(update.status,201)
    assert.equal(update.response.result.revision,2)
    const stale=await request(url,'/v1/census/assess','POST',{
      ...assessment,state:'outsourced',expectedRevision:1})
    assert.equal(stale.status,409)
    const evaluated=await request(url,'/v1/census?organizationId=hospital_demo')
    assert.equal(evaluated.response.summary.reviewed,1)
    assert.equal(evaluated.response.summary.verified,1)
    assert.equal(evaluated.response.areas[0].state,'existing')
    assert.equal(evaluated.response.areas[0].revision,2)
    assert.equal((await request(url,'/v1/dashboard?organizationId=hospital_demo')).response.units.length,0)
    const deniedSite=await request(url,'/v1/census/assess','POST',{
      ...assessment,areaId:'area_002',siteId:'unknown',expectedRevision:0})
    assert.equal(deniedSite.status,404)
  }finally{await app.close();rmSync(root,{recursive:true,force:true})}
})
test('migración SQLite preserva censos guardados antes de la columna revision',()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-census-legacy-'))
  const dbPath=join(root,'genesis.sqlite')
  let workbench=new GenesisWorkbench(dbPath)
  try{
    workbench.createOrganization(spec('legacy_hospital'))
    workbench.db.exec('CREATE TABLE genesis_area_census (org_id TEXT NOT NULL,area_id TEXT NOT NULL,state TEXT NOT NULL,review_state TEXT NOT NULL,reviewer_role TEXT NOT NULL,site_id TEXT,evidence_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,area_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id))')
    workbench.db.prepare('INSERT INTO genesis_area_census(org_id,area_id,state,review_state,reviewer_role,site_id,evidence_json,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('legacy_hospital','area_001','existing','declared','Dirección',null,'[]','2026-11-05T00:00:00.000Z')
    workbench.close()
    workbench=new GenesisWorkbench(dbPath)
    const { listGenesisAreaCensus,assessGenesisArea }=
      await import('./phoenix-genesis-area-census.mjs')
    const before=listGenesisAreaCensus(workbench,'legacy_hospital')
    assert.equal(before.areas[0].revision,1)
    assert.equal(before.areas[0].state,'existing')
    const saved=assessGenesisArea(workbench,{
      organizationId:'legacy_hospital',areaId:'area_001',state:'not-applicable',
      reviewerRole:'Dirección',expectedRevision:1
    })
    assert.equal(saved.revision,2)
    assert.equal(listGenesisAreaCensus(workbench,'legacy_hospital')
      .areas[0].state,'not-applicable')
  }finally{workbench.close();rmSync(root,{recursive:true,force:true})}
})
