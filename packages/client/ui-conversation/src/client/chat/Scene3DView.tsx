import { useEffect, useMemo, useRef, useState } from 'react'
import css from './Scene3DView.module.css'
import { exportSceneGLB, exportSceneGLTF, importSceneGLTF } from './scene3d-formats.ts'

export interface Scene3DMaterial {
  readonly preset?: string
  readonly baseColor?: string
  readonly metallic?: number
  readonly roughness?: number
  readonly opacity?: number
  readonly transmission?: number
  readonly clearcoat?: number
  readonly emissive?: string
}
/** Primitive objects and imported triangular meshes share one portable scene. */
export interface Scene3DNode {
  readonly type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'mesh'
  readonly name?: string
  readonly position: readonly [number,number,number]
  readonly size: readonly [number,number,number]
  readonly rotation?: readonly [number,number,number]
  readonly color: string
  readonly vertices?: readonly number[]
  readonly material?: Scene3DMaterial
  readonly hidden?: boolean
}
export interface Scene3D {
  readonly version: 1
  readonly units: 'meters'
  readonly name: string
  readonly background: string
  readonly nodes: readonly Scene3DNode[]
  readonly environment?: 'studio' | 'sunset' | 'daylight'
  readonly camera?: 'perspective' | 'isometric' | 'front' | 'top'
}
type Vec3 = [number,number,number]
type Face = { readonly vertices: readonly Vec3[]; readonly color: string; readonly alpha: number }
type Projected = { readonly points: readonly [number, number][]; readonly depth: number; readonly color: string; readonly alpha: number; readonly light: number }

const colorPattern = /^#[0-9a-f]{6}$/iu
function vec(value: unknown, lo: number, hi: number): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3
    && value.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi)
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Share the safe, portable schema with Phoenix apps without model or tool coupling. */
export function parseScene3D(value: unknown): Scene3D | undefined {
  if (!record(value) || value.version !== 1 || value.units !== 'meters'
    || !Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 150) return undefined
  const nodes: Scene3DNode[] = []
  let vertexCount=0
  for (const item of value.nodes as unknown[]) {
    if (!record(item) || !['box','sphere','cylinder','cone','mesh'].includes(String(item.type))
      || !vec(item.position,-300,300) || !vec(item.size,.001,300)
      || (item.rotation !== undefined && !vec(item.rotation,-360,360))
      || typeof item.color !== 'string' || !colorPattern.test(item.color)) return undefined
    const vertices=item.vertices
    if(item.type==='mesh' && (!Array.isArray(vertices)||vertices.length<9||vertices.length%9!==0
      ||vertices.length>180_000 ||!vertices.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000))) return undefined
    vertexCount += item.type==='mesh'?(vertices as number[]).length:0
    if(vertexCount>180_000) return undefined
    const sourceMaterial=record(item.material)?item.material:undefined
    let material:Scene3DMaterial|undefined
    if(sourceMaterial!==undefined) {
      const numeric=['metallic','roughness','opacity','transmission','clearcoat'] as const
      if(numeric.some(key=>sourceMaterial[key]!==undefined&&
        (typeof sourceMaterial[key]!=='number'||!Number.isFinite(sourceMaterial[key])||(sourceMaterial[key] as number)<0||(sourceMaterial[key] as number)>1))
        || ['baseColor','emissive'].some(key=>sourceMaterial[key]!==undefined&&
          (typeof sourceMaterial[key]!=='string'||!colorPattern.test(sourceMaterial[key] as string)))) return undefined
      material={
        ...(typeof sourceMaterial.preset==='string'?{preset:sourceMaterial.preset.slice(0,40)}:{}),
        ...(typeof sourceMaterial.baseColor==='string'?{baseColor:sourceMaterial.baseColor}:{}),
        ...(typeof sourceMaterial.emissive==='string'?{emissive:sourceMaterial.emissive}:{}),
        ...Object.fromEntries(numeric.filter(key=>typeof sourceMaterial[key]==='number')
          .map(key=>[key,sourceMaterial[key]])),
      }
    }
    nodes.push({
      type: item.type as Scene3DNode['type'],
      position: item.position,
      size: item.size,
      color: item.color,
      ...(typeof item.name === 'string' ? { name: item.name.slice(0,100) } : {}),
      ...(item.rotation === undefined ? {} : { rotation: item.rotation as [number, number, number] }),
      ...(item.type==='mesh'?{vertices:vertices as number[]}:{}),
      ...(material===undefined?{}:{material}),
      ...(item.hidden===true?{hidden:true}:{}),
    })
  }
  return {
    version: 1, units:'meters',
    name: typeof value.name === 'string' ? value.name.slice(0,140) : 'Escena 3D',
    background: typeof value.background === 'string' && colorPattern.test(value.background) ? value.background : '#f7f2eb',
    nodes,
    ...(value.environment==='studio'||value.environment==='sunset'||value.environment==='daylight'?{environment:value.environment}:{}),
    ...(value.camera==='perspective'||value.camera==='isometric'||value.camera==='front'||value.camera==='top'?{camera:value.camera}:{}),
  }
}

const deg = Math.PI / 180
function transform(vertex: Vec3, node: Scene3DNode): Vec3 {
  let [x,y,z] = vertex
  const [rx,ry,rz] = node.rotation ?? [0,0,0] as const
  const ax = rx * deg, ay = ry * deg, az = rz * deg
  ;[y,z] = [y*Math.cos(ax)-z*Math.sin(ax),y*Math.sin(ax)+z*Math.cos(ax)]
  ;[x,z] = [x*Math.cos(ay)+z*Math.sin(ay),-x*Math.sin(ay)+z*Math.cos(ay)]
  ;[x,y] = [x*Math.cos(az)-y*Math.sin(az),x*Math.sin(az)+y*Math.cos(az)]
  return [x*node.size[0]+node.position[0], y*node.size[1]+node.position[1], z*node.size[2]+node.position[2]]
}
function mesh(node: Scene3DNode): Face[] {
  if(node.hidden===true)return []
  const faces: Vec3[][] = []
  if(node.type==='mesh'&&node.vertices!==undefined){
    for(let i=0;i<node.vertices.length;i+=9){
      faces.push([
        [node.vertices[i]!,node.vertices[i+1]!,node.vertices[i+2]!],
        [node.vertices[i+3]!,node.vertices[i+4]!,node.vertices[i+5]!],
        [node.vertices[i+6]!,node.vertices[i+7]!,node.vertices[i+8]!],
      ])
    }
  } else
  const quad=(a: Vec3,b: Vec3,c:Vec3,d:Vec3)=>{faces.push([a,b,c,d])}
  if (node.type === 'box') {
    const v:Vec3[]=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]
    for (const ids of [[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]]) {
      quad(v[ids[0]!]!,v[ids[1]!]!,v[ids[2]!]!,v[ids[3]!]!)
    }
  } else {
    const slices=12, rings=node.type==='sphere'?8:1
    for(let j=0;j<rings;j++){
      for(let i=0;i<slices;i++){
        const a=2*Math.PI*i/slices,b=2*Math.PI*(i+1)/slices
        let lo:Vec3,hi:Vec3,lo2:Vec3,hi2:Vec3
        if(node.type==='sphere'){
          const lat1=-Math.PI/2+j*Math.PI/rings,lat2=-Math.PI/2+(j+1)*Math.PI/rings
          const sphere=(lat:number,lon:number):Vec3=>[Math.cos(lat)*Math.cos(lon)*.5,Math.sin(lat)*.5,Math.cos(lat)*Math.sin(lon)*.5]
          lo=sphere(lat1,a);hi=sphere(lat2,a);lo2=sphere(lat1,b);hi2=sphere(lat2,b)
        } else {
          const bottom=.5
          const top=node.type==='cone'?0:.5
          lo=[Math.cos(a)*bottom,-.5,Math.sin(a)*bottom]
          lo2=[Math.cos(b)*bottom,-.5,Math.sin(b)*bottom]
          hi=[Math.cos(a)*top,.5,Math.sin(a)*top]
          hi2=[Math.cos(b)*top,.5,Math.sin(b)*top]
        }
        quad(lo,lo2,hi2,hi)
        if(node.type!=='sphere'){
          faces.push([[0,.5,0],hi,hi2])
          faces.push([[0,-.5,0],lo2,lo])
        }
      }
    }
  }
  return faces.map(vertices => ({
    vertices: vertices.map(point => transform(point,node)), color:node.material?.baseColor??node.color,
    alpha: node.material?.opacity??(/cristal|acristalad|glass|window/iu.test(node.name ?? '') ? .77 : 1),
  }))
}
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
function lighting(vertices: readonly Vec3[]): number {
  const [a,b,c]=vertices
  if(a===undefined||b===undefined||c===undefined)return 1
  const n=cross([b[0]-a[0],b[1]-a[1],b[2]-a[2]],[c[0]-a[0],c[1]-a[1],c[2]-a[2]])
  const len=Math.hypot(...n)||1
  const d=(n[0]*-.35+n[1]*.84+n[2]*.40)/len
  return .58+Math.max(0,d)*.42
}
function shade(value:string, factor:number):string {
  const channels=[1,3,5].map(i=>Math.min(255,Math.max(0,Math.round(parseInt(value.slice(i,i+2),16)*factor))))
  return `rgb(${channels.join(',')})`
}
function sceneBounds(scene:Scene3D): {center:Vec3; radius:number} {
  const mins:Vec3=[Infinity,Infinity,Infinity], maxs:Vec3=[-Infinity,-Infinity,-Infinity]
  for(const node of scene.nodes) for(let axis=0;axis<3;axis++){
    const pos=node.position[axis]!,size=node.size[axis]!
    mins[axis]=Math.min(mins[axis]!,pos-size/2)
    maxs[axis]=Math.max(maxs[axis]!,pos+size/2)
  }
  const center:Vec3=[(mins[0]+maxs[0])/2,(mins[1]+maxs[1])/2,(mins[2]+maxs[2])/2]
  return {center,radius:Math.max(2,Math.hypot(maxs[0]-mins[0],maxs[1]-mins[1],maxs[2]-mins[2])*.62)}
}

function paint(canvas:HTMLCanvasElement,scene:Scene3D,faces:readonly Face[],
  bounds:{center:Vec3;radius:number},yaw:number,pitch:number,zoom:number,pan:[number,number]):void{
  const ctx=canvas.getContext('2d')
  if(ctx===null)return
  const rect=canvas.getBoundingClientRect()
  const width=Math.max(1,rect.width||canvas.clientWidth||640)
  const height=Math.max(1,rect.height||canvas.clientHeight||400)
  const dpr=Math.min(2,window.devicePixelRatio||1)
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
  }
  ctx.setTransform(dpr,0,0,dpr,0,0)
  ctx.fillStyle=scene.background
  ctx.fillRect(0,0,width,height)
  const distance=bounds.radius*2.5/zoom
  const focal=Math.min(width,height)*1.45
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch)
  const project=(p:Vec3):[number,number,number]=>{
    const x=p[0]-bounds.center[0],y=p[1]-bounds.center[1],z=p[2]-bounds.center[2]
    const x1=cy*x-sy*z,z1=sy*x+cy*z
    const y2=cp*y-sp*z1,z2=sp*y+cp*z1
    const perspective=focal/Math.max(.1,distance-z2)
    return [width*.5+pan[0]+x1*perspective,height*.54+pan[1]-y2*perspective,z2]
  }
  // Ground grid gives a stable orientation cue when rotating the geometry.
  ctx.strokeStyle='rgba(90,80,69,.13)';ctx.lineWidth=.8
  const ground=bounds.center[1]-bounds.radius*.62
  for(let i=-10;i<=10;i++){
    const a=project([bounds.center[0]+i*bounds.radius/10,ground,bounds.center[2]-bounds.radius])
    const b=project([bounds.center[0]+i*bounds.radius/10,ground,bounds.center[2]+bounds.radius])
    const c=project([bounds.center[0]-bounds.radius,ground,bounds.center[2]+i*bounds.radius/10])
    const d=project([bounds.center[0]+bounds.radius,ground,bounds.center[2]+i*bounds.radius/10])
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);ctx.stroke()
  }
  const projected:Projected[]=faces.map(face=>{
    const v=face.vertices.map(project)
    return {points:v.map(p=>[p[0],p[1]]),depth:v.reduce((sum,p)=>sum+p[2],0)/v.length,
      color:face.color,alpha:face.alpha,light:lighting(face.vertices)}
  })
  projected.sort((a,b)=>a.depth-b.depth)
  for(const face of projected){
    const first=face.points[0]
    if(first===undefined)continue
    ctx.beginPath();ctx.moveTo(first[0],first[1])
    for(const p of face.points.slice(1))ctx.lineTo(p[0],p[1])
    ctx.closePath()
    ctx.globalAlpha=face.alpha
    ctx.fillStyle=shade(face.color,face.light)
    ctx.fill()
    ctx.strokeStyle='rgba(58,49,38,.19)'
    ctx.lineWidth=.55
    ctx.stroke()
  }
  ctx.globalAlpha=1
}

/** Native interactive 3D scene canvas; no CDN, fake PNG interaction, or network. */
export function Scene3DView({ spec, expanded = false }: { readonly spec: unknown; readonly expanded?: boolean }) {
  const scene=useMemo(()=>parseScene3D(spec),[spec])
  const canvas=useRef<HTMLCanvasElement>(null)
  const drag=useRef<{x:number;y:number;button:number}|null>(null)
  const angle=useRef({yaw:-.65,pitch:.38,zoom:1,pan:[0,0] as [number,number]})
  const [autoRotate,setAutoRotate]=useState(false)
  const redraw=useRef<()=>void>(()=>{})
  const [problem,setProblem]=useState('')
  const meshes=useMemo(()=>scene?.nodes.flatMap(mesh)??[],[scene])
  const bounds=useMemo(()=>scene===undefined?undefined:sceneBounds(scene),[scene])
  useEffect(()=>{
    if(scene===undefined||bounds===undefined)return
    const element=canvas.current
    if(element===null)return
    if(element.getContext('2d')===null) {
      setProblem('Este navegador no permite dibujar el modelo 3D.')
      return
    }
    const draw=()=>paint(element,scene,meshes,bounds,angle.current.yaw,
      angle.current.pitch,angle.current.zoom,angle.current.pan)
    redraw.current=draw
    draw()
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(draw)
    observer?.observe(element)
    let frame=0
    if(autoRotate){
      const tick=()=>{angle.current.yaw+=.004;draw();frame=requestAnimationFrame(tick)}
      frame=requestAnimationFrame(tick)
    }
    return ()=>{observer?.disconnect();cancelAnimationFrame(frame);redraw.current=()=>{}}
  },[scene,meshes,bounds,autoRotate,expanded])
  if(scene===undefined)return <p role="alert" className={css.error}>La escena 3D no contiene geometría válida.</p>
  const update=(fn:()=>void)=>{fn();redraw.current()}
  return <section className={css.root} data-phoenix-scene3d="interactive" data-scene-node-count={scene.nodes.length}>
    <div className={css.toolbar}>
      <span className={css.tag}>3D interactivo · {scene.nodes.length} piezas</span>
      <div className={css.actions}>
        <button type="button" onClick={()=>update(()=>{angle.current.zoom=Math.min(6,angle.current.zoom*1.25)})}
          aria-label="Acercar modelo 3D">+</button>
        <button type="button" onClick={()=>update(()=>{angle.current.zoom=Math.max(.2,angle.current.zoom/1.25)})}
          aria-label="Alejar modelo 3D">−</button>
        <button type="button" onClick={()=>update(()=>{angle.current={yaw:-.65,pitch:.38,zoom:1,pan:[0,0]}})}>Restablecer</button>
        <button type="button" aria-pressed={autoRotate} onClick={()=>setAutoRotate(value=>!value)}>
          {autoRotate?'Pausar':'Girar'}</button>
      </div>
    </div>
    <canvas ref={canvas} className={expanded?css.canvasLarge:css.canvas} aria-label={`Modelo tridimensional manipulable: ${scene.name}`}
      onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);
        drag.current={x:event.clientX,y:event.clientY,button:event.button}}}
      onPointerMove={event=>{
        const point=drag.current;if(point===null)return
        const dx=event.clientX-point.x,dy=event.clientY-point.y
        drag.current={...point,x:event.clientX,y:event.clientY}
        update(()=>{
          if(point.button===2||event.shiftKey){
            angle.current.pan[0]+=dx;angle.current.pan[1]+=dy
          }else{
            angle.current.yaw+=dx*.009
            angle.current.pitch=Math.max(-1.48,Math.min(1.48,angle.current.pitch+dy*.007))
          }
        })
      }}
      onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)}}
      onPointerCancel={()=>{drag.current=null}}
      onContextMenu={event=>event.preventDefault()}
      onWheel={event=>{event.preventDefault();update(()=>{angle.current.zoom=Math.max(.2,Math.min(6,angle.current.zoom*(event.deltaY>0?.91:1.1)))})}}
    />
    {problem!==''&&<p role="alert" className={css.error}>{problem}</p>}
    <div className={css.help}>Arrastra para girar · Rueda para zoom · Mayús + arrastrar para mover · Descarga JSON para usar en tus apps</div>
  </section>
}
