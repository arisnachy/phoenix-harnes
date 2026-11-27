import { describe,expect,it } from 'vitest'
import { NetworkIntelligence } from '../src/network-intelligence.ts'
const host={gateway:'192.168.1.1',address:'192.168.1.2',prefix:29,index:4,received:100,sent:200,neighbors:[{IPAddress:'192.168.1.1',State:'Reachable'},{IPAddress:'192.168.1.3',State:'Stale'},{IPAddress:'8.8.8.8',State:'Reachable'}]}
const ok=(stdout:string)=>({ok:true,stdout})
const fail=()=>({ok:false,stdout:''})
describe('Network Intelligence',()=>{
  it('reports only directly connected private neighbors and actual traffic deltas',async()=>{
    let now=1000,received=100
    const t=new NetworkIntelligence(async()=>ok(JSON.stringify({...host,received})),'win32',()=>now)
    const inventory=await t.inventory()
    expect(inventory).toMatchObject({status:'completed',gateway:'192.168.1.1',devices:[{address:'192.168.1.1'},{address:'192.168.1.3'}]})
    expect(await t.monitor()).toMatchObject({receivedBytesPerSecond:null})
    now+=2000;received=300
    expect(await t.monitor()).toMatchObject({receivedBytesPerSecond:100})
  })
  it('requires approval and bounded directly connected private discovery',async()=>{
    const calls:string[][]=[]
    const t=new NetworkIntelligence(async(file,args)=>{
      if(file==='powershell.exe')return ok(JSON.stringify(host))
      calls.push(args);return ok('Reply TTL=64')
    },'win32',()=>100000)
    expect(await t.discover(async()=>false)).toMatchObject({status:'denied'})
    expect(calls).toHaveLength(0)
    expect(await t.discover(async()=>true)).toMatchObject({status:'completed',attempted:5})
    expect(calls).toHaveLength(5)
    expect(await t.discover(async()=>true)).toMatchObject({reason:'DISCOVERY_COOLDOWN'})
  })
  it('does not act if network changes during consent',async()=>{
    let changed=false
    const t=new NetworkIntelligence(async()=>ok(JSON.stringify({...host,index:changed?5:4})),'win32')
    expect(await t.discover(async()=>{changed=true;return true})).toMatchObject({reason:'NETWORK_CHANGED'})
  })
  it('requires known host validation and verified OpenWrt before reboot',async()=>{
    const calls:string[][]=[]
    let verified=false
    const t=new NetworkIntelligence(async(file,args)=>{
      if(file==='powershell.exe')return ok(JSON.stringify(host))
      calls.push(args)
      return verified?ok('{"release":{"distribution":"OpenWrt","version":"24.10"},"model":"Router"}'):fail()
    },'win32')
    expect(await t.router('root','reboot',async()=>false)).toMatchObject({status:'denied'})
    expect(calls).toHaveLength(0)
    expect(await t.router('root','reboot',async()=>true)).toMatchObject({status:'unavailable'})
    expect(calls).toHaveLength(1)
    verified=true
    expect(await t.router('root','reboot',async()=>true)).toMatchObject({status:'command-accepted',verified:false})
    expect(calls.every(a=>a.includes('StrictHostKeyChecking=yes'))).toBe(true)
    expect(calls.at(-1)?.at(-1)).toBe('ubus call system reboot')
  })
  it('fails closed for unsupported hosts and unsafe login names',async()=>{
    const t=new NetworkIntelligence(async()=>fail(),'linux')
    expect(await t.inventory()).toMatchObject({status:'unavailable'})
    expect(await t.router('root;whoami','inspect',async()=>true)).toMatchObject({status:'denied'})
  })

  it('returns bounded router telemetry without exposing Wi-Fi keys or DHCP identifiers',async()=>{
    const t=new NetworkIntelligence(async(file,args)=>{
      if(file==='powershell.exe')return ok(JSON.stringify(host))
      const cmd=args.at(-1)
      if(cmd==='ubus call system board')return ok('{"release":{"distribution":"OpenWrt","version":"24.10"},"model":"Router"}')
      if(cmd==='ubus call network.interface.wan status')return ok('{"up":true,"uptime":900,"ipv4-address":[{"address":"203.0.113.7"}]}')
      if(cmd==='cat /tmp/dhcp.leases')return ok('123456 aa:bb:cc:dd:ee:ff 192.168.1.3 private-host *')
      if(cmd==='ubus call network.wireless status')return ok('{"radio0":{"up":true,"config":{"key":"SECRET"}}}')
      if(cmd==='ubus call system info')return ok('{"uptime":1234}')
      return fail()
    },'win32')
    const result=await t.router('root','inspect',async()=>true)
    expect(result).toMatchObject({status:'completed',wanUp:true,dhcpLeaseCount:1,routerUptimeSeconds:1234,radios:[{name:'radio0',up:true}]})
    expect(JSON.stringify(result)).not.toMatch(/SECRET|private-host|aa:bb|203\.0\.113/u)
  })
  it('only reloads wireless after verified router and explicit approval',async()=>{
    const calls:string[]=[]
    const t=new NetworkIntelligence(async(file,args)=>{
      if(file==='powershell.exe')return ok(JSON.stringify(host))
      calls.push(args.at(-1)??'')
      return ok('{"release":{"distribution":"OpenWrt"}}')
    },'win32')
    expect(await t.router('root','wifi-reload',async()=>false)).toMatchObject({status:'denied'})
    expect(calls).toHaveLength(0)
    expect(await t.router('root','wifi-reload',async()=>true)).toMatchObject({status:'command-accepted',verified:false})
    expect(calls).toEqual(['ubus call system board','wifi reload'])
  })
})
