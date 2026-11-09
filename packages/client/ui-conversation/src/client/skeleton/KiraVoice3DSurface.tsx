import {useEffect,useRef} from 'react'
import type {RefObject} from 'react'
import type {VoiceAssistantPhase} from '../voice.ts'
import type {KiraAvatarExpression} from './kira-voice-movement.ts'
import {KIRA_VOICE_PORTRAIT} from './kira-voice-portrait.ts'
import {createKira3DRenderer} from './kira-voice-webgl.ts'
import type {Kira3DPhase,Kira3DRenderer} from './kira-voice-webgl.ts'

export type Kira3DMotion={level:number;expression:KiraAvatarExpression}
export interface KiraVoice3DSurfaceProps{
  readonly phase:VoiceAssistantPhase
  readonly busy:boolean
  readonly motionRef:RefObject<Kira3DMotion>
  readonly onReady:(ready:boolean)=>void
}
/** GPU-backed 3D relief of the authorized anime Kira portrait.
 * Never reads microphone input or starts speech: only the parent voice state
 * owns that authorization, and the canvas only draws the already-measured cue.
 */
export function KiraVoice3DSurface({phase,busy,motionRef,onReady}:KiraVoice3DSurfaceProps){
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const liveRef=useRef({phase,busy})
  liveRef.current={phase,busy}
  useEffect(()=>{
    const canvas=canvasRef.current
    if(canvas===null||typeof WebGL2RenderingContext==='undefined'
      ||typeof window.requestAnimationFrame!=='function'){
      onReady(false);return
    }
    let disposed=false,frame=0
    let renderer:Kira3DRenderer|undefined
    let start=0
    const image=new Image()
    const media=typeof window.matchMedia==='function'
      ?window.matchMedia('(prefers-reduced-motion: reduce)'):undefined
    const draw=(now:number)=>{
      if(disposed||renderer===undefined)return
      if(start===0)start=now
      const state=liveRef.current
      const motion=motionRef.current
      const phase:Kira3DPhase=state.phase==='paused'&&state.busy
        ?'thinking':state.phase
      renderer.draw({
        elapsed:now-start,
        level:motion?.level??0,
        expression:motion?.expression??'neutral',
        phase,reducedMotion:media?.matches??false,
      })
      frame=window.requestAnimationFrame(draw)
    }
    const initialize=()=>{
      if(disposed)return
      renderer?.dispose()
      renderer=createKira3DRenderer(canvas,image)
      if(renderer===undefined){onReady(false);return}
      onReady(true)
      start=0
      frame=window.requestAnimationFrame(draw)
    }
    const onLost=(event:Event)=>{
      event.preventDefault()
      window.cancelAnimationFrame(frame)
      renderer=undefined
      onReady(false)
    }
    const onRestored=()=>initialize()
    canvas.addEventListener('webglcontextlost',onLost)
    canvas.addEventListener('webglcontextrestored',onRestored)
    image.onload=initialize
    image.onerror=()=>{if(!disposed)onReady(false)}
    image.src=KIRA_VOICE_PORTRAIT
    return()=>{
      disposed=true
      window.cancelAnimationFrame(frame)
      image.onload=null;image.onerror=null
      canvas.removeEventListener('webglcontextlost',onLost)
      canvas.removeEventListener('webglcontextrestored',onRestored)
      renderer?.dispose();renderer=undefined
    }
  },[motionRef,onReady])
  return <canvas ref={canvasRef} aria-hidden="true" data-kira-avatar-3d
    style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block',
      pointerEvents:'none'}}/>
}
