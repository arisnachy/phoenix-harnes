#!/usr/bin/env node
/**
 * Optional PHOENIX anatomy dependency bootstrap. No patient data, no privileged
 * system modifications, no automatic model downloads. Runs DETACHED on update.
 * Installed libraries are NOT a validated diagnostic imaging pipeline.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, statfsSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 1
const self=fileURLToPath(import.meta.url)
export const rootFor=(env=process.env)=>resolve(env.PHOENIX_ANATOMY_HOME ||
  join(env.LOCALAPPDATA||homedir(),env.LOCALAPPDATA?'PHOENIX':'/.phoenix','anatomy'))
const pathsFor=(env=process.env)=>{
  const root=rootFor(env)
  const bin=process.platform==='win32'?'Scripts':'bin'
  const exe=process.platform==='win32'?'python.exe':'python'
  return {root,venv:join(root,'.venv'),python:join(root,'.venv',bin,exe),
    manifest:join(root,'manifest.json'),lock:join(root,'install.lock'),log:join(root,'install.log')}
}
const modules=[
  {id:'dicom',imports:['pydicom','SimpleITK','nibabel'],pip:['pydicom>=3,<4','SimpleITK>=2.4,<3','nibabel>=5,<6']},
  {id:'volume3d',imports:['vtk'],pip:['vtk>=9.3,<10']},
  {id:'monai',imports:['monai'],pip:['monai>=1.4,<2']},
  {id:'nnunetv2',imports:['nnunetv2'],pip:['nnunetv2>=2,<3']},
  {id:'totalsegmentator',imports:['totalsegmentator'],pip:['TotalSegmentator>=2,<3']},
]
const now=()=>new Date().toISOString()
const log=(p,line)=>{try{appendFileSync(p.log,'['+now()+'] '+line+'\n')}catch{}}
function load(p){
  try{const x=JSON.parse(readFileSync(p.manifest,'utf8'));return x.schema===SCHEMA?x:null}catch{return null}
}
function save(p,state){
  mkdirSync(p.root,{recursive:true})
  const tmp=p.manifest+'.partial'
  writeFileSync(tmp,JSON.stringify({...state,schema:SCHEMA,updatedAt:now()},null,2)+'\n')
  renameSync(tmp,p.manifest)
}
export function needsInstall(manifest,at=Date.now()){
  if(!manifest||manifest.schema!==SCHEMA)return true
  if(modules.every(x=>manifest.components?.[x.id]?.status==='installed') &&
    manifest.components?.slicer?.status==='installed' &&
    manifest.components?.slicerheart?.status==='installed')return false
  const stamp=Date.parse(manifest.updatedAt||'')
  return !Number.isFinite(stamp)||at-stamp>24*60*60*1000
}
async function run(bin,args,{cwd,timeout=900000,output}={}){
  return new Promise((resolveRun,reject)=>{
    let finished=false
    const child=spawn(bin,args,{cwd,windowsHide:true,shell:false,
      stdio:['ignore',output??'ignore',output??'ignore']})
    const timer=setTimeout(()=>{child.kill();if(!finished){finished=true;reject(Error('Timeout: '+bin))}},timeout)
    child.once('error',e=>{if(!finished){finished=true;clearTimeout(timer);reject(e)}})
    child.once('close',code=>{if(!finished){finished=true;clearTimeout(timer);code===0?resolveRun(0):reject(Error(bin+' exited '+code))}})
  })
}
async function pythonCommand(){
  const candidates=process.platform==='win32'
    ?[['py',['-3.12']],['py',['-3.11']],['py',['-3.13']],['python',[]]]
    :[['python3.12',[]],['python3.11',[]],['python3',[]],['python',[]]]
  for(const [bin,args] of candidates){
    try{await run(bin,[...args,'-c','import sys; assert (3,11)<=sys.version_info[:2]<(3,14)'],{timeout:12000});return [bin,args]}catch{}
  }
  if(process.platform==='win32'&&process.env.PHOENIX_ANATOMY_AUTO_PYTHON!=='0'){
    try{await run('winget',['install','--id','Python.Python.3.12','--exact','--scope','user',
      '--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity'],{timeout:360000})}catch{}
    for(const [bin,args] of candidates.slice(0,1)){
      try{await run(bin,[...args,'-c','import sys;assert sys.version_info[:2]>=(3,12)'],{timeout:12000});return [bin,args]}catch{}
    }
  }
  throw Error('Python 3.11-3.13 not found; automated user-scoped Python setup unavailable')
}
async function checkImports(p,names){
  if(!existsSync(p.python))return false
  try{await run(p.python,['-c','import importlib.util,sys;sys.exit(int(not all(importlib.util.find_spec(n) for n in '+JSON.stringify(names)+')))'],{timeout:20000});return true}catch{return false}
}
async function prepareVenv(p){
  if(await checkImports(p,['pip']))return
  const [bin,args]=await pythonCommand()
  await run(bin,[...args,'-m','venv',p.venv],{timeout:180000})
  if(!await checkImports(p,['pip']))throw Error('Isolated Python venv incomplete')
}
function freeBytes(p){try{const s=statfsSync(p.root);return Number(s.bavail)*Number(s.bsize)}catch{return 0}}
async function installPythonComponents(p,state,fd){
  await prepareVenv(p)
  for(const component of modules){
    const previous=state.components[component.id]
    if(previous?.status==='installed'&&await checkImports(p,component.imports))continue
    if(component.id!=='dicom'&&freeBytes(p)<12e9){
      state.components[component.id]={status:'deferred',reason:'less than 12 GB available'}
      save(p,state);continue
    }
    state.components[component.id]={status:'installing'};save(p,state)
    try{
      if(!await checkImports(p,component.imports)){
        await run(p.python,['-m','pip','install','--disable-pip-version-check','--prefer-binary',...component.pip],
          {cwd:p.root,timeout:1800000,output:fd})
      }
      if(!await checkImports(p,component.imports))throw Error('Import verification failed')
      state.components[component.id]={status:'installed',verifiedAt:now()}
    }catch(e){state.components[component.id]={status:'error',reason:String(e).slice(0,250)};log(p,component.id+': '+String(e))}
    save(p,state)
  }
}
function findSlicer(){
  if(process.platform!=='win32')return null
  const local=process.env.LOCALAPPDATA
  if(!local)return null
  for(const base of [join(local,'NA-MIC'),join(local,'Programs')]){
    try{
      const folders=readdirSync(base,{withFileTypes:true})
      for(const entry of folders){
        if(!entry.isDirectory()||!/^Slicer(?:[ ._-]|$)/i.test(entry.name))continue
        const path=join(base,entry.name,'Slicer.exe')
        if(existsSync(path))return path
      }
    }catch{}
  }
  return null
}

async function installSlicer(p,state,fd){
  if(process.platform!=='win32'){
    state.components.slicer={status:'external',reason:'Windows installer only; use official platform package'}
    return
  }
  // Use the vendor's user-scoped installer; it validates the Slicer payload SHA512.
  // No arbitrary URLs, forced admin elevation, downloads of patient data or model weights.
  const existing=findSlicer()
  if(existing){
    state.components.slicer={status:'installed',verifiedAt:now(),executable:existing}
    return
  }
  try{
    const cmd="& { $ErrorActionPreference='Stop'; "+
      "$u='https://download.slicer.org/install.ps1';"+
      "$p=Join-Path $env:TEMP 'phoenix-slicer-official-install.ps1';"+
      "Invoke-WebRequest -Uri $u -OutFile $p -UseBasicParsing;"+
      "& $p; if(-not $?) { exit 2 } }"
    await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',cmd],
      {timeout:1200000,output:fd})
    const installed=findSlicer()
    if(!installed)throw Error('Slicer installer finished but Slicer.exe was not located')
    state.components.slicer={status:'installed',verifiedAt:now(),executable:installed}
  }catch(e){state.components.slicer={status:'error',reason:String(e).slice(0,250)};log(p,'slicer: '+String(e))}
}
async function installSlicerHeart(p,state,fd){
  const slicerExe=findSlicer()
  if(!slicerExe){
    state.components.slicerheart={status:'deferred',reason:'Slicer.exe not found'}
    return
  }
  const script=join(p.root,'install-slicerheart.py')
  const content=[
    'import slicer',
    'em = slicer.app.extensionsManagerModel()',
    'em.interactive = False',
    "ok = em.isExtensionInstalled('SlicerHeart') or em.installExtensionFromServer('SlicerHeart', False)",
    "slicer.app.exit(0 if ok else 2)",
  ].join('\n')+'\n'
  writeFileSync(script,content,'utf8')
  try{
    await run(slicerExe,['--no-splash','--python-script',script],{timeout:360000,output:fd})
    state.components.slicerheart={status:'installed',verifiedAt:now(),note:'Slicer extension manager reported success'}
  }catch(e){
    state.components.slicerheart={status:'error',reason:String(e).slice(0,250)}
    log(p,'slicerheart: '+String(e))
  }
}

async function worker(env=process.env){
  const p=pathsFor(env)
  mkdirSync(p.root,{recursive:true})
  const fd=openSync(p.log,'a')
  const state=load(p)||{components:{}}
  state.components||={}
  state.platform=process.platform
  try{
    log(p,'Starting anatomy bootstrap; installation does not imply clinical validation')
    await installPythonComponents(p,state,fd)
    save(p,state)
    await installSlicer(p,state,fd)
    await installSlicerHeart(p,state,fd)
    state.components.simvascular={status:'external',reason:'Native binary requires verified vendor distribution'}
    state.components.opencarp={status:'external',reason:'Windows requires verified WSL2/Docker runtime; not a native pip package'}
    state.components.viewer={status:'pending-integration',reason:'OHIF/Cornerstone3D/Three.js/vtk.js must be built into PHOENIX web client'}
    state.clinicalValidation='not-validated'
    save(p,state)
    log(p,'Bootstrap finished; review manifest and install.log for partial failures')
  }finally{
    closeSync(fd)
    try{rmSync(p.lock,{force:true})}catch{}
  }
}
export function status(env=process.env){
  const p=pathsFor(env);const v=load(p)
  return {root:p.root,manifest:p.manifest,log:p.log,initialized:!!v,
    installed:modules.every(m=>v?.components?.[m.id]?.status==='installed'),components:v?.components||{},
    clinicallyValidated:false,notes:'Package installation alone does not reconstruct, verify or diagnose a patient.'}
}
export function ensure(env=process.env,launch=spawn){
  const p=pathsFor(env)
  if(env.PHOENIX_ANATOMY_AUTO_INSTALL==='0'||env.CI==='true'||env.NODE_ENV==='test')
    return {status:'disabled',...status(env)}
  if(!needsInstall(load(p)))return {status:'up-to-date',...status(env)}
  mkdirSync(p.root,{recursive:true})
  try{
    const age=Date.now()-statSync(p.lock).mtimeMs
    if(age>=-60000&&age<60*60*1000)return {status:'running',...status(env)}
    rmSync(p.lock,{force:true})
  }catch{}
  try{const fd=openSync(p.lock,'wx');closeSync(fd)}catch{return {status:'running',...status(env)}}
  try{
    const child=launch(process.execPath,[self,'--worker'],{
      cwd:resolve(fileURLToPath(new URL('..',import.meta.url))),detached:true,
      windowsHide:true,shell:false,env,stdio:'ignore'})
    child.unref()
    return {status:'started',...status(env)}
  }catch(e){
    rmSync(p.lock,{force:true});log(p,'launch error '+String(e))
    return {status:'error',error:String(e),...status(env)}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===self){
  if(process.argv.includes('--worker'))worker().catch(e=>{
    const p=pathsFor();log(p,'FATAL '+String(e));try{rmSync(p.lock,{force:true})}catch{}
    process.exitCode=1
  })
  else if(process.argv.includes('--status'))console.log(JSON.stringify(status(),null,2))
  else console.log(JSON.stringify(ensure(),null,2))
}
