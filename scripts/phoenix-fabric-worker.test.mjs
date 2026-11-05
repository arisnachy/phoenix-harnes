import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createFabricBroker } from './phoenix-fabric-broker.mjs'

const admin='d'.repeat(64)
const here=fileURLToPath(new URL('./phoenix-fabric-worker.mjs',import.meta.url))
const api=async(url,path,token,method='GET',data)=>{
  const res=await fetch(url+path,{method,headers:{authorization:'Bearer '+token,
    ...(data===undefined?{}:{'content-type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})})
  return {status:res.status,body:await res.json()}
}
test('dos procesos PHOENIX intercambian una tarea real y reciben comprobante',async()=>{
  const root=mkdtempSync(join(tmpdir(),'phoenix-fabric-worker-'))
  const broker=createFabricBroker({dbPath:join(root,'fabric.sqlite'),adminToken:admin})
  const {url}=await broker.start()
  let child
  try{
    const consult=await api(url,'/v1/admin/nodes',admin,'POST',{
      nodeId:'consult1',organizationId:'hospital_demo',siteId:'site1',
      capabilities:['prescriptions.propose'],receivesFrom:[]})
    const worker=await api(url,'/v1/admin/nodes',admin,'POST',{
      nodeId:'pharmacy1',organizationId:'hospital_demo',siteId:'site1',
      capabilities:['fabric.ping'],receivesFrom:['consult1']})
    assert.equal(consult.status,201);assert.equal(worker.status,201)
    const sent=await api(url,'/v1/tasks',consult.body.token,'POST',{
      targetNodeId:'pharmacy1',capability:'fabric.ping',
      idempotencyKey:'test_ping',purpose:'Prueba de conectividad real',
      references:['test_ref'],requiresApproval:false})
    assert.equal(sent.status,201)
    child=spawn(process.execPath,[here],{
      env:{...process.env,PHOENIX_FABRIC_URL:url,
        PHOENIX_FABRIC_NODE_TOKEN:worker.body.token},
      stdio:['ignore','pipe','pipe']
    })
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('El segundo proceso no confirmó la tarea')),15000)
      let output=''
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8')
        if(output.includes('"outcome":"completed"')){
          clearTimeout(timer);resolve(output)
        }
      })
      child.once('error',e=>{clearTimeout(timer);reject(e)})
      child.once('exit',code=>{
        if(!output.includes('"outcome":"completed"')){
          clearTimeout(timer);reject(Error('Worker terminó sin comprobante: '+code))
        }
      })
    })
    assert.match(result,/"resultRef":"fabric_pong"/)
    const receipt=await api(url,'/v1/tasks/'+sent.body.task.taskId,consult.body.token)
    assert.equal(receipt.body.task.state,'completed')
    assert.equal(receipt.body.task.resultRef,'fabric_pong')
  }finally{
    if(child){child.kill('SIGTERM')}
    await broker.close()
    rmSync(root,{recursive:true,force:true})
  }
})
