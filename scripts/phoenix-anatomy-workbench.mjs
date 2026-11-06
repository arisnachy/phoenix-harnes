#!/usr/bin/env node
/** Explicit local anatomical research workflow, independent of conversation data. */
import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {rootFor,ensure,status} from './phoenix-anatomy-auto.mjs'
import {startViewer} from './phoenix-anatomy-viewer.mjs'
const pythonScript=fileURLToPath(new URL('./phoenix-anatomy-reconstruct.py',import.meta.url))
const args=process.argv.slice(2),cmd=args[0],at=k=>args.includes(k),val=k=>args[args.indexOf(k)+1]
function help(){console.log('Uso: node scripts/phoenix-anatomy-workbench.mjs doctor | install | reconstruct --input <DICOM/NIfTI> --output <carpeta> --modality ct|mr --research-only [--fast] [--structures organo1,organo2] [--mask-folder carpeta-NIfTI] [--view] | view --folder <carpeta> [--open]')}
async function main(){
 if(cmd==='doctor'){console.log(JSON.stringify(status(),null,2));return}
 if(cmd==='install'){console.log(JSON.stringify(ensure(),null,2));return}
 if(cmd==='view'){
  if(!at('--folder'))throw Error('Falta --folder')
  const {url}=await startViewer({folder:val('--folder'),open:at('--open')})
  console.log('Visor privado: '+url);return
 }
 if(cmd==='reconstruct'){
  if(!at('--research-only')||!at('--input')||!at('--output')||!at('--modality')||!['ct','mr'].includes(val('--modality')))throw Error('Requiere estudio, salida, modalidad y --research-only')
  const executable=join(rootFor(),'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python')
  if(!existsSync(executable))throw Error('Dependencias no instaladas. Usa install y doctor')
  const task=[pythonScript,'--input',resolve(val('--input')),'--output',resolve(val('--output')),'--modality',val('--modality'),'--research-only']
  if(at('--fast'))task.push('--fast')
  if(at('--mask-folder'))task.push('--mask-folder',resolve(val('--mask-folder')))
  if(at('--structures')){
   const names=val('--structures').split(',').map(x=>x.trim()).filter(Boolean)
   if(names.length)task.push('--structures',...names)
  }
  const child=spawn(executable,task,{stdio:'inherit',shell:false,windowsHide:true})
  const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',x=>yes(x??1))})
  if(code!==0){process.exitCode=code;return}
  if(at('--view')){const {url}=await startViewer({folder:val('--output'),open:true});console.log('Visor privado: '+url)}
  return
 }
 help()
}
main().catch(e=>{console.error('Anatomy: '+e.message);process.exitCode=1})
