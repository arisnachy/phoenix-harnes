import {createUniver,LocaleType,mergeLocales} from '@univerjs/presets'
import {UniverSheetsCorePreset} from '@univerjs/preset-sheets-core'
import EnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
const CHANNEL='phoenix-univer-v1'
const target=window.location.origin
const post=(value)=>parent.postMessage({channel:CHANNEL,...value},target)
const status=document.getElementById('status')
const {univerAPI}=createUniver({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:mergeLocales(EnUS)},presets:[UniverSheetsCorePreset({container:document.getElementById('app'),header:true,toolbar:true,ribbonType:'collapsed',formulaBar:true,disableAutoFocus:true,footer:{sheetBar:true,statisticBar:true,zoomSlider:true}})]})
let workbook=null,revision=0,loading=false,pending=false,dirty=false,blocked=false,last=''
function capture(){
  if(!workbook)return null
  return {workbook:workbook.save(),sheetId:workbook.getActiveSheet().getSheetId()}
}
function flush(){
  if(loading||pending||blocked||!workbook||!dirty)return
  dirty=false
  try{
    const native=capture(),serialized=JSON.stringify(native)
    if(serialized===last)return
    last=serialized
    pending=true
    post({type:'snapshot',native,revision})
  }catch{post({type:'error'})}
}
let timer
function schedule(){if(loading||blocked)return;dirty=true;clearTimeout(timer);timer=setTimeout(flush,50)}
univerAPI.addEvent(univerAPI.Event.CommandExecuted,schedule)
univerAPI.addEvent(univerAPI.Event.SelectionChanged,({selections})=>{
  const range=selections?.[0]?.range
  if(range)post({type:'selection',row:range.startRow,column:range.startColumn})
})
window.addEventListener('message',event=>{
  if(event.origin!==target||event.source!==parent||event.data?.channel!==CHANNEL)return
  const d=event.data
  if(d.type==='load'){
    // Never silently discard a local edit awaiting acknowledgement.
    if(pending||dirty){blocked=true;status.textContent='Conflicto de edición. Tu libro permanece abierto; descarga una copia antes de recargar.';post({type:'error'});return}
    loading=true
    try{
      if(workbook)univerAPI.disposeUnit(workbook.getId())
      workbook=univerAPI.createWorkbook(d.native.workbook)
      const active=workbook.getSheets().find(s=>s.getSheetId()===d.native.sheetId)
      if(active)workbook.setActiveSheet(active)
      revision=d.revision
      last=JSON.stringify(capture())
      status.textContent=''
    }catch{post({type:'error'});status.textContent='No se pudo abrir esta revisión.'}
    finally{loading=false}
  }else if(d.type==='ack'){
    revision=d.revision;pending=false;flush()
  }else if(d.type==='conflict'){
    blocked=true;status.textContent='No se guardó: revisión en conflicto o almacenamiento lleno. Conserva una copia del libro.'
  }
})
document.getElementById('recovery').addEventListener('click',()=>{
  if(!workbook)return
  const url=URL.createObjectURL(new Blob([JSON.stringify(capture())],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download='phoenix-univer-recovery.json';a.click();URL.revokeObjectURL(url)
})
// Local-only diagnostic for the browser smoke test, no arbitrary code execution API.
window.addEventListener('pagehide',()=>clearTimeout(timer))
post({type:'ready'})
