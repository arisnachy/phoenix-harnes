/** Native WebGL2 solid-shaded depth-tested renderer; Canvas2D remains the fallback.
 * No remotely loaded scripts, shader strings from the model, or unsafe textures.
 */
type Vector = readonly [number,number,number]
interface Face { readonly vertices: readonly Vector[]; readonly color: string; readonly alpha: number }
interface Bounds { readonly center: Vector; readonly radius: number }
interface Pipeline {
  readonly gl: WebGL2RenderingContext
  readonly program: WebGLProgram
  readonly buffer: WebGLBuffer
  readonly position: number
  readonly normal: number
  readonly color: number
  readonly center: WebGLUniformLocation | null
  readonly rotation: WebGLUniformLocation | null
  readonly distance: WebGLUniformLocation | null
  readonly pan: WebGLUniformLocation | null
  readonly projection: WebGLUniformLocation | null
  readonly light: WebGLUniformLocation | null
}
const pipelines = new WeakMap<HTMLCanvasElement,Pipeline>()
const vertexShader = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec4 aColor;
uniform vec3 uCenter;
uniform vec2 uRotation;
uniform float uDistance;
uniform vec2 uPan;
uniform mat4 uProjection;
uniform vec3 uLight;
out vec4 vColor;
void main(){
  vec3 p=aPosition-uCenter;
  float cy=cos(uRotation.x),sy=sin(uRotation.x);
  float cp=cos(uRotation.y),sp=sin(uRotation.y);
  float x1=cy*p.x-sy*p.z;
  float z1=sy*p.x+cy*p.z;
  float y2=cp*p.y-sp*z1;
  float z2=sp*p.y+cp*z1;
  gl_Position=uProjection*vec4(x1+uPan.x,y2+uPan.y,z2-uDistance,1.0);
  float diffuse=max(dot(normalize(aNormal),normalize(uLight)),0.0);
  float shade=0.44+diffuse*0.56;
  vColor=vec4(aColor.rgb*shade,aColor.a);
}`
const fragmentShader = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main(){fragColor=vColor;}`

function pipeline(canvas: HTMLCanvasElement): Pipeline | undefined {
  const previous=pipelines.get(canvas)
  if(previous!==undefined)return previous
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:true})
  if(gl===null || typeof gl.createShader!=='function')return undefined
  const shader=(type:number,source:string):WebGLShader|undefined=>{
    const s=gl.createShader(type)
    if(s===null)return undefined
    gl.shaderSource(s,source)
    gl.compileShader(s)
    if(gl.getShaderParameter(s,gl.COMPILE_STATUS)!==true){gl.deleteShader(s);return undefined}
    return s
  }
  const vs=shader(gl.VERTEX_SHADER,vertexShader),fs=shader(gl.FRAGMENT_SHADER,fragmentShader)
  if(vs===undefined||fs===undefined)return undefined
  const program=gl.createProgram()
  const buffer=gl.createBuffer()
  if(program===null||buffer===null)return undefined
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program)
  gl.deleteShader(vs);gl.deleteShader(fs)
  if(gl.getProgramParameter(program,gl.LINK_STATUS)!==true)return undefined
  const item:Pipeline={gl,program,buffer,
    position:gl.getAttribLocation(program,'aPosition'),
    normal:gl.getAttribLocation(program,'aNormal'),
    color:gl.getAttribLocation(program,'aColor'),
    center:gl.getUniformLocation(program,'uCenter'),
    rotation:gl.getUniformLocation(program,'uRotation'),
    distance:gl.getUniformLocation(program,'uDistance'),
    pan:gl.getUniformLocation(program,'uPan'),
    projection:gl.getUniformLocation(program,'uProjection'),
    light:gl.getUniformLocation(program,'uLight')}
  pipelines.set(canvas,item)
  return item
}
function surfaceNormal(a:Vector,b:Vector,c:Vector):Vector{
  const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]]
  const v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]]
  const x=u[1]*v[2]-u[2]*v[1],y=u[2]*v[0]-u[0]*v[2],z=u[0]*v[1]-u[1]*v[0]
  const m=Math.hypot(x,y,z)||1
  return [x/m,y/m,z/m]
}
function geometry(faces:readonly Face[]):Float32Array{
  const numbers:number[]=[]
  for(const face of faces){
    const a=face.vertices[0]
    if(a===undefined)continue
    const hex=face.color
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    for(let index=1;index+1<face.vertices.length;index++){
      const b=face.vertices[index]!,c=face.vertices[index+1]!
      const normal=surfaceNormal(a,b,c)
      for(const vertex of [a,b,c])numbers.push(
        ...vertex,...normal,rgb[0]!,rgb[1]!,rgb[2]!,face.alpha)
    }
  }
  return new Float32Array(numbers)
}
/** True means GPU rendering completed; false permits the existing Canvas2D fallback. */
export function drawWebGLScene(canvas:HTMLCanvasElement,faces:readonly Face[],
  bounds:Bounds,background:string,yaw:number,pitch:number,zoom:number,
  pan:readonly [number,number]):boolean {
  const p=pipeline(canvas)
  if(p===undefined)return false
  const {gl}=p
  const rect=canvas.getBoundingClientRect()
  const width=Math.max(1,rect.width||canvas.clientWidth||640)
  const height=Math.max(1,rect.height||canvas.clientHeight||400)
  const dpr=Math.min(2,window.devicePixelRatio||1)
  const w=Math.round(width*dpr),h=Math.round(height*dpr)
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  gl.viewport(0,0,w,h)
  const rgb=[1,3,5].map(i=>parseInt(background.slice(i,i+2),16)/255)
  gl.clearColor(rgb[0]!,rgb[1]!,rgb[2]!,1)
  gl.clearDepth(1)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA)
  gl.disable(gl.CULL_FACE)
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
  const data=geometry(faces)
  gl.useProgram(p.program)
  gl.bindBuffer(gl.ARRAY_BUFFER,p.buffer)
  gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW)
  const stride=10*4
  for(const [slot,size,offset] of [[p.position,3,0],[p.normal,3,12],[p.color,4,24]]){
    if(slot<0)continue
    gl.enableVertexAttribArray(slot)
    gl.vertexAttribPointer(slot,size,gl.FLOAT,false,stride,offset)
  }
  const near=.05,far=Math.max(500,bounds.radius*40),f=1/Math.tan(.85/2)
  const aspect=width/height
  const projection=new Float32Array([f/aspect,0,0,0,0,f,0,0,
    0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0])
  gl.uniformMatrix4fv(p.projection,false,projection)
  gl.uniform3f(p.center,...bounds.center)
  gl.uniform2f(p.rotation,yaw,pitch)
  gl.uniform1f(p.distance,bounds.radius*2.5/zoom)
  const panScale=bounds.radius*2/height
  gl.uniform2f(p.pan,pan[0]*panScale,-pan[1]*panScale)
  gl.uniform3f(p.light,-.32,.85,.42)
  gl.drawArrays(gl.TRIANGLES,0,data.length/10)
  return true
}
