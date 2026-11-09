import {useEffect, useRef} from 'react'
import type {VoiceAssistantPhase} from '../voice.ts'
import {getVoiceAvatarAudioStream,getVoiceAssistantSpokenText} from '../voice.ts'
import {KIRA_VOICE_PORTRAIT} from './kira-voice-portrait.ts'
import {kiraAudioMouthLevel,kiraExpressionFromSpeech,kiraSpeechMouthEnvelope} from './kira-voice-movement.ts'
import css from './KiraVoiceAvatar.module.css'

export interface KiraVoiceAvatarProps {
  readonly active:boolean
  readonly phase:VoiceAssistantPhase
  readonly busy:boolean
  readonly native:boolean
  readonly onStop:()=>void
}
const PHASE_TEXT={
  inactive:'Inactiva',paused:'En espera',thinking:'Pensando…',
  listening:'Te escucho',speaking:'Hablando',
} as const

/** The authorized voice transport owns audio; the avatar only observes levels.
 * A still, approved Kira portrait stays intact behind a small articulated mouth
 * and head pose. For actual viseme-level animation a rigged art asset is needed.
 */
export function KiraVoiceAvatar({active,phase,busy,native,onStop}:KiraVoiceAvatarProps) {
  const figureRef=useRef<HTMLDivElement>(null)
  const portraitRef=useRef<HTMLImageElement>(null)
  const mouthRef=useRef<SVGEllipseElement>(null)
  const lipRef=useRef<SVGEllipseElement>(null)
  const stageRef=useRef<HTMLElement>(null)
  const observedPhase=phase==='paused'&&busy?'thinking':phase

  useEffect(()=>{
    if(!active)return
    let frame=0
    let audioContext:AudioContext|undefined
    let source:MediaStreamAudioSourceNode|undefined
    let analyser:AnalyserNode|undefined
    let silent:GainNode|undefined
    let samples:Uint8Array|undefined
    let nextAttempt=0
    let smooth=0
    let expression='neutral'
    const start=performance.now()
    const reduced=typeof window.matchMedia==='function'
      &&window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const attach=()=>{
      if(!native||analyser!==undefined||typeof AudioContext==='undefined')return
      const stream=getVoiceAvatarAudioStream(phase==='speaking'?'output':'input')
      if(stream===undefined||stream.getAudioTracks().length===0)return
      try{
        const context=new AudioContext()
        const input=context.createMediaStreamSource(stream)
        const meter=context.createAnalyser()
        meter.fftSize=512
        meter.smoothingTimeConstant=.65
        const sink=context.createGain()
        sink.gain.value=0
        input.connect(meter)
        // Silent observation path; the original WebRTC audio element still plays.
        meter.connect(sink)
        sink.connect(context.destination)
        void context.resume().catch(()=>undefined)
        audioContext=context;source=input;analyser=meter;silent=sink
        samples=new Uint8Array(meter.fftSize)
        if(stageRef.current)stageRef.current.dataset.audioReactive='true'
      }catch {
        // Browser audio graph may be restricted; the fallback uses speech text.
      }
    }
    const animate=(now:number)=>{
      const elapsed=now-start
      if(!analyser&&now>=nextAttempt){attach();nextAttempt=now+600}
      let rms=0
      if(analyser&&samples){
        analyser.getByteTimeDomainData(samples as Uint8Array<ArrayBuffer>)
        let total=0
        for(const sample of samples){const centered=(sample-128)/128;total+=centered*centered}
        rms=Math.sqrt(total/samples.length)
      }
      const speech=getVoiceAssistantSpokenText()
      if(phase==='speaking'&&speech){
        // Use the approximate spoken phrase rather than the whole future reply.
        // Precise alignment needs timed visemes from the voice engine.
        const cursor=Math.min(speech.length,Math.floor(elapsed/97))
        const phrase=speech.slice(Math.max(0,cursor-85),Math.min(speech.length,cursor+24))
        const next=kiraExpressionFromSpeech(phrase)
        if(expression!==next){
          expression=next
          if(figureRef.current)figureRef.current.dataset.expression=next
        }
      }
      const fallback=phase==='speaking'
        ?kiraSpeechMouthEnvelope(speech,elapsed):0
      const target=phase==='speaking'
        ?(analyser?kiraAudioMouthLevel(rms):fallback)
        :(phase==='listening'?kiraAudioMouthLevel(rms):0)
      smooth=.68*smooth+.32*target
      if(stageRef.current){
        stageRef.current.style.setProperty('--kira-voice-level',String(smooth))
        stageRef.current.style.setProperty('--kira-orb-scale',String(1+smooth*.10))
      }
      if(mouthRef.current){
        const opening=phase==='speaking'?smooth:0
        mouthRef.current.setAttribute('ry',String((.34+opening*3.15).toFixed(2)))
        mouthRef.current.setAttribute('rx',String((4.6+opening*1.1).toFixed(2)))
        mouthRef.current.style.opacity=String(Math.min(.9,.2+opening*.78))
      }
      if(lipRef.current){
        const opening=phase==='speaking'?smooth:0
        lipRef.current.setAttribute('cy',String((77.7+opening*2.2).toFixed(2)))
        lipRef.current.style.opacity=String(opening*.65)
      }
      if(portraitRef.current){
        const amount=reduced?0:phase==='speaking'?.55:phase==='listening'?.27:.16
        const x=Math.sin(elapsed/700)*amount
        const y=Math.sin(elapsed/870)*amount
        const tilt=(expression==='concerned'?-1:expression==='warm'?.6:0)
          +Math.sin(elapsed/1250)*amount*.55
        portraitRef.current.style.transform=
          'translate3d('+x.toFixed(2)+'px,'+y.toFixed(2)+'px,0) rotate('+tilt.toFixed(2)+'deg)'
      }
      frame=window.requestAnimationFrame(animate)
    }
    frame=window.requestAnimationFrame(animate)
    return()=>{
      window.cancelAnimationFrame(frame)
      source?.disconnect();analyser?.disconnect();silent?.disconnect()
      if(audioContext)void audioContext.close().catch(()=>undefined)
    }
  },[active,phase,native])

  if(!active)return null
  return <section ref={stageRef} className={css.stage}
      data-kira-voice-avatar data-voice-phase={observedPhase}
      data-audio-reactive="false" aria-label={'Kira · '+PHASE_TEXT[observedPhase]}>
    <div ref={figureRef} className={css.figure} data-expression="neutral">
      <div className={css.halo}/>
      <div className={css.frame}>
        <img ref={portraitRef} src={KIRA_VOICE_PORTRAIT}
          draggable={false} className={css.portrait}
          alt="Kira, avatar oficial de PHOENIX"/>
        <svg className={css.faceLayer} viewBox="0 0 112 112"
          aria-hidden="true" focusable="false">
          <ellipse ref={mouthRef} cx="69" cy="77.3" rx="4.6" ry=".34"
            fill="#662d29" transform="rotate(-13 69 77.3)" opacity=".2"/>
          <ellipse ref={lipRef} cx="69" cy="77.7" rx="4.7" ry="1.05"
            fill="#f09082" transform="rotate(-13 69 77.7)" opacity="0"/>
          <path className={css.brow} d="M61 45.5 Q68 41 76 44.5"
            stroke="#5c372d" strokeWidth="1.1" fill="none"/>
          <ellipse className={css.cheek} cx="75.5" cy="71.3"
            rx="7" ry="3.6" fill="#f29083"/>
        </svg>
      </div>
    </div>
    <div className={css.statusLine}>
      <span className={css.indicator} aria-hidden="true"/>
      <strong>Kira</strong>
      <span aria-live="polite">{PHASE_TEXT[observedPhase]}</span>
    </div>
    <p className={css.caption}>
      {native?'Codex Live · voz natural':'Voz alternativa · PHOENIX'}
    </p>
    <button className={css.close} type="button" onClick={onStop}
      aria-label="Finalizar conversación por voz" title="Finalizar voz">×</button>
  </section>
}
