/** One explicitly selected screen frame, never a persistent screen feed.
 * The native chooser is mandatory; capture is a local draft, not a submission. */
export async function capturePresenceFrame(signal:AbortSignal):Promise<File>{
  if(signal.aborted)throw Error('CAPTURE_CANCELLED')
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('CAPTURE_UNSUPPORTED')
  const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false})
  let video:HTMLVideoElement|undefined
  try{
    if(signal.aborted)throw Error('CAPTURE_CANCELLED')
    video=document.createElement('video');video.muted=true;video.playsInline=true
    const element=video
    await new Promise<void>((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>|undefined
      const track=stream.getVideoTracks()[0]
      const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);element.removeEventListener('loadeddata',ready);element.removeEventListener('error',failed);signal.removeEventListener('abort',cancelled);track?.removeEventListener('ended',cancelled)}
      const ready=()=>{cleanup();resolve()}
      const failed=()=>{cleanup();reject(Error('CAPTURE_FRAME_UNAVAILABLE'))}
      const cancelled=()=>{cleanup();reject(Error('CAPTURE_CANCELLED'))}
      if(!track||track.readyState==='ended'||signal.aborted){cancelled();return}
      element.addEventListener('loadeddata',ready,{once:true})
      element.addEventListener('error',failed,{once:true})
      track.addEventListener('ended',cancelled,{once:true})
      signal.addEventListener('abort',cancelled,{once:true})
      timer=setTimeout(failed,5000)
      element.srcObject=stream
      void element.play().catch(failed)
      if(element.readyState>=2)ready()
    })
    if(signal.aborted||!element.videoWidth||!element.videoHeight)throw Error('CAPTURE_FRAME_UNAVAILABLE')
    const scale=Math.min(1,1600/Math.max(element.videoWidth,element.videoHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(element.videoWidth*scale))
    canvas.height=Math.max(1,Math.round(element.videoHeight*scale))
    const context=canvas.getContext('2d')
    if(!context)throw Error('CAPTURE_FRAME_UNAVAILABLE')
    context.drawImage(element,0,0,canvas.width,canvas.height)
    // Stop sharing before encoding the single still frame.
    for(const track of stream.getTracks())track.stop()
    element.pause();element.srcObject=null
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('CAPTURE_FRAME_UNAVAILABLE')),'image/jpeg',0.82))
    if(signal.aborted)throw Error('CAPTURE_CANCELLED')
    if(blob.type!=='image/jpeg'||blob.size>4_000_000)throw Error('CAPTURE_FRAME_LIMIT')
    return new File([blob],'phoenix-screen.jpg',{type:'image/jpeg'})
  }finally{
    for(const track of stream.getTracks())if(track.readyState!=='ended')track.stop()
    if(video){video.pause();video.srcObject=null}
  }
}
