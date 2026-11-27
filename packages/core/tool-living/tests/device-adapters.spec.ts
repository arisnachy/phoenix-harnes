import { describe, expect, it } from 'vitest'
import { DeviceAdapters } from '../src/device-adapters.ts'
const udid='12345678901234567890abcdef1234567890abcd'
const pnp='USB\\VID_1234&PID_4321\\EXAMPLE'
const ok=(stdout='')=>({ok:true,stdout})
const fail=()=>({ok:false,stdout:''})
describe('Device Doctor adapter contract',()=>{
  it('redacts device identifiers and distinguishes actual probe failures',async()=>{
    const adapter=new DeviceAdapters(async(file)=>file==='fastboot'?ok('SERIAL123 fastboot\n'):file==='idevice_id'?ok(udid):fail(),'linux')
    const report=await adapter.inventory()
    expect(report.targets.map(t=>t.kind)).toEqual(['fastboot','ios'])
    expect(JSON.stringify(report)).not.toContain(udid)
    expect(JSON.stringify(report)).not.toContain('SERIAL123')
    expect(report.probes.peripherals).toBe(false)
  })
  it('reads only Fastboot product metadata from stderr',async()=>{
    const adapter=new DeviceAdapters(async(file,args)=>file==='fastboot'?(args[0]==='devices'?ok('SERIAL123 fastboot\n'):{ok:true,stdout:'',stderr:'product: panther\nFinished.'}):fail(),'linux')
    const id=(await adapter.inventory()).targets[0]!.id
    expect(await adapter.diagnose(id)).toMatchObject({status:'completed',product:'panther',firmwareWrite:false})
    expect(await adapter.restart(id,async()=>true)).toMatchObject({status:'denied'})
  })
  it('requires pairing, explicit approval and revalidation for iOS restart',async()=>{
    let paired=false, present=true, restarts=0
    const adapter=new DeviceAdapters(async(file)=>{
      if(file==='idevice_id')return ok(present?udid:'')
      if(file==='idevicepair')return paired?ok():fail()
      if(file==='idevicediagnostics'){restarts++;return ok()}
      return fail()
    },'linux')
    const id=(await adapter.inventory()).targets[0]!.id
    expect(await adapter.diagnose(id)).toMatchObject({reason:'PAIRING_NOT_VALIDATED'})
    expect(await adapter.restart(id,async()=>true)).toMatchObject({status:'denied'})
    paired=true
    expect(await adapter.restart(id,async()=>false)).toMatchObject({status:'denied'})
    expect(await adapter.restart(id,async()=>{present=false;return true})).toMatchObject({reason:'TARGET_CHANGED'})
    expect(restarts).toBe(0)
    present=true
    expect(await adapter.restart(id,async()=>true)).toMatchObject({status:'command-accepted',verified:false})
    expect(restarts).toBe(1)
  })
  it('targets a single Windows audio endpoint, never runs model-provided commands',async()=>{
    const calls:string[][]=[]
    const adapter=new DeviceAdapters(async(file,args)=>{
      if(file==='powershell.exe')return ok(JSON.stringify({InstanceId:pnp,Class:'AudioEndpoint',FriendlyName:'Speaker',Status:'Error'}))
      if(file==='pnputil.exe'){calls.push(args);return ok()}
      return fail()
    },'win32')
    const id=(await adapter.inventory()).targets[0]!.id
    expect(await adapter.diagnose(id)).toMatchObject({pnpStatus:'Error',health:'not-verified'})
    await adapter.restart(id,async()=>true)
    expect(calls).toEqual([['/restart-device',pnp]])
    expect(await adapter.restart('invalid',async()=>true)).toMatchObject({status:'denied'})
  })
  it('provides recovery guidance rather than claiming to flash a device',()=>{
    const adapter=new DeviceAdapters(async()=>fail(),'linux')
    expect(adapter.recovery('apple')).toMatchObject({status:'official-guidance',executed:false})
    expect(adapter.recovery('constructor')).toMatchObject({url:null,executed:false})
  })
  it('handles unavailable Windows network and host probes',async()=>{
    const adapter=new DeviceAdapters(async()=>fail(),'linux')
    expect(await adapter.network()).toMatchObject({status:'unavailable',groups:[]})
    expect(await adapter.host()).toEqual({status:'unavailable'})
  })
})
