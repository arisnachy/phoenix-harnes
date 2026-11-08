/**
 * Local anatomy dependency connector for PHOENIX Settings.
 * A verified package does NOT prove patient-specific clinical capability.
 * No PHI, file paths, environment secrets, or subprocess logs cross the Remote.
 */
import {spawn} from 'node:child_process'
import {existsSync,readFileSync,statSync,readdirSync,mkdirSync,openSync,closeSync,rmSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {AnatomyConnectorEntry,AnatomyConnectorId,AnatomyConnectorInstallReceipt,AnatomyConnectorSnapshot} from './types.ts'

const home=()=>resolve(process.env.PHOENIX_ANATOMY_HOME||
  join(process.env.LOCALAPPDATA||homedir(),process.env.LOCALAPPDATA?'PHOENIX':'.phoenix','anatomy'))
const script=fileURLToPath(new URL('../../../../scripts/phoenix-anatomy-auto.mjs',import.meta.url))
const ids=['slicerheart','monai-nnunet','totalsegmentator','ohif-cornerstone',
  'simvascular','opencarp','three-vtk'] as const satisfies readonly AnatomyConnectorId[]
const valid=(id:string):id is AnatomyConnectorId=>(ids as readonly string[]).includes(id)
type State={status?:string;reason?:string;verifiedAt?:string;source?:string}
function readManifest():{components:Record<string,State>;bootstrap?:{status?:string;component?:string;current?:string;completed?:number;total?:number}}{
 try{const m=JSON.parse(readFileSync(join(home(),'manifest.json'),'utf8'))
   return m.schema===2?{components:m.components||{},bootstrap:m.bootstrap}:{components:{}}
 }catch{return {components:{}}}
}
const fresh=(v:State|undefined)=>v?.status==='installed'&&
  Number.isFinite(Date.parse(v.verifiedAt||''))&&
  Date.now()-Date.parse(v.verifiedAt||'')<7*24*3600*1000
const pyReady=()=>existsSync(join(home(),'.venv',process.platform==='win32'?'Scripts':'bin',
  process.platform==='win32'?'python.exe':'python'))
const isInstalled=(s:Record<string,State>,name:string)=>pyReady()&&s[name]?.status==='installed'
const hasBaselineWeights=()=>{
 const folder=join(resolve(process.env.TOTALSEG_HOME_DIR||join(home(),'models')),'nnunet','results')
 if(!existsSync(folder))return false
 let count=0
 const stack:[string,number][]=[[folder,0]]
 while(stack.length&&count<1500){
  const [root,depth]=stack.pop()!
  let entries
  try{entries=readdirSync(root,{withFileTypes:true})}catch{continue}
  for(const e of entries){
   if(++count>1500)break
   const path=join(root,e.name)
   if(e.isDirectory()&&depth<6)stack.push([path,depth+1])
   if(e.isFile()&&/\.(?:pth|pt|ckpt)$/iu.test(e.name)){
     try{if(statSync(path).size>10*1024*1024)return true}catch{}
   }
  }
 }
 return false
}
const localPackage=(name:string,dir='viewer')=>
  existsSync(join(home(),dir,'node_modules',...name.split('/'),'package.json'))
const lockAlive=()=>{
 try{const age=Date.now()-statSync(join(home(),'install.lock')).mtimeMs
  return age>=-60000&&age<60*60*1000}catch{return false}
}
function entry(id:AnatomyConnectorId,title:string,installed:boolean,
 operational:boolean,canInstall:boolean,detail:string,
 s:Record<string,State>,keys:string[],docs?:string):AnatomyConnectorEntry{
 const failed=keys.find(k=>s[k]?.status==='error')
 const deferred=keys.find(k=>s[k]?.status==='deferred')
 const diagnose=(key:string)=>{
   const reason=s[key]?.reason||''
   if(/Python|venv|pip|Import|module/i.test(reason))return 'Revisa Python 3.11–3.13 y el entorno aislado'
   if(/space|GB|disk|available/i.test(reason))return 'Se necesita espacio libre en disco'
   if(/npm|node|package|artifact/i.test(reason))return 'Revisa Node.js y npm local'
   if(/winget|Slicer|extension/i.test(reason))return 'Revisa WinGet, la ruta de Slicer y SlicerHeart'
   if(/Docker|daemon|WSL2|registry/i.test(reason))return 'Instala e inicia Docker Desktop o configura WSL2; después reintenta'
   if(/Timeout|exited/i.test(reason))return 'El instalador terminó con error o agotó el tiempo'
   return 'Consulta install.log local para conocer el error exacto'
 }
 const external=keys.every(k=>s[k]?.status==='external')&&!canInstall
 const phase=installed?(operational?'ready':'libraries') : failed?'error':
   lockAlive()?'installing':external?'external':'missing'
 return {id,title,installed,operational,canInstall,phase,
   detail:failed?`Fallo en ${failed}. ${diagnose(failed)}. Registro: install.log local.`:
     deferred?`Pendiente: ${diagnose(deferred)}. Puedes reintentar.`:detail,
   ...(docs?{docs}:{} )}
}
/** Recompute status from disk + worker manifest; never trust a remembered toggle. */
export function readAnatomyConnectors():AnatomyConnectorSnapshot{
 const m=readManifest(),s=m.components,viewer=localPackage('three')&&
   existsSync(join(home(),'viewer','node_modules','three','examples','jsm','loaders','GLTFLoader.js'))
 const meshes=localPackage('@kitware/vtk.js')
 const cs=['@cornerstonejs/core','@cornerstonejs/tools','@cornerstonejs/dicom-image-loader']
   .every(x=>localPackage(x,'imaging'))
 const slicer=Boolean(s.slicer?.status==='installed'&&
   s.slicerheart?.status==='installed'&&
   (s.slicer as State&{executable?:string}).executable&&
   existsSync((s.slicer as State&{executable:string}).executable))
 const model=Boolean(isInstalled(s,'totalsegmentator')&&s.weights_ct?.status==='installed'&&hasBaselineWeights())
 const runtimeFresh=(name:string)=>fresh(s[name])
 const entries:AnatomyConnectorEntry[]=[
  entry('slicerheart','3D Slicer + SlicerHeart',slicer,false,true,
    'Reconstrucción cardiaca: instalación comprobada; flujo TC/RM/ecografía y extensión requieren prueba con datos autorizados.',
    s,['slicer','slicerheart'],'https://slicer.org'),
  entry('monai-nnunet','MONAI + nnU-Net',isInstalled(s,'monai')&&isInstalled(s,'nnunetv2'),false,true,
    'Bibliotecas Python para segmentación. Cada tarea necesita pesos compatibles y validación independiente.',
    s,['monai','nnunetv2'],'https://monai.io'),
  entry('totalsegmentator','TotalSegmentator',model,false,true,
    'Biblioteca y pesos CT abiertos preparados. La segmentación requiere un estudio volumétrico y verificación de salida.',
    s,['totalsegmentator','weights_ct'],'https://github.com/wasserth/TotalSegmentator'),
  {...entry('ohif-cornerstone','OHIF + Cornerstone3D',false,false,!cs,
    'Bibliotecas Cornerstone3D: '+(cs?'instaladas. ':'pendientes. ')+'OHIF requiere despliegue y PACS/DICOMweb autorizado; no es un visor clínico listo.',
    s,['cornerstone'],'https://docs.ohif.org/deployment/'),
    phase:cs?'libraries' as const:'missing' as const},
  entry('simvascular','SimVascular',runtimeFresh('simvascular'),false,false,
    'Motor externo de hemodinámica: configurar y comprobar binario oficial/WSL2 y un modelo de flujo preparado.',
    s,['simvascular'],'https://simvascular.github.io/'),
  entry('opencarp','openCARP',runtimeFresh('opencarp'),false,true,
    'Instalación automática desde imagen oficial Docker (requiere Docker Desktop iniciado) o detección de WSL2/Linux. Simulación científica, no visualizador 3D ni diagnóstico clínico.',
    s,['opencarp'],'https://opencarp.org/download/installation/install-docker'),
  entry('three-vtk','Three.js + vtk.js',viewer&&meshes,false,true,
    'Visor GLB local y bibliotecas vtk.js. Cortes volumétricos y simulación requieren herramientas adicionales.',
    s,['viewer','vtkjs'],'https://kitware.github.io/vtk-js/')
 ]
 const b=m.bootstrap
 const progress=b?.component==='all'&&typeof b.completed==='number'&&b.total===7?
   {completed:Math.max(0,Math.min(7,b.completed)),total:7,
    ...(valid(b.current||'')?{current:b.current as AnatomyConnectorId}:{}),
    status:(b.status==='running'||b.status==='error'?b.status:'finished') as 'running'|'error'|'finished'}:undefined
 return {entries,running:lockAlive(),readyCount:entries.filter(x=>x.installed).length,
   ...(progress?{progress}:{}),clinicalValidation:'not-validated'}
}
export function installAnatomyConnector(id:AnatomyConnectorId|'all'):AnatomyConnectorInstallReceipt{
 if(id!=='all'&&!valid(id))throw Error('Unsupported anatomy connector')
 if(id==='simvascular')
  return{id,status:'blocked',detail:'Requiere instalación oficial externa y configuración en Linux/WSL2; no se instalará silenciosamente.'}
 if(!existsSync(script))return{id,status:'blocked',detail:'Este runtime no contiene el instalador anatómico.'}
 if(lockAlive())return{id,status:'running',detail:'Ya existe una instalación en ejecución. Comprueba el progreso.'}
 const lock=join(home(),'install.lock')
 try{
  mkdirSync(home(),{recursive:true})
  // Remove only abandoned locks; ordinary simultaneous clicks still contend on O_EXCL.
  try{if(Date.now()-statSync(lock).mtimeMs>=60*60*1000)rmSync(lock,{force:true})}catch{}
  // Acquire the same worker lock before spawning; prevents double-click races.
  const fd=openSync(lock,'wx');closeSync(fd)
 }catch{return{id,status:'running',detail:'Otra instalación acaba de comenzar.'}}
 try{
  const args=id==='all'?['--worker','--install-all']:['--worker','--install-component',id]
  const worker=spawn(process.execPath,[script,...args],{
   cwd:resolve(fileURLToPath(new URL('../../../../',import.meta.url))),
   detached:true,windowsHide:true,shell:false,stdio:'ignore',env:process.env})
  worker.on('error',()=>{try{rmSync(lock,{force:true})}catch{}})
  worker.unref()
  return{id,status:'started',detail:id==='all'?
    'Instalación secuencial iniciada. openCARP usará Docker oficial si hace falta; SimVascular sigue siendo externo.':
    'Instalación local iniciada. Consulta el estado para ver el resultado.'}
 }catch{
  try{rmSync(lock,{force:true})}catch{}
  return{id,status:'error',detail:'No fue posible iniciar el instalador local.'}
 }
}
