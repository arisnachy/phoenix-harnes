import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildInvocation,validateInput,runSimulation,execute} from './phoenix-anatomy-simulation.mjs'

test('rejects unsupported engine and incorrect parameter types',()=>{
 const dir=mkdtempSync(join(tmpdir(),'phoenix-sim-'))
 try{
  const f=join(dir,'vascular.json');writeFileSync(f,'{"sim":true}')
  assert.throws(()=>validateInput('not-a-solver',f,join(dir,'result.csv')))
  assert.throws(()=>validateInput('opencarp',f,join(dir,'result.csv')))
  assert.deepEqual(validateInput('svzerod',f,join(dir,'result.csv')).source,f)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('builds Windows openCARP invocation without a shell and with WSL distro',()=>{
 const inv=buildInvocation('opencarp','/mnt/c/model.par','/mnt/c/outputs/run','win32',
  {PHOENIX_ANATOMY_WSL_DISTRO:'Ubuntu-24.04'})
 assert.equal(inv.cmd,'wsl.exe')
 assert.deepEqual(inv.args.slice(-5),['openCARP','-par','/mnt/c/model.par','-simID','/mnt/c/outputs/run'])
 assert.equal(inv.args[1],'Ubuntu-24.04')
})
test('refuses unverified SimVascular executable outside vendor installation',()=>{
 assert.throws(()=>buildInvocation('simvascular','','','win32',
  {PHOENIX_SIMVASCULAR_BIN:'/tmp/unknown/simvascular'}),/Verified/)
})
test('requires explicit research mode before running solvers',async()=>{
 await assert.rejects(()=>runSimulation({engine:'svzerod',input:'fake.json',output:'fake.csv'}),/research-only/)
})
test('real subprocess runner executes a harmless local program',async()=>{
 const result=await execute({cmd:process.execPath,args:['-e','process.stdout.write("solver-smoke")']},{timeoutMs:7000})
 assert.equal(result.exitCode,0)
 assert.equal(result.stdout,'solver-smoke')
})

test('svMultiPhysics 3D only accepts project-contained XML output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'phoenix-sv3d-'))
 try{
  const xml=join(dir,'solver.xml');writeFileSync(xml,'<Simulation><Mesh>prepared-by-specialist</Mesh></Simulation>')
  assert.throws(()=>validateInput('svmultiphysics',xml,join(dir,'wrong')),/1-procs/)
  assert.equal(validateInput('svmultiphysics',xml,join(dir,'1-procs')).source,xml)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('svMultiPhysics Windows runs XML from WSL project without invoking a shell',()=>{
 const inv=buildInvocation('svmultiphysics','solver.xml','','win32',{
  PHOENIX_ANATOMY_WSL_DISTRO:'Ubuntu-24.04',
  PHOENIX_SVMULTIPHYSICS_WORKDIR:'/mnt/c/study',
 })
 assert.deepEqual(inv.args.slice(-5),['--cd','/mnt/c/study','--exec','svmultiphysics','solver.xml'])
})
