import { describe, expect, it } from 'vitest'
import { inspectBlenderLocalPrograms, readBlenderLocalState } from '../src/blender-local.ts'

describe('read-only Blender Lab host readiness',()=>{
  it('recognizes an existing Blender and uv install hidden from Windows PATH',()=>{
    const paths=new Set([
      'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe',
      'C:\\Users\\test\\.local\\bin\\uvx.exe',
    ])
    expect(inspectBlenderLocalPrograms({
      platform:'win32',
      env:{ ProgramFiles:'C:\\Program Files',USERPROFILE:'C:\\Users\\test' },
      onPath:()=>false,
      fileExists:path=>paths.has(path),
    })).toEqual({blenderDetected:true,uvxDetected:true})
  })
  it('separates a missing add-on bridge from installed executables',async()=>{
    const result=await readBlenderLocalState({
      platform:'win32',
      env:{BLENDER_PATH:'C:\\blender.exe',UV_INSTALL_DIR:'D:\\uv'},
      onPath:()=>false,
      fileExists:path=>path==='C:\\blender.exe'||path==='D:\\uv\\uvx.exe',
      bridge:async()=>false,
    })
    expect(result).toEqual({
      blenderDetected:true,uvxDetected:true,addonBridgeListening:false,
    })
  })
  it('does not claim ready when only the add-on TCP bridge is open',async()=>{
    const result=await readBlenderLocalState({
      platform:'linux',env:{},onPath:()=>false,fileExists:()=>false,
      bridge:async()=>true,
    })
    expect(result).toEqual({
      blenderDetected:false,uvxDetected:false,addonBridgeListening:true,
    })
  })
})
