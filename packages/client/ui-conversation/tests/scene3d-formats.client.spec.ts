// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { exportSceneGLB, exportSceneGLTF, importSceneGLTF } from '../src/client/chat/scene3d-formats.ts'
import { parseScene3D } from '../src/client/chat/Scene3DView.tsx'
import { sphereTriangles } from '../src/client/chat/scene3d-primitives.ts'

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
  it('uses detailed outward-facing sphere surfaces for organic scenes and exports smooth normals',()=>{
    const triangles=sphereTriangles()
    expect(triangles.length).toBe(32*(2*20-2)*9)
    for(let i=0;i<triangles.length;i+=9){
      const a=[triangles[i]!,triangles[i+1]!,triangles[i+2]!]
      const b=[triangles[i+3]!,triangles[i+4]!,triangles[i+5]!]
      const c=[triangles[i+6]!,triangles[i+7]!,triangles[i+8]!]
      const u=[b[0]!-a[0]!,b[1]!-a[1]!,b[2]!-a[2]!]
      const v=[c[0]!-a[0]!,c[1]!-a[1]!,c[2]!-a[2]!]
      const normal=[
        u[1]!*v[2]!-u[2]!*v[1]!,
        u[2]!*v[0]!-u[0]!*v[2]!,
        u[0]!*v[1]!-u[1]!*v[0]!,
      ]
      const centroid=[(a[0]!+b[0]!+c[0]!)/3,
        (a[1]!+b[1]!+c[1]!)/3,(a[2]!+b[2]!+c[2]!)/3]
      expect(Math.hypot(...normal)).toBeGreaterThan(1e-7)
      expect(normal.reduce((sum,n,j)=>sum+n*centroid[j]!,0)).toBeGreaterThan(0)
    }
    const gltf=JSON.parse(exportSceneGLTF(scene))
    const spherePosition=gltf.accessors[2]
    const sphereNormal=gltf.accessors[3]
    expect(spherePosition.count).toBe(32*(2*20-2)*3)
    expect(sphereNormal.count).toBe(spherePosition.count)
    expect(sphereNormal.type).toBe('VEC3')
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
  it('round-trips PBR base color, normal, AO and metallic/roughness texture maps without external fetches',()=>{
    const tinyPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y8YyM8AAAAASUVORK5CYII='
    const textured=parseScene3D({...model,nodes:[{
      ...model.nodes[0]!,material:{...model.nodes[0]!.material,
        baseColorTexture:tinyPng,normalTexture:tinyPng,occlusionTexture:tinyPng,
        metallicRoughnessTexture:tinyPng},
    }]})
    expect(textured).toBeDefined()
    const glb=exportSceneGLB(textured!)
    const recovered=importSceneGLTF(glb)
    const map=recovered.nodes[0]?.material
    expect(map?.baseColorTexture).toBe(tinyPng)
    expect(map?.normalTexture).toBe(tinyPng)
    expect(map?.occlusionTexture).toBe(tinyPng)
    expect(map?.metallicRoughnessTexture).toBe(tinyPng)
    const json=JSON.parse(exportSceneGLTF(textured!))
    expect(json.images).toHaveLength(4)
    expect(json.materials[0].normalTexture.index).toBeTypeOf('number')
    expect(json.materials[0].occlusionTexture.index).toBeTypeOf('number')
  })
  it('exports wheels and arbitrary animation channels to real glTF/GLB geometry',()=>{
    const animated=parseScene3D({
      version:1,units:'meters',name:'Bicicleta animada',background:'#fbf7f1',
      nodes:[{type:'torus',name:'Rueda delantera',objectId:'bicycle',
        position:[1,1,0],size:[1.2,.12,1.2],rotation:[90,0,0],color:'#222222'}],
      animations:[{name:'Rodar',duration:2,loop:true,tracks:[{
        node:'Rueda delantera',property:'rotation',keys:[
          {time:0,value:[90,0,0]},{time:1,value:[90,0,180]},{time:2,value:[90,0,360]},
        ],
      }]}],
    })
    expect(animated).toBeDefined()
    const json=JSON.parse(exportSceneGLTF(animated!))
    expect(json.meshes).toHaveLength(1)
    expect(json.accessors[0].count).toBeGreaterThan(500)
    expect(json.animations).toHaveLength(1)
    expect(json.animations[0].channels[0].target).toEqual({node:0,path:'rotation'})
    expect(json.animations[0].samplers[0].interpolation).toBe('LINEAR')
    expect(json.accessors[json.animations[0].samplers[0].output].type).toBe('VEC4')
    const glb=exportSceneGLB(animated!)
    expect(new DataView(glb.buffer).getUint32(0,true)).toBe(0x46546c67)
    const roundTrip=importSceneGLTF(glb)
    expect(roundTrip.nodes[0]?.type).toBe('mesh')
    expect(roundTrip.nodes[0]?.vertices?.length).toBeGreaterThan(1000)
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
