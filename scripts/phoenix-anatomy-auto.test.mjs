import test from 'node:test'
import assert from 'node:assert/strict'
import { needsInstall, status, ensure, SCHEMA } from './phoenix-anatomy-auto.mjs'
test('empty state requires install',()=>assert.equal(needsInstall(null),true))
test('complete current state skips install',()=>{
 const components=Object.fromEntries(['dicom','volume3d','meshes','monai','nnunetv2','totalsegmentator','slicer'].map(id=>[id,{status:'installed'}]))
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
