import { describe, expect, it, vi } from 'vitest'
import { inspectSystemEnvironment, searchLocalApps } from '../src/system-proprioception.ts'

describe('System proprioception privacy and authority', () => {
  it('searches explicitly requested installed software without enumerating all programs',()=>{
    const runner=vi.fn((_cmd:string,_args:readonly string[],_opts:Record<string,unknown>)=>({
      status:0,stdout:JSON.stringify({matches:['Blender 4.5','Blender Launcher']}),
    }))
    const result=searchLocalApps('Blender',{platform:'win32',runner})
    expect(result.status).toBe('matches')
    expect(result.names).toEqual(['Blender 4.5','Blender Launcher'])
    expect(result.authorized).toBe(false)
    expect(JSON.stringify(result)).not.toContain('AppID')
    expect(runner).toHaveBeenCalledTimes(1)
    const malicious=searchLocalApps("Blender'; Remove-Item C:/*",{platform:'win32',runner})
    expect(malicious.status).toBe('invalid-query')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(searchLocalApps('Blender',{platform:'linux'}).status).toBe('unavailable')
  })


  const sample = {
    osCaption:'Microsoft Windows 11 Pro',build:'26100',systemType:2,
    chassis:[9],batteryPresent:true,memoryBytes:String(16*1073741824),
    gpuNames:['NVIDIA Example GPU','Intel UHD'],
    commands:{git:true,node:true,ollama:true,winget:true,pwsh:false,evil:true},
    apps:{vscode:true,blender:true,excel:true,unknown:true},
    serialNumber:'SECRET_SERIAL',hostName:'SECRET_HOST',username:'SECRET_USER',
    installedPrograms:['PRIVATE_PROGRAM'],
  }
  it('detects notebook form factor and allowlisted software without leaking private identifiers', () => {
    const runner = vi.fn((_cmd:string,_args:readonly string[],_opts:Record<string,unknown>) =>
      ({status:0,stdout:JSON.stringify(sample)}))
    const view = inspectSystemEnvironment({
      platform:'win32',arch:'x64',release:'10.0.26100',nodeVersion:'24.4.0',
      cpus:[{model:'Intel Core Ultra'}],totalMemory:16*1073741824,
      freeMemory:8*1073741824,runner,
    })
    expect(view.probe).toBe('completed')
    expect(view.formFactor).toBe('laptop')
    expect(view.os.windowsBuild).toBe(26100)
    expect(view.hardware.ramGiB).toBe(16)
    expect(view.commands.find(c=>c.id==='ollama')?.command).toBe('detected')
    expect(view.guiApps.find(c=>c.id==='blender')?.detection).toBe('detected')
    expect(view.permissions.commandExecution).toBe('not-granted-by-inventory')
    expect(view.commands.every(c=>c.launchPermission==='requires-tool-authorization')).toBe(true)
    const text=JSON.stringify(view)
    for(const secret of ['SECRET_SERIAL','SECRET_HOST','SECRET_USER','PRIVATE_PROGRAM','unknown']) {
      expect(text).not.toContain(secret)
    }
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0]?.[1]).toContain('-EncodedCommand')
  })
  it('does not run platform-specific discovery on non-Windows Host', () => {
    const runner=vi.fn()
    const result=inspectSystemEnvironment({platform:'linux',runner,cpus:[],totalMemory:0,freeMemory:0})
    expect(runner).not.toHaveBeenCalled()
    expect(result.probe).toBe('unavailable')
    expect(result.formFactor).toBe('unknown')
    expect(result.commands.every(x=>x.command==='not-checked')).toBe(true)
  })
  it('fails closed on crashed probe, invalid JSON or registry errors', () => {
    for (const result of [
      {status:1,stderr:'SENSITIVE_SENTINEL'},
      {status:0,stdout:'not-json'},
      {status:0,stdout:'[]'},
    ]) {
      const snapshot=inspectSystemEnvironment({
        platform:'win32',runner:()=>result,cpus:[],totalMemory:0,freeMemory:0,
      })
      expect(snapshot.probe).toBe('unavailable')
      expect(snapshot.commands.every(x=>x.command==='not-checked')).toBe(true)
      expect(JSON.stringify(snapshot)).not.toContain('SENSITIVE_SENTINEL')
    }
  })
  it('does not confuse a GPU with verified acceleration or app installation with authorization', () => {
    const view=inspectSystemEnvironment({
      platform:'win32',runner:()=>({status:0,stdout:JSON.stringify(sample)}),
      cpus:[],totalMemory:0,freeMemory:0,
    })
    expect(view.hardware.gpuInference).toBe('not-verified')
    expect(view.guiApps.find(x=>x.id==='excel')?.launchPermission).toBe('requires-tool-authorization')
    expect(view.permissions.remoteAPIs).toBe('not-granted-by-inventory')
  })
})
