import {useEffect,useRef,useState,type ReactNode} from 'react'
import {validNativeWorkbook,type NativeWorkbook} from './native-workbook.ts'
import css from './InteractiveUi.module.css'
type Props={native:NativeWorkbook;revision:number;onSave:(state:NativeWorkbook,revision:number)=>number|null;onLoaded:(state:NativeWorkbook,revision:number)=>number|null;onSelection:(row:number,column:number)=>void;onFailure:(message:string,startup:boolean)=>void}
const CHANNEL='phoenix-univer-v1'
/** The trusted bundled editor is on the same local origin, never a remote URL. */
export function UniverFrame({native,revision,onSave,onLoaded,onSelection,onFailure}:Props):ReactNode{
  const frame=useRef<HTMLIFrameElement|null>(null)
  const current=useRef({native,revision,onSave,onLoaded,onSelection,onFailure})
  current.current={native,revision,onSave,onLoaded,onSelection,onFailure}
  const sent=useRef<number|null>(null)
  const [ready,setReady]=useState(false)
  const send=(data:object)=>frame.current?.contentWindow?.postMessage({channel:CHANNEL,...data},window.location.origin)
  useEffect(()=>{
    const timer=window.setTimeout(()=>{if(sent.current===null)current.current.onFailure('El motor ofimático no pudo iniciarse. Se conserva el archivo.',true)},18000)
    const listen=(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return
      const d=event.data
      if(!d||d.channel!==CHANNEL)return
      if(d.type==='ready'){
        sent.current=current.current.revision
        send({type:'load',native:current.current.native,revision:sent.current})
        setReady(true)
      }else if((d.type==='snapshot'||d.type==='loaded')&&validNativeWorkbook(d.native)&&Number.isSafeInteger(d.revision)){
        const next=d.type==='loaded'?current.current.onLoaded(d.native,d.revision):current.current.onSave(d.native,d.revision)
        if(next===null){
          // Do not replace an unsaved native buffer on conflict.
          send({type:'conflict'})
          return
        }
        sent.current=next
        send({type:'ack',revision:next})
      }else if(d.type==='selection'&&Number.isSafeInteger(d.row)&&Number.isSafeInteger(d.column)){
        current.current.onSelection(d.row,d.column)
      }else if(d.type==='error'){
        current.current.onFailure('El motor ofimático informó un error. Se conserva la última revisión guardada y el editor abierto.',false)
      }
    }
    window.addEventListener('message',listen)
    return()=>{window.clearTimeout(timer);window.removeEventListener('message',listen)}
  },[])
  useEffect(()=>{
    if(ready&&sent.current!==revision){
      sent.current=revision
      send({type:'load',native,revision})
    }
  },[ready,native,revision])
  return <iframe ref={frame} className={css.nativeOfficeFrame} src="/office-engine/index.html" title="Univer Sheets · editor de libro activo" referrerPolicy="no-referrer"/>
}
