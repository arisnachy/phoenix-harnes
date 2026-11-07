import { mkdtempSync, mkdirSync, writeFileSync, rmSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { needsInstall, status, ensure, hasWeightFiles, validAnatomyComponent, SCHEMA } from './phoenix-anatomy-auto.mjs'
test('empty state requires install',()=>assert.equal(needsInstall(null),true))
test('complete current state skips install',()=>{
 const components=Object.fromEntries(['dicom','volume3d','meshes','monai','nnunetv2','totalsegmentator','svzerod','slicer','slicerheart','viewer','weights_ct'].map(id=>[id,{status:'installed'}]))
 assert.equal(needsInstall({schema:SCHEMA,updatedAt:new Date().toISOString(),components}),false)
})
test('partial state can retry after a day',()=>{
 assert.equal(needsInstall({schema:SCHEMA,updatedAt:'2025-01-01T00:00:00Z',components:{}}),true)
})
test('CI never launches optional installation',()=>{
 const env={...process.env,CI:'true',PHOENIX_ANATOMY_HOME:'/tmp/phoenix-anatomy-uninstalled-test'}
 const result=ensure(env,()=>{throw Error('should not launch')})
 assert.equal(result.status,'disabled')
 assert.equal(status(env).clinicallyValidated,false)
})

test('partial installation after daily backoff starts fresh installer',()=>{
 const components={dicom:{status:'installed'},weights_ct:{status:'error'}}
 const t=Date.now()
 assert.equal(needsInstall({schema:SCHEMA,updatedAt:new Date(t).toISOString(),components},t),false)
 assert.equal(needsInstall({schema:SCHEMA,updatedAt:new Date(t).toISOString(),components},t+25*3600000),true)
})
test('older anatomy installer manifest forces repair instead of false success',()=>{
 assert.equal(needsInstall({schema:SCHEMA-1,components:{viewer:{status:'installed'}}}),true)
})

test('model presence requires actual checkpoint file rather than an empty result folder',t=>{
  const home=mkdtempSync(join(tmpdir(),'phoenix-anatomy-weights-'))
  t.after(()=>rmSync(home,{recursive:true,force:true}))
  const results=join(home,'nnunet','results','Dataset001','trainer','fold_0')
  mkdirSync(results,{recursive:true})
  assert.equal(hasWeightFiles(home),false)
  const path=join(results,'checkpoint_final.pth')
  writeFileSync(path,Buffer.from('incomplete checkpoint'))
  assert.equal(hasWeightFiles(home),false)
  truncateSync(path,11*1024*1024)
  assert.equal(hasWeightFiles(home),true)
})

test('only supported connector identifiers can request local installation',()=>{
 for(const id of ['slicerheart','monai-nnunet','totalsegmentator','ohif-cornerstone',
   'simvascular','opencarp','three-vtk'])
   assert.equal(validAnatomyComponent(id),true,id)
 for(const id of ['../danger','bash -c rm -rf','',null,undefined,'all'])
   assert.equal(validAnatomyComponent(id),false,String(id))
})
