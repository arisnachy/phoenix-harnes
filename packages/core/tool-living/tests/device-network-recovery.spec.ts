import { describe,expect,it } from 'vitest'
import { DeviceNetworkRecovery } from '../src/device-network-recovery.ts'
describe('device network and recovery adapters',()=>{
  it('discovers only existing private ADB connections without returning addresses',async()=>{
    const tool=new DeviceNetworkRecovery(async(_file,args)=>({ok:true,stdout:args[0]==='devices'?'192.168.1.2:5555 device model:TV\n8.8.8.8:5555 device model:Outside\n10.0.0.2:5555 unauthorized\n':'tv'}))
    const result=await tool.networkInventory()
    expect(result.devices).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('192.168')
    expect(await tool.androidNetworkDiagnose(result.devices[0]!.id)).toMatchObject({television:true})
    expect(await tool.androidNetworkDiagnose(result.devices[1]!.id)).toMatchObject({status:'unavailable'})
  })
  it('redacts recovery identifiers',async()=>{
    const tool=new DeviceNetworkRecovery(async(file)=>({ok:true,stdout:file==='heimdall'?'Device detected':'MODE: DFU\nPRODUCT: iPhone15,2\nECID: SECRET'}))
    const result=await tool.recoveryModes()
    expect(result.apple).toMatchObject({mode:'DFU',product:'iPhone15,2'})
    expect(result.samsung.state).toBe('download-mode-detected')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
  it('denies remote access without approval or to public targets',async()=>{
    let calls=0
    const tool=new DeviceNetworkRecovery(async()=>{calls++;return {ok:true,stdout:'Linux\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 500 500 50% /\n'}})
    expect(await tool.remoteLinux('8.8.8.8','admin',async()=>true)).toMatchObject({status:'denied'})
    expect(await tool.remoteLinux('192.168.1.2','admin',async()=>false)).toMatchObject({status:'denied'})
    expect(calls).toBe(0)
    expect(await tool.remoteLinux('192.168.1.2','admin',async()=>true)).toMatchObject({status:'completed',rootUsagePercent:50})
    expect(calls).toBe(1)
  })

  it('requires authorization and stable hardware identity for remote Android restart',async()=>{
    let serial='SERIAL_A',calls=0
    const tool=new DeviceNetworkRecovery(async(_file,args)=>{
      if(args[0]==='devices')return {ok:true,stdout:'192.168.1.2:5555 device model:TV'}
      if(args.includes('ro.serialno'))return {ok:true,stdout:serial}
      if(args.includes('reboot'))calls++
      return {ok:true,stdout:''}
    })
    const id=(await tool.networkInventory()).devices[0]!.id
    expect(await tool.androidNetworkRestart(id,async()=>false)).toMatchObject({status:'denied'})
    expect(await tool.androidNetworkRestart(id,async()=>{serial='SERIAL_B';return true})).toMatchObject({reason:'TARGET_CHANGED'})
    expect(calls).toBe(0)
    expect(await tool.androidNetworkRestart(id,async()=>true)).toMatchObject({status:'command-accepted',verified:false})
    expect(calls).toBe(1)
  })
})
