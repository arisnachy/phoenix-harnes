import type { Scene3D, Scene3DNode } from './Scene3DView.tsx'

/** Self-contained glTF 2.0 import/export. No CDN, executable scripts or external URI requests. */
const MAX_BYTES=12_000_000
const MAX_TRIANGLES=60_000
const align=(n:number)=> (n+3)&~3
type V3=[number,number,number]
type Node=Scene3DNode
type R=Record<string,unknown>
const obj=(v:unknown):v is R=>typeof v==='object'&&v!==null&&!Array.isArray(v)
const nums=(v:unknown):number[]=>Array.isArray(v)?v.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)):[]
function bytesBase64(bytes:Uint8Array):string{
  let text=''
  for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192))
  return btoa(text)
}
function fromBase64(value:string):Uint8Array{
  if(value.length>MAX_BYTES*2||!/^[a-z0-9+/]*={0,2}$/iu.test(value))throw Error('Archivo base64 3D inválido o demasiado grande.')
  const decoded=atob(value),result=new Uint8Array(decoded.length)
  for(let i=0;i<decoded.length;i++)result[i]=decoded.charCodeAt(i)
  return result
}
const vector=(a:number,b:number,c:number):V3=>[a,b,c]
const unit=(a:V3):V3=>{const length=Math.hypot(...a)||1;return vector(a[0]/length,a[1]/length,a[2]/length)}
const subtract=(a:V3,b:V3):V3=>vector(a[0]-b[0],a[1]-b[1],a[2]-b[2])
const cross=(a:V3,b:V3):V3=>vector(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
function primitiveTriangles(node:Node):number[]{
  if(node.type==='mesh')return Array.from(node.vertices??[])
  const coords:number[]=[]
  const tri=(a:V3,b:V3,c:V3)=>coords.push(...a,...b,...c)
  const quad=(a:V3,b:V3,c:V3,d:V3)=>{tri(a,b,c);tri(a,c,d)}
  if(node.type==='box'){
    const p:V3[]=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]
    for(const ids of [[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]])
      quad(p[ids[0]!]!,p[ids[1]!]!,p[ids[2]!]!,p[ids[3]!]!)
  }else{
    const slices=16,rings=node.type==='sphere'?10:1
    for(let j=0;j<rings;j++)for(let i=0;i<slices;i++){
      const a=2*Math.PI*i/slices,b=2*Math.PI*(i+1)/slices
      if(node.type==='sphere'){
        const v=(lat:number,lon:number):V3=>[.5*Math.cos(lat)*Math.cos(lon),.5*Math.sin(lat),.5*Math.cos(lat)*Math.sin(lon)]
        const p=-Math.PI/2+j*Math.PI/rings,q=-Math.PI/2+(j+1)*Math.PI/rings
        quad(v(p,a),v(p,b),v(q,b),v(q,a))
      }else{
        const v=(angle:number,y:number,radius:number):V3=>[Math.cos(angle)*radius,y,Math.sin(angle)*radius]
        const top=node.type==='cone'?0:.5
        quad(v(a,-.5,.5),v(b,-.5,.5),v(b,.5,top),v(a,.5,top))
        tri([0,-.5,0],v(b,-.5,.5),v(a,-.5,.5))
        if(node.type!=='cone')tri([0,.5,0],v(a,.5,top),v(b,.5,top))
      }
    }
  }
  return coords
}
function normals(coords:readonly number[]):number[]{
  const result:number[]=[]
  for(let i=0;i<coords.length;i+=9){
    const a=vector(coords[i]!,coords[i+1]!,coords[i+2]!)
    const b=vector(coords[i+3]!,coords[i+4]!,coords[i+5]!)
    const c=vector(coords[i+6]!,coords[i+7]!,coords[i+8]!)
    const n=unit(cross(subtract(b,a),subtract(c,a)))
    for(let j=0;j<3;j++)result.push(...n)
  }
  return result
}
function colorFactor(hex:string):number[]{
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  return [...c,1]
}
function quaternion(euler:readonly number[]):number[]{
  const [x,y,z]=euler.map(v=>v*Math.PI/360)
  const cx=Math.cos(x!),sx=Math.sin(x!),cy=Math.cos(y!),sy=Math.sin(y!),cz=Math.cos(z!),sz=Math.sin(z!)
  return [sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz]
}
function objectMaterial(node:Node):R{
  const material=node.material
  const base=material?.baseColor??node.color
  const alpha=material?.opacity??1
  const mat:R={
    name: material?.preset??node.name??'Phoenix Material',
    doubleSided:true,
    pbrMetallicRoughness:{
      baseColorFactor:colorFactor(base).map((v,i)=>i===3?alpha:v),
      metallicFactor:material?.metallic??0,
      roughnessFactor:material?.roughness??.8,
    },
    alphaMode:alpha<1?'BLEND':'OPAQUE',
    emissiveFactor:material?.emissive===undefined?[0,0,0]:colorFactor(material.emissive).slice(0,3),
  }
  if((material?.transmission??0)>0){
    mat.extensions={KHR_materials_transmission:{transmissionFactor:material!.transmission}}
  }
  if((material?.clearcoat??0)>0){
    mat.extensions={...(mat.extensions as R|undefined),KHR_materials_clearcoat:{clearcoatFactor:material!.clearcoat}}
  }
  return mat
}
function buildDocument(scene:Scene3D):{json:R;binary:Uint8Array}{
  if(scene.nodes.length>150)throw Error('Límite de 150 piezas por escena.')
  const chunks:Uint8Array[]=[],views:R[]=[],accessors:R[]=[],meshes:R[]=[],nodes:R[]=[],materials:R[]=[]
  let offset=0,verticesCount=0
  const append=(data:Uint8Array,target:number):number=>{
    const index=views.length
    views.push({buffer:0,byteOffset:offset,byteLength:data.byteLength,target})
    chunks.push(data)
    offset+=align(data.length)
    return index
  }
  const attr=(v:number[],size:3,type:'VEC3'):number=>{
    const floats=new Float32Array(v)
    const view=append(new Uint8Array(floats.buffer),34962)
    const index=accessors.length
    const lows=[Infinity,Infinity,Infinity],highs=[-Infinity,-Infinity,-Infinity]
    for(let i=0;i<v.length;i++){const axis=i%3; lows[axis]=Math.min(lows[axis]!,v[i]!);highs[axis]=Math.max(highs[axis]!,v[i]!)}
    accessors.push({bufferView:view,componentType:5126,count:v.length/size,type,
      min:lows,max:highs})
    return index
  }
  for(const node of scene.nodes.filter(item=>item.hidden!==true)){
    const vertices=primitiveTriangles(node)
    if(vertices.length%9!==0||vertices.length===0||!vertices.every(Number.isFinite))throw Error('Geometría 3D inválida.')
    verticesCount+=vertices.length/3
    if(verticesCount>MAX_TRIANGLES*3)throw Error('Límite de triángulos 3D excedido.')
    const pos=attr(vertices,3,'VEC3'),norm=attr(normals(vertices),3,'VEC3')
    const material=materials.push(objectMaterial(node))-1
    const mesh=meshes.push({primitives:[{attributes:{POSITION:pos,NORMAL:norm},material,mode:4}]})-1
    const tr:R={mesh,name:node.name??node.type,
      translation:node.position,scale:node.size,
      rotation:quaternion(node.rotation??[0,0,0])}
    nodes.push(tr)
  }
  if(nodes.length===0)throw Error('No hay piezas visibles para exportar.')
  // Camera and light are interoperable glTF scene nodes, not only Phoenix UI state.
  const camIndex=nodes.length
  const cameraName=scene.camera??'perspective'
  const cameraTranslation=cameraName==='top'?[0,40,0]:cameraName==='front'?[0,8,40]:[25,19,28]
  nodes.push({name:'Phoenix Camera',camera:0,translation:cameraTranslation,
    rotation:cameraName==='top'?quaternion([-90,0,0]):cameraName==='front'?quaternion([-12,0,0]):quaternion([-24,38,0])})
  const lightIndex=nodes.length
  nodes.push({name:'Phoenix Directional Light',translation:[10,25,14],
    rotation:quaternion([-35,22,0]),extensions:{KHR_lights_punctual:{light:0}}})
  const binary=new Uint8Array(offset)
  let cursor=0
  for(const chunk of chunks){binary.set(chunk,cursor);cursor+=align(chunk.length)}
  const extensions=new Set<string>()
  if(materials.some(m=>obj(m.extensions)&&'KHR_materials_transmission'in m.extensions))extensions.add('KHR_materials_transmission')
  if(materials.some(m=>obj(m.extensions)&&'KHR_materials_clearcoat'in m.extensions))extensions.add('KHR_materials_clearcoat')
  const json:R={asset:{version:'2.0',generator:'Phoenix 3D'},
    scene:0,scenes:[{name:scene.name,nodes:nodes.map((_,i)=>i)}],
    nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:binary.length}],
    cameras:[{name:'Phoenix Camera',type:'perspective',perspective:{yfov:Math.PI/3,znear:.1,zfar:3000}}],
    extensions:{KHR_lights_punctual:{lights:[{name:'Main Light',type:'directional',
      color:scene.environment==='sunset'?[1,.74,.52]:[1,1,1],
      intensity:scene.environment==='daylight'?2.4:1.8}]}},
    extensionsUsed:[...extensions,'KHR_lights_punctual'],
    extras:{phoenixSceneVersion:scene.version,units:'meters',background:scene.background,
      environment:scene.environment??'studio',camera:cameraName,camIndex,lightIndex}}
  return {json,binary}
}
function gltfData(scene:Scene3D):string{
  const {json,binary}=buildDocument(scene)
  const buffers=json.buffers as R[]
  buffers[0]={...buffers[0],uri:'data:application/octet-stream;base64,'+bytesBase64(binary)}
  return JSON.stringify(json,null,2)
}
export function exportSceneGLTF(scene:Scene3D):string{return gltfData(scene)}
export function exportSceneGLB(scene:Scene3D):Uint8Array{
  const {json,binary}=buildDocument(scene)
  const source=new TextEncoder().encode(JSON.stringify(json))
  const jsonLength=align(source.length),binLength=align(binary.length)
  const out=new Uint8Array(12+8+jsonLength+8+binLength)
  const dv=new DataView(out.buffer)
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true)
  dv.setUint32(12,jsonLength,true);dv.setUint32(16,0x4e4f534a,true)
  out.fill(32,20,20+jsonLength);out.set(source,20)
  const cursor=20+jsonLength
  dv.setUint32(cursor,binLength,true);dv.setUint32(cursor+4,0x004e4942,true)
  out.set(binary,cursor+8)
  return out
}
function readDocument(data:Uint8Array|string):{json:R;binary:Uint8Array}{
  if(typeof data==='string'){
    if(data.length>MAX_BYTES)throw Error('glTF demasiado grande.')
    const value:unknown=JSON.parse(data)
    if(!obj(value))throw Error('JSON glTF inválido.')
    const buffers=Array.isArray(value.buffers)?value.buffers:[]
    if(buffers.length!==1||!obj(buffers[0])||typeof buffers[0].uri!=='string'
      ||!buffers[0].uri.startsWith('data:application/octet-stream;base64,')){
      throw Error('Este importador requiere glTF con buffer incrustado; utiliza GLB para recursos externos.')
    }
    return {json:value,binary:fromBase64(buffers[0].uri.split(',')[1]!)}
  }
  if(data.byteLength>MAX_BYTES||data.byteLength<20)throw Error('GLB inválido o demasiado grande.')
  const dv=new DataView(data.buffer,data.byteOffset,data.byteLength)
  if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2
    ||dv.getUint32(8,true)!==data.byteLength||dv.getUint32(16,true)!==0x4e4f534a)throw Error('Cabecera GLB 2.0 inválida.')
  const jsonSize=dv.getUint32(12,true)
  if(20+jsonSize+8>data.length)throw Error('GLB truncado.')
  const value:unknown=JSON.parse(new TextDecoder().decode(data.subarray(20,20+jsonSize)).trim())
  if(!obj(value))throw Error('Escena GLB inválida.')
  const at=20+jsonSize
  if(dv.getUint32(at+4,true)!==0x004e4942)throw Error('GLB no contiene geometría BIN.')
  const length=dv.getUint32(at,true)
  if(at+8+length>data.length)throw Error('BIN GLB incompleto.')
  return {json:value,binary:data.subarray(at+8,at+8+length)}
}
function matmul(a:number[],b:number[]):number[]{
  const o=new Array<number>(16).fill(0)
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]!+=a[k*4+r]!*b[c*4+k]!
  return o
}
const identity=():number[]=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
function matrix(node:R):number[]{
  if(Array.isArray(node.matrix)&&node.matrix.length===16&&node.matrix.every(Number.isFinite))return node.matrix
  const t=nums(node.translation),s=nums(node.scale),q=nums(node.rotation)
  const [x,y,z,w]=q.length===4?q:[0,0,0,1],sx=s[0]??1,sy=s[1]??1,sz=s[2]??1
  return [
    (1-2*(y*y+z*z))*sx,(2*(x*y+z*w))*sx,(2*(x*z-y*w))*sx,0,
    (2*(x*y-z*w))*sy,(1-2*(x*x+z*z))*sy,(2*(y*z+x*w))*sy,0,
    (2*(x*z+y*w))*sz,(2*(y*z-x*w))*sz,(1-2*(x*x+y*y))*sz,0,
    t[0]??0,t[1]??0,t[2]??0,1]
}
function translate(m:number[],p:V3):V3{
  return [m[0]!*p[0]+m[4]!*p[1]+m[8]!*p[2]+m[12]!,
    m[1]!*p[0]+m[5]!*p[1]+m[9]!*p[2]+m[13]!,
    m[2]!*p[0]+m[6]!*p[1]+m[10]!*p[2]+m[14]!]
}
function accessorValues(index:number,json:R,binary:Uint8Array):number[]{
  const accessors=Array.isArray(json.accessors)?json.accessors:[],views=Array.isArray(json.bufferViews)?json.bufferViews:[]
  const a=accessors[index],v=obj(a)?views[Number(a.bufferView)]:undefined
  if(!obj(a)||!obj(v)||a.sparse!==undefined||v.buffer!==0)throw Error('Accessor glTF no compatible.')
  const n=Number(a.count),kind=String(a.type),component=Number(a.componentType)
  const count=kind==='VEC3'?3:kind==='SCALAR'?1:0
  const bytes=component===5126||component===5125?4:component===5123?2:component===5121?1:0
  if(count===0||bytes===0||!Number.isSafeInteger(n)||n<1||n>MAX_TRIANGLES*3)throw Error('Accessor glTF excesivo o no compatible.')
  const stride=Number(v.byteStride??count*bytes),offset=Number(v.byteOffset??0)+Number(a.byteOffset??0)
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(stride)||stride<count*bytes
    ||offset<0||offset+(n-1)*stride+count*bytes>binary.byteLength
    ||offset+(n-1)*stride+count*bytes>Number(v.byteOffset??0)+Number(v.byteLength))
    throw Error('Buffer glTF fuera de límites.')
  const dv=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),values:number[]=[]
  for(let i=0;i<n;i++)for(let j=0;j<count;j++){
    const at=offset+i*stride+j*bytes
    const value=component===5126?dv.getFloat32(at,true):component===5125?dv.getUint32(at,true)
      :component===5123?dv.getUint16(at,true):dv.getUint8(at)
    if(!Number.isFinite(value))throw Error('Vértice glTF no finito.')
    values.push(value)
  }
  return values
}
function hexColor(v:unknown):string{
  const xs=nums(v);if(xs.length<3)return '#d9c6ac'
  return '#'+xs.slice(0,3).map(n=>Math.max(0,Math.min(255,Math.round(n*255))).toString(16).padStart(2,'0')).join('')
}
function parseMaterial(m:unknown):{color:string;material:NonNullable<Node['material']>}{
  const data=obj(m)?m:{},p=obj(data.pbrMetallicRoughness)?data.pbrMetallicRoughness:{}
  const base=Array.isArray(p.baseColorFactor)?p.baseColorFactor:[.85,.76,.65,1]
  const color=hexColor(base)
  const ex=obj(data.extensions)?data.extensions:{}
  const trans=obj(ex.KHR_materials_transmission)?ex.KHR_materials_transmission:{}
  const coat=obj(ex.KHR_materials_clearcoat)?ex.KHR_materials_clearcoat:{}
  return {color,material:{baseColor:color,
    metallic:typeof p.metallicFactor==='number'?p.metallicFactor:1,
    roughness:typeof p.roughnessFactor==='number'?p.roughnessFactor:1,
    opacity:typeof base[3]==='number'?base[3]:1,
    transmission:typeof trans.transmissionFactor==='number'?trans.transmissionFactor:0,
    clearcoat:typeof coat.clearcoatFactor==='number'?coat.clearcoatFactor:0,
    emissive:Array.isArray(data.emissiveFactor)?hexColor(data.emissiveFactor):'#000000',
  }}
}
export function importSceneGLTF(input:string|Uint8Array):Scene3D{
  const {json,binary}=readDocument(input)
  if(!obj(json.asset)||(json.asset.version!=='2.0'&&json.asset.minVersion!=='2.0'))throw Error('Solo se admite glTF 2.0.')
  const nodes=Array.isArray(json.nodes)?json.nodes:[],meshes=Array.isArray(json.meshes)?json.meshes:[]
  const materials=Array.isArray(json.materials)?json.materials:[]
  const sceneList=Array.isArray(json.scenes)?json.scenes:[]
  const root:R=obj(sceneList[Number(json.scene??0)])?sceneList[Number(json.scene??0)] as R:{}
  const roots=Array.isArray(root.nodes)?root.nodes.map(Number):nodes.map((_,i)=>i)
  const output:Scene3DNode[]=[],visits=new Set<number>()
  let total=0
  const visit=(index:number,parent:number[],depth:number):void=>{
    if(depth>16||visits.has(index)||index<0||index>=nodes.length)throw Error('Jerarquía glTF circular o demasiado profunda.')
    const raw=nodes[index];if(!obj(raw))throw Error('Nodo glTF inválido.')
    visits.add(index)
    const world=matmul(parent,matrix(raw))
    if(raw.mesh!==undefined){
      const mesh=meshes[Number(raw.mesh)]
      if(!obj(mesh)||!Array.isArray(mesh.primitives))throw Error('Malla glTF inválida.')
      for(const prim of mesh.primitives){
        if(!obj(prim)||!obj(prim.attributes)||typeof prim.attributes.POSITION!=='number'
          ||(prim.mode!==undefined&&prim.mode!==4))throw Error('Solo se admiten triángulos glTF.')
        const positions=accessorValues(prim.attributes.POSITION,json,binary)
        const indices=prim.indices===undefined
          ?Array.from({length:positions.length/3},(_,i)=>i)
          :accessorValues(Number(prim.indices),json,binary)
        if(indices.length%3!==0)throw Error('Índices de triángulo inválidos.')
        const vertices:number[]=[]
        for(const i of indices){
          if(!Number.isInteger(i)||i<0||i>=positions.length/3)throw Error('Índice glTF fuera de rango.')
          vertices.push(...translate(world,[positions[3*i]!,positions[3*i+1]!,positions[3*i+2]!]))
        }
        total+=vertices.length/9
        if(total>MAX_TRIANGLES||output.length>=150)throw Error('Escena demasiado compleja; límite de 60 000 triángulos y 150 piezas.')
        const props=parseMaterial(materials[Number(prim.material??-1)])
        output.push({type:'mesh',name:typeof raw.name==='string'?raw.name:'Malla glTF',
          position:[0,0,0],size:[1,1,1],color:props.color,vertices,material:props.material})
      }
    }
    for(const child of Array.isArray(raw.children)?raw.children:[])visit(Number(child),world,depth+1)
    visits.delete(index)
  }
  for(const index of roots)visit(index,identity(),0)
  if(!output.length)throw Error('El archivo no contiene geometría triangular importable.')
  const extras=obj(json.extras)?json.extras:{}
  const background=typeof extras.background==='string'&&/^#[0-9a-f]{6}$/iu.test(extras.background)?extras.background:'#f7f2eb'
  const environment=extras.environment==='studio'||extras.environment==='sunset'||extras.environment==='daylight'
    ?extras.environment:'studio'
  const camera=extras.camera==='front'||extras.camera==='top'||extras.camera==='isometric'||extras.camera==='perspective'
    ?extras.camera:'perspective'
  return {version:1,units:'meters',name:typeof root.name==='string'?root.name:'Modelo glTF importado',
    background,nodes:output,environment,camera}
}
