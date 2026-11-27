import { describe, expect, it } from 'vitest'
import { ManagedRouter } from '../src/managed-router.ts'

const gateway='10.0.0.1'
const profile={vendor:'mikrotik',gateway,username:'operator',fingerprint:'A'.repeat(64),encrypted:'a'.repeat(64)}
describe('Managed router local enrollment',()=>{
  it('does not decrypt without a matching private gateway',async()=>{
    let calls=0
    const router=new ManagedRouter(async()=>profile,async()=>{calls++;return 'SECRET'})
    expect(await router.inspect('8.8.8.8',async()=>gateway)).toMatchObject({status:'enrollment-required'})
    expect(await router.inspect('10.0.0.2',async()=>gateway)).toMatchObject({status:'enrollment-required'})
    expect(await router.inspect(gateway,async()=>null)).toMatchObject({reason:'NETWORK_CHANGED'})
    expect(calls).toBe(0)
  })
  it('reports only safe telemetry and can reuse enrollment',async()=>{
    const router=new ManagedRouter(async()=>profile,async()=> 'SECRET',async(_p,_m,path)=>{
      if(path==='/rest/system/resource')return {version:'7.19', 'board-name':'Router', 'cpu-load':'10',password:'SECRET'}
      if(path.startsWith('/rest/interface'))return [{running:'true',name:'PRIVATE'}]
      return [{status:'bound',address:'PRIVATE'}]
    })
    expect(await router.status(gateway)).toMatchObject({status:'enrolled',authenticated:false})
    for(let i=0;i<2;i++){
      const value=await router.inspect(gateway,async()=>gateway)
      expect(value).toMatchObject({status:'completed',authenticated:true,interfaceCount:1,boundDhcpLeases:1})
      expect(JSON.stringify(value)).not.toMatch(/SECRET|PRIVATE|encrypted|operator/u)
    }
  })
  it('fails without retry or raw error disclosure',async()=>{
    let calls=0
    const router=new ManagedRouter(async()=>profile,async()=> 'SECRET',async()=>{calls++;throw new Error('SECRET')})
    expect(await router.inspect(gateway,async()=>gateway)).toMatchObject({reason:'ROUTER_AUTH_TLS_OR_API_FAILED'})
    expect(calls).toBe(1)
  })
  it('authenticates OpenWrt, verifies vendor and disposes the session',async()=>{
    const calls:string[]=[]
    const router=new ManagedRouter(async()=>({...profile,vendor:'openwrt'}),async()=> 'SECRET',async(_p,_m,_path,_auth,body)=>{
      const params=(body as {params:unknown[]}).params
      const method=String(params[2]);calls.push(method)
      const result=method==='login'?{ubus_rpc_session:'a'.repeat(32)}:method==='board'?{release:{distribution:'OpenWrt',version:'24.10'},model:'Router'}:method==='info'?{uptime:50}:String(params[1])==='network.interface.wan'?{up:true}:{radio0:{up:true,key:'SECRET'}}
      return {result:[0,result]}
    })
    const value=await router.inspect(gateway,async()=>gateway)
    expect(value).toMatchObject({status:'completed',vendor:'openwrt',wanUp:true})
    expect(JSON.stringify(value)).not.toContain('SECRET')
    expect(calls.at(-1)).toBe('destroy')
  })
  it('requires separate approval and never retries an uncertain restart',async()=>{
    const calls:string[]=[]
    const router=new ManagedRouter(async()=>profile,async()=> 'SECRET',async(_p,_m,path)=>{
      calls.push(path)
      if(path==='/rest/system/resource')return {version:'7.19','board-name':'Router'}
      throw new Error('disconnected')
    })
    expect(await router.reboot(gateway,async()=>gateway,async()=>false)).toMatchObject({status:'denied'})
    expect(calls).toHaveLength(0)
    expect(await router.reboot(gateway,async()=>gateway,async()=>true)).toMatchObject({status:'unknown-outcome',verified:false})
    expect(calls).toEqual(['/rest/system/resource','/rest/system/reboot'])
  })
  it('blocks repeat authentication immediately after a failed request',async()=>{
    let calls=0
    const router=new ManagedRouter(async()=>profile,async()=> 'SECRET',async()=>{calls++;throw new Error('auth failed')})
    await router.inspect(gateway,async()=>gateway)
    expect(await router.inspect(gateway,async()=>gateway)).toMatchObject({reason:'ROUTER_AUTH_COOLDOWN'})
    expect(calls).toBe(1)
  })
})
