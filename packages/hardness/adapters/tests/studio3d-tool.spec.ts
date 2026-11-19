import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { inspectStudio3DModel, createPhoenixStudio3DTool } from '../src/studio3d-tool.ts'
import { inspectStudio3DAsset, mountStudio3DAssets, publishStudio3DAssets,
  resolveStudio3DWorkspaceFile, serveStudio3DAsset } from '../src/studio3d-bundle.ts'

const dirs:string[]=[]
function folder():string {
  const dir=mkdtempSync(join(tmpdir(),'phoenix-studio3d-unit-'))
  dirs.push(dir)
  return dir
}
function makeGLB(file:string,triangleCount=500):void {
  const metadata={
    asset:{version:'2.0'},
    scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},mode:4,material:0}]}],
    accessors:[{count:triangleCount*3,componentType:5126,type:'VEC3'}],
    materials:[{name:'Studio PBR'}],
  }
  const raw=Buffer.from(JSON.stringify(metadata))
  const padded=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)])
  const glb=Buffer.alloc(20+padded.length)
  glb.write('glTF',0,'ascii')
  glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8)
  glb.writeUInt32LE(padded.length,12);glb.write('JSON',16,'ascii')
  padded.copy(glb,20)
  writeFileSync(file,glb)
}
afterEach(()=>{
  for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})
  vi.restoreAllMocks()
})
describe('PHOENIX Studio 3D actual Blender asset path',()=>{
  it('requires real glTF2 triangle geometry, not a few plastic primitives',()=>{
    const root=folder(),source=join(root,'model.glb')
    makeGLB(source,800)
    expect(inspectStudio3DModel(source)).toEqual({
      meshes:1,triangles:800,materials:1,skins:0,animations:0,
      sourceGeometryVerified:true,appearanceReviewed:false,
    })
    makeGLB(source,4)
    expect(()=>inspectStudio3DModel(source)).toThrow('menos de 300 triángulos')
    writeFileSync(source,Buffer.alloc(25))
    expect(()=>inspectStudio3DModel(source)).toThrow(/cabecera inválida/u)
  })
  it('blocks path escapes and rejects invalid model metadata',()=>{
    const workspace=folder(),outside=folder()
    makeGLB(join(outside,'outside.glb'),400)
    expect(()=>resolveStudio3DWorkspaceFile(workspace,join(outside,'outside.glb'),'.glb'))
      .toThrow(/fuera del workspace/)
    const file=join(workspace,'model.glb')
    makeGLB(file,400)
    expect(resolveStudio3DWorkspaceFile(workspace,'model.glb','.glb')).toBe(realpathSync(file))
    expect(()=>resolveStudio3DWorkspaceFile(workspace,'model.glb','.blend')).toThrow()
  })
  it('publishes only checked Blender outputs through the opaque token route',()=>{
    const workspace=folder(),out=join(workspace,'render')
    mkdirSync(out)
    makeGLB(join(out,'scene.glb'),1000)
    writeFileSync(join(out,'render.png'),Buffer.concat([
      Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]))
    writeFileSync(join(out,'scene.blend'),Buffer.from('BLENDER'+ '0'.repeat(24)))
    const captured:Array<{path:string,handler:(...args:any[])=>void}>=[]
    const release=mountStudio3DAssets({register(route){
      captured.push({path:route.path,handler:route.handler})
      return ()=>{}
    }})
    let published:string|undefined
    try {
      const result=publishStudio3DAssets('render',workspace)
      published=result.renderUrl
      expect(result.verifiedFiles).toEqual(['render.png','scene.glb','scene.blend'])
      expect(result.renderUrl).toMatch(/^\/phoenix-studio3d\/assets\/[0-9a-f]{48}\/render\.png$/u)
      expect(result.viewportVerified).toBe(false)
      expect(captured[0]?.path).toBe('/phoenix-studio3d/assets')
      const forged=join(out,'render.png')
      writeFileSync(forged,Buffer.alloc(64))
      expect(()=>inspectStudio3DAsset(forged,'render.png')).toThrow(/cabecera inválida/u)
    } finally {
      release()
      if(published!==undefined) {
        const token=published.split('/').at(-2)
        if(token!==undefined)rmSync(join(homedir(),'.dsh','studio3d-assets',token),{recursive:true,force:true})
      }
    }
  })
  it('exposes Studio only as a real model/Blender pipeline, never a dummy low-poly final',async()=>{
    const tool=createPhoenixStudio3DTool()
    expect(tool.name).toBe('phoenix_studio3d')
    expect(tool.description).toContain('Blender')
    expect(tool.description).toContain('REAL MESH')
    expect(tool.timeoutMs).toBe(600_000)
    const call={callId:'studio-test',signal:new AbortController().signal,
      agent:{session:{header:{cwd:folder()}}}}
    await expect(tool.execute({title:'Test',model_path:'missing.glb'},call as never))
      .rejects.toThrow(/falta|invalida|path|ENOENT/iu)
  })
})
