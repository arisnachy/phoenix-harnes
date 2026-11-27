import { describe, expect, it } from 'vitest'
import { DeviceIntelligence } from '../src/device-intelligence.ts'

describe('device intelligence', () => {
  const devices = 'List of devices attached\nSERIAL123 device product:x model:Pixel_8 usb:1\nLOCKED unauthorized\n192.168.1.2:5555 device model:Remote\nemulator-5554 device model:Emulator\n'
  it('redacts identifiers, excludes network targets, and preserves authorization state', async () => {
    const subject = new DeviceIntelligence(async (file) => file==='adb'
      ? {ok:true,stdout:devices} : {ok:true,stdout:'[{"class":"USB","status":"OK","Count":3}]'},'win32')
    const result=await subject.inventory()
    expect(result.windows.groups).toEqual([{class:'USB',status:'OK',count:3}])
    expect(result.android.devices).toHaveLength(2)
    expect(result.android.devices[1]?.state).toBe('unauthorized')
    expect(JSON.stringify(result)).not.toContain('SERIAL123')
    expect(JSON.stringify(result)).not.toContain('192.168')
  })
  it('reads only fixed diagnostics on the authorized target', async () => {
    const calls:string[][]=[]
    const subject=new DeviceIntelligence(async (_file,args)=>{
      calls.push(args)
      return {ok:true,stdout:args[0]==='devices'?devices:args.includes('battery')?'level: 78\ntemperature: 360\nhealth: 2':'14'}
    },'linux')
    const target=(await subject.inventory()).android.devices[0]!.target
    const result=await subject.diagnose(target)
    expect(result).toMatchObject({status:'completed',battery:{levelPercent:78,temperatureDeciC:360,healthCode:2}})
    expect(calls.some(args=>args.includes('reboot'))).toBe(false)
    expect(await subject.diagnose('untrusted')).toMatchObject({status:'unavailable'})
  })
  it('denies reboot without approval and revalidates after approval', async () => {
    let current=devices
    let reboot=0
    const subject=new DeviceIntelligence(async (_file,args)=>{
      if(args.includes('reboot')) reboot++
      return {ok:true,stdout:current}
    },'linux')
    const target=(await subject.inventory()).android.devices[0]!.target
    expect(await subject.reboot(target,async()=>false)).toMatchObject({status:'denied'})
    expect(await subject.reboot(target,async()=>{current='';return true})).toMatchObject({reason:'TARGET_CHANGED'})
    expect(reboot).toBe(0)
    current=devices
    expect(await subject.reboot(target,async()=>true)).toMatchObject({status:'command-accepted',verified:false})
    expect(reboot).toBe(1)
  })
  it('handles missing utilities without inventing devices',async()=>{
    const subject=new DeviceIntelligence(async()=>{throw Error('missing')},'win32')
    expect(await subject.inventory()).toMatchObject({windows:{state:'unavailable',groups:[]},android:{state:'adb-unavailable',devices:[]}})
  })
})
