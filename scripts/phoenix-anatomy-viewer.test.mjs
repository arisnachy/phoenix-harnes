import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {modelFiles,startViewer} from './phoenix-anatomy-viewer.mjs'

test('refuses missing research manifest',()=>assert.throws(()=>modelFiles('/not-a-patient-model')))
test('refuses misleading diagnostic claims',()=>{
 const folder=mkdtempSync(join(tmpdir(),'phoenix-bad-anatomy-'))
 try{
  writeFileSync(join(folder,'anatomy.glb'),'dummy')
  writeFileSync(join(folder,'anatomy-manifest.json'),JSON.stringify({clinicalStatus:'VALIDATED'}))
  assert.throws(()=>modelFiles(folder),/misleading clinical status/)
 }finally{rmSync(folder,{recursive:true,force:true})}
})
test('refuses public interfaces',async()=>assert.rejects(
 startViewer({folder:'unused',host:'0.0.0.0'}),/loopback/
))
test('serves only an explicitly authorized local model and bundled scripts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'phoenix-view-test-'))
 const previous=process.env.PHOENIX_ANATOMY_HOME
 let server
 try{
  process.env.PHOENIX_ANATOMY_HOME=join(dir,'anatomy-home')
  const folder=join(dir,'research-case')
  mkdirSync(folder,{recursive:true})
  writeFileSync(join(folder,'anatomy.glb'),Buffer.from('GLB-RESEARCH-STUB'))
  writeFileSync(join(folder,'anatomy-manifest.json'),JSON.stringify({
   clinicalStatus:'UNVALIDATED_RESEARCH_OUTPUT',needsExpertReview:true,structures:[]
  }))
  const base=join(process.env.PHOENIX_ANATOMY_HOME,'viewer','node_modules','three')
  for(const file of [
   'build/three.module.js','build/three.core.js',
   'examples/jsm/loaders/GLTFLoader.js','examples/jsm/controls/OrbitControls.js',
   'examples/jsm/utils/BufferGeometryUtils.js'
  ]){
   const path=join(base,file);mkdirSync(join(path,'..'),{recursive:true})
   writeFileSync(path,'export const test = true;')
  }
  const view=await startViewer({folder});server=view.server
  assert.equal((await fetch(view.url)).status,200)
  assert.equal((await fetch(view.url+'anatomy.glb')).status,200)
  assert.equal((await fetch(view.url+'anatomy-manifest.json')).status,200)
  assert.equal((await fetch(view.url+'build/three.core.js')).status,200)
  assert.equal((await fetch(view.url+'examples/jsm/utils/BufferGeometryUtils.js')).status,200)
  assert.equal((await fetch(view.url+'..%2F..%2Fsecret')).status,404)
  assert.equal((await fetch(view.url+'not-allowed.txt')).status,404)
  assert.equal((await fetch(view.url,{method:'POST'})).status,405)
  const wrong=view.url.replace(/\/view\/[a-f0-9]{64}\//,'/view/wrong-token/')
  assert.equal((await fetch(wrong)).status,404)
 }finally{
  if(server)await new Promise(ok=>server.close(ok))
  if(previous===undefined)delete process.env.PHOENIX_ANATOMY_HOME
  else process.env.PHOENIX_ANATOMY_HOME=previous
  rmSync(dir,{recursive:true,force:true})
 }
})
