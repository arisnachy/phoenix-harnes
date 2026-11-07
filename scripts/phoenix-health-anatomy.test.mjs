import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectAnatomicalGlb} from '../packages/bundle/web-app/src/health-anatomy.ts'
import {renderHealthPage} from '../packages/bundle/web-app/src/health-ui.ts'

function sampleGlb(document={}){
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},meshes:[{primitives:[{attributes:{POSITION:0}}]}],...document}),'utf8')
 const jsonSize=Math.ceil(json.length/4)*4
 const padded=Buffer.concat([json,Buffer.alloc(jsonSize-json.length,0x20)])
 const binary=Buffer.alloc(36)
 const head=Buffer.alloc(12);head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+jsonSize+8+binary.length,8)
 const jsonHead=Buffer.alloc(8);jsonHead.writeUInt32LE(jsonSize,0);jsonHead.write('JSON',4)
 const binHead=Buffer.alloc(8);binHead.writeUInt32LE(binary.length,0);binHead.write('BIN\u0000',4)
 return Buffer.concat([head,jsonHead,padded,binHead,binary])
}
test('standalone GLB accepted as unreviewed only',()=>{
 const result=inspectAnatomicalGlb(sampleGlb())
 assert.equal(result.meshes,1)
 assert.equal(result.geometryStatus,'unreviewed')
})
test('GLB with external URL dependencies is rejected',()=>{
 assert.throws(()=>inspectAnatomicalGlb(sampleGlb({images:[{uri:'https://example.test/study.png'}]})),/externos/)
})
test('GLB with decoder extension or corrupt length is rejected',()=>{
 assert.throws(()=>inspectAnatomicalGlb(sampleGlb({extensionsRequired:['KHR_draco_mesh_compression']})),/Extensiones/)
 const broken=sampleGlb();broken.writeUInt32LE(broken.length+1,8)
 assert.throws(()=>inspectAnatomicalGlb(broken),/GLB 2.0/)
})
test('HealthIA anatomy UI shares one fresh CSP nonce and has no external viewer CDN',()=>{
 const page=renderHealthPage('test-nonce')
 assert.equal(page.includes('__NONCE__'),false)
 assert.equal((page.match(/nonce="test-nonce"/g)||[]).length,2)
 assert.match(page,/Anatomía 3D/)
 assert.match(page,/health\/vendor\/build\/three.module.js/)
 assert.equal(page.includes('cdn.jsdelivr'),false)
})
