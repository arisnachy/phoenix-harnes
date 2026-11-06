import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {modelFiles,startViewer} from './phoenix-anatomy-viewer.mjs'
test('refuses nonexistent models',()=>assert.throws(()=>modelFiles('/not-a-patient-model')))
test('refuses to display model misrepresented as clinically validated',()=>{
 const folder=mkdtempSync(join(tmpdir(),'phoenix-anatomy-'))
 try{
  writeFileSync(join(folder,'anatomy.glb'),'dummy')
  writeFileSync(join(folder,'anatomy-manifest.json'),JSON.stringify({clinicalStatus:'VALIDATED'}))
  assert.throws(()=>modelFiles(folder),/misleading clinical status/)
 }finally{rmSync(folder,{recursive:true,force:true})}
})
test('rejects network listener',async()=>assert.rejects(startViewer({folder:'unused',host:'0.0.0.0'}),/loopback/))
