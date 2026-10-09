// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { exportSceneGLB, exportSceneGLTF, importSceneGLTF } from '../src/client/chat/scene3d-formats.ts'
import { parseScene3D } from '../src/client/chat/Scene3DView.tsx'

const model={
  version:1,units:'meters',name:'Showroom interior',background:'#f7f2eb',
  camera:'isometric',environment:'studio',
  nodes:[
    {type:'box',name:'Cristal',position:[2,1,-3],size:[4,2,.2],color:'#b5d8d6',
      material:{preset:'glass',baseColor:'#b5d8d6',metallic:0,roughness:.06,opacity:.6,transmission:.8,clearcoat:.2}},
    {type:'sphere',name:'Mesa',position:[0,1,0],size:[2,1.5,2],color:'#b08056',
      material:{preset:'wood',baseColor:'#b08056',metallic:0,roughness:.8}},
  ],
}
describe('Phoenix 3D standard GLB/glTF models',()=>{
  const scene=parseScene3D(model)
  if(scene===undefined)throw Error('Test scene missing')
  it('exports standards-shaped embedded glTF 2.0 with actual mesh vertices and core PBR metadata',()=>{
    const gltf=exportSceneGLTF(scene)
    const json=JSON.parse(gltf)
    expect(json.asset.version).toBe('2.0')
    expect(json.meshes.length).toBe(2)
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/u)
    expect(json.accessors[0]).toMatchObject({componentType:5126,type:'VEC3'})
    expect(json.materials[0].pbrMetallicRoughness).toMatchObject({
      baseColorFactor:expect.any(Array),roughnessFactor:.06,metallicFactor:0,
    })
    expect(json.extensionsUsed).toEqual(expect.arrayContaining(['KHR_materials_transmission','KHR_materials_clearcoat']))
    expect(json.cameras).toHaveLength(1)
    expect(json.extensionsUsed).toContain('KHR_lights_punctual')
    expect(json.extensions.KHR_lights_punctual.lights[0].type).toBe('directional')
  })
  it('round trips imported glTF and GLB into actual edit-ready geometry with materials',()=>{
    const gltf=exportSceneGLTF(scene),glb=exportSceneGLB(scene)
    const dv=new DataView(glb.buffer,glb.byteOffset,glb.byteLength)
    expect(dv.getUint32(0,true)).toBe(0x46546c67)
    expect(dv.getUint32(4,true)).toBe(2)
    expect(dv.getUint32(8,true)).toBe(glb.byteLength)
    const a=parseScene3D(importSceneGLTF(gltf)),b=parseScene3D(importSceneGLTF(glb))
    for(const item of [a,b]){
      expect(item?.nodes).toHaveLength(2)
      expect(item?.environment).toBe('studio')
      expect(item?.camera).toBe('isometric')
      expect(item?.nodes[0]).toMatchObject({
        type:'mesh',name:'Cristal',material:{metallic:0,roughness:.06,transmission:.8,clearcoat:.2},
      })
      expect(item?.nodes[0]?.vertices?.length).toBeGreaterThan(100)
      expect(item?.nodes[1]?.vertices?.length).toBeGreaterThan(100)
    }
    expect(exportSceneGLB(b!).byteLength).toBeGreaterThan(100)
  })
  it('rejects malformed GLB headers, unsupported external buffers and poisoned geometry',()=>{
    expect(()=>importSceneGLTF(new Uint8Array(20))).toThrow()
    expect(()=>importSceneGLTF(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://bad.example/a.bin'}]}))).toThrow()
    const corrupt=exportSceneGLB(scene).slice()
    corrupt[0]=0
    expect(()=>importSceneGLTF(corrupt)).toThrow()
    expect(parseScene3D({...scene,nodes:[{type:'mesh',position:[0,0,0],size:[1,1,1],color:'#ffffff',
      vertices:[0,0,0,1,0,0,NaN,1,0]}]})).toBeUndefined()
  })
})
