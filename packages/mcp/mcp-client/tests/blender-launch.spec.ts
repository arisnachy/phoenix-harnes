import { describe, expect, it } from 'vitest'
import { normalizeBlenderLabMcpLaunch, sanitizeBlenderLabGitEnvironment } from '../src/transport.ts'

const source='git+https://projects.blender.org/lab/blender_mcp.git@v1.0.2#subdirectory=mcp'
const args=['--from',source,'blender-mcp']
const legacyArgs=['--from','git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp','blender-mcp']

describe('Blender Lab MCP Windows desktop recovery',()=>{
  it('upgrades only pinned legacy Blender v1.0.0 to the official SDK-compatible v1.0.2',()=>{
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',legacyArgs,{},{
      platform:'win32',fileExists:()=>false,
    })).toEqual({command:'uvx',args})
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',legacyArgs,{},{
      platform:'linux',
    })).toEqual({command:'uvx',args})
    expect(normalizeBlenderLabMcpLaunch('fetch','uvx',legacyArgs,{},{
      platform:'win32',fileExists:()=>true,
    })).toEqual({command:'uvx',args:legacyArgs})
    expect(sanitizeBlenderLabGitEnvironment({
      serverName:'blender',command:'uvx',args:legacyArgs,
    },{GIT_CONFIG_COUNT:'1',GIT_CONFIG_VALUE_0:'fixture'}))
      .toEqual({})
  })
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
  it('prevents git init 128 from a stale GIT_CONFIG_COUNT with missing KEY_0',()=>{
    const config={serverName:'blender',command:'uvx',args}
    const original={
      GIT_CONFIG_COUNT:'1',
      GIT_CONFIG_VALUE_0:'fixture',
      GIT_CONFIG_PARAMETERS:"'user.name=fixture'",
      GIT_CONFIG_GLOBAL:'C:\\gitconfig',
      PATH:'C:\\Windows\\System32',
    }
    const result=sanitizeBlenderLabGitEnvironment(config,original)
    expect(result.GIT_CONFIG_COUNT).toBeUndefined()
    expect(result.GIT_CONFIG_VALUE_0).toBeUndefined()
    expect(result.GIT_CONFIG_PARAMETERS).toBeUndefined()
    expect(result.GIT_CONFIG_GLOBAL).toBe(original.GIT_CONFIG_GLOBAL)
    expect(result.PATH).toBe(original.PATH)
    expect(original.GIT_CONFIG_COUNT).toBe('1')
  })
  it('removes mixed-case inline Git pairs even when a saved config explicitly supplies them',()=>{
    const result=sanitizeBlenderLabGitEnvironment(
      {serverName:'blender',command:'uvx.exe',args},
      {git_config_count:'2',Git_Config_Key_0:'x.y',GIT_CONFIG_VALUE_0:'value',
        GIT_CONFIG_KEY_1:'x.z',gIt_cOnFiG_vAlUe_1:'other',GIT_CONFIG_NOSYSTEM:'1'})
    expect(Object.keys(result).filter(key=>/^git_config_(count|key_\\d+|value_\\d+)$/iu.test(key))).toEqual([])
    expect(result.GIT_CONFIG_NOSYSTEM).toBe('1')
  })
  it('does not remove inline Git config for other registered MCP servers',()=>{
    const environment={GIT_CONFIG_COUNT:'1',GIT_CONFIG_VALUE_0:'fixture'}
    expect(sanitizeBlenderLabGitEnvironment({serverName:'other',command:'uvx',args},environment))
      .toEqual(environment)
    expect(sanitizeBlenderLabGitEnvironment({serverName:'blender',command:'uvx',
      args:['--from','other-url','blender-mcp']},environment)).toEqual(environment)
  })
  it('preserves the saved launcher when no executable was found',()=>{
    expect(normalizeBlenderLabMcpLaunch('blender','uvx',args,{
      PATH:'C:\\Windows\\System32',
    },{platform:'win32',fileExists:()=>false})).toEqual({command:'uvx',args})
  })
})
