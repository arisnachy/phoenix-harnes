import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFabricBroker } from './phoenix-fabric-broker.mjs'

const ADMIN='e'.repeat(64)
const db=()=>join(mkdtempSync(join(tmpdir(),'phoenix-fabric-')),'fabric.sqlite')
function request(url,path,secret,method='GET',data){
  return fetch(url+path,{
    method,headers:{authorization:'Bearer '+secret,
      ...(data===undefined?{}:{'content-type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  }).then(async response=>({status:response.status,body:await response.json()}))
}
const register=(url,nodeId,organizationId,siteId,capabilities,receivesFrom)=>
  request(url,'/v1/admin/nodes',ADMIN,'POST',
    {nodeId,organizationId,siteId,capabilities,receivesFrom})

test('solo loopback funciona sin mTLS, incluso con configuración accidental',()=>{
  assert.throws(()=>createFabricBroker({dbPath:db(),host:'0.0.0.0',port:0,
    adminToken:ADMIN}),/requiere TLS mutuo/)
  assert.throws(()=>createFabricBroker({dbPath:db(),host:'192.168.1.10',port:0,
    adminToken:ADMIN}),/requiere TLS mutuo/)
  assert.throws(()=>createFabricBroker({dbPath:db(),host:'127.0.0.1',port:0,
    adminToken:'short'}),/32 caracteres/)
})

test('nodos independientes, identidad, autorizaciones, tareas, comprobantes y persistencia',async()=>{
  const dbPath=db()
  const broker=createFabricBroker({dbPath,adminToken:ADMIN})
  const {url}=await broker.start()
  try{
    const health=await fetch(url+'/healthz')
    assert.equal(health.status,200)
    const denied=await request(url,'/v1/admin/nodes','f'.repeat(64))
    assert.equal(denied.status,403)
    const consult=await register(url,'consult1','hospital1','campus1',
      ['prescriptions.propose'],[])
    assert.equal(consult.status,201)
    assert.equal(consult.body.token.length,64)
    const pharmacy=await register(url,'pharmacy1','hospital1','campus1',
      ['inventory.preview'],['consult1'])
    assert.equal(pharmacy.status,201)
    const nurse=await register(url,'nurse1','hospital1','campus1',
      ['care.notify'],['pharmacy1'])
    assert.equal(nurse.status,201)
    const foreign=await register(url,'external1','other_org','outside',
      ['inventory.preview'],['consult1'])
    assert.equal(foreign.status,201)
    const duplicate=await register(url,'consult1','hospital1','campus1',[],[])
    assert.equal(duplicate.status,409)
    const summary=await request(url,'/v1/admin/nodes',ADMIN)
    assert.equal(summary.status,200)
    assert.equal(summary.body.nodes.length,4)
    assert.equal(JSON.stringify(summary.body).includes('secret_hash'),false)
    assert.equal(JSON.stringify(summary.body).includes(consult.body.token),false)

    const payload={targetNodeId:'pharmacy1',capability:'inventory.preview',
      idempotencyKey:'prescription_001',purpose:'Revisión de disponibilidad',
      references:['order1'],requiresApproval:true}
    const crossOrg=await request(url,'/v1/tasks',consult.body.token,'POST',
      {...payload,targetNodeId:'external1'})
    assert.equal(crossOrg.status,403)
    const disallowed=await request(url,'/v1/tasks',nurse.body.token,'POST',payload)
    assert.equal(disallowed.status,403)
    const secretPayload=await request(url,'/v1/tasks',consult.body.token,'POST',
      {...payload,payload:{patient:'secret'}})
    assert.equal(secretPayload.status,400)
    const submitted=await request(url,'/v1/tasks',consult.body.token,'POST',payload)
    assert.equal(submitted.status,201)
    assert.equal(submitted.body.task.state,'pending-approval')
    const taskId=submitted.body.task.taskId
    const replay=await request(url,'/v1/tasks',consult.body.token,'POST',payload)
    assert.equal(replay.status,200)
    assert.equal(replay.body.replayed,true)
    assert.equal(replay.body.task.taskId,taskId)
    const conflicting=await request(url,'/v1/tasks',consult.body.token,'POST',
      {...payload,purpose:'Diferente'})
    assert.equal(conflicting.status,409)
    const premature=await request(url,'/v1/tasks/next',pharmacy.body.token)
    assert.equal(premature.body.assignment,null)
    const approve=await request(url,'/v1/admin/tasks/'+taskId+'/approve',
      ADMIN,'POST',{})
    assert.equal(approve.status,200)
    assert.equal(approve.body.task.state,'queued')
    assert.match(approve.body.warning,/no es una firma clínica/)
    const pulled=await request(url,'/v1/tasks/next',pharmacy.body.token)
    assert.equal(pulled.status,200)
    assert.equal(pulled.body.assignment.task.taskId,taskId)
    assert.equal(pulled.body.assignment.task.state,'leased')
    const wrongActor=await request(url,'/v1/tasks/'+taskId+'/finish',
      consult.body.token,'POST',{outcome:'completed',
        leaseToken:pulled.body.assignment.leaseToken,resultRef:'receipt1'})
    assert.equal(wrongActor.status,404)
    const wrongLease=await request(url,'/v1/tasks/'+taskId+'/finish',
      pharmacy.body.token,'POST',{outcome:'completed',
        leaseToken:'f'.repeat(64),resultRef:'receipt1'})
    assert.equal(wrongLease.status,409)
    const completed=await request(url,'/v1/tasks/'+taskId+'/finish',
      pharmacy.body.token,'POST',{outcome:'completed',
        leaseToken:pulled.body.assignment.leaseToken,resultRef:'receipt1'})
    assert.equal(completed.status,200)
    assert.equal(completed.body.task.state,'completed')
    assert.equal(completed.body.task.resultRef,'receipt1')
    const receipt=await request(url,'/v1/tasks/'+taskId,consult.body.token)
    assert.equal(receipt.status,200)
    assert.equal(receipt.body.task.state,'completed')
    const unauthorizedRead=await request(url,'/v1/tasks/'+taskId,nurse.body.token)
    assert.equal(unauthorizedRead.status,404)

    const queued=await request(url,'/v1/tasks',pharmacy.body.token,'POST',
      {targetNodeId:'nurse1',capability:'care.notify',
        idempotencyKey:'notification_001',purpose:'Aviso sin datos identificables',
        references:['receipt1'],requiresApproval:false})
    assert.equal(queued.status,201)
    assert.equal(queued.body.task.state,'queued')
    const heartbeat=await request(url,'/v1/nodes/heartbeat',nurse.body.token,'POST',{})
    assert.equal(heartbeat.status,200)
    assert.equal(heartbeat.body.ok,true)
    await broker.close()

    const restarted=createFabricBroker({dbPath,adminToken:ADMIN})
    const next=await restarted.start()
    try{
      const recovered=await request(next.url,'/v1/tasks/next',nurse.body.token)
      assert.equal(recovered.status,200)
      assert.equal(recovered.body.assignment.task.taskId,queued.body.task.taskId)
      const ack=await request(next.url,'/v1/tasks/'+queued.body.task.taskId+'/finish',
        nurse.body.token,'POST',{outcome:'completed',
          leaseToken:recovered.body.assignment.leaseToken,resultRef:'delivered1'})
      assert.equal(ack.body.task.state,'completed')
      const metrics=await request(next.url,'/v1/admin/metrics',ADMIN)
      assert.equal(metrics.status,200)
      assert.deepEqual(metrics.body.states,[{state:'completed',count:2}])
      const revoke=await request(next.url,'/v1/admin/nodes/pharmacy1/revoke',
        ADMIN,'POST',{})
      assert.equal(revoke.status,200)
      const invalidated=await request(next.url,'/v1/nodes/heartbeat',
        pharmacy.body.token,'POST',{})
      assert.equal(invalidated.status,401)
    }finally{await restarted.close()}
  }catch(error){
    // A failed assertion must not leave a listening server behind.
    try{await broker.close()}catch{}
    throw error
  }finally{rmSync(dirname(dbPath),{recursive:true,force:true})}
})
