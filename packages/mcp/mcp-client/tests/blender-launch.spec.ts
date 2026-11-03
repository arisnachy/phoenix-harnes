import { describe, expect, it } from 'vitest'
import { normalizeBlenderLabMcpLaunch } from '../src/transport.ts'

const source='git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp'
const args=['--from',source,'blender-mcp']

describe('Blender Lab MCP Windows desktop recovery',()=>{
  it('resolves uvx installed under the user profile even when Phoenix PATH is stale',()=>{
    const target='C:\\Users\\user\\.local\\bin\\uvx.exe'
    const result=normalizeBlenderLabMcpLaunch('blender','uvx',args,{
      USERPROFILE:'C:\\Users\\user',Path:'C:\\Windows\\system32',
    },{platform:'win32',fileExists:(path)=>path===target})
    expect(result).toEqual({command:target,args})
  })
  it('honors UV_INSTALL_DIR and Windows case-insensitive environment',()=>{
    const target='D:\\Tools\\uv\\uvx.exe'
    const result=normalizeBlenderLabMcpLaunch('blender','uvx',args,{
      uv_install_dir:'D:\\Tools\\uv',
    },{platform:'win32',fileExists:(path)=>path===target})
    expect(result.command).toBe(target)
  })
  it('prefers verified PATH entries without shell execution or mutation',()=>{
    const target='D:\\apps\\uvx.exe'
    const result=normalizeBlenderLabMcpLaunch('blender','uvx',args,{
      PATH:'D:\\apps;C:\\Windows\\system32',
    },{platform:'win32',fileExists:(path)=>path===target})
    expect(result.command).toBe(target)
  })
  it('leaves untrusted source, arbitrary MCPs and other platforms unchanged',()=>{
    const env={USERPROFILE:'C:\\Users\\user'}
    const probe={platform:'win32' as const,fileExists:()=>true}
    expect(normalizeBlenderLabMcpLaunch('fetch','uvx',args,env,probe))
      .toEqual({command:'uvx',args})
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',['bad','package'],env,probe))
      .toEqual({command:'uvx',args:['bad','package']})
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',args,env,{platform:'linux'}))
      .toEqual({command:'uvx',args})
  })
  it('preserves the saved launcher when no executable was found',()=>{
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',args,{
      PATH:'C:\\Windows\\System32',
    },{platform:'win32',fileExists:()=>false})).toEqual({command:'uvx',args})
  })
})
