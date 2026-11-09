/** Actual curved 3D portrait surface. The reference portrait stays the color/identity
 * source; the surface, head turns and lip/eye layers use 3D coordinates rather than
 * applying a CSS transform to a flat picture.
 */
export type KiraHeadGeometry={readonly vertices:Float32Array;readonly indices:Uint16Array}
export const KIRA_HEAD_SEGMENTS=52
const clamp=(n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n))
const gaussian=(x:number,y:number,sx:number,sy:number)=>
  Math.exp(-.5*((x/sx)**2+(y/sy)**2))

/** Face and hair relief in metres-like model units. Front projection uses the
 * original image without resynthesizing a second, mismatched Kira face.
 */
export function kiraFaceDepth(u:number,v:number):number {
  const x=(u-.5)*2,y=(v-.5)*2
  const radial=Math.sqrt(Math.max(0,1-x*x-y*y))
  const cheek=gaussian(u-.57,v-.56,.25,.27)*.11
  const nose=gaussian(u-.61,v-.55,.045,.11)*.115
  const chin=gaussian(u-.57,v-.74,.16,.13)*.045
  const hair=gaussian(u-.35,v-.19,.34,.27)*.055
  return .035+.29*radial+cheek+nose+chin+hair
}
export function kiraFacePoint(u:number,v:number,offset=0):readonly[number,number,number]{
  return[(u-.5)*2.06,(.5-v)*2.06,kiraFaceDepth(u,v)+offset]
}
/** 52x52 tessellation: true triangles with curved depth and perspective. */
export function createKiraHeadGeometry(segments=KIRA_HEAD_SEGMENTS):KiraHeadGeometry {
  const n=clamp(Math.floor(segments),12,90)
  const vertices=new Float32Array((n+1)*(n+1)*5)
  const indices:number[]=[]
  for(let iy=0;iy<=n;iy++)for(let ix=0;ix<=n;ix++){
    const u=ix/n,v=iy/n
    const [x,y,z]=kiraFacePoint(u,v)
    const i=(iy*(n+1)+ix)*5
    vertices.set([x,y,z,u,1-v],i)
  }
  for(let iy=0;iy<n;iy++)for(let ix=0;ix<n;ix++){
    const u=(ix+.5)/n,v=(iy+.5)/n
    const dx=(u-.5)*2,dy=(v-.5)*2
    if(dx*dx+dy*dy>.975*.975)continue
    const tl=iy*(n+1)+ix,bl=(iy+1)*(n+1)+ix
    indices.push(tl,bl,tl+1,tl+1,bl,bl+1)
  }
  return{vertices,indices:new Uint16Array(indices)}
}
/** A bounded physical head pose prevents a flat side profile from being shown. */
export function kira3dPose(
  elapsedMs:number,level:number,phase:'listening'|'speaking'|'paused'|'thinking'|'inactive',
  reducedMotion=false,
):{yaw:number;pitch:number;roll:number;scale:number}{
  if(reducedMotion)return{yaw:0,pitch:0,roll:0,scale:1}
  const energy=clamp(Number.isFinite(level)?level:0,0,1)
  const animated=phase==='speaking' || phase==='listening'
  return{
    yaw:Math.sin(elapsedMs/1850)*.105 + (phase==='listening'?.015:0),
    pitch:Math.sin(elapsedMs/2380)*.043-(phase==='thinking'?.028:0),
    roll:Math.sin(elapsedMs/2800)*.027,
    scale:1+(animated?.012+energy*.021:0),
  }
}
/** Blink the open eye at natural irregular intervals, no persistent wink mask. */
export function kiraBlinkAmount(elapsedMs:number):number {
  if(!Number.isFinite(elapsedMs)||elapsedMs<0)return 0
  const cycle=elapsedMs%4900
  const blink=(t:number)=>clamp(1-Math.abs(t-100)/100,0,1)
  return Math.max(blink(cycle-2500),blink(cycle-2815)*.6)
}
