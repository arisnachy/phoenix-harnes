import {createKiraHeadGeometry,createKiraHairBackGeometry,kira3dPose,kiraBlinkAmount} from './kira-voice-3d-geometry.ts'
import type {KiraAvatarExpression} from './kira-voice-movement.ts'
export type Kira3DPhase='listening'|'speaking'|'paused'|'thinking'|'inactive'
export type Kira3DFrame={elapsed:number;level:number;phase:Kira3DPhase;expression:KiraAvatarExpression;reducedMotion:boolean}
export interface Kira3DRenderer{draw(input:Kira3DFrame):void;dispose():void}
const VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUv;
uniform mat4 uMvp;
out vec2 vUv;
void main(){vUv=aUv;gl_Position=uMvp*vec4(aPosition,1.0);}
`
const FRAGMENT=`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPortrait;
uniform vec4 uColor;
uniform bool uTextured;
uniform float uMouth;
uniform float uBlink;
out vec4 outputColor;
void main(){
  if(!uTextured){outputColor=uColor;return;}
  // Keep the artist's actual lips and eye. Change sampling coordinates by
  // only a few pixels: no extra drawn ellipse, fake tongue or cheek sticker.
  vec2 uv=vec2(vUv.x,1.0-vUv.y);
  vec2 lip=(uv-vec2(.625,.704))/vec2(.11,.055);
  float lipMask=exp(-dot(lip,lip)*1.6);
  uv.y-=(uv.y-.704)*uMouth*.25*lipMask;
  vec2 eye=(uv-vec2(.668,.45))/vec2(.075,.052);
  float eyeMask=exp(-dot(eye,eye)*1.8);
  uv.y+=(uv.y-.45)*uBlink*.32*eyeMask;
  outputColor=texture(uPortrait,vec2(clamp(uv.x,0.0,1.0),1.0-clamp(uv.y,0.0,1.0)));
  if(outputColor.a<.01)discard;
}
`
function compile(gl:WebGL2RenderingContext,type:number,source:string):WebGLShader{
  const shader=gl.createShader(type)
  if(!shader)throw new Error('Kira WebGL shader unavailable')
  gl.shaderSource(shader,source);gl.compileShader(shader)
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const error=gl.getShaderInfoLog(shader)
    gl.deleteShader(shader);throw new Error('Kira WebGL shader compilation failed: '+error)
  }
  return shader
}
function programFor(gl:WebGL2RenderingContext):WebGLProgram {
  const vert=compile(gl,gl.VERTEX_SHADER,VERTEX)
  const frag=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT)
  const program=gl.createProgram()
  if(!program)throw new Error('Kira WebGL program unavailable')
  gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program)
  gl.deleteShader(vert);gl.deleteShader(frag)
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
    const error=gl.getProgramInfoLog(program);gl.deleteProgram(program)
    throw new Error('Kira WebGL link failed: '+error)
  }
  return program
}
/** Perspective camera with yaw, pitch and roll: true 3D model rotation. */
function modelProjection(yaw:number,pitch:number,roll:number,scale:number):Float32Array{
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch)
  const cz=Math.cos(roll),sz=Math.sin(roll)
  const r00=cz*cy,r01=cz*sy*sx-sz*cx,r02=cz*sy*cx+sz*sx
  const r10=sz*cy,r11=sz*sy*sx+cz*cx,r12=sz*sy*cx-cz*sx
  const r20=-sy,r21=cy*sx,r22=cy*cx
  const near=.1,far=20,f=1/Math.tan(45*Math.PI/360),z=-2.77
  const c=(far+near)/(near-far),d=2*far*near/(near-far)
  return new Float32Array([
    f*r00*scale,f*r10*scale,c*r20*scale,-r20*scale,
    f*r01*scale,f*r11*scale,c*r21*scale,-r21*scale,
    f*r02*scale,f*r12*scale,c*r22*scale,-r22*scale,
    0,0,c*z+d,-z,
  ])
}
export function createKira3DRenderer(canvas:HTMLCanvasElement,portrait:HTMLImageElement):Kira3DRenderer|undefined{
  // Some GPU drivers throw instead of returning null during WebGL creation.
  // Never let a renderer failure crash PHOENIX's voice transport.
  let gl:WebGL2RenderingContext|null
  try {
    gl=canvas.getContext('webgl2',{alpha:true,antialias:true,depth:true,
      premultipliedAlpha:true,preserveDrawingBuffer:false})
  }catch{return undefined}
  if(!gl)return undefined
  let resources:{program:WebGLProgram;texture:WebGLTexture;face:WebGLBuffer;indices:WebGLBuffer;
    faceVao:WebGLVertexArrayObject;hair:WebGLBuffer;hairVao:WebGLVertexArrayObject}|undefined
  try{
    const program=programFor(gl)
    const texture=gl.createTexture(),face=gl.createBuffer(),indices=gl.createBuffer()
    const faceVao=gl.createVertexArray()
    const hair=gl.createBuffer(),hairVao=gl.createVertexArray()
    if(!texture||!face||!indices||!faceVao||!hair||!hairVao)
      throw new Error('Kira WebGL buffers unavailable')
    const geometry=createKiraHeadGeometry()
    const backHair=createKiraHairBackGeometry(geometry)
    gl.bindTexture(gl.TEXTURE_2D,texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,portrait)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.bindVertexArray(faceVao)
    gl.bindBuffer(gl.ARRAY_BUFFER,face);gl.bufferData(gl.ARRAY_BUFFER,geometry.vertices,gl.STATIC_DRAW)
    gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);gl.enableVertexAttribArray(1)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,geometry.indices,gl.STATIC_DRAW)
    gl.bindVertexArray(hairVao)
    gl.bindBuffer(gl.ARRAY_BUFFER,hair)
    gl.bufferData(gl.ARRAY_BUFFER,backHair.vertices,gl.STATIC_DRAW)
    gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);gl.enableVertexAttribArray(1)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices)
    gl.bindVertexArray(null)
    resources={program,texture,face,indices,faceVao,hair,hairVao}
    const matrixLocation=gl.getUniformLocation(program,'uMvp')
    const texturedLocation=gl.getUniformLocation(program,'uTextured')
    const colorLocation=gl.getUniformLocation(program,'uColor')
    const samplerLocation=gl.getUniformLocation(program,'uPortrait')
    const mouthLocation=gl.getUniformLocation(program,'uMouth')
    const blinkLocation=gl.getUniformLocation(program,'uBlink')
    if(!matrixLocation||!texturedLocation||!colorLocation||!samplerLocation||!mouthLocation||!blinkLocation)
      throw new Error('Kira WebGL uniforms unavailable')
    let disposed=false
    const draw=(frame:Kira3DFrame)=>{
      if(disposed)return
      const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1))
      const size=Math.max(96,Math.round((canvas.clientWidth||220)*dpr))
      if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size}
      gl.viewport(0,0,size,size)
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL)
      gl.useProgram(program);gl.uniform1i(samplerLocation,0)
      const opening=frame.phase==='speaking'?Math.min(.78,Math.max(0,frame.level)) : 0
      gl.uniform1f(mouthLocation,opening)
      gl.uniform1f(blinkLocation,frame.reducedMotion?0:Math.min(.50,kiraBlinkAmount(frame.elapsed)*.50))
      const pose=kira3dPose(frame.elapsed,frame.level,frame.phase,frame.reducedMotion)
      gl.uniformMatrix4fv(matrixLocation,false,modelProjection(pose.yaw,pose.pitch,pose.roll,pose.scale))
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture)
      gl.uniform1i(texturedLocation,0);gl.uniform4fv(colorLocation,
        new Float32Array([.19,.085,.075,1]))
      gl.bindVertexArray(hairVao)
      gl.drawElements(gl.TRIANGLES,backHair.indices.length,gl.UNSIGNED_SHORT,0)
      gl.uniform1i(texturedLocation,1);gl.bindVertexArray(faceVao)
      gl.drawElements(gl.TRIANGLES,geometry.indices.length,gl.UNSIGNED_SHORT,0)
      gl.bindVertexArray(null)
    }
    return{
      draw,dispose(){
        if(disposed)return;disposed=true
        gl.deleteVertexArray(faceVao);gl.deleteVertexArray(hairVao)
        gl.deleteBuffer(face);gl.deleteBuffer(indices);gl.deleteBuffer(hair)
        gl.deleteTexture(texture);gl.deleteProgram(program)
      },
    }
  }catch{
    if(resources){
      gl.deleteVertexArray(resources.faceVao);gl.deleteVertexArray(resources.hairVao)
      gl.deleteBuffer(resources.face);gl.deleteBuffer(resources.indices);gl.deleteBuffer(resources.hair)
      gl.deleteTexture(resources.texture);gl.deleteProgram(resources.program)
    }
    return undefined
  }
}
