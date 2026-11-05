import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'
import { createFabricBroker } from './phoenix-fabric-broker.mjs'

const ADMIN='f'.repeat(64)
const GENESIS='c'.repeat(64)
const fixture=JSON.parse(readFileSync(new URL('./phoenix-genesis-fabric-example.json',import.meta.url),'utf8'))
const api=async(base,path,secret,method='GET',data)=>{
  const response=await fetch(base+path,{
    method,headers:{
      authorization:'Bearer '+secret,
      ...(data===undefined?{}:{'content-type':'application/json'})
    },...(data===undefined?{}:{body:JSON.stringify(data)})})
  return {status:response.status,result:await response.json()}
}
test('Genesis verifica Fabric real y registra un PHOENIX sin inventar conectividad',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'genesis-fabric-link-'))
  const previousUrl=process.env.PHOENIX_FABRIC_URL
  const previousAdmin=process.env.PHOENIX_FABRIC_ADMIN_TOKEN
  const broker=createFabricBroker({
    dbPath:join(dir,'fabric.sqlite'),adminToken:ADMIN
  })
  const genesis=createGenesisConsole({
    dbPath:join(dir,'genesis.sqlite'),adminToken:GENESIS
  })
  let brokerOpen=false,consoleOpen=false
  try{
    const a=await broker.start();brokerOpen=true
    const b=await genesis.start();consoleOpen=true
    process.env.PHOENIX_FABRIC_URL=a.url
    process.env.PHOENIX_FABRIC_ADMIN_TOKEN=ADMIN
    assert.equal((await api(b.url,'/v1/organizations',GENESIS,'POST',fixture)).status,201)
    const unit=await api(b.url,'/v1/units',GENESIS,'POST',{
      organizationId:'hospital_ejemplo',unitId:'farmacia',siteId:'campus',
      name:'Farmacia ficticia',staffCount:4,workstations:2,role:'pharmacy'
    })
    assert.equal(unit.status,201)
    const before=await api(b.url,'/v1/fabric/status?organizationId=hospital_ejemplo',GENESIS)
    assert.equal(before.status,200)
    assert.equal(before.result.connected,true)
    assert.equal(before.result.nodes.length,0)
    const denied=await api(b.url,'/v1/fabric/enroll',GENESIS,'POST',{
      approved:false,organizationId:'hospital_ejemplo',
      unitId:'farmacia',siteId:'campus',nodeId:'pharmacy1',
      capabilities:['fabric.ping'],receivesFrom:[]
    })
    assert.equal(denied.status,400)
    const enrolled=await api(b.url,'/v1/fabric/enroll',GENESIS,'POST',{
      approved:true,organizationId:'hospital_ejemplo',
      unitId:'farmacia',siteId:'campus',nodeId:'pharmacy1',
      capabilities:['fabric.ping'],receivesFrom:[]
    })
    assert.equal(enrolled.status,201)
    assert.equal(enrolled.result.token.length,64)
    assert.equal(enrolled.result.oneTimeToken,true)
    const idle=await api(b.url,'/v1/fabric/status?organizationId=hospital_ejemplo',GENESIS)
    assert.equal(idle.result.nodes.length,1)
    assert.equal(idle.result.nodes[0].connected,false)
    assert.equal(JSON.stringify(idle.result).includes(enrolled.result.token),false)
    const heartbeat=await api(a.url,'/v1/nodes/heartbeat',enrolled.result.token,'POST',{})
    assert.equal(heartbeat.status,200)
    const actual=await api(b.url,'/v1/fabric/status?organizationId=hospital_ejemplo',GENESIS)
    assert.equal(actual.result.nodes[0].connected,true)
    const another=await api(b.url,'/v1/fabric/status?organizationId=unknown_org',GENESIS)
    assert.equal(another.status,404)
  }finally{
    if(previousUrl===undefined)delete process.env.PHOENIX_FABRIC_URL
    else process.env.PHOENIX_FABRIC_URL=previousUrl
    if(previousAdmin===undefined)delete process.env.PHOENIX_FABRIC_ADMIN_TOKEN
    else process.env.PHOENIX_FABRIC_ADMIN_TOKEN=previousAdmin
    if(consoleOpen)await genesis.close()
    if(brokerOpen)await broker.close()
    rmSync(dir,{recursive:true,force:true})
  }
})
