import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import { registerSpaceRoutes } from '../src/space-routes.ts'

type Handler=(req:IncomingMessage,res:ServerResponse)=>Promise<void>
const roots:string[]=[]
const disposal:Array<()=>void>=[]
const former=process.env.PHOENIX_SPACE_HOME
afterEach(()=>{
  disposal.splice(0).forEach(fn=>fn())
  roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}))
  if(former===undefined)delete process.env.PHOENIX_SPACE_HOME
  else process.env.PHOENIX_SPACE_HOME=former
})
function setup(host='127.0.0.1') {
  const root=mkdtempSync(join(tmpdir(),'phoenix-space-api-'))
  process.env.PHOENIX_SPACE_HOME=root
  roots.push(root)
  let handler:Handler|undefined
  let teardown:(()=>void)|undefined
  const warn=vi.fn()
  const ctx={
    webServer:{
      host,
      register:(input:{handler:Handler})=>{handler=input.handler;return ()=>{}},
    },
    logger:{warn},
    effect:(factory:()=>()=>void)=>{teardown=factory();disposal.push(teardown)},
  } as unknown as Context
  registerSpaceRoutes(ctx)
  return {handler,warn}
}
async function request(handler:Handler,path:string,method='GET',data?:Record<string,unknown>,options:{
  address?:string;host?:string;origin?:string;header?:string
}={}) {
  let status=0
  let responseHeaders:Record<string,string>={}
  let result:Buffer=Buffer.alloc(0)
  const host=options.host??'127.0.0.1:3080'
  const req={
    method,url:path,socket:{remoteAddress:options.address??'127.0.0.1'},
    headers:{host,origin:options.origin??'http://'+host,
      'content-type':'application/json','x-phoenix-space':options.header??'1'},
    async *[Symbol.asyncIterator](){if(data!==undefined)yield Buffer.from(JSON.stringify(data))},
  } as unknown as IncomingMessage
  const res={
    writeHead(code:number,headers:Record<string,string>){status=code;responseHeaders=headers;return this},
    end(payload?:Buffer|string){result=Buffer.from(payload??'');return this},
  } as unknown as ServerResponse
  await handler(req,res)
  let json:unknown=null
  try{json=JSON.parse(result.toString('utf8'))}catch{/* Binary export */}
  return {status,headers:responseHeaders,data:result,json}
}
describe('PHOENIX Space loopback-only API',()=>{
  it('does not mount a remote library surface',()=>{
    const app=setup('0.0.0.0')
    expect(app.handler).toBeUndefined()
    expect(app.warn).toHaveBeenCalledOnce()
  })
  it('blocks nonlocal peers and cross-origin mutating requests',async()=>{
    const h=setup().handler!
    const denied=await request(h,'/space-api/items','POST',{kind:'document'},{
      address:'192.0.2.2',
    })
    expect(denied.status).toBe(403)
    expect((await request(h,'/space-api/items','GET',undefined,{host:'malicious.example'})).status).toBe(403)
    expect((await request(h,'/space-api/items','POST',{},{
      origin:'http://evil.example',
    })).status).toBe(403)
    expect((await request(h,'/space-api/items','POST',{},{
      header:'0',
    })).status).toBe(403)
  })
  it('creates, searches, edits and exports an XLSX without exposing filesystem paths',async()=>{
    const h=setup().handler!
    const created=await request(h,'/space-api/items','POST',{
      kind:'sheet',space:'docencia',title:'Informe económico',
      mime:'application/vnd.phoenix.sheet+json',
      content:JSON.stringify({columns:['Nombre','Importe'],rows:[['Salud','100']]}),
    })
    expect(created.status).toBe(201)
    const item=(created.json as {item:{id:string;revision:number}}).item
    const found=await request(h,'/space-api/items?q=econ%C3%B3mico','GET')
    expect((found.json as {items:unknown[]}).items).toHaveLength(1)
    expect((found.json as {items:Record<string,unknown>[]}).items[0]?.content).toBeUndefined()
    const updated=await request(h,'/space-api/items/'+item.id,'PUT',{revision:1,title:'Informe 2'})
    expect(updated.status).toBe(200)
    const conflict=await request(h,'/space-api/items/'+item.id,'PUT',{revision:1,title:'Conflicto'})
    expect(conflict.status).toBe(409)
    const downloaded=await request(h,'/space-api/items/'+item.id+'/export?format=xlsx')
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers['content-type']).toContain('spreadsheetml')
    expect(downloaded.data.readUInt32LE(0)).toBe(0x04034b50)
    expect((await request(h,'/space-api/items/../../secrets')).status).toBe(404)
  })
  it('imports and retrieves bounded binary data as attachment, not inline HTML',async()=>{
    const h=setup().handler!
    const uploaded=await request(h,'/space-api/import','POST',{
      title:'mi-logo.png',mime:'image/png',base64:Buffer.from('fake-png-byte-content').toString('base64'),
    })
    expect(uploaded.status).toBe(201)
    const item=(uploaded.json as {item:{id:string}}).item
    const original=await request(h,'/space-api/items/'+item.id+'/file')
    expect(original.status).toBe(200)
    expect(original.headers['content-disposition']).toContain('attachment;')
    expect(original.data.toString('utf8')).toBe('fake-png-byte-content')
  })
})
it('enforces distribution on export and inherited alternatives, including explicit declassification',async()=>{
  const h=setup().handler!
  const created=await request(h,'/space-api/items','POST',{kind:'document',space:'personal',title:'Private',mime:'text/plain',content:'synthetic'})
  const id=(created.json as {item:{id:string}}).item.id
  const path='/space-api/items/'+id
  expect((await request(h,path+'/distribution','PUT',{revision:1,restricted:true,confirm:true})).status).toBe(200)
  expect((await request(h,path+'/export?format=portable')).status).toBe(403)
  const fork=await request(h,path+'/fork','POST',{revision:1,title:'Variant'})
  const child=(fork.json as {item:{id:string}}).item.id
  expect((await request(h,'/space-api/items/'+child+'/export?format=json')).status).toBe(403)
  expect((await request(h,path+'/distribution','PUT',{revision:1,restricted:false,confirm:false})).status).toBe(400)
  expect((await request(h,path+'/distribution','PUT',{revision:1,restricted:false,confirm:true})).status).toBe(200)
  expect((await request(h,path+'/export?format=json')).status).toBe(200)
  expect((await request(h,'/space-api/items/'+child+'/export?format=json')).status).toBe(403)
})

it('requires explicit reconciliation and preserves independent concurrent metadata edits',async()=>{
  const h=setup().handler!
  const created=await request(h,'/space-api/items','POST',{kind:'document',space:'personal',title:'Original',mime:'text/plain',content:'base'})
  const id=(created.json as {item:{id:string}}).item.id
  const path='/space-api/items/'+id
  expect((await request(h,path,'PUT',{revision:1,title:'Remote title'})).status).toBe(200)
  const draft={revision:1,title:'Original',space:'personal',content:'Local text'}
  expect((await request(h,path+'/reconcile','POST',{...draft,confirm:false})).status).toBe(400)
  const merged=await request(h,path+'/reconcile','POST',{...draft,confirm:true})
  expect(merged.status).toBe(200)
  expect(merged.json).toMatchObject({item:{title:'Remote title',content:'Local text',revision:3}})
  expect((await request(h,path+'/reconcile','POST',{...draft,content:'Conflicting text',confirm:true})).status).toBe(409)
})
